/** A parsed segment: optional chord positioned above text */
export interface Segment {
  chord?: string;
  text: string;
}

/** A parsed line of a song */
export interface Line {
  segments: Segment[];
}

/** Section types */
export type SectionType = 'verse' | 'chorus' | 'bridge' | 'tab' | 'unknown';

/** A section of a song (verse, chorus, etc.) */
export interface Section {
  type: SectionType;
  label?: string;
  lines: Line[];
}

/** Raw / unknown directive preserved as-is */
export interface RawDirective {
  type: 'raw';
  text: string;
}

/** A parsed directive */
export interface Directive {
  type: 'directive';
  name: string;
  value: string;
}

export type ParsedItem = Section | RawDirective | Directive;

/** Full parse result */
export interface ParseResult {
  title: string;
  artist: string;
  key: string;
  tempo: number | null;
  items: (Section | RawDirective)[];
  directives: Record<string, string>;
}

/** Derived search index for a song */
export interface SongIndex {
  id: string;
  title: string;
  artist: string;
  plainText: string;
  searchKey: string;
  originalKey: string;
  chords: string[];
  tempo: number | null;
  sectionCount: number;
}

/** Per-song user preferences (sticky) */
export interface SongPrefs {
  songId: string;
  transpose: number;
  capo: number | null;
  fontScale: number;
  tempo: number | null;
  chordsVisible: boolean;
}

/** Play history record */
export interface PlayRecord {
  songId: string;
  playedAt: number;
}

/** A song stored in IndexedDB */
export interface Song {
  id: string;
  chordpro: string;
  index: SongIndex;
}

/** Setlist */
export interface Setlist {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
}
