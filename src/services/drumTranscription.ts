/**
 * Drum transcription: band-split onset detection -> General MIDI drum events.
 *
 * Basic Pitch is a pitched-note model — it cannot transcribe unpitched
 * percussion (drums come out of it as scattered garbage notes). This service
 * takes the classical ADT route instead:
 *
 *   1. STFT at 22.05 kHz; per-frame energy in four diagnostic bands —
 *      kick (40–130 Hz), snare body (160–350 Hz), snare snap (1.2–4.5 kHz),
 *      hats (7 kHz–Nyquist).
 *   2. Per-band spectral flux (positive energy increases), each band
 *      normalised by its own 90th percentile so bands are comparable; the
 *      snare detector sums its body and snap fluxes.
 *   3. Adaptive-threshold peak picking: an onset must clear BOTH a multiple
 *      of its local (±0.5 s) median flux and an absolute floor tied to the
 *      band's loud passages, be a local maximum, and respect a per-drum
 *      minimum retrigger interval. The snare detector is gated on its BODY
 *      band: short bursts splatter a few percent of their energy across the
 *      spectrum, and after per-band normalisation that splatter is loud
 *      enough to fake a snap-band onset — but a hat or kick puts almost
 *      nothing in the snare's body band, while a real snare always does.
 *   4. Onset times are refined to the band-energy peak just after the flux
 *      peak and stamped at the STFT frame centre — a raw flux peak fires up
 *      to ~90 ms early, while the hit is still sliding into the window.
 *   5. Hat hits are split open/closed by how much hat-band energy is still
 *      present ~100 ms later; hat onsets coincident with a snare hit are
 *      suppressed unless they are strong in their own right (a snare's snap
 *      otherwise double-fires as a hat).
 *   6. Toms: onsets in a 70–390 Hz tom band that RING (energy still present
 *      150 ms later — a click or kick tail doesn't). Both other pickers can
 *      claim a tom first, and both claims are appealable: a tom in the kick
 *      band fires the kick picker, but a real kick is anchored below 70 Hz
 *      and a tom is not, so an unanchored "kick" is reclaimed; a tom in the
 *      snare's body band fires the snare picker too, so the snap band acts
 *      as witness: a coincident "snare" with no snap energy is acquitted
 *      and reclassified as the tom. Pitch class
 *      (low/mid/high) comes from the lowest sub-band holding at least 35%
 *      of the strongest sub-band's energy at the hit — approximately the
 *      fundamental. Known ambiguity: a sustained bass-guitar note can look
 *      exactly like a tom to band analysis; that confusion is inherent to
 *      the method and is accepted for this palette.
 *
 * Output is deliberately a small, honest palette — kick 36, snare 38,
 * closed hat 42, open hat 46 on the GM drum channel. On programmed /
 * electronic material this is quite reliable; on dense acoustic mixes it is
 * a starting sketch, not a score. Events keep their true (unquantised)
 * timing — quantising is the user's call in the DAW.
 */

import { bufferToMono, decimate, stftMagnitudes } from './dsp';

export interface DrumEvent {
  /** Seconds from the start of the track. */
  time: number;
  /** General MIDI drum note number. */
  midi: number;
  /** 'Kick' | 'Snare' | 'Closed Hat' | 'Open Hat' | 'Low/Mid/High Tom' */
  name: string;
  /** 0..1 */
  velocity: number;
  /** Seconds. */
  duration: number;
}

export const GM_DRUMS = {
  kick: 36,
  snare: 38,
  closedHat: 42,
  lowTom: 45,
  openHat: 46,
  midTom: 47,
  highTom: 50,
} as const;

const TARGET_SAMPLE_RATE = 22050;
const FRAME_SIZE = 2048;
const HOP_SIZE = 256;

interface BandOnset {
  frame: number;
  peak: number;
  threshold: number;
}

function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/** Median of flux over a ±halfWindow-frame neighbourhood, per frame. */
function localMedians(flux: Float32Array, halfWindow: number): Float32Array {
  const n = flux.length;
  const out = new Float32Array(n);
  const window: number[] = [];
  for (let i = 0; i < n; i++) {
    window.length = 0;
    const from = Math.max(0, i - halfWindow);
    const to = Math.min(n - 1, i + halfWindow);
    for (let k = from; k <= to; k++) window.push(flux[k]);
    window.sort((a, b) => a - b);
    out[i] = window[Math.floor(window.length / 2)];
  }
  return out;
}

