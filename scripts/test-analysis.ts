/**
 * Verification harness for the analysis modules + MIDI header fix.
 * Run with: npx tsx scripts/test-analysis.ts
 *
 * Synthesises ground-truth audio in memory (no fixtures needed):
 *   - a 98 BPM click/accent pattern  -> tempo detection must find ~98
 *   - an F# minor chord loop        -> key detection must find F# minor
 * Then builds a MIDI exactly the way basicPitchService now does and writes
 * /tmp/test-export.mid so it can be parsed back with mido and checked for
 * the set_tempo + key_signature meta events and correct tick placement.
 */
import { writeFileSync } from 'fs';
import { Midi } from '@tonejs/midi';
import { detectTempo } from '../src/services/tempoDetection';
import { detectKey } from '../src/services/keyDetection';
import { fftMagnitudes } from '../src/services/dsp';
import { insertKeySignatureMetaEvent } from '../src/services/midiMeta';
import { cleanupStemNotes, CleanableNote } from '../src/services/noteCleanup';
import { applyKeyMapping, countOutOfKey, isInKey } from '../src/services/keyMapping';

const SR = 44100;
let failures = 0;

// --- Test 0: FFT sanity — a pure tone must peak at its own bin ---
{
  const n = 8192;
  const tone = new Float32Array(n);
  const binTarget = 100;
  for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * binTarget * i) / n);
  const mags = fftMagnitudes(tone);
  let peak = 0;
  for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peak]) peak = i;
  check('FFT tone peak', peak === binTarget, `peak bin ${peak}, expected ${binTarget}`);
}

