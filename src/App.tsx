import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Upload,
  FileAudio,
  Music,
  Download,
  Play,
  Square,
  RefreshCw,
  Mic,
  AlertCircle,
  Sparkles,
  GripHorizontal,
  Layers,
  Check,
  Archive,
  Volume2,
  VolumeX,
  Laptop,
  X,
  Copy,
} from 'lucide-react';
import {
  convertAudioToStems,
  MultiStemConversionResult,
  MultiStemSynthPlayer,
  TranscribedNote,
} from './services/basicPitchService';
import {
  StemType,
  STEM_DEFINITIONS,
  StemDefinition,
} from './services/stemSeparationService';
import { PianoRoll } from './components/PianoRoll';

type AppState = 'idle' | 'converting' | 'completed' | 'error';

const AVAILABLE_STEMS: StemType[] = ['piano', 'guitar', 'bass', 'lead'];

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [conversionResult, setConversionResult] = useState<MultiStemConversionResult | null>(null);
  const [showStandaloneModal, setShowStandaloneModal] = useState<boolean>(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

  // Selected stems for extraction
  const [selectedStems, setSelectedStems] = useState<Set<StemType>>(
    new Set(['piano', 'guitar', 'bass', 'lead'])
  );

  // Active audible stems in synth player / piano roll
  const [activeAuditionStems, setActiveAuditionStems] = useState<Set<StemType>>(
    new Set(['piano', 'guitar', 'bass', 'lead', 'full_mix'])
  );

  // Filter for PianoRoll view
  const [pianoRollFilter, setPianoRollFilter] = useState<'all' | StemType>('all');

  // Audio Playback Preview State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const synthPlayerRef = useRef<MultiStemSynthPlayer | null>(null);

  // Microphone recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    synthPlayerRef.current = new MultiStemSynthPlayer();
    return () => {
      synthPlayerRef.current?.stop();
    };
  }, []);

  const toggleStemSelection = (stem: StemType) => {
    setSelectedStems((prev) => {
      const next = new Set(prev);
      if (next.has(stem)) {
        if (next.size > 1) next.delete(stem);
      } else {
        next.add(stem);
      }
      return next;
    });
  };

  const selectAllStems = () => {
    setSelectedStems(new Set(['piano', 'guitar', 'bass', 'lead']));
  };

  const handleProcessAudio = useCallback(
    async (file: File | Blob, name: string) => {
      synthPlayerRef.current?.stop();
      setIsPlaying(false);
      setPlaybackTime(0);

      setState('converting');
      setProgress(0);
      setStatusMessage('Preparing stem extraction...');
      setErrorMessage('');

      try {
        const stemsArray = Array.from(selectedStems);
        const result = await convertAudioToStems(
          file,
          name,
          stemsArray,
          (pct, msg) => {
            setProgress(pct);
            setStatusMessage(msg);
          }
        );
        setConversionResult(result);
        // Initially enable all extracted stems for audition
        setActiveAuditionStems(new Set(result.stems.map((s) => s.stem)));
        setPianoRollFilter('all');
        setState('completed');
      } catch (err: unknown) {
        console.error('Stem conversion failed:', err);
        const msg = err instanceof Error ? err.message : 'Failed to convert audio file to MIDI stems.';
        setErrorMessage(msg);
        setState('error');
      }
    },
    [selectedStems]
  );

  // Window drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleProcessAudio(files[0], files[0].name);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessAudio(files[0], files[0].name);
    }
    e.target.value = '';
  };

  const handleLoadSample = async (samplePath: string, displayName: string) => {
    try {
      setState('converting');
      setProgress(4);
      setStatusMessage(`Loading ${displayName}...`);
      const resp = await fetch(samplePath);
      if (!resp.ok) throw new Error(`Could not load ${samplePath}`);
      const blob = await resp.blob();
      await handleProcessAudio(blob, displayName);
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(`Failed to load sample: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setState('error');
    }
  };

  // Microphone recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        stream.getTracks().forEach((track) => track.stop());
        handleProcessAudio(
          audioBlob,
          `Voice_Stem_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.wav`
        );
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone error:', err);
      setErrorMessage('Microphone access was denied or is unavailable.');
      setState('error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current !== null) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  // Synth Playback controls
  const togglePlay = () => {
    if (!conversionResult || conversionResult.stems.length === 0) return;

    if (isPlaying) {
      synthPlayerRef.current?.stop();
      setIsPlaying(false);
      setPlaybackTime(0);
    } else {
      setIsPlaying(true);
      synthPlayerRef.current?.play(
        conversionResult.stems,
        activeAuditionStems,
        (t) => setPlaybackTime(t),
        () => {
          setIsPlaying(false);
          setPlaybackTime(0);
        }
      );
    }
  };

  const toggleAuditionStem = (stem: StemType) => {
    setActiveAuditionStems((prev) => {
      const next = new Set(prev);
      if (next.has(stem)) {
        next.delete(stem);
      } else {
        next.add(stem);
      }
      // If currently playing, restart with new active stems
      if (isPlaying && conversionResult) {
        synthPlayerRef.current?.play(
          conversionResult.stems,
          next,
          (t) => setPlaybackTime(t),
          () => {
            setIsPlaying(false);
            setPlaybackTime(0);
          }
        );
      }
      return next;
    });
  };

  // Drag-out handlers
  const handleGenericMidiDragStart = (
    e: React.DragEvent<HTMLElement>,
    fileName: string,
    dataUrl: string,
    blobUrl: string,
    blob: Blob
  ) => {
    // 1. If running as standalone Electron desktop app, invoke native OS startDrag
    if (window.electronAPI?.isElectron) {
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      window.electronAPI.startDrag({ fileName, base64Data });
    }

    // 2. Standard HTML5 Chromium DownloadURL & file items for web/embedded
    const downloadUrlPayload = `audio/midi:${fileName}:${dataUrl}`;
    e.dataTransfer.setData('DownloadURL', downloadUrlPayload);
    e.dataTransfer.setData('text/plain', fileName);
    e.dataTransfer.setData('text/uri-list', blobUrl);

    try {
      const file = new File([blob], fileName, { type: 'audio/midi' });
      if (e.dataTransfer.items && typeof e.dataTransfer.items.add === 'function') {
        e.dataTransfer.items.add(file);
      }
    } catch {
      // Fallback
    }

    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleReset = () => {
    synthPlayerRef.current?.stop();
    setIsPlaying(false);
    setPlaybackTime(0);
    setState('idle');
    setConversionResult(null);
    setProgress(0);
    setErrorMessage('');
  };

  // Combined notes for all stems
  const allNotes = useMemo<TranscribedNote[]>(() => {
    if (!conversionResult) return [];
    return conversionResult.stems.flatMap((s) => s.notes);
  }, [conversionResult]);

  const visibleNotesForPianoRoll = useMemo<TranscribedNote[]>(() => {
    if (!conversionResult) return [];
    if (pianoRollFilter === 'all') {
      return allNotes;
    }
    const match = conversionResult.stems.find((s) => s.stem === pianoRollFilter);
    return match ? match.notes : [];
  }, [conversionResult, pianoRollFilter, allNotes]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-between selection:bg-emerald-500/20"
    >
      {/* Top Bar */}
      <header className="border-b border-neutral-900 bg-neutral-950/80 backdrop-blur px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <span className="text-base font-semibold tracking-tight text-neutral-100">
                Basic Pitch
              </span>
              <span className="text-xs text-neutral-500 ml-2">Stem Separator & MIDI Extractor</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-500">
              <span>Polyphonic Stems</span>
              <span aria-hidden="true">·</span>
              <span>Guitars</span>
              <span aria-hidden="true">·</span>
              <span>Piano</span>
              <span aria-hidden="true">·</span>
              <span>Bass</span>
            </div>

            {isElectron ? (
              <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-800/60 rounded-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Standalone Desktop App
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowStandaloneModal(true)}
                className="px-2.5 py-1 text-xs text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Laptop className="w-3.5 h-3.5 text-emerald-400" />
                <span>Run Standalone</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 max-w-4xl w-full mx-auto">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* 1. IDLE STATE: DRAG & DROP WITH STEM CONFIG */}
        {state === 'idle' && (
          <div className="w-full flex flex-col items-center">
            {/* Primary Drop Box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`w-full py-14 px-8 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer flex flex-col items-center justify-center text-center relative group ${
                isDragOver
                  ? 'border-emerald-500 bg-emerald-950/20 shadow-xl shadow-emerald-950/40 scale-[1.01]'
                  : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/40 hover:bg-neutral-900/60'
              }`}
            >
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-200 ${
                  isDragOver
                    ? 'bg-emerald-500/20 text-emerald-400 scale-110'
                    : 'bg-neutral-800 text-neutral-400 group-hover:text-neutral-200'
                }`}
              >
                <Upload className="w-8 h-8" />
              </div>

              <h2 className="text-xl font-semibold text-neutral-100 mb-2">
                Drag and drop an audio file to extract stems
              </h2>
              <p className="text-sm text-neutral-400 max-w-lg mb-4">
                Separates your audio into isolated stems (Piano/Keys, Guitars, Bass, Lead) and converts each to polyphonic MIDI via Spotify Basic Pitch.
              </p>

              <div className="flex items-center gap-2 text-xs text-neutral-500 mb-6">
                <span>MP3</span>
                <span aria-hidden="true">·</span>
                <span>WAV</span>
                <span aria-hidden="true">·</span>
                <span>FLAC</span>
                <span aria-hidden="true">·</span>
                <span>OGG</span>
                <span aria-hidden="true">·</span>
                <span>M4A</span>
                <span aria-hidden="true">·</span>
                <span>AIFF</span>
              </div>

              <button
                type="button"
                className="px-4 py-2 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Or choose audio file
              </button>
            </div>

            {/* Stem Selection Bar */}
            <div className="w-full mt-6 bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">
                    Stems to Extract ({selectedStems.size} selected)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={selectAllStems}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Select all stems
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {AVAILABLE_STEMS.map((stemId) => {
                  const def = STEM_DEFINITIONS[stemId];
                  const isSelected = selectedStems.has(stemId);
                  return (
                    <button
                      key={stemId}
                      type="button"
                      onClick={() => toggleStemSelection(stemId)}
                      className={`px-3 py-2.5 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? `${def.badgeBg} ${def.badgeBorder} ${def.badgeText} shadow-sm`
                          : 'bg-neutral-950/60 border-neutral-800 text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold">{def.name}</div>
                        <div className="text-[11px] text-neutral-500 truncate max-w-[130px]">
                          {def.shortName} stem
                        </div>
                      </div>
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                          isSelected
                            ? 'bg-emerald-500 border-emerald-400 text-neutral-950'
                            : 'border-neutral-700'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Testing Options: Samples & Microphone */}
            <div className="w-full mt-6 pt-6 border-t border-neutral-900 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-500">Test with sample:</span>
                <button
                  type="button"
                  onClick={() => handleLoadSample('/samples/band_song_mix.wav', 'band_song_mix.wav')}
                  className="px-3 py-1.5 text-xs text-neutral-200 hover:text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Full Band Mix (Piano + Guitar + Bass)
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSample('/samples/guitar_arpeggio.wav', 'guitar_arpeggio.wav')}
                  className="px-3 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5"
                >
                  Guitar Arpeggio
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSample('/samples/piano_melody.wav', 'piano_melody.wav')}
                  className="px-3 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5"
                >
                  Piano Melody
                </button>
              </div>

              {/* Microphone recording */}
              <div>
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="px-3 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5"
                  >
                    <Mic className="w-3.5 h-3.5 text-rose-400" />
                    Record Mic / Humming
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="px-3 py-1.5 text-xs text-rose-300 hover:text-rose-100 bg-rose-950/40 border border-rose-800/60 rounded-md transition-colors flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    Recording ({recordingSeconds}s) · Click to Finish
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. CONVERTING STATE: MULTI-STAGE PROGRESS BAR */}
        {state === 'converting' && (
          <div className="w-full max-w-xl bg-neutral-900/60 border border-neutral-800 rounded-2xl p-8 flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            </div>

            <h3 className="text-lg font-semibold text-neutral-100 mb-1">
              Extracting Stems & Converting to MIDI
            </h3>
            <p className="text-xs text-neutral-400 mb-6 font-mono text-center">
              {statusMessage || 'Processing audio waveform...'}
            </p>

            {/* Progress Bar Container */}
            <div className="w-full space-y-2 mb-6">
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-400">Multi-stem extraction progress</span>
                <span className="text-emerald-400 font-mono font-semibold tabular-nums">
                  {progress}%
                </span>
              </div>

              <div className="w-full h-2.5 bg-neutral-800 rounded-full overflow-hidden p-0.5 border border-neutral-700/50">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>Running client-side</span>
              <span aria-hidden="true">·</span>
              <span>DSP Stem Filtering</span>
              <span aria-hidden="true">·</span>
              <span>Spotify Basic Pitch Neural Model</span>
            </div>
          </div>
        )}

        {/* 3. COMPLETED STATE: DRAG & DROP OUT FOR EACH STEM & ALL STEMS */}
        {state === 'completed' && conversionResult && (
          <div className="w-full space-y-6">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-900 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">
                  Stem MIDI Extractions Ready
                </h2>
                <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1">
                  <span className="font-medium text-neutral-300">{conversionResult.originalFileName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{conversionResult.durationSeconds}s duration</span>
                  <span aria-hidden="true">·</span>
                  <span>{conversionResult.stems.length} stems extracted</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{allNotes.length} total notes</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {conversionResult.zipUrl && (
                  <a
                    href={conversionResult.zipUrl}
                    download={`${conversionResult.originalFileName.replace(/\.[^/.]+$/, '')}_all_stems.zip`}
                    className="px-3 py-1.5 text-xs text-neutral-200 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Archive className="w-3.5 h-3.5 text-emerald-400" />
                    Download All (.ZIP)
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Extract Another
                </button>
              </div>
            </div>

            {/* MASTER COMBINED MULTI-TRACK MIDI CARD */}
            <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Combined Master Multi-Track MIDI
                    </span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-emerald-950/80 text-emerald-300 rounded border border-emerald-800/80">
                      Multi-Track
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    Contains all stems arranged onto separate MIDI channels (Ch 1: Piano, Ch 2: Guitars, Ch 3: Bass, Ch 4: Lead).
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Master Download */}
                  <a
                    href={conversionResult.allStemsMidi.blobUrl}
                    download={conversionResult.allStemsMidi.fileName}
                    className="px-3.5 py-2 text-xs font-semibold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Master .MID
                  </a>

                  {/* Audition Synth All */}
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="px-3.5 py-2 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isPlaying ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
                        Audition All
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Master Draggable Item */}
              <div
                draggable="true"
                onDragStart={(e) =>
                  handleGenericMidiDragStart(
                    e,
                    conversionResult.allStemsMidi.fileName,
                    conversionResult.allStemsMidi.dataUrl,
                    conversionResult.allStemsMidi.blobUrl,
                    conversionResult.allStemsMidi.midiBlob
                  )
                }
                className="w-full p-4 rounded-xl bg-neutral-950/80 hover:bg-neutral-950 border-2 border-emerald-500/40 hover:border-emerald-400 transition-all cursor-grab active:cursor-grabbing shadow-md flex items-center justify-between group select-none"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-neutral-100 group-hover:text-emerald-300 transition-colors">
                      {conversionResult.allStemsMidi.fileName}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                      <span>{conversionResult.stems.length} instrument tracks</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{allNotes.length} notes</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-neutral-400 group-hover:text-emerald-400 transition-colors">
                  <span className="text-xs font-medium hidden sm:inline">
                    Drag Master to DAW (Ableton / Logic / FL Studio)
                  </span>
                  <GripHorizontal className="w-5 h-5 text-neutral-500 group-hover:text-emerald-400" />
                </div>
              </div>
            </div>

            {/* INDIVIDUAL STEM DRAGGABLE CARDS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                  Individual Stem Extractions ({conversionResult.stems.length})
                </span>
                <span className="text-xs text-neutral-500">
                  Drag any stem directly into individual DAW audio/instrument tracks
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {conversionResult.stems.map((stemResult) => {
                  const def = stemResult.definition;
                  const isAuditionActive = activeAuditionStems.has(stemResult.stem);

                  return (
                    <div
                      key={stemResult.stem}
                      className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between gap-3 group/card hover:border-neutral-700 transition-colors"
                    >
                      {/* Stem Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: def.color }}
                          />
                          <div>
                            <span className="text-sm font-semibold text-neutral-100">
                              {def.name}
                            </span>
                            <div className="text-xs text-neutral-400">
                              {stemResult.stats.noteCount} notes · Range: {stemResult.stats.pitchRange}
                            </div>
                          </div>
                        </div>

                        {/* Audition Solo/Mute toggle */}
                        <button
                          type="button"
                          onClick={() => toggleAuditionStem(stemResult.stem)}
                          title={isAuditionActive ? 'Mute stem' : 'Unmute stem'}
                          className={`p-1.5 rounded-md border text-xs transition-colors flex items-center gap-1 ${
                            isAuditionActive
                              ? 'bg-neutral-800 border-neutral-700 text-neutral-200 hover:text-white'
                              : 'bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-400 line-through'
                          }`}
                        >
                          {isAuditionActive ? (
                            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <VolumeX className="w-3.5 h-3.5 text-neutral-500" />
                          )}
                          <span className="text-[11px]">{isAuditionActive ? 'Audible' : 'Muted'}</span>
                        </button>
                      </div>

                      {/* Tactile Draggable Token for this Stem */}
                      <div
                        draggable="true"
                        onDragStart={(e) =>
                          handleGenericMidiDragStart(
                            e,
                            stemResult.midiFileName,
                            stemResult.dataUrl,
                            stemResult.blobUrl,
                            stemResult.midiBlob
                          )
                        }
                        className="w-full p-3 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-600 transition-all cursor-grab active:cursor-grabbing flex items-center justify-between select-none"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <FileAudio className="w-4 h-4 shrink-0" style={{ color: def.color }} />
                          <span className="text-xs font-mono text-neutral-200 truncate">
                            {stemResult.midiFileName}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-neutral-400 group-hover/card:text-neutral-200 transition-colors shrink-0">
                          <span className="text-[11px] hidden sm:inline">Drag out</span>
                          <GripHorizontal className="w-4 h-4 text-neutral-500" />
                        </div>
                      </div>

                      {/* Download Link */}
                      <div className="flex items-center justify-end">
                        <a
                          href={stemResult.blobUrl}
                          download={stemResult.midiFileName}
                          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          Download .MID
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MULTI-STEM PIANO ROLL VISUALIZER */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                    Transcribed Notes Visualizer
                  </span>
                  {isPlaying && (
                    <span className="text-emerald-400 font-mono text-xs tabular-nums">
                      Playing: {playbackTime.toFixed(1)}s / {conversionResult.durationSeconds}s
                    </span>
                  )}
                </div>

                {/* Filter view by stem */}
                <div className="flex items-center gap-1 p-0.5 bg-neutral-900 rounded-lg border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setPianoRollFilter('all')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      pianoRollFilter === 'all'
                        ? 'bg-neutral-800 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    All Stems
                  </button>
                  {conversionResult.stems.map((s) => (
                    <button
                      key={s.stem}
                      type="button"
                      onClick={() => setPianoRollFilter(s.stem)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                        pianoRollFilter === s.stem
                          ? 'bg-neutral-800 text-white shadow-sm'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: s.definition.color }}
                      />
                      {s.definition.shortName}
                    </button>
                  ))}
                </div>
              </div>

              <PianoRoll
                notes={visibleNotesForPianoRoll}
                totalDuration={conversionResult.durationSeconds}
                currentPlaybackTime={playbackTime}
                activeStems={pianoRollFilter === 'all' ? activeAuditionStems : new Set([pianoRollFilter])}
              />

              {/* Color Legend */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500 px-1">
                <span className="text-neutral-400 font-medium">Stem Colors:</span>
                {conversionResult.stems.map((s) => (
                  <div key={s.stem} className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: s.definition.color }}
                    />
                    <span className="text-neutral-400">{s.definition.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. ERROR STATE */}
        {state === 'error' && (
          <div className="w-full max-w-lg bg-neutral-900/60 border border-red-900/50 rounded-2xl p-8 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-neutral-100 mb-2">
              Extraction Error
            </h3>
            <p className="text-sm text-neutral-400 mb-6">
              {errorMessage || 'An error occurred during audio processing.'}
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-900 px-6 py-4 text-xs text-neutral-500">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <span>Spotify Basic Pitch Polyphonic Transcription & Multi-Stem Filter Bank</span>
          <span>Drag stems into Ableton, Logic Pro, FL Studio or Desktop</span>
        </div>
      </footer>

      {/* Standalone Desktop Guidance Modal */}
      {showStandaloneModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowStandaloneModal(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Laptop className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-100">
                  Run as Standalone Desktop App
                </h3>
                <p className="text-xs text-neutral-400">
                  Native macOS, Windows & Linux app with direct OS drag-to-DAW
                </p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed mb-4">
              The project is pre-configured with <strong>Electron</strong> and <strong>electron-builder</strong>. When run as a standalone desktop app, you get native window management and true OS-level file drag-and-drop straight into Ableton Live, Logic Pro, FL Studio, or Finder/Explorer with zero browser security restrictions.
            </p>

            <div className="space-y-3 mb-6">
              {/* Option 1: Run instantly */}
              <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-neutral-200">
                    1. Launch Standalone Desktop Window:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('npm run electron:dev');
                      setCopiedCommand('dev');
                      setTimeout(() => setCopiedCommand(null), 2000);
                    }}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedCommand === 'dev' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="text-xs font-mono text-emerald-400 block bg-neutral-900/80 px-2.5 py-1.5 rounded border border-neutral-800">
                  npm run electron:dev
                </code>
              </div>

              {/* Option 2: Package Installer */}
              <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-neutral-200">
                    2. Package Native Installer (.dmg / .exe / .AppImage):
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('npm run electron:build');
                      setCopiedCommand('build');
                      setTimeout(() => setCopiedCommand(null), 2000);
                    }}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedCommand === 'build' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="text-xs font-mono text-emerald-400 block bg-neutral-900/80 px-2.5 py-1.5 rounded border border-neutral-800">
                  npm run electron:build
                </code>
                <p className="text-[11px] text-neutral-500 mt-1.5">
                  Creates native installers in the <span className="font-mono text-neutral-400">release/</span> folder.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowStandaloneModal(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
