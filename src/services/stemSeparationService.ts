/**
 * DSP Spectral & Frequency Filter Bank for Audio Stem Isolation
 * Runs high-speed offline rendering to isolate harmonic instrument bands
 * prior to Spotify Basic Pitch neural network inference.
 */

export type StemType = 'piano' | 'guitar' | 'bass' | 'lead' | 'full_mix' | 'drums';

export interface StemDefinition {
  id: StemType;
  name: string;
  shortName: string;
  description: string;
  color: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  midiProgram: number; // General MIDI instrument patch
  channel: number;
  pitchParams: {
    minFreq?: number;
    maxFreq?: number;
    onsetThresh: number;
    frameThresh: number;
    minNoteLen: number;
    melodiaTrick?: boolean;
    energyTolerance?: number;
  };
}

export const STEM_DEFINITIONS: Record<StemType, StemDefinition> = {
  piano: {
    id: 'piano',
    name: 'Piano & Keyboards',
    shortName: 'Piano',
    description: 'Acoustic piano, electric keys, organs & harmonic chords',
    color: '#10b981', // emerald
    badgeBg: 'bg-emerald-950/40',
    badgeBorder: 'border-emerald-800/60',
    badgeText: 'text-emerald-300',
    midiProgram: 0, // Acoustic Grand Piano
    channel: 0,
    pitchParams: {
      minFreq: 80,
      maxFreq: 3800,
      onsetThresh: 0.48,
      frameThresh: 0.28,
      minNoteLen: 5,
      melodiaTrick: false,
      energyTolerance: 11,
    },
  },
  guitar: {
    id: 'guitar',
    name: 'Guitars',
    shortName: 'Guitar',
    description: 'Acoustic & electric guitar strums, picking & mid-range riffs',
    color: '#f59e0b', // amber
    badgeBg: 'bg-amber-950/40',
    badgeBorder: 'border-amber-800/60',
    badgeText: 'text-amber-300',
    midiProgram: 24, // Acoustic Guitar (nylon)
    channel: 1,
    pitchParams: {
      minFreq: 82,
      maxFreq: 1800,
      onsetThresh: 0.44,
      frameThresh: 0.28,
      minNoteLen: 4,
      melodiaTrick: false,
      energyTolerance: 10,
    },
  },
  bass: {
    id: 'bass',
    name: 'Bass',
    shortName: 'Bass',
    description: 'Electric bass guitar, synth bass & low-end fundamental basslines',
    color: '#818cf8', // indigo
    badgeBg: 'bg-indigo-950/40',
    badgeBorder: 'border-indigo-800/60',
    badgeText: 'text-indigo-300',
    midiProgram: 33, // Electric Bass (finger)
    channel: 2,
    pitchParams: {
      minFreq: 30,
      maxFreq: 320,
      onsetThresh: 0.38,
      frameThresh: 0.24,
      minNoteLen: 6,
      melodiaTrick: false,
      energyTolerance: 12,
    },
  },
  lead: {
    id: 'lead',
    name: 'Lead & Vocals',
    shortName: 'Lead',
    description: 'Melodic top-line, vocal pitch contours, solo instruments',
    color: '#fb7185', // rose
    badgeBg: 'bg-rose-950/40',
    badgeBorder: 'border-rose-800/60',
    badgeText: 'text-rose-300',
    midiProgram: 54, // Voice Oohs / Synth Lead
    channel: 3,
    pitchParams: {
      minFreq: 180,
      maxFreq: 1600,
      onsetThresh: 0.42,
      frameThresh: 0.25,
      minNoteLen: 5,
      melodiaTrick: true,
      energyTolerance: 10,
    },
  },
  full_mix: {
    id: 'full_mix',
    name: 'Full Mix (All)',
    shortName: 'Full Mix',
    description: 'Master track polyphonic transcription without stem isolation',
    color: '#06b6d4', // cyan
    badgeBg: 'bg-cyan-950/40',
    badgeBorder: 'border-cyan-800/60',
    badgeText: 'text-cyan-300',
    midiProgram: 0,
    channel: 4,
    pitchParams: {
      onsetThresh: 0.5,
      frameThresh: 0.3,
      minNoteLen: 5,
      melodiaTrick: false,
      energyTolerance: 11,
    },
  },
  drums: {
    id: 'drums',
    name: 'Drums',
    shortName: 'Drums',
    description: 'Kick, snare, hats & toms transcribed from transients (GM drum map, ch. 10). Also sharpens tempo detection.',
    color: '#a3e635', // lime
    badgeBg: 'bg-lime-950/40',
    badgeBorder: 'border-lime-800/60',
    badgeText: 'text-lime-300',
    midiProgram: 0, // ignored on the drum channel
    channel: 9, // MIDI channel 10 — the General MIDI drum channel
    // Unused: drums are transcribed by onset detection, not the pitch model.
    pitchParams: {
      onsetThresh: 0.5,
      frameThresh: 0.3,
      minNoteLen: 1,
      melodiaTrick: false,
      energyTolerance: 11,
    },
  },
};

