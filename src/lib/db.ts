/**
 * IndexedDB storage layer using the `idb` library.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Song, SongPrefs, PlayRecord, Setlist, SongIndex, ChordMode } from '../types';
import { parseChordPro, extractPlainText, extractChords, normalizeForSearch } from './parser';
import { DEFAULT_CHORD_COLOR } from './chordColors';

const DB_NAME = 'zpevnik';
const DB_VERSION = 2;

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
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

let dbPromise: Promise<IDBPDatabase<ZpevnikDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ZpevnikDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ZpevnikDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
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
        }

        if (oldVersion < 2) {
          // Bookkeeping for the seed stamp, so songs are parsed once rather
          // than on every launch.
          db.createObjectStore('meta', { keyPath: 'key' });
        }
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
    sectionCount: parsed.items.filter(i => 'lines' in i).length,
  };
}

/** Save or update a song */
export async function saveSong(id: string, chordpro: string): Promise<Song> {
  const db = await getDB();
  const index = buildSongIndex(id, chordpro);
  const song: Song = { id, chordpro, index };
  await db.put('songs', song);
  forgetSongs();
  return song;
}

/** How many songs one import transaction parses and writes before yielding. */
const IMPORT_CHUNK = 100;

/**
 * Bulk-import songs from a song pack. Rows are tagged `source: 'import'` so
 * `seedSongsIfNeeded` leaves them alone, and are written in chunks so a
 * multi-thousand-song pack reports progress instead of freezing the UI.
 * Returns the number of songs written.
 */
export async function importSongs(
  entries: Array<{ id: string; chordpro: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = await getDB();
  let done = 0;

  for (let start = 0; start < entries.length; start += IMPORT_CHUNK) {
    const chunk = entries.slice(start, start + IMPORT_CHUNK);
    // Parse outside the transaction: an idle IndexedDB transaction auto-commits,
    // and parsing is the slow half.
    const rows = chunk.map(({ id, chordpro }) => ({
      id,
      chordpro,
      index: buildSongIndex(id, chordpro),
      source: 'import' as const,
    }));

    const tx = db.transaction('songs', 'readwrite');
    for (const row of rows) tx.store.put(row);
    await tx.done;

    forgetSongs();
    done += rows.length;
    onProgress?.(done, entries.length);
    // Let the browser paint the progress before the next chunk hogs the thread
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return done;
}

/**
 * The library as it was last read, kept for the screens that open onto it. The
 * artist screen and a setlist both need every song to draw their list, and both
 * are opened by a card growing into their hero — a screen that arrives empty has
 * nothing for that card to grow into (see `warmSongs` below). Dropped on every
 * write, so a deleted or re-imported song is never served from here.
 */
let librarySnapshot: Song[] | null = null;

/** Synchronous, hence usable as initial state. Null until a read has happened. */
export function getWarmLibrary(): Song[] | null {
  return librarySnapshot;
}

/** Every write goes through here: nothing remembered outlives the songs table. */
function forgetSongs(): void {
  librarySnapshot = null;
  warmSongs.clear();
}

/** Get all songs */
export async function getAllSongs(): Promise<Song[]> {
  const db = await getDB();
  const all = await db.getAll('songs');
  librarySnapshot = all;
  return all;
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
  forgetSongs();
}

/** Global app settings stored in localStorage */
export interface AppSettings {
  fontScale: number;
  chordMode: ChordMode;
  chordColor: string;
}

const APP_SETTINGS_KEY = 'zpevnik-settings';

const APP_SETTINGS_DEFAULTS: AppSettings = {
  fontScale: 1,
  chordMode: 'all',
  chordColor: DEFAULT_CHORD_COLOR,
};

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<AppSettings> & { chordsVisible?: boolean };
      return {
        ...APP_SETTINGS_DEFAULTS,
        ...stored,
        // Settings written before the three-way mode existed
        chordMode: stored.chordMode ?? (stored.chordsVisible === false ? 'none' : 'all'),
      };
    }
  } catch { /* ignore */ }
  return { ...APP_SETTINGS_DEFAULTS };
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Home screen's recently-played rail, cached so it paints on the first frame
 * instead of appearing once IndexedDB has answered.
 */
export interface RecentEntry {
  id: string;
  title: string;
  artist: string;
}

const RECENT_CACHE_KEY = 'zpevnik-recent';

export function getRecentCache(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentCache(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(RECENT_CACHE_KEY, JSON.stringify(entries));
  } catch { /* quota or private mode — the rail just recomputes next time */ }
}

/**
 * The letter the artist grid was left on. The home screen is returned to far
 * more often than it is opened cold — from a song, an artist, a setlist — and it
 * is a fresh mount every time, so without this the filter is back at A on every
 * trip home and the strip has to be swiped to your place again.
 */
const ARTIST_LETTER_KEY = 'zpevnik-artist-letter';

export function getArtistLetter(): string | null {
  try {
    return localStorage.getItem(ARTIST_LETTER_KEY);
  } catch {
    return null;
  }
}

export function saveArtistLetter(letter: string): void {
  try {
    localStorage.setItem(ARTIST_LETTER_KEY, letter);
  } catch { /* quota or private mode — the grid just opens on A next time */ }
}

/**
 * A song and its prefs held in memory, so the play screen can paint its hero on
 * the very first frame instead of a frame or two after IndexedDB answers.
 *
 * The card that opens a song warms it before the screen transition starts (see
 * `morphNavigate`), which is what lets the arriving screen be complete when the
 * browser snapshots it — an empty screen there has no hero for the tapped card
 * to grow into, and the whole thing degrades to a cross-fade into "Načítám…".
 */
