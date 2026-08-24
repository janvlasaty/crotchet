/**
 * Web Audio: metronome click, reference tone/arpeggio, tuner.
 */
import { noteToIndex, noteFrequency, parseChordRoot } from './transpose';

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Play a metronome click */
export function playClick(time?: number): void {
  const ctx = getAudioCtx();
  const t = time ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 1000;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.start(t);
  osc.stop(t + 0.05);
}

/**
 * Semitones above the root that a chord suffix asks for, low to high.
 *
 * Enough of chord naming for the reference tone to sound like what is written:
 * the third the quality wants, or the suspension standing in for it; the fifth
 * where the quality moves it; and the sixth or seventh that makes a seventh
 * chord four notes instead of three. Anything past that (the 9ths of a 9/11/13,
 * altered colours) is left off — this is a pitch reference, not a voicing.
 */
function chordIntervals(rest: string): number[] {
  // A slash bass names the bottom note, not the chord's own colour
  const quality = rest.split('/')[0].replace(/[()\s]/g, '');
  const q = quality.toLowerCase();

  // Case matters: `m` is minor, `maj` is not
  const minor = /^(m|min)(?!aj)/.test(quality);
  const halfDim = q.startsWith('ø') || /^m(in)?7?[b-]5/.test(q);
  const dim = q.startsWith('dim') || q.startsWith('°') || q.startsWith('o') || halfDim;
  const aug = q.startsWith('aug') || q.startsWith('+');

  // The suspension replaces the third — that is what "suspended" means
  const third = /sus2/.test(q) ? 2
    : /sus(4|$)/.test(q) ? 5
    : q === '5' ? null                       // power chord: root and fifth alone
    : minor || dim ? 3
    : 4;

  const fifth = dim || /[b-]5/.test(q) ? 6
    : aug || /[#+]5/.test(q) ? 8
    : 7;

  // The fourth note, when the name carries one
  const seventh = /^(dim|°)7|^o7/.test(q) ? 9   // fully diminished: the 6th
    : halfDim ? 10
    // maj7, Δ7 and the capital-M shorthand all mean the major seventh
    : /^(maj|ma|Δ)(7|9|11|13)/.test(q) || /(maj|Δ|M)7/.test(quality) ? 11
    : /add9/.test(q) ? 14
    : /6/.test(q) ? 9
    : /7|9|11|13/.test(q) ? 10
    : null;

  return [0, third, fifth, seventh].filter((n): n is number => n !== null);
}

/**
 * A chord as a rising arpeggio.
 *
 * The intervals are counted from the root's own pitch instead of being folded
 * back into its octave with `% 12`. Folding put every note that crosses B→C
 * *below* the root — A major sounded A3 C#3 E3, D major D3 F#3 A3 but B minor
 * B3 D3 F#3 — so the reference tone ran downwards for a third of the keys. The
 * sort then guarantees the rise whatever intervals the suffix asks for.
 */
function chordToFrequencies(chord: string): number[] {
  const parsed = parseChordRoot(chord);
  if (!parsed) return [440]; // fallback A4

  const rootIdx = noteToIndex(parsed.root);
  if (rootIdx === -1) return [440];

  return chordIntervals(parsed.rest)
    .map(semitones => noteFrequency(rootIdx + semitones, 3))
    .sort((a, b) => a - b);
}

/** Play a reference tone (arpeggio of the first chord) */
export function playReferenceTone(chord: string): void {
  const ctx = getAudioCtx();
  const freqs = chordToFrequencies(chord);
  const now = ctx.currentTime;

  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'triangle';
    const start = now + i * 0.15;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    osc.start(start);
    osc.stop(start + 0.5);
  });
}

/** Metronome class that ticks at a given BPM using Web Audio scheduling */
export class Metronome {
  private timerId: number | null = null;
  private _bpm: number = 120;
  private _running = false;
  private nextNoteTime = 0;
  private readonly scheduleAheadTime = 0.1; // seconds
  private readonly lookAhead = 25; // ms

  get bpm() { return this._bpm; }
  set bpm(v: number) {
    this._bpm = v;
    if (this._running) {
      this.stop();
      this.start();
    }
  }

  get running() { return this._running; }

  start() {
    if (this._running) return;
    this._running = true;
    const ctx = getAudioCtx();
    this.nextNoteTime = ctx.currentTime;
    this.scheduler();
  }

  private scheduler() {
    const ctx = getAudioCtx();
    while (this.nextNoteTime < ctx.currentTime + this.scheduleAheadTime) {
      playClick(this.nextNoteTime);
      this.nextNoteTime += 60.0 / this._bpm;
    }
    this.timerId = window.setTimeout(() => this.scheduler(), this.lookAhead);
  }

  stop() {
    this._running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  toggle() {
    if (this._running) this.stop();
    else this.start();
  }
}

/**
 * Simple pitch detector using autocorrelation.
 * Returns detected frequency or null.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  const rms = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / SIZE);
  if (rms < 0.01) return null; // too quiet

  const correlations = new Float32Array(MAX_SAMPLES);
  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += buffer[i] * buffer[i + offset];
    }
    correlations[offset] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset === -1 || bestCorrelation < 0.01) return null;

  // Find the first peak after the initial decline
  let foundPeak = false;
  for (let i = 1; i < MAX_SAMPLES; i++) {
    if (correlations[i] > correlations[i - 1]) {
      foundPeak = true;
    }
    if (foundPeak && correlations[i] < correlations[i - 1]) {
      bestOffset = i - 1;
      break;
    }
  }

  return sampleRate / bestOffset;
}

/** Convert frequency to nearest note name and cents offset */
export function frequencyToNote(freq: number): { note: string; cents: number; octave: number } {
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const semitones = 12 * Math.log2(freq / 440) + 69;
  const rounded = Math.round(semitones);
  const cents = Math.round((semitones - rounded) * 100);
  const note = NOTES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { note, cents, octave };
}
