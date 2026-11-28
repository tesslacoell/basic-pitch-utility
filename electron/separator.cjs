/**
 * HTDemucs 6s stem separator — main-process module.
 *
 * The app ships WITHOUT the model. On first use the renderer asks the
 * user to agree to the model's license; only then does the app download
 * the model (once per model version) into the user-data models folder
 * and cache it there. Nothing about separation works without the model,
 * by design: there is no filter-bank fallback pretending to be a stem.
 *
 * Model: htdemucs_6s (Meta AI) ONNX export, full fp32 build. (The
 * fp16-weights build was retired in beta.2 during the first in-app
 * crash investigation; the crash was later proven model-independent
 * — see the arena note at InferenceSession.create below. fp32 stays:
 * it is the model's native precision and ran faster in testing.)
 *   stems: drums, bass, other, vocals, guitar, piano
 *   license: MIT (per the export's model card)
 *   sha256 pinned below — a download that does not match is rejected.
 *
 * This module is deliberately free of Electron imports so it can be
 * exercised from plain Node (scripts/test-separator.cjs). The caller
 * injects the models directory and a progress callback.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const MODEL = {
  version: 'htdemucs-6s-fp32-v1',
  fileName: 'htdemucs_6s.onnx',
  url: 'https://huggingface.co/Acapellas/htdemucs-6s-onnx/resolve/main/htdemucs_6s.onnx',
  sizeBytes: 258159781,
  sha256: '48f8e84945579f8ab340e083339e9221e03785dbe733a52c388200b6d3ca779a',
  licenseName: 'MIT',
};

// Demucs output order in the ONNX graph.
const DEMUCS_STEMS = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
// App stem -> demucs stem. ('other' has no app stem of its own; the
// full-mix transcription covers its content. Its WAV is still written
// to the session folder with the rest.)
const APP_TO_DEMUCS = {
  drums: 'drums',
  bass: 'bass',
  lead: 'vocals',
  guitar: 'guitar',
  piano: 'piano',
};

const SAMPLE_RATE = 44100;
const SEGMENT = 343980; // 7.8 s — the model's fixed input length
const OVERLAP = Math.floor(SEGMENT / 4);
const STRIDE = SEGMENT - OVERLAP;
const ANALYSIS_RATE = 22050; // what Basic Pitch / the drum transcriber eat

function resolveModelPath(modelsDir) {
  const override = process.env.BASIC_PITCH_DEMUCS_MODEL;
  if (override && fs.existsSync(override)) return override;
  const p = path.join(modelsDir, MODEL.fileName);
  return fs.existsSync(p) && fs.statSync(p).size === MODEL.sizeBytes ? p : null;
}

function getModelStatus(modelsDir) {
  const p = resolveModelPath(modelsDir);
  return p
    ? { state: 'ready', version: MODEL.version, path: p }
    : { state: 'missing', version: MODEL.version, sizeBytes: MODEL.sizeBytes };
}

function downloadModel(modelsDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(modelsDir, { recursive: true });
    const finalPath = path.join(modelsDir, MODEL.fileName);
    const partPath = finalPath + '.part';
    const hash = crypto.createHash('sha256');
    let received = 0;

    const cleanup = (err) => {
      try { fs.unlinkSync(partPath); } catch { /* already gone */ }
      reject(err);
    };

    const request = (url, redirects) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects <= 0) return cleanup(new Error('Too many redirects downloading the separator model.'));
          res.resume();
          return request(res.headers.location, redirects - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return cleanup(new Error(`Model download failed (HTTP ${res.statusCode}).`));
        }
        const out = fs.createWriteStream(partPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          hash.update(chunk);
          if (onProgress) {
            onProgress({ phase: 'download', receivedBytes: received, totalBytes: MODEL.sizeBytes });
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            const digest = hash.digest('hex');
            if (received !== MODEL.sizeBytes || digest !== MODEL.sha256) {
              return cleanup(new Error('Downloaded model failed verification (size or checksum mismatch).'));
            }
            fs.renameSync(partPath, finalPath);
            resolve({ state: 'ready', version: MODEL.version, path: finalPath });
          });
        });
        out.on('error', cleanup);
      }).on('error', cleanup);
    };

    request(MODEL.url, 5);
  });
}

