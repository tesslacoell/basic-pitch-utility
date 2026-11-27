/**
 * Note cleanup: turns Basic Pitch's raw note list into something a musician
 * would recognise as the part that was played.
 *
 * The model's characteristic errors, in the order this stage removes them:
 *   1. Whisper-quiet ghosts — bleed and resonance below a velocity floor.
 *   2. Harmonic shadows — when a note sounds, the model often also reports
 *      its 2nd/3rd/4th harmonics (octave, octave+fifth, two octaves) as
 *      separate short, quiet notes starting at the same instant. A note
 *      that starts with a stronger lower note, sits exactly on one of its
 *      harmonic pitches, and doesn't outlast it is a shadow, not a note.
 *   3. Impossible overlaps on monophonic parts — a bass / lead line can
 *      only play one pitch at a time; the stronger note wins and the
 *      loser is truncated at the winner's onset.
 *   4. Fragmentation — one sustained note reported as several pieces with
 *      hairline gaps; pieces of the same pitch separated by less than the
 *      merge gap are glued back together.
 *   5. Blips — anything still shorter than the minimum length at the end.
 *
 * Pure functions over a minimal note shape (structural typing — the app's
 * TranscribedNote satisfies it), so the stage is Node-testable without
 * running the model. This logic was prototyped on the 'Your Addiction'
 * bass stem, where it took the raw output from 2,003 notes to a 548-note
 * line Tess could work with.
 */

import { StemType } from './stemSeparationService';

export interface CleanableNote {
  midi: number;
  startTime: number; // seconds
  duration: number; // seconds
  velocity: number; // 0..1
}

export interface CleanupConfig {
  /** Notes quieter than this are bleed/resonance, not playing. */
  minVelocity: number;
  /** Notes shorter than this (after merging) are blips. Seconds. */
  minNoteLength: number;
  /** Same-pitch notes separated by less than this are one note. Seconds. */
  mergeGap: number;
  /** Remove harmonic shadows of stronger simultaneous notes. */
  harmonicPruning: boolean;
  /**
   * A harmonic shadow must be no louder than this fraction of its
   * fundamental's velocity to be pruned (real octave doublings in an
   * arrangement are usually played at comparable strength).
   */
  harmonicVelocityRatio: number;
  /**
   * A harmonic shadow must not outlast its fundamental by more than this
   * factor (a shadow dies with the note that casts it).
   */
  harmonicMaxDurationRatio: number;
  /** How close two onsets must be to count as "the same instant". Seconds. */
  onsetCoincidence: number;
  /** Enforce one-note-at-a-time (bass, lead/vocal). */
  monophonic: boolean;
}

/** Per-stem cleanup presets. Piano/guitar/full_mix stay polyphonic. */
export const STEM_CLEANUP: Record<StemType, CleanupConfig> = {
  bass: {
    minVelocity: 0.18,
    minNoteLength: 0.06,
    mergeGap: 0.07,
    harmonicPruning: true,
    harmonicVelocityRatio: 0.95,
    harmonicMaxDurationRatio: 1.5,
    onsetCoincidence: 0.03,
    monophonic: true,
  },
  lead: {
    minVelocity: 0.16,
    minNoteLength: 0.05,
    mergeGap: 0.06,
    harmonicPruning: true,
    harmonicVelocityRatio: 0.9,
    harmonicMaxDurationRatio: 1.5,
    onsetCoincidence: 0.03,
    monophonic: true,
  },
  piano: {
    minVelocity: 0.15,
    minNoteLength: 0.05,
    mergeGap: 0.05,
    harmonicPruning: true,
    harmonicVelocityRatio: 0.85,
    harmonicMaxDurationRatio: 1.25,
    onsetCoincidence: 0.03,
    monophonic: false,
  },
  guitar: {
    minVelocity: 0.15,
    minNoteLength: 0.05,
    mergeGap: 0.05,
    harmonicPruning: true,
    harmonicVelocityRatio: 0.85,
    harmonicMaxDurationRatio: 1.25,
    onsetCoincidence: 0.03,
    monophonic: false,
  },
  full_mix: {
    minVelocity: 0.15,
    minNoteLength: 0.05,
    mergeGap: 0.05,
    harmonicPruning: true,
    harmonicVelocityRatio: 0.85,
    harmonicMaxDurationRatio: 1.25,
    onsetCoincidence: 0.03,
    monophonic: false,
  },
};

