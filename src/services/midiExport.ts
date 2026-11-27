import { Midi } from '@tonejs/midi';
import { StemType, STEM_DEFINITIONS } from './stemSeparationService';
import { KeyDetectionResult } from './keyDetection';
import { insertKeySignatureMetaEvent } from './midiMeta';

/**
 * MIDI serialisation shared by the conversion service and the
 * final-tempo re-export. Kept free of the inference stack (no
 * TensorFlow / Basic Pitch imports) so the test harness can exercise
 * the export path in plain Node.
 */

/** The note fields the exporter needs — TranscribedNote satisfies this. */
export interface ExportableNote {
  midi: number;
  startTime: number;
  duration: number;
  velocity: number;
  pitchBends?: number[];
}

/**
 * Stamps a Midi file with the track's tempo. MUST be called before notes
 * are added: @tonejs/midi converts note times from seconds to ticks
 * through the header's tempo map, so a header set after notes exist
 * cannot repair their tick positions. This is the fix for the historical
 * bug where every export silently assumed 120 BPM and stretched ~1.22x
 * against a 98 BPM song.
 */
export function applyHeaderMetadata(midi: Midi, bpm: number): void {
  midi.header.setTempo(bpm);
}

/**
 * Serialises a Midi file and splices in the key_signature meta event.
 * (The event is added at the byte level, not via @tonejs/midi's header,
 * because that library's key-signature encoder is broken — see
 * midiMeta.ts.)
 */
export function finalizeMidiBytes(midi: Midi, key: KeyDetectionResult | null): Uint8Array {
  const bytes = midi.toArray();
  return key ? insertKeySignatureMetaEvent(bytes, key.midiSharps, key.mode) : bytes;
}

type MidiTrack = ReturnType<Midi['addTrack']>;

/** Writes notes and their pitch bends onto a track. */
export function writeNotesToTrack(track: MidiTrack, notes: ExportableNote[]): void {
  notes.forEach((n) => {
    track.addNote({ midi: n.midi, time: n.startTime, duration: n.duration, velocity: n.velocity });
    if (n.pitchBends && n.pitchBends.length > 0) {
      n.pitchBends.forEach((bend, bIdx) => {
        const bendTime = n.startTime + (bIdx * n.duration) / n.pitchBends!.length;
        track.addPitchBend({ time: bendTime, value: bend });
      });
    }
  });
}

/**
 * Serialises a set of stem note lists to MIDI bytes at a given tempo.
 * Notes stay at their absolute times in seconds; only the tempo stamp
 * changes, and because the header tempo is set before notes are
 * written, their ticks are laid out against the new grid — a note
 * sitting exactly on beat 100 of the true tempo lands exactly on tick
 * 100 × PPQ in the exported file.
 */
export function buildMidiBytesAtTempo(
  stems: { stem: StemType; notes: ExportableNote[] }[],
  baseName: string,
  bpm: number,
  key: KeyDetectionResult | null
): { perStem: { stem: StemType; midiBytes: Uint8Array }[]; masterBytes: Uint8Array } {
  const masterMidi = new Midi();
  masterMidi.name = `${baseName} (All Stems)`;
  applyHeaderMetadata(masterMidi, bpm);

  const perStem: { stem: StemType; midiBytes: Uint8Array }[] = [];
  for (const { stem, notes } of stems) {
    const def = STEM_DEFINITIONS[stem];
    const singleMidi = new Midi();
    singleMidi.name = `${baseName} - ${def.shortName}`;
    applyHeaderMetadata(singleMidi, bpm);
    const singleTrack = singleMidi.addTrack();
    singleTrack.name = def.name;
    singleTrack.channel = def.channel;
    singleTrack.instrument.number = def.midiProgram;
    writeNotesToTrack(singleTrack, notes);

    const masterTrack = masterMidi.addTrack();
    masterTrack.name = def.name;
    masterTrack.channel = def.channel;
    masterTrack.instrument.number = def.midiProgram;
    writeNotesToTrack(masterTrack, notes);

    perStem.push({ stem, midiBytes: finalizeMidiBytes(singleMidi, key) });
  }
  return { perStem, masterBytes: finalizeMidiBytes(masterMidi, key) };
}
