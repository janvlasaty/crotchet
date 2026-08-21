/**
 * Guitar chord voicings.
 * Small open-position dictionary + movable (barre) shapes for everything else,
 * so any parseable chord gets a diagram without shipping a big database.
 */

import { noteToIndex, parseChordRoot } from './transpose';

/** frets[0] = low E (6th string) … frets[5] = high E (1st string). null = muted. */
export interface ChordShape {
  frets: (number | null)[];
  /** Fret barred across the shape, if any (absolute fret number). */
  barre?: number;
  /** Chord name this voicing was resolved for (after slash-bass stripping). */
  name: string;
}

type Quality =
  | 'maj' | 'min' | '7' | 'm7' | 'maj7' | 'sus2' | 'sus4'
  | '6' | 'm6' | '9' | 'add9' | 'dim' | 'aug' | '5';

/** Normalize a chord suffix to a quality we have a shape for. */
function normalizeQuality(rest: string): Quality {
  const s = rest.replace(/\s+/g, '');

  if (/^(5)$/.test(s)) return '5';
  if (/^(dim|°|o)/.test(s)) return 'dim';
  if (/^(aug|\+)/.test(s)) return 'aug';
  if (/^sus2/.test(s)) return 'sus2';
  if (/^(sus4?|4)$/.test(s) || /^sus4/.test(s)) return 'sus4';
  if (/^add9/.test(s)) return 'add9';

  const minor = /^(m(?!aj)|min|-)/.test(s);
  const afterMinor = minor ? s.replace(/^(m(?!aj)|min|-)/, '') : s;

  if (/^(maj7|maj9|M7|Δ)/.test(afterMinor)) return minor ? 'm7' : 'maj7';
  if (/^(7|11|13)/.test(afterMinor)) return minor ? 'm7' : '7';
  if (/^9/.test(afterMinor)) return minor ? 'm7' : '9';
  if (/^6/.test(afterMinor)) return minor ? 'm6' : '6';

  return minor ? 'min' : 'maj';
}

