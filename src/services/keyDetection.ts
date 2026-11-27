/**
 * Key detection: chromagram + Krumhansl–Schmuckler key profiles.
 *
 * Pipeline:
 *   1. Mono PCM is decimated to ~22.05 kHz and run through an STFT.
 *   2. Each frame's magnitude spectrum is folded into 12 pitch classes
 *      (bins between 55 Hz and 5 kHz), building a time-averaged chroma
 *      vector — the track's pitch-class fingerprint.
 *   3. The chroma is Pearson-correlated against the Krumhansl–Schmuckler
 *      major and minor profiles at all 12 rotations (24 candidate keys).
 *      The best correlation wins; the margin over the runner-up is the
 *      confidence.
 */

import { bufferToMono, decimate, pearsonCorrelation, stftMagnitudes } from './dsp';

export type KeyMode = 'major' | 'minor';

export interface KeyDetectionResult {
  /** Pitch class of the tonic, 0 = C … 11 = B. */
  tonic: number;
  /** Tonic name in the app's sharp spelling, e.g. "F#". */
  tonicName: string;
  mode: KeyMode;
  /** Human-readable key, e.g. "F# minor". */
  keyName: string;
  /**
   * Key spelling to write into a MIDI key_signature meta event — the
   * conventional standard key for this tonic/mode (may be the enharmonic
   * flat spelling, e.g. tonic D# minor is written as Eb minor).
   */
  midiKey: string;
  /** Sharps count for the key_signature meta event (negative = flats). */
  midiSharps: number;
  /** Winning Pearson correlation, -1..1. */
  correlation: number;
  /** Margin over the runner-up key, 0..2. Higher = more certain. */
  confidence: number;
  /** The 12-bin chroma vector the decision was made from (sums to 1). */
  chroma: number[];
}

const TARGET_SAMPLE_RATE = 22050;
const FRAME_SIZE = 8192;
const HOP_SIZE = 2048;
const MIN_FREQ = 40;
const MAX_FREQ = 5000;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl–Schmuckler key profiles (listener rating experiments).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Conventional MIDI key-signature spelling per tonic pitch class.
 * Index = pitch class (0 = C). Chosen from the standard 15 major / 15 minor
 * key signatures so files open correctly in DAWs and notation software.
 */
const MIDI_KEY_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MIDI_KEY_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** Sharps count (negative = flats) for each standard major key spelling. */
const MAJOR_SHARPS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

/** Sharps count for each standard minor key spelling (its relative major's). */
const MINOR_SHARPS: Record<string, number> = {
  A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, D: -1, G: -2, C: -3,
  F: -4, Bb: -5, Eb: -6, 'G#': 5,
};

/** Builds the time-averaged 12-bin chroma vector for mono PCM. */
export function chromagram(samples: Float32Array, sampleRate: number): Float32Array {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_SAMPLE_RATE));
  const pcm = decimate(samples, factor);
  const sr = sampleRate / factor;
  const chroma = new Float32Array(12);
  const binFreq = sr / FRAME_SIZE;

  stftMagnitudes(pcm, FRAME_SIZE, HOP_SIZE, (mags) => {
    // Per-frame normalisation keeps loud sections from dominating the key.
    let frameTotal = 0;
    const frameChroma = new Float32Array(12);
    for (let bin = 1; bin < mags.length - 1; bin++) {
      const freq = bin * binFreq;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
      // Peak-picking: only spectral peaks carry pitch-class energy. Without
      // this, leakage shoulders from two adjacent real notes (e.g. B and C#)
      // pile phantom energy into the pitch class between them (C natural),
      // which can pull detection toward a wrong key entirely.
      if (mags[bin] < mags[bin - 1] || mags[bin] < mags[bin + 1]) continue;
      // Soft assignment: split the bin's magnitude between the two nearest
      // pitch classes, weighted by distance in the log-frequency domain, so
      // a peak sitting between two pitch centres doesn't snap wholesale to
      // the wrong one.
      const midiFloat = 69 + 12 * Math.log2(freq / 440);
      const lower = Math.floor(midiFloat);
      const frac = midiFloat - lower;
      const pcLower = ((lower % 12) + 12) % 12;
      const pcUpper = (pcLower + 1) % 12;
      frameChroma[pcLower] += mags[bin] * (1 - frac);
      frameChroma[pcUpper] += mags[bin] * frac;
      frameTotal += mags[bin];
    }
    if (frameTotal > 0) {
      for (let pc = 0; pc < 12; pc++) chroma[pc] += frameChroma[pc] / frameTotal;
    }
  });

  let total = 0;
  for (let pc = 0; pc < 12; pc++) total += chroma[pc];
  if (total > 0) {
    for (let pc = 0; pc < 12; pc++) chroma[pc] /= total;
  }
  return chroma;
}

function rotate(profile: number[], tonic: number): number[] {
  // Profile index 0 is the tonic; rotate so it aligns with chroma bins,
  // where bin 0 is C. For tonic T, bin (T + i) should match profile[i].
  const out = new Array<number>(12);
  for (let i = 0; i < 12; i++) {
    out[(tonic + i) % 12] = profile[i];
  }
  return out;
}

/** Detects the key from raw mono PCM. Pure function — Node-testable. */
export function detectKey(samples: Float32Array, sampleRate: number): KeyDetectionResult | null {
  if (samples.length < sampleRate) return null; // need at least ~1 second

  const chroma = chromagram(samples, sampleRate);
  let chromaEnergy = 0;
  for (let pc = 0; pc < 12; pc++) chromaEnergy += chroma[pc];
  if (chromaEnergy === 0) return null;

  let best: { tonic: number; mode: KeyMode; correlation: number } | null = null;
  let runnerUp = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as KeyMode[]) {
      const profile = rotate(mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE, tonic);
      const r = pearsonCorrelation(chroma, profile);
      if (!best || r > best.correlation) {
        if (best) runnerUp = Math.max(runnerUp, best.correlation);
        best = { tonic, mode, correlation: r };
      } else {
        runnerUp = Math.max(runnerUp, r);
      }
    }
  }
  if (!best) return null;

  const tonicName = NOTE_NAMES[best.tonic];
  const midiKey = best.mode === 'major' ? MIDI_KEY_MAJOR[best.tonic] : MIDI_KEY_MINOR[best.tonic];
  return {
    tonic: best.tonic,
    tonicName,
    mode: best.mode,
    keyName: `${tonicName} ${best.mode}`,
    midiKey,
    midiSharps: best.mode === 'major' ? MAJOR_SHARPS[midiKey] : MINOR_SHARPS[midiKey],
    correlation: Math.round(best.correlation * 1000) / 1000,
    confidence: Math.round((best.correlation - runnerUp) * 1000) / 1000,
    chroma: Array.from(chroma),
  };
}

/** Convenience wrapper for the app: detect the key from a decoded AudioBuffer. */
export function detectKeyFromBuffer(buffer: AudioBuffer): KeyDetectionResult | null {
  return detectKey(bufferToMono(buffer), buffer.sampleRate);
}
