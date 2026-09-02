/**
 * "Co hrát dál" — ranking the library against the song that has just finished.
 *
 * Not a similarity search. What is wanted at the end of a song is not the song
 * most like it, it is the song that would actually be played next, and the two
 * come apart quickly: the best follow-up is often in the same key with the same
 * capo and by somebody else entirely.
 *
 * The score is a weighted sum of independent signals, each normalised to 0–1 so
 * the weights can be moved one at a time. Two of them (`cooc`, `trans`) need
 * data about what people play together and simply read zero until there is any
 * — see `cooccurrence.ts`. The rest are computed from the songs themselves and
 * work from the very first launch, which is what makes this useful before a
 * single setlist exists.
 */
import type { Song } from '../types';
import type { CoocData } from './cooccurrence';
import { keyFromChord, noteToIndex, transposeChord, transposeKey } from './transpose';

/**
 * Starting weights, not the result of tuning. Nothing here should be moved
 * before there is a click-through number to move it against.
 */
const W = {
  cooc: 3.0,
  trans: 2.0,
  key: 1.5,
  chords: 0.8,
  tempo: 0.5,
  artist: 0.3,
  popularity: 0.2,
};

/** Tempo further apart than this counts as unrelated. */
const TEMPO_SPAN = 60;

/** How the song on screen stands right now — transpose and capo included. */
export interface PlayContext {
  id: string;
  artist: string;
  /**
   * The key the *hands* are in, not the one the room hears. A song in Eb played
   * with C shapes behind a capo on 3 follows a song in C, not one in Eb — the
   * whole point of the signal is that the hand does not have to move.
   */
  shapeKey: string;
  /** The fret the capo is on, 0 for none. */
  capo: number;
  /** Chords as fingered, so the comparison is shape against shape. */
  chords: string[];
  tempo: number | null;
}

/** Which signal earned a candidate its place, for the label on its card. */
export type RecReason = 'together' | 'shapes' | 'capo' | 'near-key' | 'chords' | 'tempo' | null;

export interface Recommendation {
  song: Song;
  score: number;
  reason: RecReason;
}

/** A candidate as the scorer needs it: the song at its own default settings. */
interface Candidate {
  shapeKey: string;
  capo: number;
  chords: string[];
  tempo: number | null;
}

const CAPO_RE = /\{capo\s*:\s*(\d+)\}/i;

/**
 * Candidate shape key and capo, as the song would open.
 *
 * `originalKey` is already the written key, which with a `{capo}` present means
 * shapes rather than sounding pitch — exactly what is wanted here. The capo is
 * pulled out with a regex instead of a parse: the index does not carry it, and
 * re-parsing the whole library to get one number per song would cost far more
 * than the ranking it feeds. Memoised, so a library is scanned once per session.
 */
const candidates = new Map<string, Candidate>();

function candidateOf(song: Song): Candidate {
  const cached = candidates.get(song.id);
  if (cached) return cached;
  const built: Candidate = {
    shapeKey: song.index.originalKey || keyFromChord(song.index.chords[0]),
    capo: Number(CAPO_RE.exec(song.chordpro)?.[1]) || 0,
    chords: song.index.chords,
    tempo: song.index.tempo,
  };
  candidates.set(song.id, built);
  return built;
}

/** Drop the memo — a re-import changes what the ids stand for. */
export function forgetCandidates(): void {
  candidates.clear();
}

/** The context for the song on screen, with its live transpose and capo. */
export function playContext(opts: {
  id: string;
  artist: string;
  /** Key the chords are written in. */
  writtenKey: string;
  /** Semitones between the written chords and the fingered ones. */
  shapeShift: number;
  capo: number | null;
  /** Chords as written; transposed to shapes here. */
  chords: string[];
  tempo: number | null;
}): PlayContext {
  const shapeKey = opts.writtenKey ? transposeKey(opts.writtenKey, opts.shapeShift) : '';
  return {
    id: opts.id,
    artist: opts.artist,
    shapeKey,
    capo: opts.capo ?? 0,
    chords: opts.chords.map(c => transposeChord(c, opts.shapeShift, shapeKey)),
    tempo: opts.tempo,
  };
}

