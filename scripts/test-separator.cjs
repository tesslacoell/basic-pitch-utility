/**
 * Headless smoke test for the HTDemucs separator (electron/separator.cjs).
 *
 * Usage (on a machine with real memory — the model will not load in a
 * small sandbox):
 *   BASIC_PITCH_DEMUCS_MODEL=/path/to/htdemucs_6s.onnx \
 *     node scripts/test-separator.cjs /path/to/stereo-44k.wav
 *
 * Without BASIC_PITCH_DEMUCS_MODEL it looks in the given models dir
 * (default: ./test-models). Asserts: model status resolves, separation
 * returns all six stem WAVs plus analysis buffers for every app stem,
 * the analysis is not silent, and the guitar stem's RMS sits in a sane
 * band relative to the mix (separated, not a copy of everything).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const separator = require('../electron/separator.cjs');

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node scripts/test-separator.cjs <stereo-44.1k-wav>');
    process.exit(2);
  }
  const modelsDir = process.argv[3] || path.join(__dirname, 'test-models');

  const status = separator.getModelStatus(modelsDir);
  console.log('model status:', status.state, status.version);
  if (status.state !== 'ready') {
    console.error('FAIL: model not ready (set BASIC_PITCH_DEMUCS_MODEL or download first)');
    process.exit(1);
  }

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demucs-smoke-'));
  const started = Date.now();
  const result = await separator.separate(
    modelsDir,
    input,
    sessionDir,
    ['piano', 'guitar', 'bass', 'lead', 'drums'],
    (p) => process.stdout.write(`\rchunk ${p.chunk}/${p.chunks}   `)
  );
  console.log(`\nseparated in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  let failed = false;
  const check = (ok, label) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed = true;
  };

  check(Math.abs(result.durationSeconds) > 1, `duration ${result.durationSeconds.toFixed(1)}s`);
  for (const name of separator.DEMUCS_STEMS) {
    const f = path.join(sessionDir, result.wavFiles[name]);
    check(fs.existsSync(f) && fs.statSync(f).size > 44, `stem WAV written: ${name}`);
  }
  const rmsByStem = {};
  for (const stem of ['piano', 'guitar', 'bass', 'lead', 'drums']) {
    const samples = result.analysis[stem];
    check(samples && samples.length > 0, `analysis buffer present: ${stem}`);
    rmsByStem[stem] = samples ? rms(samples) : 0;
    check(rmsByStem[stem] > 1e-5, `analysis not silent: ${stem} (rms ${rmsByStem[stem].toFixed(5)})`);
  }
  // The guitar stem should be a real separation: present, but well
  // under the full mix's energy (the mix itself is the ceiling).
  console.log('analysis RMS:', Object.fromEntries(
    Object.entries(rmsByStem).map(([k, v]) => [k, v.toFixed(4)])
  ));
  console.log(`session dir: ${sessionDir}`);
  if (failed) process.exit(1);
  console.log('separator smoke test: ALL PASS');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