/**
 * Wires a stem's filter chain into a context and returns the node at the
 * end of the chain (connect it to the context's destination). Shared by the
 * analysis render (22,050 Hz mono, for the pitch model) and the export
 * render (source rate and channel count, for WAV download) so the two can
 * never drift apart — the filter frequencies are absolute Hz and behave
 * identically at either rate. 'drums' has no chain: drums are transcribed
 * from the mix's transients, not isolated by filtering, so the source is
 * returned untouched.
 */
export function connectStemFilterChain(
  ctx: BaseAudioContext,
  source: AudioNode,
  stemType: StemType
): AudioNode {
  if (stemType === 'full_mix' || stemType === 'drums') {
    // No filtering — direct pass-through
    return source;
  } else if (stemType === 'bass') {
    // Steep low-pass filter cascade (4th order Butterworth) + sub-rumble cutoff
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 32;
    hp.Q.value = 0.707;

    const lp1 = ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = 270;
    lp1.Q.value = 0.8;

    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 290;
    lp2.Q.value = 0.8;

    // Bass warmth boost
    const bassPeak = ctx.createBiquadFilter();
    bassPeak.type = 'peaking';
    bassPeak.frequency.value = 90;
    bassPeak.gain.value = 3.0;
    bassPeak.Q.value = 1.2;

    source.connect(hp);
    hp.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(bassPeak);
    return bassPeak;
  } else if (stemType === 'piano') {
    // Highpass kick/sub-bass removal + lowpass cymbal air removal
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = 0.707;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = 0.707;

    // Body clarity
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 850;
    peak.gain.value = 2.5;
    peak.Q.value = 1.0;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(peak);
    return peak;
  } else if (stemType === 'guitar') {
    // Highpass mud removal + mid-range guitar body & pick resonance
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    hp.Q.value = 0.707;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4800;
    lp.Q.value = 0.707;

    const midBoost = ctx.createBiquadFilter();
    midBoost.type = 'peaking';
    midBoost.frequency.value = 1400;
    midBoost.gain.value = 3.5;
    midBoost.Q.value = 1.2;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(midBoost);
    return midBoost;
  } else {
    // lead — Vocal & Lead Formant Isolation (220 Hz - 3,400 Hz)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 220;
    hp.Q.value = 0.707;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 0.707;

    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = 1200;
    formant.gain.value = 4.0;
    formant.Q.value = 1.4;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(formant);
    return formant;
  }
}

/**
 * True when a stem has an audio filter chain and can therefore be exported
 * as a WAV. Drums cannot: they are note transcriptions of transients in the
 * full mix, not an isolated audio band.
 */
export function canExportAudioStem(stemType: StemType): boolean {
  return stemType !== 'drums';
}

/**
 * Creates an isolated audio stem buffer resampled to 22,050 Hz mono
 * tailored with instrument-specific spectral filtering.
 */
export async function isolateStemAudioBuffer(
  decodedAudio: AudioBuffer,
  stemType: StemType
): Promise<AudioBuffer> {
  const targetSampleRate = 22050;
  const targetLength = Math.ceil(decodedAudio.duration * targetSampleRate);
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = decodedAudio;

  connectStemFilterChain(offlineCtx, source, stemType).connect(offlineCtx.destination);

  source.start(0);
  return await offlineCtx.startRendering();
}

/**
 * Renders a stem for audio export at the source's own sample rate and
 * channel count — the same filter chain the analyser hears, at full
 * quality, for dropping into a DAW. Rendered on demand (or warmed in the
 * background) rather than during conversion: five full-rate stereo renders
 * are far too much memory to keep for every run.
 */
export async function renderStemAudioForExport(
  decodedAudio: AudioBuffer,
  stemType: StemType
): Promise<AudioBuffer> {
  const sampleRate = decodedAudio.sampleRate;
  const length = Math.ceil(decodedAudio.duration * sampleRate);
  const offlineCtx = new OfflineAudioContext(
    decodedAudio.numberOfChannels,
    length,
    sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = decodedAudio;

  connectStemFilterChain(offlineCtx, source, stemType).connect(offlineCtx.destination);

  source.start(0);
  return await offlineCtx.startRendering();
}