/** Root index and mode of a key name, or null if it does not parse. */
function splitKey(key: string): { root: number; minor: boolean } | null {
  if (!key) return null;
  const minor = key.endsWith('m');
  const root = noteToIndex(minor ? key.slice(0, -1) : key);
  return root === -1 ? null : { root, minor };
}

/**
 * How much the left hand has to change, from "nothing at all" downwards. Named
 * rather than scored, because the score alone cannot be labelled honestly — a
 * key component of 0.5 is two quite different situations.
 */
type KeyTier =
  /** Same grips, same fret. Straight into the next song. */
  | 'identical'
  /** Same grips, capo one fret over. */
  | 'capo-near'
  /** Same grips, but the capo has to come off and go back on. */
  | 'capo-far'
  /** Relative minor/major or a fifth away — mostly shapes already in the hand. */
  | 'near'
  | 'unrelated';

const KEY_SCORE: Record<KeyTier, number> = {
  identical: 1,
  'capo-near': 0.7,
  'capo-far': 0.5,
  near: 0.5,
  unrelated: 0.1,
};

/**
 * How playable the candidate is without moving anything.
 *
 * This is the signal nobody else has, and the data for it is already in the
 * ChordPro. At a campfire it is the whole difference between playing straight
 * on and half a minute of retuning and shuffling the capo about.
 */
function keyTier(ctx: PlayContext, cand: Candidate): KeyTier {
  const a = splitKey(ctx.shapeKey);
  const b = splitKey(cand.shapeKey);
  if (!a || !b) return 'unrelated';

  const capoGap = Math.abs(ctx.capo - cand.capo);
  if (a.root === b.root && a.minor === b.minor) {
    if (capoGap === 0) return 'identical';
    return capoGap === 1 ? 'capo-near' : 'capo-far';
  }
  // Relative major/minor share a hand: Am and C are the same five shapes
  const minorRoot = a.minor ? a.root : b.root;
  const majorRoot = a.minor ? b.root : a.root;
  const relative = a.minor !== b.minor && (minorRoot + 3) % 12 === majorRoot;
  // A fifth either way — one new shape, and it is one already in the song
  const fifth =
    a.minor === b.minor && ((a.root + 7) % 12 === b.root || (b.root + 7) % 12 === a.root);
  if ((relative || fifth) && capoGap <= 1) return 'near';

  return 'unrelated';
}

/**
 * Chord reduced to the shape a hand recognises. Am7 and Am are one grip as far
 * as "do I know this yet" goes, and the extensions differ too much between
 * transcriptions of the same song to be worth distinguishing.
 */
const shapeOf = (chord: string) => keyFromChord(chord);

/** Jaccard over the fingered shapes: same four chords means nothing new. */
function chordOverlap(ctx: PlayContext, cand: Candidate): number {
  const a = new Set(ctx.chords.map(shapeOf));
  const b = new Set(cand.chords.map(shapeOf));
  a.delete('');
  b.delete('');
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const shape of a) if (b.has(shape)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Zero when either tempo is missing — guessing one is worse than not scoring. */
function tempoProximity(ctx: PlayContext, cand: Candidate): number {
  if (!ctx.tempo || !cand.tempo) return 0;
  return 1 - Math.min(1, Math.abs(ctx.tempo - cand.tempo) / TEMPO_SPAN);
}

/**
 * Stable pseudo-random in 0–1 for a pair of ids.
 *
 * Without data the top of the list is a bucket of songs on identical scores,
 * and breaking that tie by title would open every song on the same handful of
 * As. Seeded by both ids, so the order is fixed for a given song — it does not
 * reshuffle under the reader between two glances — while a different song gets
 * a different set.
 */
function jitter(a: string, b: string): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) h = ((h ^ a.charCodeAt(i)) * 16777619) | 0;
  for (let i = 0; i < b.length; i++) h = ((h ^ b.charCodeAt(i)) * 16777619) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export interface RecommendOptions {
  /** Never suggested: the open song, and anything played in this sitting. */
  exclude: ReadonlySet<string>;
  cooc?: CoocData | null;
  /** Plays per song, from local history — a tiebreaker, nothing more. */
  playCounts?: Map<string, number> | null;
  limit?: number;
}