const warmSongs = new Map<string, { song: Song; prefs: SongPrefs }>();

/** The song open, the ones around it — a handful, not the library. */
const WARM_LIMIT = 8;

/** Synchronous, hence usable during render. Undefined until warmed. */
export function getWarmSong(id: string): { song: Song; prefs: SongPrefs } | undefined {
  return warmSongs.get(id);
}

/**
 * Read a song and its prefs, remembering both. Resolves immediately once the
 * song has been warmed, so the play screen's own load is a microtask on arrival.
 */
export async function loadSong(id: string): Promise<{ song: Song; prefs: SongPrefs } | null> {
  const warm = warmSongs.get(id);
  if (warm) return warm;
  const song = await getSong(id);
  if (!song) return null;
  // Prefs come second: a fresh row seeds its capo from the song's {capo}
  const prefs = await getSongPrefs(id, parseChordPro(song.chordpro).capo);
  const entry = { song, prefs };
  if (warmSongs.size >= WARM_LIMIT) warmSongs.delete(warmSongs.keys().next().value as string);
  warmSongs.set(id, entry);
  return entry;
}

/** Warm a song without caring about the result — for a card about to open it. */
export async function warmSong(id: string): Promise<void> {
  await loadSong(id);
}

/**
 * Get or create song prefs (uses global defaults).
 * `fileCapo` is the song's own `{capo}` — it seeds a fresh row so the song
 * first opens exactly as it was written down. A stored row always wins.
 */
export async function getSongPrefs(
  songId: string,
  fileCapo: number | null = null
): Promise<SongPrefs> {
  const db = await getDB();
  const prefs = await db.get('prefs', songId);
  if (prefs) return { ...prefs, chordMode: resolveChordMode(prefs) };
  const defaults = getAppSettings();
  return {
    songId,
    transpose: 0,
    capo: fileCapo,
    fontScale: defaults.fontScale,
    tempo: null,
    chordMode: defaults.chordMode,
  };
}

/** Rows written before chordMode carried a boolean instead. */
function resolveChordMode(prefs: SongPrefs): ChordMode {
  if (prefs.chordMode) return prefs.chordMode;
  return prefs.chordsVisible === false ? 'none' : 'all';
}

/** Save song prefs */
export async function saveSongPrefs(prefs: SongPrefs): Promise<void> {
  // The warm copy is what the screen paints on re-entry; a stale transpose there
  // would flash the old key before IndexedDB corrected it.
  const warm = warmSongs.get(prefs.songId);
  if (warm) warmSongs.set(prefs.songId, { ...warm, prefs });
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
  await refreshSetlistCache(db);
}

export async function getAllSetlists(): Promise<Setlist[]> {
  const db = await getDB();
  const setlists = await db.getAll('setlists');
  saveSetlistCache(setlists);
  return setlists;
}

export async function getSetlist(id: string): Promise<Setlist | undefined> {
  const db = await getDB();
  return db.get('setlists', id);
}

export async function deleteSetlist(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('setlists', id);
  await refreshSetlistCache(db);
}

/**
 * The home screen's setlist rail, cached like the recently-played one so it
 * paints on the first frame. Coming back from a setlist the rail was already on
 * screen a moment ago, and waiting for IndexedDB to say so again made the cards
 * blink out and back in.
 *
 * Written on every read *and* every mutation, so a setlist that has just been
 * renamed, created or deleted is never briefly resurrected from a stale cache.
 */
const SETLIST_CACHE_KEY = 'zpevnik-setlists';

export function getSetlistCache(): Setlist[] {
  try {
    const raw = localStorage.getItem(SETLIST_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSetlistCache(setlists: Setlist[]): void {
  try {
    localStorage.setItem(SETLIST_CACHE_KEY, JSON.stringify(setlists));
  } catch { /* quota or private mode — the rail just waits for the read */ }
}

async function refreshSetlistCache(db: IDBPDatabase<ZpevnikDB>): Promise<void> {
  saveSetlistCache(await db.getAll('setlists'));
}

/**
 * Fingerprint of the static song set. A single pass over the sources — cheap
 * next to parsing every song, which is what it lets us skip.
 */
function songSetStamp(songs: Array<{ id: string; chordpro: string }>): string {
  let h = 5381;
  for (const { id, chordpro } of songs) {
    for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) | 0;
    for (let i = 0; i < chordpro.length; i++) h = ((h * 33) ^ chordpro.charCodeAt(i)) | 0;
  }
  return `${songs.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Seed songs from static .cho files. Parses and writes only when the song set
 * has actually changed — otherwise this is one indexed read, so startup no
 * longer scales with catalog size.
 */
export async function seedSongsIfNeeded(songs: Array<{ id: string; chordpro: string }>): Promise<void> {
  const db = await getDB();
  const stamp = songSetStamp(songs);

  if ((await db.get('meta', 'seed'))?.value === stamp) return;

  const tx = db.transaction('songs', 'readwrite');
  for (const { id, chordpro } of songs) {
    const index = buildSongIndex(id, chordpro);
    await tx.store.put({ id, chordpro, index });
  }
  // Drop seeded rows that are no longer in the song set. Without this, renaming
  // an id leaves the old row behind forever and it keeps serving stale content
  // on /play/:id. Imported rows are skipped — those are the user's library.
  const live = new Set(songs.map(s => s.id));
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (!live.has(String(cursor.key)) && cursor.value.source !== 'import') {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  forgetSongs();

  await db.put('meta', { key: 'seed', value: stamp });
}
