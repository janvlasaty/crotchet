/**
 * "Which songs get played together" — the two co-occurrence signals behind the
 * recommendations, kept apart from the content signals in `recommend.ts`.
 *
 * Two sources, two different signals:
 *
 *   cooc   unordered. A songbook says "these belong in one set", nothing about
 *          what follows what. Plentiful, weak.
 *   trans  ordered, and directional. A setlist is a running order, so a pair
 *          three songs apart carries less than an adjacent one, and a → b is
 *          not b → a. Scarce, strong.
 *
 * Both are read from two places and summed: a build-time file (many people's
 * playlists, see `scripts/build-neighbors.mjs`) and the user's own setlists,
 * computed here on the fly. There are only ever a handful of the latter, but
 * they are *his* setlists, so for him they are the better signal.
 *
 * Each source normalises itself to 0–1 before the two are summed, so what the
 * scorer's weights mean does not depend on how much data has accumulated. That
 * is done here rather than in `recommend`, which would only have the candidates
 * for one song to judge by and would hand full marks to the best of a bad lot.
 */
import type { Setlist } from '../types';
import { getDB } from './db';

export interface Neighbor {
  /** Unordered co-occurrence, cosine with shrinkage. */
  cooc: number;
  /** Directional transition weight, current song → this one. */
  trans: number;
}

/** Sparse adjacency: song id → its neighbours. Absent id means no data. */
export interface CoocData {
  neighbors: Map<string, Map<string, Neighbor>>;
}

/**
 * Shrinkage, so a pair seen once in one setlist does not land on a perfect
 * score next to a pair seen in thirty. Small here because the local source is
 * a handful of hand-made setlists; the build-time file uses a larger one.
 */
const LAMBDA = 1;

/** How far ahead in a running order still counts as "played after". */
const WINDOW = 3;

/**
 * A source's say, by how tightly curated it is. A pair out of a 12-song wedding
 * setlist means far more than a pair out of a 200-song "everything I know"
 * songbook, and without this the big ones drown out the small ones entirely.
 */
function sourceWeight(size: number): number {
  return size > 1 ? 1 / Math.log2(size + 1) : 0;
}

const emptyData = (): CoocData => ({ neighbors: new Map() });

function bump(
  data: CoocData,
  from: string,
  to: string,
  field: keyof Neighbor,
  amount: number
): void {
  let row = data.neighbors.get(from);
  if (!row) data.neighbors.set(from, (row = new Map()));
  const entry = row.get(to);
  if (entry) entry[field] += amount;
  else row.set(to, { cooc: 0, trans: 0, [field]: amount } as Neighbor);
}

/**
 * Co-occurrence and transitions over the user's own setlists.
 *
 * Cheap enough to redo whenever the setlists change — this is tens of lists of
 * tens of songs, not a catalog-wide job.
 */
export function buildLocalCooc(setlists: Setlist[]): CoocData {
  const data = emptyData();
  /** Weighted number of setlists each song appears in — the cosine's divisor. */
  const count = new Map<string, number>();

  for (const setlist of setlists) {
    // A song listed twice in one setlist would otherwise inflate its own pairs
    const songs = [...new Set(setlist.songIds)];
    const w = sourceWeight(songs.length);
    if (w === 0) continue;

    for (const id of songs) count.set(id, (count.get(id) ?? 0) + w);

    // Unordered: every pair, both directions, so either song can ask
    for (let i = 0; i < songs.length; i++) {
      for (let j = i + 1; j < songs.length; j++) {
        bump(data, songs[i], songs[j], 'cooc', w);
        bump(data, songs[j], songs[i], 'cooc', w);
      }
    }

    // Ordered: forwards only, decaying with the gap
    for (let i = 0; i < songs.length; i++) {
      for (let d = 1; d <= WINDOW && i + d < songs.length; d++) {
        bump(data, songs[i], songs[i + d], 'trans', w / d);
      }
    }
  }

  // Raw sums put the song that is in every setlist first for all of them, so
  // divide the popularity back out: cosine for the unordered signal, the source
  // song's own weight for the directional one.
  let topCooc = 0;
  let topTrans = 0;
  for (const [id, row] of data.neighbors) {
    const self = count.get(id) ?? 0;
    for (const [other, entry] of row) {
      entry.cooc /= Math.sqrt(self * (count.get(other) ?? 0)) + LAMBDA;
      entry.trans /= self + LAMBDA;
      if (entry.cooc > topCooc) topCooc = entry.cooc;
      if (entry.trans > topTrans) topTrans = entry.trans;
    }
  }

  // Onto 0–1 against this source's own strongest pair. Unlike the precomputed
  // corpus, which is scaled against a percentile, a handful of hand-made
  // setlists has no distribution to speak of — but they are the user's explicit
  // statement that these songs go together, so the best of them earning full
  // marks is right rather than merely convenient.
  normalize(data, topCooc, topTrans);

  return data;
}