function pickOnsets(
  flux: Float32Array,
  frameSeconds: number,
  opts: { factor: number; minIntervalSeconds: number }
): BandOnset[] {
  const n = flux.length;
  // Reference level: the 99.5th percentile, NOT p95. Drum events are sparse
  // (a few dozen hot frames in thousands), so p95 sits down in the splatter
  // and a floor tied to it lets burst sidelobes through as phantom hits.
  const pRef = percentile(flux, 0.995);
  if (pRef <= 0) return [];
  const floor = 0.12 * pRef;
  const medians = localMedians(flux, Math.round(0.5 / frameSeconds));
  const minInterval = Math.max(1, Math.round(opts.minIntervalSeconds / frameSeconds));
  const onsets: BandOnset[] = [];
  let lastFrame = -Infinity;
  for (let i = 2; i < n - 2; i++) {
    const threshold = Math.max(opts.factor * medians[i], floor);
    if (flux[i] < threshold) continue;
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    if (flux[i] < flux[i - 2] || flux[i] < flux[i + 2]) continue;
    if (i - lastFrame < minInterval) continue;
    onsets.push({ frame: i, peak: flux[i], threshold });
    lastFrame = i;
  }
  return onsets;
}

/** Transcribes drums from raw mono PCM. Pure function — Node-testable. */
export function transcribeDrums(samples: Float32Array, sampleRate: number): DrumEvent[] {
  if (samples.length < sampleRate) return []; // need at least a second

  const factor = Math.max(1, Math.round(sampleRate / TARGET_SAMPLE_RATE));
  const pcm = decimate(samples, factor);
  const sr = sampleRate / factor;
  const binHz = sr / FRAME_SIZE;
  const frameSeconds = HOP_SIZE / sr;

  const bin = (hz: number) => Math.max(0, Math.min(FRAME_SIZE / 2 - 1, Math.round(hz / binHz)));
  const bands = {
    kick: [bin(40), bin(130)],
    subKick: [bin(35), bin(70)],
    snareBody: [bin(160), bin(350)],
    snareSnap: [bin(1200), bin(4500)],
    hat: [bin(7000), bin(16000)],
  } as const;
  type BandName = keyof typeof bands;

  // Tom sub-bands across 70–390 Hz: fine enough to estimate a tom's
  // fundamental (the lowest sub-band carrying real energy), coarse enough
  // to track cheaply alongside the main bands.
  const TOM_SUB_BANDS = [
    { lo: 70, hi: 95, centre: 82 },
    { lo: 95, hi: 120, centre: 107 },
    { lo: 120, hi: 150, centre: 135 },
    { lo: 150, hi: 185, centre: 167 },
    { lo: 185, hi: 225, centre: 205 },
    { lo: 225, hi: 270, centre: 247 },
    { lo: 270, hi: 325, centre: 297 },
    { lo: 325, hi: 390, centre: 357 },
  ];

  // Per-frame band energies, gathered straight from the STFT callback so the
  // full spectrogram never has to be held in memory.
  const energies: Record<BandName, number[]> = { kick: [], subKick: [], snareBody: [], snareSnap: [], hat: [] };
  const subBandEnergies: number[][] = TOM_SUB_BANDS.map(() => []);
  stftMagnitudes(pcm, FRAME_SIZE, HOP_SIZE, (mags) => {
    (Object.keys(bands) as BandName[]).forEach((name) => {
      const [lo, hi] = bands[name];
      let sum = 0;
      for (let b = lo; b <= hi; b++) sum += mags[b];
      energies[name].push(sum);
    });
    TOM_SUB_BANDS.forEach((sub, sIdx) => {
      let sum = 0;
      for (let b = bin(sub.lo); b <= bin(sub.hi); b++) sum += mags[b];
      subBandEnergies[sIdx].push(sum);
    });
  });

  const frameCount = energies.kick.length;
  if (frameCount < 16) return [];

  const fluxOf = (series: number[]): Float32Array => {
    const out = new Float32Array(series.length);
    for (let i = 1; i < series.length; i++) out[i] = Math.max(0, series[i] - series[i - 1]);
    return out;
  };
  const normalise = (flux: Float32Array): Float32Array => {
    const p90 = percentile(flux, 0.9);
    if (p90 <= 0) return flux;
    const out = new Float32Array(flux.length);
    for (let i = 0; i < flux.length; i++) out[i] = flux[i] / p90;
    return out;
  };

  const kickFlux = normalise(fluxOf(energies.kick));
  const hatFlux = normalise(fluxOf(energies.hat));
  const bodyFlux = normalise(fluxOf(energies.snareBody));
  const snapFlux = normalise(fluxOf(energies.snareSnap));

  const velocityOf = (flux: Float32Array, onset: BandOnset): number => {
    const pRef = percentile(flux, 0.995);
    if (pRef <= 0) return 0.7;
    return Math.min(1, Math.max(0.3, 0.3 + 0.7 * (onset.peak / pRef)));
  };

  // Refine a flux-peak frame to the band-energy peak within the next few
  // frames, then stamp the event at that frame's centre. Without this,
  // events land up to ~90 ms early (the flux peaks while the hit is still
  // entering the analysis window).
  const refineFrame = (energy: number[], fluxFrame: number): number => {
    let best = fluxFrame;
    for (let f = fluxFrame; f <= Math.min(frameCount - 1, fluxFrame + 5); f++) {
      if (energy[f] > energy[best]) best = f;
    }
    return best;
  };
  const frameTime = (frame: number): number => (frame * HOP_SIZE + FRAME_SIZE / 2) / sr;
  const refinedTime = (energy: number[], fluxFrame: number): number =>
    frameTime(refineFrame(energy, fluxFrame));

  // Events carry their flux-onset frame internally: the tom pass needs it
  // for coincidence tests. It is stripped before returning.
  type FramedEvent = DrumEvent & { frame: number };
  const events: FramedEvent[] = [];

  for (const onset of pickOnsets(kickFlux, frameSeconds, { factor: 2.4, minIntervalSeconds: 0.07 })) {
    events.push({
      time: refinedTime(energies.kick, onset.frame),
      midi: GM_DRUMS.kick,
      name: 'Kick',
      velocity: velocityOf(kickFlux, onset),
      duration: 0.12,
      frame: onset.frame,
    });
  }

  // Snare picking is gated on the BODY band (see header note 3); the snap
  // band still contributes to the velocity so a crack-heavy snare reads hot.
  const snareOnsets = pickOnsets(bodyFlux, frameSeconds, { factor: 2.2, minIntervalSeconds: 0.07 });
  for (const onset of snareOnsets) {
    const combinedPeak = 0.55 * onset.peak + 0.45 * (snapFlux[onset.frame] ?? 0);
    events.push({
      time: refinedTime(energies.snareBody, onset.frame),
      midi: GM_DRUMS.snare,
      name: 'Snare',
      velocity: Math.min(1, Math.max(0.3, velocityOf(bodyFlux, { ...onset, peak: combinedPeak }))),
      duration: 0.12,
      frame: onset.frame,
    });
  }

  const hatEnergy = energies.hat;
  const decayFrames = Math.round(0.12 / frameSeconds);
  for (const onset of pickOnsets(hatFlux, frameSeconds, { factor: 2.0, minIntervalSeconds: 0.045 })) {
    // Snare cross-talk: a snare's snap fires the hat band. Suppress a hat
    // within one frame of a snare onset unless it is strong in its own right.
    const nearSnare = snareOnsets.some((s) => Math.abs(s.frame - onset.frame) <= 1);
    if (nearSnare && onset.peak < 2.5 * onset.threshold) continue;

    // Open vs closed: measure from the energy PEAK frame (not the earlier
    // flux frame) ~120 ms forward. A closed hat is long gone by then
    // (energy ratio ~0.01); a ringing open hat still holds > 0.12.
    const peakFrame = refineFrame(hatEnergy, onset.frame);
    const atPeak = hatEnergy[peakFrame] || 0;
    const later = hatEnergy[Math.min(frameCount - 1, peakFrame + decayFrames)] || 0;
    const isOpen = atPeak > 0 && later > 0.12 * atPeak;
    events.push({
      time: frameTime(peakFrame),
      midi: isOpen ? GM_DRUMS.openHat : GM_DRUMS.closedHat,
      name: isOpen ? 'Open Hat' : 'Closed Hat',
      velocity: velocityOf(hatFlux, onset),
      duration: isOpen ? 0.4 : 0.05,
      frame: onset.frame,
    });
  }

  // --- Toms (see header note 6) ---
  const tomEnergy: number[] = new Array(frameCount).fill(0);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    for (const series of subBandEnergies) sum += series[f];
    tomEnergy[f] = sum;
  }
  const tomRawFlux = fluxOf(tomEnergy);
  const tomFlux = normalise(tomRawFlux);
  const snapRawFlux = fluxOf(energies.snareSnap);
  const ringFrames = Math.round(0.15 / frameSeconds);
  for (const onset of pickOnsets(tomFlux, frameSeconds, { factor: 2.2, minIntervalSeconds: 0.09 })) {
    const f = onset.frame;
    const peakFrame = refineFrame(tomEnergy, f);
    // Ring gate: a tom sustains; a click, hat splatter or kick tail doesn't.
    const atPeak = tomEnergy[peakFrame] || 0;
    const later = tomEnergy[Math.min(frameCount - 1, peakFrame + ringFrames)] || 0;
    if (!(atPeak > 0 && later > 0.12 * atPeak)) continue;

    // A kick claims its own instants — but a tom whose fundamental sits in
    // the kick band (a low tom at ~98 Hz, or any tom's low splatter) fires
    // the kick picker too. The anchor test decides: a real kick is anchored
    // below 70 Hz (its fundamental lives there); a tom's energy is not, so
    // a coincident "kick" with a quiet sub-70 band was the tom in disguise
    // and is reclaimed.
    const kickIdx = events.findIndex(
      (e) => e.midi === GM_DRUMS.kick && Math.abs(e.frame - f) <= 1
    );
    if (kickIdx >= 0) {
      const kickPeak = refineFrame(energies.kick, events[kickIdx].frame);
      const subLow = energies.subKick[kickPeak] || 0;
      const kickBand = energies.kick[kickPeak] || 0;
      // A real kick's fundamental sits inside the sub band, so sub/kick
      // measures ~0.8–1.0. A tom's sub content is only attack splatter,
      // ~0.5 or less even for a low tom. The line sits between the clusters.
      if (subLow >= 0.65 * Math.max(1, kickBand)) continue; // real kick — veto stands
      events.splice(kickIdx, 1); // tom in disguise — reclaim the instant
    }

    // Fundamental estimate: lowest sub-band holding >= 35% of the strongest.
    let maxSub = 0;
    for (const series of subBandEnergies) maxSub = Math.max(maxSub, series[peakFrame] || 0);
    if (maxSub <= 0) continue;
    let estHz = 0;
    for (let sIdx = 0; sIdx < TOM_SUB_BANDS.length; sIdx++) {
      if ((subBandEnergies[sIdx][peakFrame] || 0) >= 0.35 * maxSub) {
        estHz = TOM_SUB_BANDS[sIdx].centre;
        break;
      }
    }
    if (estHz === 0) continue;
    const midi =
      estHz < 115 ? GM_DRUMS.lowTom : estHz < 160 ? GM_DRUMS.midTom : GM_DRUMS.highTom;
    const name = estHz < 115 ? 'Low Tom' : estHz < 160 ? 'Mid Tom' : 'High Tom';

    // Snare acquittal: a coincident body-band "snare" was this tom wearing
    // the snare's clothes — unless the snap band testifies for the snare.
    // The testimony is a RATIO, snap flux vs the hit's own tom-band flux:
    // a real snare's crack is a substantial fraction of its body (~0.5–1×),
    // while a tom's attack splatter in the snap band is a few percent.
    // (An absolute snap threshold fails here: after per-band normalisation,
    // attack splatter inflates to the same range as real snap values.)
    const coincident = events.findIndex(
      (e) => e.midi === GM_DRUMS.snare && Math.abs(e.frame - f) <= 2
    );
    if (coincident >= 0) {
      const snapRatio = (snapRawFlux[f] ?? 0) / Math.max(1, tomRawFlux[f] ?? 0);
      if (snapRatio >= 0.25) continue; // the snap testifies: real snare
      events.splice(coincident, 1);
    }

    events.push({
      time: frameTime(peakFrame),
      midi,
      name,
      velocity: velocityOf(tomFlux, onset),
      duration: 0.25,
      frame: f,
    });
  }

  events.sort((a, b) => a.time - b.time || a.midi - b.midi);
  return events.map(({ frame: _frame, ...ev }) => ev);
}

/** Convenience wrapper for the app: transcribe drums from a decoded AudioBuffer. */
export function transcribeDrumsFromBuffer(buffer: AudioBuffer): DrumEvent[] {
  return transcribeDrums(bufferToMono(buffer), buffer.sampleRate);
}
