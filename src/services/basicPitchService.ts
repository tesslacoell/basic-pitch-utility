import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';
import { Midi } from '@tonejs/midi';
import JSZip from 'jszip';
import {
  StemType,
  STEM_DEFINITIONS,
  isolateStemAudioBuffer,
  StemDefinition,
} from './stemSeparationService';
import { detectTempoFromBuffer, TempoDetectionResult } from './tempoDetection';
import { detectKeyFromBuffer, KeyDetectionResult } from './keyDetection';
import { insertKeySignatureMetaEvent } from './midiMeta';
import { cleanupStemNotes } from './noteCleanup';
import { applyKeyMapping, countOutOfKey } from './keyMapping';

export type InferenceBackendMode = 'auto' | 'cpu' | 'webgl';

let activeBackendPreference: InferenceBackendMode = 'auto';

export function setInferenceBackendPreference(mode: InferenceBackendMode) {
  activeBackendPreference = mode;
  if (mode === 'cpu') {
    tf.setBackend('cpu').catch(() => {});
    cachedBasicPitchInstance = null;
  } else if (mode === 'webgl') {
    tf.setBackend('webgl').catch(() => {});
    cachedBasicPitchInstance = null;
  }
}

export function getInferenceBackendPreference(): InferenceBackendMode {
  return activeBackendPreference;
}

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
    /** Note count before the cleanup stage ran. */
    rawNoteCount: number;
    /** Notes outside the detected key (after cleanup, before any key mapping). Null when no key was detected. */
    outOfKeyCount: number | null;
    durationSeconds: number;
    pitchRange: string;
    lowestNote: string;
    highestNote: string;
  };
}

export interface ConversionOptions {
  /**
   * Tempo to write into the exported MIDI. When omitted, tempo is detected
   * from the audio; if detection fails, 120 BPM is used as a last resort
   * (and flagged as 'fallback' in the result analysis).
   */
  bpm?: number;
  /** Run key detection and write a key_signature meta event. Default true. */
  detectKeySignature?: boolean;
  /** Run the note cleanup stage (harmonic pruning, monophony, merging). Default true. */
  cleanup?: boolean;
  /**
   * Force notes into the detected key: 'snap' moves out-of-key notes one
   * semitone into the scale, 'drop' deletes short out-of-key notes.
   * Default 'off' — a judgment call, never applied silently.
   */
  keyMapping?: 'off' | 'snap' | 'drop';
}

export interface TrackAnalysis {
  /** Tempo actually used for the export, in BPM. */
  bpm: number;
  bpmSource: 'manual' | 'detected' | 'fallback';
  tempo: TempoDetectionResult | null;
  key: KeyDetectionResult | null;
}