/** Divide every entry through, clamped, skipping a scale of zero. */
function normalize(data: CoocData, coocScale: number, transScale: number): void {
  for (const row of data.neighbors.values()) {
    for (const entry of row.values()) {
      if (coocScale > 0) entry.cooc = Math.min(1, entry.cooc / coocScale);
      if (transScale > 0) entry.trans = Math.min(1, entry.trans / transScale);
    }
  }
}

/** Sum two sources into one adjacency. Neither input is mutated. */
export function mergeCooc(...sources: Array<CoocData | null | undefined>): CoocData {
  const merged = emptyData();
  for (const source of sources) {
    if (!source) continue;
    for (const [id, row] of source.neighbors) {
      for (const [other, entry] of row) {
        bump(merged, id, other, 'cooc', entry.cooc);
        bump(merged, id, other, 'trans', entry.trans);
      }
    }
  }
  return merged;
}

// ------------------------------------------------------- precomputed block

/**
 * Written by scripts/build-neighbors.mjs, and reaching the app either inside a
 * song pack or as a `neighbors.json` deployed beside it.
 */
export interface NeighborFile {
  generatedAt?: string;
  k?: number;
  /** What counted as a strong pair in the corpus this was built from. */
  coocScale?: number;
  transScale?: number;
  neighbors: Record<string, Array<{ id: string; cooc?: number; trans?: number }>>;
}

const CACHE_KEY = 'neighbors';

/** Turn a neighbours block into an adjacency, skipping anything malformed. */
export function parseNeighbors(file: NeighborFile): CoocData {
  const data = emptyData();
  for (const [id, list] of Object.entries(file.neighbors ?? {})) {
    if (!Array.isArray(list)) continue;
    const row = new Map<string, Neighbor>();
    for (const entry of list) {
      if (!entry || typeof entry.id !== 'string') continue;
      row.set(entry.id, {
        cooc: Number(entry.cooc) || 0,
        trans: Number(entry.trans) || 0,
      });
    }
    if (row.size) data.neighbors.set(id, row);
  }
  // A file written before the scales existed is left as it is — those values
  // were already roughly 0–1, just uncalibrated.
  normalize(data, file.coocScale ?? 0, file.transScale ?? 0);
  return data;
}

/**
 * Store a neighbours block that arrived with a song pack.
 *
 * Derived data, so it lives under its own key in `meta` and is overwritten in
 * place — importing must never clear the database, that is where the user's
 * songs and setlists are.
 */
export async function saveNeighbors(json: string): Promise<void> {
  // Checked before it is written, not after it is read back. A pack carrying
  // something unusable would otherwise overwrite a perfectly good block and
  // the recommendations would quietly lose a signal with nothing to show why.
  let usable = false;
  try {
    usable = parseNeighbors(JSON.parse(json) as NeighborFile).neighbors.size > 0;
  } catch {
    usable = false;
  }
  if (!usable) return;

  const db = await getDB();
  await db.put('meta', { key: CACHE_KEY, value: json });
  // The session already answered this once; let the next ask see the new data
  pending = null;
}

/**
 * Read the stored neighbours, falling back to a `neighbors.json` sitting next
 * to the app.
 *
 * Stored first, because that is where an imported pack puts them and it costs
 * nothing. The fetch is only for a deploy that ships the file on its own, and
 * only happens when there is nothing stored — the file runs to megabytes, and
 * pulling it on every launch to re-learn what is already in the database would
 * be the most expensive thing the app does at startup.
 */
async function readNeighbors(): Promise<CoocData | null> {
  const db = await getDB();

  try {
    const cached = await db.get('meta', CACHE_KEY);
    if (cached?.value) {
      const parsed = parseNeighbors(JSON.parse(cached.value) as NeighborFile);
      if (parsed.neighbors.size) return parsed;
    }
  } catch {
    // Stored text no longer parses; treated as absent
  }

  try {
    const res = await fetch('./neighbors.json', { cache: 'no-store' });
    // The PWA answers an unknown path with index.html and a 200, so an absent
    // file arrives looking like a success. The content type is what tells them
    // apart; JSON.parse would otherwise throw on every build without the file.
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      const text = await res.text();
      const parsed = parseNeighbors(JSON.parse(text) as NeighborFile);
      if (parsed.neighbors.size) {
        await db.put('meta', { key: CACHE_KEY, value: text });
        return parsed;
      }
    }
  } catch {
    // Offline, or no such file — the content signals carry the ranking alone
  }

  return null;
}

let pending: Promise<CoocData | null> | null = null;

/** Once per session, unless an import has replaced what is stored. */
export function loadNeighborFile(): Promise<CoocData | null> {
  if (!pending) pending = readNeighbors();
  return pending;
}