function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${detail}`);
  if (!ok) failures++;
}

/** Renders `seconds` of audio by summing note events (freq, start, dur, gain). */
function render(events: { freq: number; start: number; dur: number; gain: number; harmonics?: number }[], seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * SR));
  for (const ev of events) {
    const startSample = Math.floor(ev.start * SR);
    const n = Math.floor(ev.dur * SR);
    const harmonics = ev.harmonics ?? 4;
    for (let i = 0; i < n && startSample + i < out.length; i++) {
      const t = i / SR;
      const env = Math.exp(-3 * (i / n)); // percussive decay
      let sample = 0;
      for (let h = 1; h <= harmonics; h++) {
        sample += Math.sin(2 * Math.PI * ev.freq * h * t) / h;
      }
      out[startSample + i] += ev.gain * env * sample;
    }
  }
  return out;
}

// --- Test 1: tempo, 98 BPM with accented downbeats + eighth offbeats ---
{
  const events: { freq: number; start: number; dur: number; gain: number; harmonics?: number }[] = [];
  const beat = 60 / 98;
  for (let b = 0; b < 48; b++) {
    events.push({ freq: 2000, start: b * beat, dur: 0.05, gain: b % 4 === 0 ? 0.9 : 0.6, harmonics: 2 });
    events.push({ freq: 3000, start: (b + 0.5) * beat, dur: 0.03, gain: 0.25, harmonics: 2 });
  }
  const pcm = render(events, 48 * beat + 0.5);
  const result = detectTempo(pcm, SR);
  check('tempo detected', result !== null, JSON.stringify(result));
  if (result) {
    check('tempo ~98 BPM', Math.abs(result.bpm - 98) <= 1.0, `got ${result.bpm} (confidence ${result.confidence})`);
  }
}

// --- Test 2: key detection ---
// NOTE on ground truth: Krumhansl-Schmuckler (like every content-based key
// finder) reads pitch-class statistics, so a perfectly balanced loop of
// F#m-D-A-E is statistically its relative major (A appears in 3 of the 4
// chords). These fixtures therefore encode key the way real music does:
// the tonic chord gets double duration and the bass keeps restating it.
{
  const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  const FSHARPM = [42, 49, 57, 61]; // F# C# A C#
  const DMAJ = [38, 50, 57, 62]; //    D  D  A D
  const AMAJ = [45, 52, 57, 64]; //    A  E  A E
  const EMAJ = [40, 47, 56, 59]; //    E  B  G# B

  function loopPcm(progression: number[][], bars: number): Float32Array {
    const events: { freq: number; start: number; dur: number; gain: number }[] = [];
    for (let bar = 0; bar < bars; bar++) {
      const chord = progression[bar % progression.length];
      for (let eighth = 0; eighth < 8; eighth++) {
        const note = chord[eighth % chord.length];
        events.push({ freq: midiHz(note), start: bar * 2 + eighth * 0.25, dur: 0.24, gain: 0.5 });
      }
      events.push({ freq: midiHz(chord[0] - 12), start: bar * 2, dur: 1.8, gain: 0.7 }); // root, low
    }
    return render(events, bars * 2 + 0.5);
  }

  // F# minor: tonic chord occupies half the loop.
  const minorResult = detectKey(loopPcm([FSHARPM, FSHARPM, DMAJ, EMAJ], 8), SR);
  check('key detected (minor fixture)', minorResult !== null, JSON.stringify(minorResult && { key: minorResult.keyName, r: minorResult.correlation }));
  if (minorResult) {
    check('key is F# minor', minorResult.tonic === 6 && minorResult.mode === 'minor', `got ${minorResult.keyName}`);
    check('midiKey spelling', minorResult.midiKey === 'F#', `got ${minorResult.midiKey}`);
    check('midiSharps for F# minor', minorResult.midiSharps === 3, `got ${minorResult.midiSharps}`);
  }

  // A major control: same chord set, tonic emphasis moved to A.
  const majorResult = detectKey(loopPcm([AMAJ, AMAJ, DMAJ, EMAJ], 8), SR);
  check('key detected (major control)', majorResult !== null, JSON.stringify(majorResult && { key: majorResult.keyName, r: majorResult.correlation }));
  if (majorResult) {
    check('key is A major', majorResult.tonic === 9 && majorResult.mode === 'major', `got ${majorResult.keyName}`);
  }
}

// --- Test 3: MIDI header round-trip (parsed back separately with mido) ---
// Uses the exact production path: setTempo before notes, key signature
// spliced in at the byte level afterwards (see midiMeta.ts).
{
  const midi = new Midi();
  midi.name = 'test';
  midi.header.setTempo(98);
  const track = midi.addTrack();
  track.addNote({ midi: 42, time: 1.0, duration: 0.5, velocity: 0.8 });
  track.addNote({ midi: 45, time: 2.0, duration: 0.5, velocity: 0.8 });
  const bytes = insertKeySignatureMetaEvent(midi.toArray(), 3, 'minor');
  writeFileSync('/tmp/test-export.mid', Buffer.from(bytes));

  // Flat-key edge case: Eb minor = 6 flats (sharps = -6).
  const flat = new Midi();
  flat.header.setTempo(120);
  flat.addTrack().addNote({ midi: 51, time: 0, duration: 0.5, velocity: 0.8 });
  writeFileSync('/tmp/test-export-flat.mid', Buffer.from(insertKeySignatureMetaEvent(flat.toArray(), -6, 'minor')));
  console.log('wrote /tmp/test-export.mid and /tmp/test-export-flat.mid');
}

// --- Test 4: note cleanup on a synthetic bass part with known pathologies ---
{
  const n = (midi: number, startTime: number, duration: number, velocity: number): CleanableNote => ({
    midi, startTime, duration, velocity,
  });
  const raw: CleanableNote[] = [
    n(30, 0.0, 0.4, 0.9), // fundamental — survives
    n(42, 0.01, 0.2, 0.5), // octave shadow — pruned
    n(49, 0.005, 0.15, 0.4), // 3rd-harmonic shadow — pruned
    n(30, 1.0, 0.4, 0.9), // fundamental — survives
    n(42, 1.0, 0.4, 0.88), // hard octave: survives pruning, but bass is monophonic — removed
    n(36, 2.0, 0.02, 0.9), // blip — dropped by min length
    n(38, 3.0, 0.1, 0.7), // fragment 1
    n(38, 3.15, 0.15, 0.75), // fragment 2 — merges with fragment 1
    n(31, 4.0, 0.5, 0.6), // mono conflict loser — truncated at winner's onset
    n(35, 4.1, 0.4, 0.95), // mono conflict winner
    n(28, 5.0, 0.3, 0.1), // below velocity floor — dropped
  ];
  const cleaned = cleanupStemNotes(raw, 'bass');
  const sig = cleaned.map((x) => `${x.midi}@${x.startTime.toFixed(2)}+${x.duration.toFixed(2)}`);
  const expected = ['30@0.00+0.40', '30@1.00+0.40', '38@3.00+0.30', '31@4.00+0.10', '35@4.10+0.40'];
  check(
    'cleanup bass fixture',
    JSON.stringify(sig) === JSON.stringify(expected),
    `got [${sig.join(', ')}]`
  );

  // Piano is polyphonic: a hard-played octave doubling must survive.
  const pianoRaw: CleanableNote[] = [n(48, 0, 0.4, 0.9), n(60, 0, 0.4, 0.88), n(72, 0.01, 0.1, 0.4)];
  const pianoCleaned = cleanupStemNotes(pianoRaw, 'piano');
  check(
    'cleanup piano keeps real octave, prunes quiet shadow',
    pianoCleaned.length === 2 && pianoCleaned.some((x) => x.midi === 60),
    `got [${pianoCleaned.map((x) => x.midi).join(', ')}]`
  );
}

// --- Test 5: key mapping against F# minor (tonic 6) ---
{
  const n = (midi: number, duration: number): CleanableNote => ({ midi, startTime: 0, duration, velocity: 0.8 });
  // F# natural minor pitch classes: F# G# A B C# D E -> {6,8,9,11,1,2,4}
  check('isInKey: C# in F# minor', isInKey(49, 6, 'minor'), 'C# (pc 1) is diatonic');
  check('isInKey: C natural out', !isInKey(48, 6, 'minor'), 'C (pc 0) is not diatonic');

  const notes = [n(48, 0.2), n(49, 0.2), n(48, 0.9), n(45, 0.2)]; // C, C#, C(long), A
  check('countOutOfKey', countOutOfKey(notes, 6, 'minor') === 2, `got ${countOutOfKey(notes, 6, 'minor')}`);

  // Snap up: C (48) -> C# (49), Tess's hand correction to the Addiction bassline.
  const snapped = applyKeyMapping(notes, 6, 'minor', 'snap');
  check('snap up C->C#', snapped.every((x) => x.midi !== 48) && snapped.filter((x) => x.midi === 49).length === 3, `got [${snapped.map((x) => x.midi).join(', ')}]`);
  // Snap down: C (48) -> B (47).
  const snappedDown = applyKeyMapping(notes, 6, 'minor', 'snap', { snapDirection: 'down' });
  check('snap down C->B', snappedDown.filter((x) => x.midi === 47).length === 2, `got [${snappedDown.map((x) => x.midi).join(', ')}]`);
  // Drop: short C removed, long C (0.9s >= 0.4 protect) kept as intentional.
  const dropped = applyKeyMapping(notes, 6, 'minor', 'drop');
  check('drop keeps long chromatic', dropped.length === 3 && dropped.some((x) => x.midi === 48 && x.duration === 0.9), `got [${dropped.map((x) => `${x.midi}+${x.duration}`).join(', ')}]`);
}

process.exit(failures > 0 ? 1 : 0);
