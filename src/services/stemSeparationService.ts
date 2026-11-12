/**
 * DSP Spectral & Frequency Filter Bank for Audio Stem Isolation
 * Runs high-speed offline rendering to isolate harmonic instrument bands
 * prior to Spotify Basic Pitch neural network inference.
 */

export type StemType = 'piano' | 'guitar' | 'bass' | 'lead' | 'full_mix';

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
};

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

  if (stemType === 'full_mix') {
    // Direct resampling without instrument filtering
    source.connect(offlineCtx.destination);
  } else if (stemType === 'bass') {
    // Steep low-pass filter cascade (4th order Butterworth) + sub-rumble cutoff
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 32;
    hp.Q.value = 0.707;

    const lp1 = offlineCtx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = 270;
    lp1.Q.value = 0.8;

    const lp2 = offlineCtx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 290;
    lp2.Q.value = 0.8;

    // Bass warmth boost
    const bassPeak = offlineCtx.createBiquadFilter();
    bassPeak.type = 'peaking';
    bassPeak.frequency.value = 90;
    bassPeak.gain.value = 3.0;
    bassPeak.Q.value = 1.2;

    source.connect(hp);
    hp.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(bassPeak);
    bassPeak.connect(offlineCtx.destination);
  } else if (stemType === 'piano') {
    // Highpass kick/sub-bass removal + lowpass cymbal air removal
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = 0.707;

    const lp = offlineCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = 0.707;

    // Body clarity
    const peak = offlineCtx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 850;
    peak.gain.value = 2.5;
    peak.Q.value = 1.0;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(peak);
    peak.connect(offlineCtx.destination);
  } else if (stemType === 'guitar') {
    // Highpass mud removal + mid-range guitar body & pick resonance
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    hp.Q.value = 0.707;

    const lp = offlineCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4800;
    lp.Q.value = 0.707;

    const midBoost = offlineCtx.createBiquadFilter();
    midBoost.type = 'peaking';
    midBoost.frequency.value = 1400;
    midBoost.gain.value = 3.5;
    midBoost.Q.value = 1.2;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(midBoost);
    midBoost.connect(offlineCtx.destination);
  } else if (stemType === 'lead') {
    // Vocal & Lead Formant Isolation (220 Hz - 3,400 Hz)
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 220;
    hp.Q.value = 0.707;

    const lp = offlineCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 0.707;

    const formant = offlineCtx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = 1200;
    formant.gain.value = 4.0;
    formant.Q.value = 1.4;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(formant);
    formant.connect(offlineCtx.destination);
  }

  source.start(0);
  return await offlineCtx.startRendering();
}