/** Enough of a lead over the runner-up to be worth naming on the card. */
const REASON_MARGIN = 0.05;

/** Rank the library behind the song on screen. Highest score first. */
export function recommend(
  ctx: PlayContext,
  library: Song[],
  { exclude, cooc, playCounts, limit = 12 }: RecommendOptions
): Recommendation[] {
  const pool = library.filter(s => !exclude.has(s.id));
  if (!pool.length) return [];

  const row = cooc?.neighbors.get(ctx.id);

  // `cooc` and `trans` arrive already on 0–1, each scaled by the source that
  // produced them (see cooccurrence.ts) — a pair resting on one songbook has to
  // score like one, and only the source knows what a strong pair looks like.
  // Plays are the exception: "often, for this player" is only ever relative.
  let maxPlays = 0;
  for (const song of pool) {
    const plays = playCounts?.get(song.id) ?? 0;
    if (plays > maxPlays) maxPlays = plays;
  }

  const scored = pool.map(song => {
    const cand = candidateOf(song);
    const neighbor = row?.get(song.id);
    const tier = keyTier(ctx, cand);

    const parts = {
      cooc: neighbor?.cooc ?? 0,
      trans: neighbor?.trans ?? 0,
      key: KEY_SCORE[tier],
      chords: chordOverlap(ctx, cand),
      tempo: tempoProximity(ctx, cand),
      artist: ctx.artist && (song.index.artist?.trim() || '') === ctx.artist ? 1 : 0,
      popularity: maxPlays > 0 ? (playCounts?.get(song.id) ?? 0) / maxPlays : 0,
    };

    let score = 0;
    for (const k of Object.keys(parts) as Array<keyof typeof parts>) {
      score += W[k] * parts[k];
    }
    // Small next to any real signal, decisive only between exact ties
    score += 0.01 * jitter(ctx.id, song.id);

    return { song, score, reason: reasonFor(parts, tier) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

type Parts = Record<keyof typeof W, number>;

/**
 * The one thing worth saying on the card.
 *
 * Two rules keep it honest. It has to be the signal actually carrying the
 * candidate — named only when it is clearly ahead of the runner-up, since
 * "stejné hmaty" on a song that merely shares a tempo is worse than saying
 * nothing. And `unrelated` keys never produce a key reason at all: the key
 * component wins the argmax on almost everything simply because its weight is
 * the largest, and 0.1 of it is not a reason to play a song.
 */
function reasonFor(parts: Parts, tier: KeyTier): RecReason {
  const ranked = (Object.keys(parts) as Array<keyof Parts>)
    .map(k => ({ k, weighted: W[k] * parts[k] }))
    // A key nobody would call compatible cannot be the reason for anything
    .filter(part => !(part.k === 'key' && tier === 'unrelated'))
    .sort((a, b) => b.weighted - a.weighted);

  const [top, next] = ranked;
  if (!top || top.weighted <= 0) return null;
  if (next && top.weighted - next.weighted < REASON_MARGIN) return null;

  switch (top.k) {
    case 'cooc':
    case 'trans':
      return 'together';
    case 'key':
      // Where the capo has to go is the more useful half to print
      if (tier === 'identical') return 'shapes';
      if (tier === 'near') return 'near-key';
      return 'capo';
    case 'chords':
      return 'chords';
    case 'tempo':
      return 'tempo';
    // The artist is on the card already — restating it as a reason says nothing
    default:
      return null;
  }
}

/** Czech label for a reason. `song` supplies the numbers a label names. */
export function reasonLabel(reason: RecReason, song: Song): string | null {
  switch (reason) {
    case 'together':
      return 'hraje se spolu';
    case 'shapes':
      return 'stejné hmaty';
    case 'capo': {
      // Same grips, different fret — so the fret is the whole message
      const capo = candidateOf(song).capo;
      return capo ? `stejné hmaty, capo ${capo}` : 'stejné hmaty, bez capa';
    }
    case 'near-key':
      return 'blízká tónina';
    case 'chords':
      return 'stejné akordy';
    case 'tempo':
      return 'stejné tempo';
    default:
      return null;
  }
}
