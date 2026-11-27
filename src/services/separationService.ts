/**
 * Renderer-side client for the HTDemucs 6s separator, which lives in
 * the Electron main process (electron/separator.cjs).
 *
 * The app ships without the model. The first time a conversion needs
 * real stems, the user is asked to agree to the model's license; the
 * app then downloads the model once (per model version) and caches it
 * in user data. If the model is unavailable or the user declines,
 * conversion stops with an explanation — the named stems are never
 * faked with filter bands.
 */

import type { StemType } from './stemSeparationService';
import type { DemucsProgress } from '../types/electron';

export const SEPARATOR_MODEL = {
  name: 'HTDemucs 6s',
  byline: 'Meta AI — ONNX export via Hugging Face (Acapellas)',
  sizeMB: 130,
  licenseName: 'MIT',
  licenseUrl: 'https://huggingface.co/Acapellas/htdemucs-6s-onnx/blob/main/README.md',
};

/** App stem -> demucs stem name (the session WAV files use demucs names). */
export const APP_TO_DEMUCS: Partial<Record<StemType, string>> = {
  piano: 'piano',
  guitar: 'guitar',
  bass: 'bass',
  lead: 'vocals',
  drums: 'drums',
};

export interface SeparationOutcome {
  sessionId: string;
  /** Analysis buffers (22.05 kHz mono) keyed by app stem, ready for the models. */
  buffers: Map<StemType, AudioBuffer>;
}

function api() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

export function isSeparatorAvailable(): boolean {
  const a = api();
  return Boolean(a?.isElectron && a.demucsSeparate);
}

export async function getSeparatorModelStatus(): Promise<'ready' | 'missing' | 'unavailable'> {
  const a = api();
  if (!a?.demucsModelStatus) return 'unavailable';
  const status = await a.demucsModelStatus();
  return status.state;
}

export async function downloadSeparatorModel(
  onProgress: (progress: DemucsProgress) => void
): Promise<void> {
  const a = api();
  if (!a?.demucsDownloadModel) throw new Error('Separator is unavailable outside the desktop app.');
  const off = a.onDemucsProgress?.(onProgress);
  try {
    await a.demucsDownloadModel();
  } finally {
    off?.();
  }
}

// --- base64 helpers (chunked; song-length payloads are tens of MB) ----

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- 16-bit WAV encode (transfer format for the separator input) ------

function encodeWav16PcmBytes(
  channels: Float32Array[],
  sampleRate: number
): Uint8Array {
  const frames = channels[0].length;
  const numCh = channels.length;
  const dataSize = frames * numCh * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const asc = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i));
  };
  asc(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  asc(8, 'WAVE');
  asc(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  asc(36, 'data');
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const x = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(o, Math.round(x * 32767), true);
      o += 2;
    }
  }
  return bytes;
}

/** Renders the decoded master as a 44.1 kHz stereo buffer for the model. */
async function renderMasterForSeparator(masterBuffer: AudioBuffer): Promise<AudioBuffer> {
  const targetRate = 44100;
  const targetLength = Math.ceil(masterBuffer.duration * targetRate);
  const offlineCtx = new OfflineAudioContext(2, targetLength, targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = masterBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  return await offlineCtx.startRendering();
}

/**
 * Separates the master into real stems via the main process.
 * `onModelNeeded` is the consent hook: it resolves true if the user
 * agreed to the model license (the download then happens here, with
 * progress), false to abort the conversion.
 */
export async function separateMasterBuffer(
  masterBuffer: AudioBuffer,
  wantStems: StemType[],
  hooks: {
    onProgress: (progress: DemucsProgress) => void;
    onModelNeeded: () => Promise<boolean>;
  }
): Promise<SeparationOutcome> {
  const a = api();
  if (!a?.demucsSeparate) {
    throw new Error(
      'Stem separation runs in the desktop app (it needs the HTDemucs model). ' +
        'The Full Mix transcription still works here, but Piano/Guitar/Bass/Lead/Drums need the app.'
    );
  }

  let status = await getSeparatorModelStatus();
  if (status === 'missing') {
    const agreed = await hooks.onModelNeeded();
    if (!agreed) {
      throw new Error('Separation cancelled — the HTDemucs model was not downloaded.');
    }
    await downloadSeparatorModel(hooks.onProgress);
    status = await getSeparatorModelStatus();
  }
  if (status !== 'ready') {
    throw new Error('The separator model is still unavailable after download.');
  }

  const rendered = await renderMasterForSeparator(masterBuffer);
  const wavBytes = encodeWav16PcmBytes(
    [rendered.getChannelData(0), rendered.getChannelData(1)],
    rendered.sampleRate
  );

  const off = a.onDemucsProgress?.(hooks.onProgress);
  let result;
  try {
    result = await a.demucsSeparate({
      wavBase64: bytesToBase64(wavBytes),
      wantStems: wantStems.filter((s) => s !== 'full_mix'),
    });
  } finally {
    off?.();
  }

  const ctx = new OfflineAudioContext(1, 1, result.analysisSampleRate);
  const buffers = new Map<StemType, AudioBuffer>();
  for (const [stem, bytes] of Object.entries(result.analysis)) {
    const u8 = bytes as Uint8Array;
    const samples = new Float32Array(u8.byteLength / 4);
    new Uint8Array(samples.buffer).set(u8.subarray(0, samples.byteLength));
    const buffer = ctx.createBuffer(1, samples.length, result.analysisSampleRate);
    buffer.copyToChannel(samples, 0);
    buffers.set(stem as StemType, buffer);
  }

  return { sessionId: result.sessionId, buffers };
}

/** Fetches one separated stem's 24-bit WAV bytes from the session folder. */
export async function fetchStemWavBytes(
  sessionId: string,
  stem: StemType
): Promise<Uint8Array> {
  const a = api();
  const demucsStem = APP_TO_DEMUCS[stem];
  if (!a?.demucsReadStemWav || !demucsStem) {
    throw new Error(`No separated audio available for the ${stem} stem.`);
  }
  const { base64Data } = await a.demucsReadStemWav({ sessionId, demucsStem });
  return base64ToBytes(base64Data);
}