export interface MultiStemConversionResult {
  originalFileName: string;
  durationSeconds: number;
  analysis: TrackAnalysis;
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

/**
 * Safely evaluates the Basic Pitch model on the provided audio buffer.
 * If WebGL shader compilation fails (e.g. macOS GPU/Metal ANGLE error)
 * OR if WebGL silently produces zero activation energy on audible audio,
 * it automatically switches the TensorFlow.js backend to 'cpu' and retries transparently with 100% precision.
 */
async function evaluateModelWithFallback(
  audioBuffer: AudioBuffer,
  onProgress: (pct: number) => void
): Promise<{ frames: number[][]; onsets: number[][]; contours: number[][] }> {
  // If user selected CPU or if already running on CPU, evaluate directly on CPU
  if (activeBackendPreference === 'cpu' || tf.getBackend() === 'cpu') {
    if (tf.getBackend() !== 'cpu') {
      await tf.setBackend('cpu');
      await tf.ready();
      cachedBasicPitchInstance = null;
    }
    const instance = getBasicPitchInstance();
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    await instance.evaluateModel(
      audioBuffer,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      onProgress
    );
    return { frames, onsets, contours };
  }

  // Attempt WebGL first for maximum speed
  try {
    let instance = getBasicPitchInstance();
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    await instance.evaluateModel(
      audioBuffer,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      onProgress
    );

    // Verify whether WebGL output has real energy
    let maxEnergy = 0;
    for (let i = 0; i < frames.length; i++) {
      const row = frames[i];
      for (let j = 0; j < row.length; j++) {
        if (row[j] > maxEnergy) maxEnergy = row[j];
      }
    }

    // Inspect peak amplitude of the input audio
    const channelData = audioBuffer.getChannelData(0);
    let audioPeak = 0;
    const checkLength = Math.min(channelData.length, 66150); // first ~3 seconds
    for (let i = 0; i < checkLength; i++) {
      const amp = Math.abs(channelData[i]);
      if (amp > audioPeak) audioPeak = amp;
    }

    // If WebGL returned zero energy on an audible signal, it silently failed
    if (maxEnergy < 0.001 && audioPeak > 0.01) {
      console.warn(
        `[Basic Pitch] WebGL produced zero activation energy (peak=${maxEnergy}) on audible signal (peak=${audioPeak}). Retrying with CPU backend...`
      );
      throw new Error('WebGL silent zero output detected');
    }

    return { frames, onsets, contours };
  } catch (err: unknown) {
    const errString = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Basic Pitch] WebGL inference issue ("${errString}"). Switching to CPU backend for 100% precision...`
    );

    // Force CPU backend and reset model instance
    await tf.setBackend('cpu');
    await tf.ready();
    cachedBasicPitchInstance = null;
    const cpuInstance = getBasicPitchInstance();

    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    await cpuInstance.evaluateModel(
      audioBuffer,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      onProgress
    );

    console.info('[Basic Pitch] Successfully transcribed audio using CPU backend.');
    return { frames, onsets, contours };
  }
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
 * Stamps a Midi file with the track's tempo. MUST be called before notes
 * are added: @tonejs/midi converts note times from seconds to ticks
 * through the header's tempo map, so a header set after notes exist
 * cannot repair their tick positions. This is the fix for the historical
 * bug where every export silently assumed 120 BPM and stretched ~1.22x
 * against a 98 BPM song.
 */
function applyHeaderMetadata(midi: Midi, bpm: number): void {
  midi.header.setTempo(bpm);
}

/**
 * Serialises a Midi file and splices in the key_signature meta event.
 * (The event is added at the byte level, not via @tonejs/midi's header,
 * because that library's key-signature encoder is broken — see
 * midiMeta.ts.)
 */
function finalizeMidiBytes(midi: Midi, key: KeyDetectionResult | null): Uint8Array {
  const bytes = midi.toArray();
  return key ? insertKeySignatureMetaEvent(bytes, key.midiSharps, key.mode) : bytes;
}

/**
 * Converts audio into one or multiple instrument stems using Spotify Basic Pitch
 */
export async function convertAudioToStems(
  fileOrBlob: File | Blob,
  originalFileName: string,
  selectedStems: StemType[],
  onProgress: (percent: number, statusText: string) => void,
  options: ConversionOptions = {}
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
  const stemResults: StemResult[] = [];

  // 3. Analyse the master audio: tempo (for the MIDI header) and key.
  onProgress(9, 'Detecting tempo & key...');
  const tempoResult = options.bpm ? null : detectTempoFromBuffer(masterBuffer);
  const analysis: TrackAnalysis = {
    bpm: options.bpm ?? tempoResult?.bpm ?? 120,
    bpmSource: options.bpm ? 'manual' : tempoResult ? 'detected' : 'fallback',
    tempo: tempoResult,
    key: options.detectKeySignature === false ? null : detectKeyFromBuffer(masterBuffer),
  };

  // Master multi-track MIDI file containing all extracted stems on separate channels/tracks
  const masterMidi = new Midi();
  masterMidi.name = `${baseName} (All Stems)`;
  applyHeaderMetadata(masterMidi, analysis.bpm);

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

    // Evaluate model for this stem with automatic CPU fallback if WebGL shader compilation fails
    const { frames, onsets, contours } = await evaluateModelWithFallback(
      stemBuffer,
      (modelPct) => {
        const currentPct = Math.round(stemBasePct + modelPct * (progressPerStem * 0.8));
        const backendNotice = tf.getBackend() === 'cpu' ? ' [CPU Engine]' : '';
        onProgress(
          currentPct,
          `Transcribing ${def.shortName} stem${backendNotice} (${Math.round(modelPct * 100)}%)...`
        );
      }
    );

    // Post-process with stem-specific frequency constraints
    const params = def.pitchParams;
    let rawNotes = outputToNotesPoly(
      frames.map((r) => r.slice()),
      onsets.map((r) => r.slice()),
      params.onsetThresh,
      params.frameThresh,
      params.minNoteLen,
      true,
      params.maxFreq ?? null,
      params.minFreq ?? null,
      params.melodiaTrick ?? false,
      params.energyTolerance ?? 11
    );

    // Adaptive threshold fallback: If strict thresholds yield 0 notes, retry with relaxed threshold so quiet instruments are extracted
    if (rawNotes.length === 0) {
      const relaxedOnset = Math.max(0.22, params.onsetThresh * 0.7);
      const relaxedFrame = Math.max(0.16, params.frameThresh * 0.7);
      const relaxedMinLen = Math.max(2, params.minNoteLen - 2);

      const retryNotes = outputToNotesPoly(
        frames.map((r) => r.slice()),
        onsets.map((r) => r.slice()),
        relaxedOnset,
        relaxedFrame,
        relaxedMinLen,
        true,
        params.maxFreq ?? null,
        params.minFreq ?? null,
        params.melodiaTrick ?? false,
        params.energyTolerance ?? 11
      );

      if (retryNotes.length > 0) {
        console.info(
          `[Basic Pitch] Adaptive sensitivity applied for ${def.name}: extracted ${retryNotes.length} notes.`
        );
        rawNotes = retryNotes;
      }
    }

    const notesWithBends = addPitchBendsToNoteEvents(contours, rawNotes);
    const timedNotes = noteFramesToTime(notesWithBends);

    // Create standalone single-stem MIDI
    const singleMidi = new Midi();
    singleMidi.name = `${baseName} - ${def.shortName}`;
    applyHeaderMetadata(singleMidi, analysis.bpm);
    const singleTrack = singleMidi.addTrack();
    singleTrack.name = def.name;
    singleTrack.channel = def.channel;
    singleTrack.instrument.number = def.midiProgram;

    // Also add to master multi-track MIDI
    const masterTrack = masterMidi.addTrack();
    masterTrack.name = def.name;
    masterTrack.channel = def.channel;
    masterTrack.instrument.number = def.midiProgram;

    // Pass 1: normalise the model's raw output into TranscribedNotes.
    const parsedNotes: TranscribedNote[] = [];
    timedNotes.forEach((n) => {
      const pitch = Math.round(n.pitchMidi);
      parsedNotes.push({
        midi: pitch,
        pitchName: midiToNoteName(pitch),
        startTime: n.startTimeSeconds,
        duration: Math.max(0.05, n.durationSeconds),
        velocity: Math.max(0.2, Math.min(1.0, n.amplitude || 0.8)),
        pitchBends: n.pitchBends,
        stem: stemType,
      });
    });

    // Pass 2: cleanup (harmonic shadows, monophony, fragment merging) —
    // applied BEFORE anything is written, so the exported MIDI, the stats
    // and the piano roll all show the same cleaned part.
    let finalNotes =
      options.cleanup === false ? parsedNotes : cleanupStemNotes(parsedNotes, stemType);

    // Pass 2.5: count out-of-key notes against the detected key, and apply
    // key mapping only when the user explicitly asked for it.
    const outOfKeyCount = analysis.key
      ? countOutOfKey(finalNotes, analysis.key.tonic, analysis.key.mode)
      : null;
    if (options.keyMapping && options.keyMapping !== 'off' && analysis.key) {
      finalNotes = applyKeyMapping(finalNotes, analysis.key.tonic, analysis.key.mode, options.keyMapping);
      finalNotes.forEach((n) => {
        n.pitchName = midiToNoteName(n.midi);
      });
    }

    // Pass 3: write the surviving notes to both MIDI files.
    let minMidi = 128;
    let maxMidi = -1;
    finalNotes.forEach((n) => {
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;

      singleTrack.addNote({ midi: n.midi, time: n.startTime, duration: n.duration, velocity: n.velocity });
      masterTrack.addNote({ midi: n.midi, time: n.startTime, duration: n.duration, velocity: n.velocity });

      if (n.pitchBends && n.pitchBends.length > 0) {
        n.pitchBends.forEach((bend, bIdx) => {
          const bendTime = n.startTime + (bIdx * n.duration) / n.pitchBends!.length;
          singleTrack.addPitchBend({ time: bendTime, value: bend });
          masterTrack.addPitchBend({ time: bendTime, value: bend });
        });
      }
    });

    const singleBytes = finalizeMidiBytes(singleMidi, analysis.key);
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
      notes: finalNotes,
      stats: {
        noteCount: finalNotes.length,
        rawNoteCount: parsedNotes.length,
        outOfKeyCount,
        durationSeconds,
        pitchRange,
        lowestNote,
        highestNote,
      },
    });
  }

  // Finalize Master Multi-Track MIDI
  onProgress(94, 'Assembling multi-track master MIDI...');
  const masterBytes = finalizeMidiBytes(masterMidi, analysis.key);
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
    analysis,
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

/**
 * Explicitly forces TensorFlow.js into CPU inference mode and resets model caches.
 */
export async function forceCpuBackend(): Promise<void> {
  try {
    await tf.setBackend('cpu');
    await tf.ready();
    cachedBasicPitchInstance = null;
    console.info('[Basic Pitch] Explicitly switched to CPU backend.');
  } catch (err) {
    console.warn('[Basic Pitch] Could not force CPU backend:', err);
  }
}

