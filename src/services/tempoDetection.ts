/**
 * Tempo detection: spectral-flux onset envelope + autocorrelation.
 *
 * Pipeline:
 *   1. Mono PCM is decimated to ~22.05 kHz and run through an STFT.
 *   2. The onset envelope is the frame-to-frame sum of positive magnitude
 *      increases (spectral flux) — a novelty curve that spikes at attacks.
 *   3. The envelope is autocorrelated over lags corresponding to 40–220 BPM.
 *      The strongest peak (with a gentle prior favouring the 70–160 range,
 *      which resolves most half/double-time ambiguity) is the tempo.
 *   4. Parabolic interpolation around the peak gives fractional BPM.
 *
 * The detector returns alternates (half / double) so the UI can offer the
 * standard ÷2 / ×2 correction — detection proposes, the user confirms.
 */

import { bufferToMono, decimate, stftMagnitudes } from './dsp';

export interface TempoDetectionResult {
  /** Most likely tempo in BPM (one decimal place). */
  bpm: number;
  /** Peak autocorrelation strength, roughly 0..1. Higher = more periodic. */
  confidence: number;
  /** Plausible alternates (half / double time) within range, if any. */
  alternates: number[];
}

const TARGET_SAMPLE_RATE = 22050;
const FRAME_SIZE = 2048;
const HOP_SIZE = 256;
const MIN_BPM = 40;
const MAX_BPM = 220;

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Builds the spectral-flux onset envelope for mono PCM. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): { envelope: Float32Array; envelopeRate: number } {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_SAMPLE_RATE));
  const pcm = decimate(samples, factor);
  const sr = sampleRate / factor;
  const envelopeRate = sr / HOP_SIZE;

  const flux: number[] = [];
  let prev: Float32Array | null = null;
  stftMagnitudes(pcm, FRAME_SIZE, HOP_SIZE, (mags) => {
    if (prev) {
      // Percussive emphasis: a bin's increase only counts at full weight if
      // it clears 2% of the frame's peak magnitude. Drum hits are loud AND
      // broadband, so they clear that bar across hundreds of bins at once;
      // a pitched onset clears it only at its harmonics, and reverb tails /
      // noise-floor wobble fall below it and are quarter-weighted. The
      // envelope therefore leans on the kit — where the tempo actually
      // lives — without a separate source-separation stage.
      let frameMax = 0;
      for (let i = 0; i < mags.length; i++) if (mags[i] > frameMax) frameMax = mags[i];
      const meaningful = 0.02 * frameMax;
      let sum = 0;
      for (let i = 0; i < mags.length; i++) {
        const diff = mags[i] - prev[i];
        if (diff > 0) sum += diff > meaningful ? diff : diff * 0.25;
      }
      flux.push(sum);
    } else {
      flux.push(0);
    }
    prev = mags;
  });

  const envelope = Float32Array.from(flux);

  // Remove the local mean (slow drift) so autocorrelation sees periodicity,
  // not the track's overall loudness contour.
  const meanWindow = Math.max(8, Math.round(envelopeRate * 0.5));
  for (let i = 0; i < envelope.length; i++) {
    let sum = 0;
    let count = 0;
    const from = Math.max(0, i - meanWindow);
    const to = Math.min(envelope.length - 1, i + meanWindow);
    for (let k = from; k <= to; k++) {
      sum += envelope[k];
      count++;
    }
    envelope[i] = Math.max(0, envelope[i] - sum / count);
  }

  return { envelope, envelopeRate };
}

/** Detects tempo from raw mono PCM. Pure function — Node-testable. */
export function detectTempo(samples: Float32Array, sampleRate: number): TempoDetectionResult | null {
  if (samples.length < sampleRate * 2) return null; // need a couple of seconds

  const { envelope, envelopeRate } = onsetEnvelope(samples, sampleRate);
  const n = envelope.length;
  if (n < 64) return null;

  let energy = 0;
  for (let i = 0; i < n; i++) energy += envelope[i] * envelope[i];
  if (energy === 0) return null;

  const minLag = Math.floor((60 / MAX_BPM) * envelopeRate);
  const maxLag = Math.ceil((60 / MIN_BPM) * envelopeRate);

  // Gentle log-Gaussian tempo prior centred at 105 BPM (sigma = 1 octave).
  // It breaks ties between a tempo and its half/double in favour of the
  // range most popular music lives in, without dragging genuine outliers.
  const prior = (bpm: number) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105), 2));

  let bestLag = -1;
  let bestScore = -Infinity;
  const scores = new Float64Array(maxLag + 2);
  const weighted = (lag: number) => {
    const bpmAtLag = 60 / (lag / envelopeRate);
    return scores[lag] * (0.75 + 0.25 * prior(bpmAtLag));
  };
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) {
      sum += envelope[i] * envelope[i + lag];
    }
    // Normalise by overlap so long lags aren't unfairly penalised.
    const normalised = sum / (n - lag);
    scores[lag] = normalised;
    const score = weighted(lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;

  // Octave resolution: grooves with a strong two-beat pattern (funk,
  // hip-hop, half-time feels) autocorrelate harder at the two-beat lag than
  // at the beat lag, so the raw winner is often exactly half the true tempo
  // — e.g. a 115.8 BPM track read as 57.9. If the double-tempo peak is
  // nearly as strong as the winner (>= 85% of its prior-weighted score),
  // prefer the double: a genuine slow groove's half-beat lag only lines
  // beats up with offbeats and scores far lower, so it stays put.
  {
    const halfLag = Math.round(bestLag / 2);
    let candidateLag = -1;
    let candidateScore = -Infinity;
    for (let lag = halfLag - 1; lag <= halfLag + 1; lag++) {
      if (lag >= minLag && lag <= maxLag && lag < n) {
        const s = weighted(lag);
        if (s > candidateScore) {
          candidateScore = s;
          candidateLag = lag;
        }
      }
    }
    if (candidateLag > 0 && candidateScore >= 0.85 * bestScore) {
      bestLag = candidateLag;
      bestScore = candidateScore;
    }
  }

  // Parabolic interpolation around the peak for sub-frame lag precision.
  let refinedLag = bestLag;
  const s0 = scores[bestLag - 1] ?? scores[bestLag];
  const s1 = scores[bestLag];
  const s2 = scores[bestLag + 1] ?? scores[bestLag];
  const denom = s0 - 2 * s1 + s2;
  if (denom !== 0) {
    const shift = 0.5 * (s0 - s2) / denom;
    if (Math.abs(shift) <= 1) refinedLag = bestLag + shift;
  }

  const bpm = round1(60 / (refinedLag / envelopeRate));

  // Confidence: winning peak vs. the average autocorrelation in range.
  let meanScore = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    meanScore += scores[lag];
    count++;
  }
  meanScore = count > 0 ? meanScore / count : 0;
  const confidence = meanScore > 0 ? Math.min(1, Math.max(0, (s1 - meanScore) / s1)) : 0;

  const alternates: number[] = [];
  if (bpm / 2 >= MIN_BPM) alternates.push(round1(bpm / 2));
  if (bpm * 2 <= MAX_BPM) alternates.push(round1(bpm * 2));

  return { bpm, confidence: Math.round(confidence * 100) / 100, alternates };
}

/** Convenience wrapper for the app: detect tempo from a decoded AudioBuffer. */
export function detectTempoFromBuffer(buffer: AudioBuffer): TempoDetectionResult | null {
  return detectTempo(bufferToMono(buffer), buffer.sampleRate);
}
