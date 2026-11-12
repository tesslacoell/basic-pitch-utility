import { useEffect, useRef } from 'react';
import { TranscribedNote } from '../services/basicPitchService';
import { STEM_DEFINITIONS, StemType } from '../services/stemSeparationService';

interface PianoRollProps {
  notes: TranscribedNote[];
  totalDuration: number;
  currentPlaybackTime?: number;
  activeStems?: Set<StemType>;
}

export function PianoRoll({
  notes,
  totalDuration,
  currentPlaybackTime = 0,
  activeStems,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina display scaling
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Filter notes by active stems if provided
    const visibleNotes = activeStems
      ? notes.filter((n) => !n.stem || activeStems.has(n.stem))
      : notes;

    if (visibleNotes.length === 0 || totalDuration <= 0) {
      ctx.fillStyle = '#525252';
      ctx.font = '12px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No notes detected in selected stem(s)', width / 2, height / 2);
      return;
    }

    // Determine MIDI pitch bounds with padding
    let minPitch = 127;
    let maxPitch = 0;
    visibleNotes.forEach((n) => {
      if (n.midi < minPitch) minPitch = n.midi;
      if (n.midi > maxPitch) maxPitch = n.midi;
    });

    minPitch = Math.max(21, minPitch - 2);
    maxPitch = Math.min(108, maxPitch + 2);
    const pitchRange = Math.max(12, maxPitch - minPitch + 1);

    // Draw horizontal pitch guide grid lines
    const rowHeight = height / pitchRange;
    for (let p = minPitch; p <= maxPitch; p++) {
      const y = height - (p - minPitch + 1) * rowHeight;
      const isBlackKey = [1, 3, 6, 8, 10].includes(p % 12);
      ctx.fillStyle = isBlackKey ? '#121212' : '#1a1a1a';
      ctx.fillRect(0, y, width, rowHeight);

      ctx.strokeStyle = '#262626';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (p % 12 === 0) {
        ctx.fillStyle = '#525252';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`C${Math.floor(p / 12) - 1}`, 6, y + rowHeight - 2);
      }
    }

    // Draw vertical time bars
    const duration = Math.max(1, totalDuration);
    const numBeats = Math.ceil(duration);
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 0.5;
    for (let sec = 1; sec < numBeats; sec++) {
      const x = (sec / duration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Render notes with stem-specific colors
    visibleNotes.forEach((note) => {
      const x = (note.startTime / duration) * width;
      const noteW = Math.max(4, (note.duration / duration) * width);
      const y = height - (note.midi - minPitch + 1) * rowHeight;
      const noteH = Math.max(2, rowHeight - 1);

      const isActive =
        currentPlaybackTime >= note.startTime &&
        currentPlaybackTime <= note.startTime + note.duration;

      const stemColor = note.stem ? STEM_DEFINITIONS[note.stem]?.color : '#10b981';

      if (isActive) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = stemColor || '#10b981';
        ctx.shadowBlur = 8;
      } else {
        ctx.fillStyle = stemColor || '#10b981';
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.roundRect(x, y, noteW, noteH, 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = isActive ? '#ffffff' : 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // Playback scrubber cursor
    if (currentPlaybackTime > 0) {
      const scrubX = (currentPlaybackTime / duration) * width;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scrubX, 0);
      ctx.lineTo(scrubX, height);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(scrubX, 4, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [notes, totalDuration, currentPlaybackTime, activeStems]);

  return (
    <div className="w-full h-40 rounded-xl overflow-hidden border border-neutral-800 bg-neutral-950 relative">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