/** Open-position voicings that beat the generic barre shapes. */
const OPEN: Record<string, (number | null)[]> = {
  C: [null, 3, 2, 0, 1, 0],
  C7: [null, 3, 2, 3, 1, 0],
  Cmaj7: [null, 3, 2, 0, 0, 0],
  Cadd9: [null, 3, 2, 0, 3, 0],
  C6: [null, 3, 2, 2, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  G7: [3, 2, 0, 0, 0, 1],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  Gsus4: [3, 3, 0, 0, 1, 3],
  G6: [3, 2, 0, 0, 0, 0],
  D: [null, null, 0, 2, 3, 2],
  Dm: [null, null, 0, 2, 3, 1],
  D7: [null, null, 0, 2, 1, 2],
  Dm7: [null, null, 0, 2, 1, 1],
  Dmaj7: [null, null, 0, 2, 2, 2],
  Dsus2: [null, null, 0, 2, 3, 0],
  Dsus4: [null, null, 0, 2, 3, 3],
  A: [null, 0, 2, 2, 2, 0],
  Am: [null, 0, 2, 2, 1, 0],
  A7: [null, 0, 2, 0, 2, 0],
  Am7: [null, 0, 2, 0, 1, 0],
  Amaj7: [null, 0, 2, 1, 2, 0],
  Asus2: [null, 0, 2, 2, 0, 0],
  Asus4: [null, 0, 2, 2, 3, 0],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  E7: [0, 2, 0, 1, 0, 0],
  Em7: [0, 2, 0, 0, 0, 0],
  Emaj7: [0, 2, 1, 1, 0, 0],
  Esus4: [0, 2, 2, 2, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Fmaj7: [null, null, 3, 2, 1, 0],
  Bm: [null, 2, 4, 4, 3, 2],
  B7: [null, 2, 1, 2, 0, 2],
  Bb: [null, 1, 3, 3, 3, 1],
};

/** Movable shapes as fret offsets from the root, anchored on one string. */
interface Template {
  /** Which string index (0 = low E) carries the root. */
  anchor: 0 | 1 | 2;
  /** Offsets from the root fret; null = muted. */
  offsets: (number | null)[];
  /** True if the shape is played as a full barre at the root fret. */
  barre?: boolean;
}

const OPEN_STRING_NOTES = [4, 9, 2, 7, 11, 4]; // E A D G B E

const TEMPLATES: Record<Quality, Template[]> = {
  maj: [
    { anchor: 0, offsets: [0, 2, 2, 1, 0, 0], barre: true },
    { anchor: 1, offsets: [null, 0, 2, 2, 2, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 3, 2] },
  ],
  min: [
    { anchor: 0, offsets: [0, 2, 2, 0, 0, 0], barre: true },
    { anchor: 1, offsets: [null, 0, 2, 2, 1, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 3, 1] },
  ],
  '7': [
    { anchor: 0, offsets: [0, 2, 0, 1, 0, 0], barre: true },
    { anchor: 1, offsets: [null, 0, 2, 0, 2, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 1, 2] },
  ],
  m7: [
    { anchor: 0, offsets: [0, 2, 0, 0, 0, 0], barre: true },
    { anchor: 1, offsets: [null, 0, 2, 0, 1, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 1, 1] },
  ],
  maj7: [
    { anchor: 0, offsets: [0, 2, 1, 1, 0, null], barre: true },
    { anchor: 1, offsets: [null, 0, 2, 1, 2, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 2, 2] },
  ],
  sus2: [
    { anchor: 1, offsets: [null, 0, 2, 2, 0, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 3, 0] },
  ],
  sus4: [
    { anchor: 0, offsets: [0, 2, 2, 2, 0, 0], barre: true },
    { anchor: 1, offsets: [null, 0, 2, 2, 3, 0], barre: true },
    { anchor: 2, offsets: [null, null, 0, 2, 3, 3] },
  ],
  '6': [
    { anchor: 1, offsets: [null, 0, 2, 2, 2, 2], barre: true },
    { anchor: 0, offsets: [0, 2, 2, 1, 2, 0], barre: true },
  ],
  m6: [
    { anchor: 1, offsets: [null, 0, 2, 2, 1, 2], barre: true },
    { anchor: 0, offsets: [0, 2, 2, 0, 2, 0], barre: true },
  ],
  '9': [
    { anchor: 1, offsets: [null, 0, 2, 0, 2, 3], barre: true },
    { anchor: 0, offsets: [0, 2, 0, 1, 0, 2], barre: true },
  ],
  add9: [
    { anchor: 1, offsets: [null, 0, 2, 4, 2, 0], barre: true },
    { anchor: 0, offsets: [0, 2, 2, 1, 0, 2], barre: true },
  ],
  dim: [
    { anchor: 1, offsets: [null, 0, 1, 2, 1, null] },
    { anchor: 2, offsets: [null, null, 0, 1, 3, 1] },
  ],
  aug: [
    { anchor: 1, offsets: [null, 0, 3, 2, 2, 1] },
    { anchor: 0, offsets: [0, 3, 2, 1, 1, 0] },
  ],
  '5': [
    { anchor: 0, offsets: [0, 2, 2, null, null, null] },
    { anchor: 1, offsets: [null, 0, 2, 2, null, null] },
  ],
};

function rootFretOn(anchor: 0 | 1 | 2, rootIdx: number): number {
  return ((rootIdx - OPEN_STRING_NOTES[anchor]) % 12 + 12) % 12;
}

function buildFromTemplate(t: Template, rootIdx: number): ChordShape | null {
  const base = rootFretOn(t.anchor, rootIdx);
  // Prefer a playable position: shapes with a barre can also sit an octave up,
  // but fret 0 with a barre template is just the open shape.
  const frets = t.offsets.map(o => (o === null ? null : o + base));
  if (frets.some(f => f !== null && f > 15)) return null;
  return {
    frets,
    barre: t.barre && base > 0 ? base : undefined,
    name: '',
  };
}

function shapeCost(shape: ChordShape): number {
  const played = shape.frets.filter((f): f is number => f !== null && f > 0);
  const max = played.length ? Math.max(...played) : 0;
  const muted = shape.frets.filter(f => f === null).length;
  return max * 2 + muted;
}

/** Resolve a chord name (e.g. "F#m7", "C/G") to a guitar voicing. */
export function getChordShape(chord: string): ChordShape | null {
  if (!chord) return null;

  const slashIdx = chord.indexOf('/');
  let name = slashIdx > 0 ? chord.slice(0, slashIdx) : chord;
  // Czech notation: H is B natural.
  if (name[0] === 'H') name = 'B' + name.slice(1);

  const parsed = parseChordRoot(name);
  if (!parsed) return null;

  const openKey = parsed.root + parsed.rest;
  if (OPEN[openKey]) return { frets: OPEN[openKey], name: openKey };

  const rootIdx = noteToIndex(parsed.root);
  if (rootIdx === -1) return null;

  const quality = normalizeQuality(parsed.rest);

  // A flat/sharp spelling may have an open voicing under the other name.
  const templates = TEMPLATES[quality];
  const candidates = templates
    .map(t => buildFromTemplate(t, rootIdx))
    .filter((s): s is ChordShape => s !== null);

  if (!candidates.length) return null;
  candidates.sort((a, b) => shapeCost(a) - shapeCost(b));
  return { ...candidates[0], name };
}
