/**
 * Key mapping: measures transcribed notes against the detected key and,
 * optionally, forces them into it.
 *
 * Two strategies, both OFF by default (this is a destructive, judgment-call
 * operation — the user turns it on per conversion):
 *
 *   'snap' — every out-of-key note is moved one semitone into the scale.
 *            In a 7-note scale every non-scale pitch class sits exactly
 *            between two scale tones, so the direction is a real choice:
 *            'up' (default) raises, e.g. C -> C# in F# minor — which is
 *            exactly the correction Tess made by hand to the 'Your
 *            Addiction' bassline, where she also kept the bridging notes
 *            she wanted. Users who want those kept use 'drop' with a
 *            protection threshold, or leave mapping off and use the
 *            piano-roll highlighting to fix notes by hand in the DAW.
 *
 *   'drop' — out-of-key notes are deleted, EXCEPT notes at least
 *            `protectDuration` seconds long: a sustained chromatic note
 *            is usually an intentional passing/bridge tone, while the
 *            model's chromatic hallucinations are typically short.
 *
 * Scales: major and natural minor. (Harmonic-minor colour — the raised
 * 7th in minor — will read as "out of key" here; that is deliberate, so
 * the highlighting surfaces it instead of silently blessing it.)
 */

import { CleanableNote } from './noteCleanup';
import { KeyMode } from './keyDetection';

const SCALE_OFFSETS: Record<KeyMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

/** The set of pitch classes (0 = C … 11 = B) belonging to the key. */
export function scalePitchClasses(tonic: number, mode: KeyMode): Set<number> {
  return new Set(SCALE_OFFSETS[mode].map((offset) => (tonic + offset) % 12));
}

export function isInKey(midi: number, tonic: number, mode: KeyMode): boolean {
  return scalePitchClasses(tonic, mode).has(((midi % 12) + 12) % 12);
}

export function countOutOfKey(notes: CleanableNote[], tonic: number, mode: KeyMode): number {
  const scale = scalePitchClasses(tonic, mode);
  return notes.filter((n) => !scale.has(((n.midi % 12) + 12) % 12)).length;
}

export type KeyMappingStrategy = 'snap' | 'drop';

export interface KeyMappingOptions {
  /** For 'snap': which neighbouring scale tone wins the tie. Default 'up'. */
  snapDirection?: 'up' | 'down';
  /** For 'drop': notes at least this long are kept as intentional. Seconds. Default 0.4. */
  protectDuration?: number;
}

/**
 * Applies a key-mapping strategy. Returns a new array; snapped notes are
 * shallow copies with an updated `midi` (callers should refresh any
 * derived pitch name afterwards).
 */
export function applyKeyMapping<T extends CleanableNote>(
  notes: T[],
  tonic: number,
  mode: KeyMode,
  strategy: KeyMappingStrategy,
  options: KeyMappingOptions = {}
): T[] {
  const scale = scalePitchClasses(tonic, mode);
  const inScale = (midi: number) => scale.has(((midi % 12) + 12) % 12);
  const protectDuration = options.protectDuration ?? 0.4;
  const direction = options.snapDirection ?? 'up';

  if (strategy === 'drop') {
    return notes.filter((n) => inScale(n.midi) || n.duration >= protectDuration);
  }

  // 'snap': every out-of-key pitch class is exactly one semitone from two
  // scale tones; the direction option picks which one. (Fallback to the
  // other direction guards future scale definitions where that might not
  // hold for both neighbours.)
  return notes.map((n) => {
    if (inScale(n.midi)) return n;
    const preferred = direction === 'up' ? n.midi + 1 : n.midi - 1;
    const target = inScale(preferred) ? preferred : direction === 'up' ? n.midi - 1 : n.midi + 1;
    return { ...n, midi: target };
  });
}
