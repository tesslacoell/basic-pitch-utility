/**
 * Stem definitions for the app, plus the one piece of audio rendering
 * that still lives here: the Full Mix stem, which is simply the master
 * resampled to 22,050 Hz mono for Spotify Basic Pitch inference.
 *
 * The named stems (Piano, Guitar, Bass, Lead, Drums) are NOT produced
 * here anymore. They come from the HTDemucs 6s separator — see
 * separationService.ts. An earlier version of this file faked them
 * with a biquad filter bank; the bands were never isolation, and the
 * pretense has been removed rather than relabelled.
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
 * Renders the Full Mix stem: the master resampled to 22,050 Hz mono,
 * no filtering — the full-mix transcription hears everything, which is
 * exactly what it says on the tin. Named stems are separated by the
 * HTDemucs model (separationService.ts); asking this function for one
 * is a programming error and throws.
 */
export async function isolateStemAudioBuffer(
  decodedAudio: AudioBuffer,
  stemType: StemType
): Promise<AudioBuffer> {
  if (stemType !== 'full_mix') {
    throw new Error(
      `The ${stemType} stem comes from the HTDemucs separator, not a filter. ` +
        'This path only renders the Full Mix.'
    );
  }
  const targetSampleRate = 22050;
  const targetLength = Math.ceil(decodedAudio.duration * targetSampleRate);
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = decodedAudio;

  // Direct resampling without instrument filtering
  source.connect(offlineCtx.destination);

  source.start(0);
  return await offlineCtx.startRendering();
}