// Semitone offsets of the 2nd, 3rd and 4th harmonics above a fundamental.
const HARMONIC_OFFSETS = [12, 19, 24];

function end(note: CleanableNote): number {
  return note.startTime + note.duration;
}

function pruneHarmonicShadows<T extends CleanableNote>(notes: T[], config: CleanupConfig): T[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
  const ghosts = new Set<T>();
  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    if (ghosts.has(candidate)) continue;
    for (let j = 0; j < sorted.length; j++) {
      const fundamental = sorted[j];
      if (fundamental === candidate || ghosts.has(fundamental)) continue;
      if (!HARMONIC_OFFSETS.includes(candidate.midi - fundamental.midi)) continue;
      if (Math.abs(candidate.startTime - fundamental.startTime) > config.onsetCoincidence) continue;
      if (candidate.velocity > fundamental.velocity * config.harmonicVelocityRatio) continue;
      if (candidate.duration > fundamental.duration * config.harmonicMaxDurationRatio) continue;
      ghosts.add(candidate);
      break;
    }
  }
  return sorted.filter((n) => !ghosts.has(n));
}

function enforceMonophony<T extends CleanableNote>(notes: T[], config: CleanupConfig): T[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const out: T[] = [];
  for (const note of sorted) {
    const prev = out[out.length - 1];
    if (prev && note.startTime < end(prev)) {
      if (note.velocity >= prev.velocity) {
        // The new note wins: truncate the previous one at this onset.
        prev.duration = note.startTime - prev.startTime;
        if (prev.duration < config.minNoteLength) out.pop();
        out.push({ ...note });
      } else {
        // The existing note wins: delay/clip the new one behind it.
        const clippedStart = end(prev);
        const clippedDuration = end(note) - clippedStart;
        if (clippedDuration >= config.minNoteLength) {
          out.push({ ...note, startTime: clippedStart, duration: clippedDuration });
        }
      }
    } else {
      out.push({ ...note });
    }
  }
  return out;
}

function mergeFragments<T extends CleanableNote>(notes: T[], config: CleanupConfig): T[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
  const out: T[] = [];
  for (const note of sorted) {
    // Find the most recent same-pitch note this one could continue.
    let target: T | undefined;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].midi === note.midi) {
        target = out[i];
        break;
      }
    }
    if (target && note.startTime - end(target) <= config.mergeGap && note.startTime >= target.startTime) {
      target.duration = Math.max(end(target), end(note)) - target.startTime;
      target.velocity = Math.max(target.velocity, note.velocity);
    } else {
      out.push({ ...note });
    }
  }
  return out;
}

/**
 * Runs the full cleanup pipeline for one stem's notes.
 * Returns a new array; the input is not mutated (except that merged /
 * truncated results are shallow copies — extra fields such as pitchBends
 * and stem are preserved).
 */
export function cleanupNotes<T extends CleanableNote>(
  notes: T[],
  config: CleanupConfig
): T[] {
  let result = notes.filter((n) => n.velocity >= config.minVelocity);
  if (config.harmonicPruning) result = pruneHarmonicShadows(result, config);
  if (config.monophonic) result = enforceMonophony(result, config);
  result = mergeFragments(result, config);
  result = result.filter((n) => n.duration >= config.minNoteLength);
  return result.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
}

/** Convenience: clean one stem's notes with that stem's preset. */
export function cleanupStemNotes<T extends CleanableNote>(
  notes: T[],
  stem: StemType,
  overrides: Partial<CleanupConfig> = {}
): T[] {
  return cleanupNotes(notes, { ...STEM_CLEANUP[stem], ...overrides });
}
