/** A parsed segment: optional chord positioned above text */
export interface Segment {
  chord?: string;
  /** ChordPro annotation `[*text]` — sits in the chord slot but is never transposed. */
  annotation?: string;
  text: string;
}

export type CommentStyle = 'plain' | 'italic' | 'box';

/** A block marker that stands in place of content on its own line. */
export type LineMarker =
  | { kind: 'repeat_start'; count: number }
  | { kind: 'repeat_end' }
  | { kind: 'comment'; text: string; style: CommentStyle };

/** A parsed line of a song */
export interface Line {
  segments: Segment[];
  /** When set, the line carries a marker rather than lyrics. */
  marker?: LineMarker;
  /** Verbatim source text — kept for tab lines, where columns must line up. */
  raw?: string;
}

/** Section types */
export type SectionType = 'verse' | 'chorus' | 'bridge' | 'tab' | 'unknown';

/** A section of a song (verse, chorus, etc.) */
export interface Section {
  type: SectionType;
  label?: string;
  lines: Line[];
  /** `{x_repeat: n}` preceding the block — play it n times. */
  repeat?: number;
  /** Filled in from an earlier chorus, standing in for a shortened recall. */
  recalled?: boolean;
}

/** Raw / unknown directive preserved as-is */
export interface RawDirective {
  type: 'raw';
  text: string;
}

/** `{ci:}` / `{c:}` / `{cb:}` standing between sections */
export interface CommentItem {
  type: 'comment';
  text: string;
  style: CommentStyle;
}

/** `{column_break}` — start a new column at the given breakpoint and up. */
export interface ColumnBreakItem {
  type: 'column_break';
  breakpoint: string;
}

/** `{chorus}` — play the chorus again here. */
export interface ChorusRecallItem {
  type: 'chorus_recall';
  repeat?: number;
}

/** A `{define:}`d fingering. frets[0] = low E, null = muted. */
export interface ChordDef {
  name: string;
  frets: (number | null)[];
  baseFret: number;
}

/** A parsed directive */
export interface Directive {
  type: 'directive';
  name: string;
  value: string;
}

export type ParsedItem = Section | RawDirective | Directive;

/** Anything that can appear at the top level of a parsed song. */
export type SongItem =
  | Section
  | RawDirective
  | CommentItem
  | ColumnBreakItem
  | ChorusRecallItem;

/** Full parse result */
export interface ParseResult {
  title: string;
  artist: string;
  key: string;
  tempo: number | null;
  capo: number | null;
  items: SongItem[];
  directives: Record<string, string>;
  /** Fingerings declared with `{define:}`, keyed by chord name. */
  chordDefs: Record<string, ChordDef>;
  /** True when the song asks for a multi-column layout somewhere. */
  hasColumnBreak: boolean;
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

/** How much of the chord line to print. */
export type ChordMode = 'all' | 'first' | 'none';

/** Per-song user preferences (sticky) */
export interface SongPrefs {
  songId: string;
  transpose: number;
  capo: number | null;
  fontScale: number;
  tempo: number | null;
  chordMode: ChordMode;
  /** Pre-chordMode rows stored a plain on/off; normalised on read. */
  chordsVisible?: boolean;
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
