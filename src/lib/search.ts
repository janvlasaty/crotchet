/**
 * Search engine: diacritics-insensitive fuzzy matching over songs and artists.
 */
import Fuse from 'fuse.js';
import type { FuseGetFunction } from 'fuse.js';
import type { Song } from '../types';
import { normalizeForSearch } from './parser';
import { UNKNOWN_ARTIST } from './artists';

/** An artist matched as a whole, with how many songs sit under them. */
export interface ArtistHit {
  artist: string;
  count: number;
}

let fuseInstance: Fuse<Song> | null = null;
let artistFuse: Fuse<ArtistHit> | null = null;
let cachedSongs: Song[] = [];
let cachedArtists: ArtistHit[] = [];

/** Diacritics-folded lookup, shared by both indexes. */
const normalizeGetFn: FuseGetFunction<never> = (obj, path) => {
  const value = Fuse.config.getFn(obj, path);
  if (typeof value === 'string') return normalizeForSearch(value);
  if (Array.isArray(value)) return value.map(v => (typeof v === 'string' ? normalizeForSearch(v) : v));
  return value;
};

/** Distinct artists with song counts, alphabetical with the unknown bucket last. */
function collectArtists(songs: Song[]): ArtistHit[] {
  const counts = new Map<string, number>();
  for (const s of songs) {
    const artist = s.index.artist?.trim() || UNKNOWN_ARTIST;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => {
      if (a.artist === UNKNOWN_ARTIST) return 1;
      if (b.artist === UNKNOWN_ARTIST) return -1;
      return a.artist.localeCompare(b.artist, 'cs');
    });
}

/** Whether an index has been built yet — screens can seed it lazily. */
export function isSearchReady(): boolean {
  return fuseInstance !== null;
}

export function initSearch(songs: Song[]): void {
  cachedSongs = songs;
  cachedArtists = collectArtists(songs);
  artistFuse = new Fuse(cachedArtists, {
    keys: ['artist'],
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: true,
    getFn: normalizeGetFn as FuseGetFunction<ArtistHit>,
  });
  // Fuzzy pass over the short fields only — bitap on whole lyrics is both slow
  // and unreliable, so lyric hits come from the literal pass in search().
  fuseInstance = new Fuse(songs, {
    keys: [
      { name: 'index.title', weight: 3 },
      { name: 'index.artist', weight: 2 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: true,
    getFn: normalizeGetFn as FuseGetFunction<Song>,
  });
}

/**
 * Songs matching the query, best first.
 *
 * Literal token matching runs first, because a phrase like "hit me baby" is
 * spread across the lyrics and only shows up if every word is looked for
 * independently. Fuse then adds typo tolerance on titles and artists.
 */
export function search(query: string): Song[] {
  if (!fuseInstance) return [];
  const q = normalizeForSearch(query.trim());
  if (!q) return cachedSongs;
  const tokens = q.split(/\s+/).filter(Boolean);

  const ranks = new Map<string, number>();
  const hits: Song[] = [];
  const add = (song: Song, rank: number) => {
    const seen = ranks.get(song.id);
    if (seen === undefined) {
      ranks.set(song.id, rank);
      hits.push(song);
    } else if (rank < seen) {
      ranks.set(song.id, rank);
    }
  };

  for (const song of cachedSongs) {
    const head = normalizeForSearch(`${song.index.title} ${song.index.artist}`);
    if (head.includes(q)) add(song, 0);
    else if (tokens.every(t => head.includes(t))) add(song, 1);
    else {
      // searchKey is prebuilt and normalized; fall back for older stored rows
      const body = song.index.searchKey || normalizeForSearch(song.index.plainText);
      // A contiguous lyric phrase beats a song that merely scatters the words
      if (body.includes(q)) add(song, 2);
      else if (tokens.every(t => body.includes(t))) add(song, 3);
    }
  }

  for (const r of fuseInstance.search(q)) add(r.item, 4);

  // Stable sort, so within a rank the literal passes keep catalog order and the
  // fuzzy pass keeps Fuse's own scoring.
  return hits.sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
}

/** Artists whose name matches the query, best first. */
export function searchArtists(query: string): ArtistHit[] {
  if (!artistFuse) return [];
  if (!query.trim()) return cachedArtists;
  return artistFuse.search(normalizeForSearch(query)).map(r => r.item);
}