/** Minimal 16-bit PCM WAV reader (the renderer guarantees this format). */
function readWav16(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Separator input is not a WAV file.');
  }
  let fmt = null;
  let data = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      data = buf.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('Separator input WAV is missing fmt/data chunks.');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels !== 2 || fmt.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Separator needs 16-bit stereo WAV at ${SAMPLE_RATE} Hz (got ${fmt.bitsPerSample}-bit, ${fmt.channels} ch, ${fmt.sampleRate} Hz).`);
  }
  const frames = Math.floor(data.length / 4);
  const interleaved = new Float32Array(frames * 2);
  for (let i = 0; i < frames * 2; i++) {
    interleaved[i] = data.readInt16LE(i * 2) / 32768;
  }
  return { frames, interleaved };
}

/** Session stems are written as 24-bit WAV — the format DAWs expect. */
function writeWav24(filePath, ch0, ch1, frames) {
  const dataSize = frames * 2 * 3;
  const bytes = new Uint8Array(44 + dataSize);
  const v = new DataView(bytes.buffer);
  const asc = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  asc(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); asc(8, 'WAVE');
  asc(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 6, true); v.setUint16(32, 6, true); v.setUint16(34, 24, true);
  asc(36, 'data'); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const x = Math.max(-1, Math.min(1, (ch === 0 ? ch0 : ch1)[i]));
      const int24 = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
      bytes[o] = int24 & 0xff;
      bytes[o + 1] = (int24 >> 8) & 0xff;
      bytes[o + 2] = (int24 >> 16) & 0xff;
      o += 3;
    }
  }
  fs.writeFileSync(filePath, bytes);
}

/**
 * Stereo 44.1k -> mono 22.05k analysis samples: mono mix, a [1,2,1]/4
 * smoothing pass (cheap anti-alias), then decimate by 2.
 */
function toAnalysisSamples(ch0, ch1, frames) {
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  const outLen = Math.floor(frames / 2);
  const out = new Float32Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const i = n * 2;
    const a = mono[Math.max(0, i - 1)];
    const b = mono[i];
    const c = mono[Math.min(frames - 1, i + 1)];
    out[n] = (a + 2 * b + c) * 0.25;
  }
  return out;
}

/**
 * Runs the separation. Stems accumulate on disk inside sessionDir (the
 * full-song float arrays never sit in RAM); the caller gets back the
 * session's WAV file names plus, for each wanted app stem, its 22.05k
 * mono analysis samples.
 */
async function separate(modelsDir, inputWavPath, sessionDir, wantAppStems, onProgress) {
  const modelPath = resolveModelPath(modelsDir);
  if (!modelPath) throw new Error('Separator model is not downloaded yet.');

  // Required lazily so the app (and this module's status/download
  // paths) work even before the native runtime is exercised.
  const ort = require('onnxruntime-node');

  fs.mkdirSync(sessionDir, { recursive: true });
  const { frames: total, interleaved } = readWav16(inputWavPath);
  const mix = [new Float32Array(total), new Float32Array(total)];
  for (let i = 0; i < total; i++) {
    mix[0][i] = interleaved[i * 2];
    mix[1][i] = interleaved[i * 2 + 1];
  }

  const window = new Float32Array(SEGMENT).fill(1);
  for (let i = 0; i < OVERLAP; i++) {
    const f = i / OVERLAP;
    window[i] = f;
    window[SEGMENT - 1 - i] = f;
  }

  const stemFds = DEMUCS_STEMS.map((name) => {
    const fd = fs.openSync(path.join(sessionDir, `.${name}.f32`), 'w+');
    fs.ftruncateSync(fd, 2 * total * 4);
    return fd;
  });
  const weight = new Float32Array(total);

  const session = await ort.InferenceSession.create(modelPath, {
    graphOptimizationLevel: 'all',
    // The CPU memory arena must stay OFF in the Electron main process:
    // the arena's BFC Extend makes very large single allocations, and
    // an allocation failure inside Chromium's browser process is fatal
    // (EXC_BREAKPOINT in BFCArena::Extend on the first chunk — the
    // beta.1/beta.2 crash). Per-tensor allocation completes the same
    // separation reliably; verified in an Electron harness run.
    enableCpuMemArena: false,
    enableMemPattern: false,
  });

  const nChunks = Math.max(1, Math.ceil(total / STRIDE));
  const chunkBuf = new Float32Array(2 * SEGMENT);
  const acc = new Float32Array(SEGMENT);

  try {
    for (let c = 0; c < nChunks; c++) {
      const start = c * STRIDE;
      const end = Math.min(start + SEGMENT, total);
      const clen = end - start;
      chunkBuf.fill(0);
      for (let ch = 0; ch < 2; ch++) {
        chunkBuf.set(mix[ch].subarray(start, end), ch * SEGMENT);
      }
      const { stems } = await session.run({
        mix: new ort.Tensor('float32', chunkBuf, [1, 2, SEGMENT]),
      });
      const data = stems.data; // (6, 2, SEGMENT)
      for (let s = 0; s < DEMUCS_STEMS.length; s++) {
        for (let ch = 0; ch < 2; ch++) {
          const srcOff = (s * 2 + ch) * SEGMENT;
          const fileOff = (ch * total + start) * 4;
          fs.readSync(stemFds[s], acc, 0, clen * 4, fileOff);
          for (let i = 0; i < clen; i++) acc[i] += data[srcOff + i] * window[i];
          fs.writeSync(stemFds[s], Buffer.from(acc.buffer, 0, clen * 4), 0, clen * 4, fileOff);
        }
      }
      for (let i = 0; i < clen; i++) weight[start + i] += window[i];
      if (onProgress) {
        onProgress({ phase: 'separate', chunk: c + 1, chunks: nChunks });
      }
    }
  } finally {
    if (typeof session.release === 'function') {
      try { await session.release(); } catch { /* best effort */ }
    }
  }

  const analysis = {};
  const wavFiles = {};
  for (let s = 0; s < DEMUCS_STEMS.length; s++) {
    const name = DEMUCS_STEMS[s];
    const raw = new Float32Array(2 * total);
    fs.readSync(stemFds[s], Buffer.from(raw.buffer), 0, 2 * total * 4, 0);
    fs.closeSync(stemFds[s]);
    fs.unlinkSync(path.join(sessionDir, `.${name}.f32`));
    const ch0 = raw.subarray(0, total);
    const ch1 = raw.subarray(total, 2 * total);
    for (let ch = 0; ch < 2; ch++) {
      const chan = ch === 0 ? ch0 : ch1;
      for (let i = 0; i < total; i++) chan[i] /= Math.max(weight[i], 1e-8);
    }
    const wavName = `${name}.wav`;
    writeWav24(path.join(sessionDir, wavName), ch0, ch1, total);
    wavFiles[name] = wavName;

    const appStem = Object.keys(APP_TO_DEMUCS).find((k) => APP_TO_DEMUCS[k] === name);
    if (appStem && wantAppStems.includes(appStem)) {
      analysis[appStem] = toAnalysisSamples(ch0, ch1, total);
    }
  }

  return {
    durationSeconds: total / SAMPLE_RATE,
    analysisSampleRate: ANALYSIS_RATE,
    analysis,
    wavFiles,
  };
}

module.exports = {
  MODEL,
  DEMUCS_STEMS,
  APP_TO_DEMUCS,
  getModelStatus,
  downloadModel,
  separate,
};
