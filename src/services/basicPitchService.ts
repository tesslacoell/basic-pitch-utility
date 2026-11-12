import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import {
  StemType,
  STEM_DEFINITIONS,
  isolateStemAudioBuffer,
  StemDefinition,
} from './stemSeparationService';

export interface TranscribedNote {
  midi: number;
  pitchName: string;
  startTime: number;
  duration: number;
  velocity: number;
  pitchBends?: number[];
  stem?: StemType;
}

export interface StemResult {
  stem: StemType;
  definition: StemDefinition;
  fileName: string;
  midiFileName: string;
  midiBytes: Uint8Array;
  midiBlob: Blob;
  blobUrl: string;
  dataUrl: string;
  notes: TranscribedNote[];
  stats: {
    noteCount: number;
    durationSeconds: number;
    pitchRange: string;
    lowestNote: string;
    highestNote: string;
  };
}

export interface MultiStemConversionResult {
  originalFileName: string;
  durationSeconds: number;
  stems: StemResult[];
  allStemsMidi: {
    midiBytes: Uint8Array;
    midiBlob: Blob;
    blobUrl: string;
    dataUrl: string;
    fileName: string;
  };
  zipBlob?: Blob;
  zipUrl?: string;
}

// Global cached BasicPitch instance
let cachedBasicPitchInstance: BasicPitch | null = null;

