/**
 * Minimal 24-bit PCM WAV encoder for stem audio export.
 *
 * 24-bit is the working format DAWs expect for stems: no dither decisions
 * baked in at 16-bit, no float-WAV compatibility surprises. Samples are
 * hard-clamped to [-1, 1] — a filtered stem can overshoot slightly where
 * the chain boosts a band, and wrapping an out-of-range int24 would be far
 * uglier than a clipped peak.
 *
 * Accepts a structural subset of AudioBuffer so it can be unit-tested
 * outside the browser with a plain object.
 */

export interface WavSourceBuffer {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

const BYTES_PER_SAMPLE = 3; // 24-bit

export function encodeWav24PcmBytes(buffer: WavSourceBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  // RIFF header
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  // fmt chunk — PCM, 24-bit
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // audioFormat = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true); // byteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true); // bitsPerSample
  // data chunk
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][frame]));
      const int24 = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
      bytes[offset] = int24 & 0xff;
      bytes[offset + 1] = (int24 >> 8) & 0xff;
      bytes[offset + 2] = (int24 >> 16) & 0xff;
      offset += BYTES_PER_SAMPLE;
    }
  }

  return bytes;
}

export function encodeWav24Pcm(buffer: WavSourceBuffer): Blob {
  const bytes = encodeWav24PcmBytes(buffer);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}
