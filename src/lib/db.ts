/**
 * IndexedDB storage layer using the `idb` library.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Song, SongPrefs, PlayRecord, Setlist, SongIndex } from '../types';
import { parseChordPro, extractPlainText, extractChords, normalizeForSearch } from './parser';

const DB_NAME = 'zpevnik';
const DB_VERSION = 1;

interface ZpevnikDB {
  songs: {
    key: string;
    value: Song;
    indexes: { 'by-title': string };
  };
  prefs: {
    key: string;
    value: SongPrefs;
  };
  history: {
    key: number; // auto-increment
    value: PlayRecord;
    indexes: { 'by-song': string; 'by-time': number };
  };
  setlists: {
    key: string;
    value: Setlist;
  };
}

let dbPromise: Promise<IDBPDatabase<ZpevnikDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ZpevnikDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ZpevnikDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Songs store
        const songStore = db.createObjectStore('songs', { keyPath: 'id' });
        songStore.createIndex('by-title', 'index.title');

        // Per-song prefs
        db.createObjectStore('prefs', { keyPath: 'songId' });

        // Play history
        const historyStore = db.createObjectStore('history', { autoIncrement: true });
        historyStore.createIndex('by-song', 'songId');
        historyStore.createIndex('by-time', 'playedAt');

        // Setlists
        db.createObjectStore('setlists', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** Build derived index from ChordPro source */
export function buildSongIndex(id: string, chordpro: string): SongIndex {
  const parsed = parseChordPro(chordpro);
  const plainText = extractPlainText(parsed);
  const chords = extractChords(parsed);
  const searchKey = normalizeForSearch([parsed.title, parsed.artist, plainText].join(' '));

  return {
    id,
    title: parsed.title,
    artist: parsed.artist,
    plainText,
    searchKey,
    originalKey: parsed.key,
    chords,
    tempo: parsed.tempo,
    sectionCount: parsed.items.filter(i => i.type !== 'raw').length,
  };
}

/** Save or update a song */
export async function saveSong(id: string, chordpro: string): Promise<Song> {
  const db = await getDB();
  const index = buildSongIndex(id, chordpro);
  const song: Song = { id, chordpro, index };
  await db.put('songs', song);
  return song;
}

/** Get all songs */
export async function getAllSongs(): Promise<Song[]> {
  const db = await getDB();
  return db.getAll('songs');
}

/** Get a song by ID */
export async function getSong(id: string): Promise<Song | undefined> {
  const db = await getDB();
  return db.get('songs', id);
}

/** Delete a song */
export async function deleteSong(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('songs', id);
}

/** Get or create song prefs */
export async function getSongPrefs(songId: string): Promise<SongPrefs> {
  const db = await getDB();
  const prefs = await db.get('prefs', songId);
  return prefs || {
    songId,
    transpose: 0,
    capo: null,
    fontScale: 1,
    tempo: null,
    chordsVisible: true,
  };
}

/** Save song prefs */
export async function saveSongPrefs(prefs: SongPrefs): Promise<void> {
  const db = await getDB();
  await db.put('prefs', prefs);
}

/** Record a play */
export async function recordPlay(songId: string): Promise<void> {
  const db = await getDB();
  await db.add('history', { songId, playedAt: Date.now() });
}

/** Get recent plays, newest first */
export async function getRecentPlays(limit: number = 20): Promise<PlayRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('history', 'by-time');
  // Deduplicate by songId, keeping the most recent
  const seen = new Set<string>();
  const result: PlayRecord[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (!seen.has(all[i].songId)) {
      seen.add(all[i].songId);
      result.push(all[i]);
    }
    if (result.length >= limit) break;
  }
  return result;
}

// Setlist operations
export async function saveSetlist(setlist: Setlist): Promise<void> {
  const db = await getDB();
  await db.put('setlists', setlist);
}

export async function getAllSetlists(): Promise<Setlist[]> {
  const db = await getDB();
  return db.getAll('setlists');
}

export async function getSetlist(id: string): Promise<Setlist | undefined> {
  const db = await getDB();
  return db.get('setlists', id);
}

export async function deleteSetlist(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('setlists', id);
}

/** Seed songs from static .cho files — always update to latest content */
export async function seedSongsIfNeeded(songs: Array<{ id: string; chordpro: string }>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('songs', 'readwrite');
  for (const { id, chordpro } of songs) {
    const index = buildSongIndex(id, chordpro);
    await tx.store.put({ id, chordpro, index });
  }
  await tx.done;
}