function getBasicPitchInstance(): BasicPitch {
  if (!cachedBasicPitchInstance) {
    // Supports both standalone Electron file:// protocol and web http://
    const modelUrl =
      window.location.protocol === 'file:'
        ? new URL('model/model.json', window.location.href).href
        : `${window.location.origin}/model/model.json`;
    cachedBasicPitchInstance = new BasicPitch(modelUrl);
  }
  return cachedBasicPitchInstance;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midiNumber: number): string {
  const rounded = Math.round(midiNumber);
  const note = NOTE_NAMES[rounded % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${note}${octave}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts audio into one or multiple instrument stems using Spotify Basic Pitch
 */
export async function convertAudioToStems(
  fileOrBlob: File | Blob,
  originalFileName: string,
  selectedStems: StemType[],
  onProgress: (percent: number, statusText: string) => void
): Promise<MultiStemConversionResult> {
  const baseName = originalFileName.replace(/\.[^/.]+$/, '').trim() || 'transcription';
  const stemsToProcess = selectedStems.length > 0 ? selectedStems : (['piano', 'guitar', 'bass', 'lead'] as StemType[]);

  // 1. Read audio bytes
  onProgress(2, 'Reading audio file...');
  const arrayBuffer = await fileOrBlob.arrayBuffer();

  // 2. Decode original audio waveform
  onProgress(8, 'Decoding master audio waveform...');
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  
  let masterBuffer: AudioBuffer;
  try {
    masterBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error('Could not decode audio. Please ensure the file is a valid audio format (MP3, WAV, FLAC, OGG, M4A, etc.).');
  } finally {
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  }

  const durationSeconds = Math.round(masterBuffer.duration * 10) / 10;
  const basicPitch = getBasicPitchInstance();
  const stemResults: StemResult[] = [];

  // Master multi-track MIDI file containing all extracted stems on separate channels/tracks
  const masterMidi = new Midi();
  masterMidi.name = `${baseName} (All Stems)`;

  // Allocate progress percentage per stem
  const totalStems = stemsToProcess.length;
  const progressPerStem = 82 / totalStems; // From 10% to 92%

  for (let sIdx = 0; sIdx < totalStems; sIdx++) {
    const stemType = stemsToProcess[sIdx];
    const def = STEM_DEFINITIONS[stemType];
    const stemBasePct = 10 + sIdx * progressPerStem;

    onProgress(
      Math.round(stemBasePct),
      `Isolating ${def.name} stem (${sIdx + 1}/${totalStems})...`
    );

    // Isolate & resample stem to 22.05 kHz mono
    const stemBuffer = await isolateStemAudioBuffer(masterBuffer, stemType);

    // Evaluate model for this stem
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    await basicPitch.evaluateModel(
      stemBuffer,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (modelPct) => {
        const currentPct = Math.round(stemBasePct + modelPct * (progressPerStem * 0.8));
        onProgress(
          currentPct,
          `Transcribing ${def.shortName} stem (${Math.round(modelPct * 100)}%)...`
        );
      }
    );

    // Post-process with stem-specific frequency constraints
    const params = def.pitchParams;
    const rawNotes = outputToNotesPoly(
      frames,
      onsets,
      params.onsetThresh,
      params.frameThresh,
      params.minNoteLen,
      true,
      params.maxFreq ?? null,
      params.minFreq ?? null,
      params.melodiaTrick ?? false,
      params.energyTolerance ?? 11
    );

    const notesWithBends = addPitchBendsToNoteEvents(contours, rawNotes);
    const timedNotes = noteFramesToTime(notesWithBends);

    // Create standalone single-stem MIDI
    const singleMidi = new Midi();
    singleMidi.name = `${baseName} - ${def.shortName}`;
    const singleTrack = singleMidi.addTrack();
    singleTrack.name = def.name;
    singleTrack.channel = def.channel;
    singleTrack.instrument.number = def.midiProgram;

    // Also add to master multi-track MIDI
    const masterTrack = masterMidi.addTrack();
    masterTrack.name = def.name;
    masterTrack.channel = def.channel;
    masterTrack.instrument.number = def.midiProgram;

    const parsedNotes: TranscribedNote[] = [];
    let minMidi = 128;
    let maxMidi = -1;

    timedNotes.forEach((n) => {
      const pitch = Math.round(n.pitchMidi);
      if (pitch < minMidi) minMidi = pitch;
      if (pitch > maxMidi) maxMidi = pitch;

      const duration = Math.max(0.05, n.durationSeconds);
      const velocity = Math.max(0.2, Math.min(1.0, n.amplitude || 0.8));

      // Add to single-stem MIDI track
      singleTrack.addNote({
        midi: pitch,
        time: n.startTimeSeconds,
        duration,
        velocity,
      });

      // Add to master multi-track MIDI
      masterTrack.addNote({
        midi: pitch,
        time: n.startTimeSeconds,
        duration,
        velocity,
      });

      if (n.pitchBends && n.pitchBends.length > 0) {
        n.pitchBends.forEach((bend, bIdx) => {
          const bendTime = n.startTimeSeconds + (bIdx * duration) / n.pitchBends!.length;
          singleTrack.addPitchBend({ time: bendTime, value: bend });
          masterTrack.addPitchBend({ time: bendTime, value: bend });
        });
      }

      parsedNotes.push({
        midi: pitch,
        pitchName: midiToNoteName(pitch),
        startTime: n.startTimeSeconds,
        duration,
        velocity,
        pitchBends: n.pitchBends,
        stem: stemType,
      });
    });

    const singleBytes = singleMidi.toArray();
    const singleBlob = new Blob([singleBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
    const singleBlobUrl = URL.createObjectURL(singleBlob);
    const singleDataUrl = `data:audio/midi;base64,${uint8ArrayToBase64(singleBytes)}`;
    const stemMidiFileName = `${baseName}_${stemType}.mid`;

    const lowestNote = minMidi <= 127 ? midiToNoteName(minMidi) : '—';
    const highestNote = maxMidi >= 0 ? midiToNoteName(maxMidi) : '—';
    const pitchRange = minMidi <= maxMidi ? `${lowestNote} to ${highestNote}` : 'None';

    stemResults.push({
      stem: stemType,
      definition: def,
      fileName: originalFileName,
      midiFileName: stemMidiFileName,
      midiBytes: singleBytes,
      midiBlob: singleBlob,
      blobUrl: singleBlobUrl,
      dataUrl: singleDataUrl,
      notes: parsedNotes,
      stats: {
        noteCount: parsedNotes.length,
        durationSeconds,
        pitchRange,
        lowestNote,
        highestNote,
      },
    });
  }

  // Finalize Master Multi-Track MIDI
  onProgress(94, 'Assembling multi-track master MIDI...');
  const masterBytes = masterMidi.toArray();
  const masterBlob = new Blob([masterBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
  const masterBlobUrl = URL.createObjectURL(masterBlob);
  const masterDataUrl = `data:audio/midi;base64,${uint8ArrayToBase64(masterBytes)}`;
  const masterFileName = `${baseName}_all_stems.mid`;

  // Build ZIP bundle containing all stems and master MIDI
  onProgress(97, 'Packaging stem archive...');
  let zipBlob: Blob | undefined;
  let zipUrl: string | undefined;

  try {
    const zip = new JSZip();
    zip.file(masterFileName, masterBytes);
    stemResults.forEach((s) => {
      zip.file(s.midiFileName, s.midiBytes);
    });
    zipBlob = await zip.generateAsync({ type: 'blob' });
    zipUrl = URL.createObjectURL(zipBlob);
  } catch (err) {
    console.warn('Zip packaging skipped:', err);
  }

  onProgress(100, 'Stem extraction complete!');

  return {
    originalFileName,
    durationSeconds,
    stems: stemResults,
    allStemsMidi: {
      midiBytes: masterBytes,
      midiBlob: masterBlob,
      blobUrl: masterBlobUrl,
      dataUrl: masterDataUrl,
      fileName: masterFileName,
    },
    zipBlob,
    zipUrl,
  };
}

/**
 * Multi-Stem Web Audio synthesizer player supporting solo, mute, and stem-specific timbres
 */
export class MultiStemSynthPlayer {
  private audioCtx: AudioContext | null = null;
  private activeOscillators: { osc: OscillatorNode; gain: GainNode }[] = [];
  private isPlaying = false;
  private timerId: number | null = null;
  private onTimeUpdate?: (time: number) => void;
  private onFinish?: () => void;

  public play(
    stems: StemResult[],
    activeStemIds: Set<StemType>,
    onTimeUpdate?: (time: number) => void,
    onFinish?: () => void
  ) {
    this.stop();

    const activeStems = stems.filter((s) => activeStemIds.has(s.stem) && s.notes.length > 0);
    if (activeStems.length === 0) {
      onFinish?.();
      return;
    }

    this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.isPlaying = true;
    this.onTimeUpdate = onTimeUpdate;
    this.onFinish = onFinish;

    const startTime = this.audioCtx.currentTime + 0.05;
    let maxEndTime = 0;

    const masterGain = this.audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.3, startTime);
    masterGain.connect(this.audioCtx.destination);

    activeStems.forEach((stemResult) => {
      if (!this.audioCtx) return;
      const stemType = stemResult.stem;

      // Stem-specific bus gain
      const stemGain = this.audioCtx.createGain();
      const stemLevel = stemType === 'bass' ? 0.45 : stemType === 'piano' ? 0.35 : 0.3;
      stemGain.gain.setValueAtTime(stemLevel, startTime);
      stemGain.connect(masterGain);

      stemResult.notes.forEach((note) => {
        if (!this.audioCtx) return;
        const noteStart = startTime + note.startTime;
        const noteEnd = noteStart + Math.max(0.08, note.duration);
        if (noteEnd > maxEndTime) {
          maxEndTime = noteEnd;
        }

        const osc = this.audioCtx.createOscillator();
        const noteGain = this.audioCtx.createGain();
        const freq = 440 * Math.pow(2, (note.midi - 69) / 12);

        // Customize waveform per instrument stem
        if (stemType === 'bass') {
          osc.type = 'sawtooth';
          // Low-pass filter for bass roundness
          const filter = this.audioCtx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(450, noteStart);
          osc.connect(noteGain);
          noteGain.connect(filter);
          filter.connect(stemGain);
        } else if (stemType === 'guitar') {
          osc.type = 'triangle';
          osc.connect(noteGain);
          noteGain.connect(stemGain);
        } else if (stemType === 'lead') {
          osc.type = 'sine';
          osc.connect(noteGain);
          noteGain.connect(stemGain);
        } else {
          // Piano / keys
          osc.type = 'triangle';
          osc.connect(noteGain);
          noteGain.connect(stemGain);
        }

        osc.frequency.setValueAtTime(freq, noteStart);

        // Amplitude envelope
        noteGain.gain.setValueAtTime(0.0001, noteStart);
        noteGain.gain.exponentialRampToValueAtTime(
          Math.min(1.0, note.velocity * 0.5),
          noteStart + (stemType === 'guitar' ? 0.008 : 0.02)
        );
        noteGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

        osc.start(noteStart);
        osc.stop(noteEnd + 0.05);

        this.activeOscillators.push({ osc, gain: noteGain });
      });
    });

    const startPerf = performance.now();
    const totalDurationSeconds = maxEndTime - startTime;

    const tick = () => {
      if (!this.isPlaying) return;
      const elapsed = (performance.now() - startPerf) / 1000;
      this.onTimeUpdate?.(Math.min(totalDurationSeconds, elapsed));

      if (elapsed >= totalDurationSeconds) {
        this.stop();
        this.onFinish?.();
      } else {
        this.timerId = window.requestAnimationFrame(tick);
      }
    };

    this.timerId = window.requestAnimationFrame(tick);
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerId !== null) {
      window.cancelAnimationFrame(this.timerId);
      this.timerId = null;
    }
    this.activeOscillators.forEach(({ osc }) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // already stopped
      }
    });
    this.activeOscillators = [];
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  public get playing(): boolean {
    return this.isPlaying;
  }
}
