/**
 * Search engine: diacritics-insensitive fuzzy matching.
 */
import Fuse from 'fuse.js';
import type { Song } from '../types';
import { normalizeForSearch } from './parser';

let fuseInstance: Fuse<Song> | null = null;
let cachedSongs: Song[] = [];

export function initSearch(songs: Song[]): void {
  cachedSongs = songs;
  fuseInstance = new Fuse(songs, {
    keys: [
      { name: 'index.title', weight: 3 },
      { name: 'index.artist', weight: 2 },
      { name: 'index.plainText', weight: 1 },
    ],
    threshold: 0.35,
    distance: 200,
    includeScore: true,
    getFn: (obj, path) => {
      const value = Fuse.config.getFn(obj, path);
      if (typeof value === 'string') return normalizeForSearch(value);
      if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? normalizeForSearch(v) : v);
      return value;
    },
  });
}

export function search(query: string): Song[] {
  if (!fuseInstance) return [];
  if (!query.trim()) return cachedSongs;
  const normalizedQuery = normalizeForSearch(query);
  return fuseInstance.search(normalizedQuery).map(r => r.item);
}
