/**
 * Small shared DSP helpers for the analysis modules (tempo / key detection).
 *
 * Everything here is pure and dependency-free: functions take raw PCM samples
 * plus a sample rate, so the cores can be unit-tested in Node with synthetic
 * audio (no AudioBuffer / Web Audio required). The AudioBuffer wrappers live
 * in the individual analysis modules.
 */

/** Iterative radix-2 FFT. Input length must be a power of two. */
export function fftMagnitudes(input: Float32Array): Float32Array {
  const n = input.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`fftMagnitudes: length ${n} is not a power of two`);
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = input[i];

  // Bit-reversal permutation (array fully loaded before any swaps)
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterfly stages
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    for (let base = 0; base < n; base += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = base + k;
        const b = base + k + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }

  const mags = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mags;
}

export function hannWindow(length: number): Float32Array {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return w;
}

/**
 * Runs an STFT over mono PCM and calls `onFrame` with each frame's magnitude
 * spectrum (length frameSize/2). Returns the number of frames processed.
 */
export function stftMagnitudes(
  samples: Float32Array,
  frameSize: number,
  hopSize: number,
  onFrame: (mags: Float32Array, frameIndex: number) => void
): number {
  const window = hannWindow(frameSize);
  const frame = new Float32Array(frameSize);
  let frameIndex = 0;
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    for (let i = 0; i < frameSize; i++) {
      frame[i] = samples[start + i] * window[i];
    }
    onFrame(fftMagnitudes(frame), frameIndex);
    frameIndex++;
  }
  return frameIndex;
}

/**
 * Naive decimation by an integer factor (block averaging, which doubles as a
 * crude anti-alias filter). Returns the input unchanged if factor <= 1.
 */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const outLength = Math.floor(samples.length / factor);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += samples[base + k];
    out[i] = sum / factor;
  }
  return out;
}

/** Mixes an AudioBuffer down to a single Float32Array (channel average). */
export function bufferToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i] / channels;
  }
  return out;
}

/** Pearson correlation between two equal-length numeric arrays. */
export function pearsonCorrelation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  if (n !== b.length || n === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}
