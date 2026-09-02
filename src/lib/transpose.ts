/**
 * Chord transposition.
 * Works on parsed chords, never on raw text with regex.
 * Enharmonic spelling chosen based on target key.
 */

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Keys that conventionally use flats
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb',
  'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

function noteToIndex(note: string): number {
  // Handle sharps
  const si = NOTES_SHARP.indexOf(note);
  if (si >= 0) return si;
  // Handle flats
  const fi = NOTES_FLAT.indexOf(note);
  if (fi >= 0) return fi;
  return -1;
}

function parseChordRoot(chord: string): { root: string; rest: string } | null {
  if (!chord || chord.length === 0) return null;

  let root = chord[0].toUpperCase();
  let rest = chord.slice(1);

  if (rest.startsWith('#') || rest.startsWith('b')) {
    root += rest[0];
    rest = rest.slice(1);
  }

  if (noteToIndex(root) === -1) return null;
  return { root, rest };
}

function shouldUseFlats(targetKey: string): boolean {
  return FLAT_KEYS.has(targetKey);
}

export function transposeChord(chord: string, semitones: number, targetKey?: string): string {
  if (semitones === 0) return chord;

  // Handle slash chords like C/G
  const slashIdx = chord.indexOf('/');
  if (slashIdx > 0) {
    const main = transposeChord(chord.slice(0, slashIdx), semitones, targetKey);
    const bass = transposeChord(chord.slice(slashIdx + 1), semitones, targetKey);
    return `${main}/${bass}`;
  }

  const parsed = parseChordRoot(chord);
  if (!parsed) return chord; // Can't parse, return as-is

  const idx = noteToIndex(parsed.root);
  if (idx === -1) return chord;

  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  const useFlats = targetKey ? shouldUseFlats(targetKey) : FLAT_KEYS.has(chord);
  const notes = useFlats ? NOTES_FLAT : NOTES_SHARP;

  return notes[newIdx] + parsed.rest;
}

/** Transpose a key name itself */
export function transposeKey(key: string, semitones: number): string {
  if (!key) return key;
  const isMinor = key.endsWith('m') && !key.endsWith('#m') && !key.endsWith('bm')
    ? true
    : key.endsWith('m');

  const root = isMinor ? key.slice(0, -1) : key;
  const idx = noteToIndex(root);
  if (idx === -1) return key;

  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  // Determine flats based on resulting key
  const newRoot = NOTES_SHARP[newIdx];
  const resultKey = newRoot + (isMinor ? 'm' : '');
  const useFlats = shouldUseFlats(resultKey);
  const notes = useFlats ? NOTES_FLAT : NOTES_SHARP;

  return notes[newIdx] + (isMinor ? 'm' : '');
}

/**
 * Calculate capo position to play target key using desired chord shapes.
 * E.g., song in Eb, play shapes in C → capo 3
 */
export function calculateCapo(songKey: string, desiredShapeKey: string): number | null {
  const songIdx = noteToIndex(songKey.replace('m', ''));
  const shapeIdx = noteToIndex(desiredShapeKey.replace('m', ''));
  if (songIdx === -1 || shapeIdx === -1) return null;
  return ((songIdx - shapeIdx) % 12 + 12) % 12;
}

/** Get the chord shapes key for a given song key and capo position */
export function getShapeKey(songKey: string, capo: number): string {
  const isMinor = songKey.endsWith('m');
  const root = isMinor ? songKey.slice(0, -1) : songKey;
  const idx = noteToIndex(root);
  if (idx === -1) return songKey;

  const newIdx = ((idx - capo) % 12 + 12) % 12;
  const notes = NOTES_SHARP;
  return notes[newIdx] + (isMinor ? 'm' : '');
}

/**
 * Key implied by a chord: its root, minor only for plain m/min qualities.
 * Used wherever a song has no `{key}` and its first chord has to stand in.
 */
export function keyFromChord(chord: string | undefined): string {
  if (!chord) return '';
  const match = /^([A-H][#b]?)(.*)$/.exec(chord.split('/')[0]);
  if (!match) return '';
  const [, rawRoot, rest] = match;
  // Czech H is B, as elsewhere in the app — keeps transposeKey able to parse it
  const root = rawRoot[0] === 'H' ? `B${rawRoot.slice(1)}` : rawRoot;
  const minor = /^(m|min)(?!aj)/.test(rest);
  return minor ? `${root}m` : root;
}

/** Generate reference frequencies for notes (A4 = 440 Hz) */
export function noteFrequency(noteIndex: number, octave: number = 4): number {
  // A4 = 440 Hz, A is index 9
  const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9);
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

export { NOTES_SHARP, NOTES_FLAT, noteToIndex, parseChordRoot };
