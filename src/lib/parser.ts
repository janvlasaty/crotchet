/**
 * ChordPro parser — never throws, never loses data.
 *
 * Beyond plain ChordPro it understands the extensions the imported corpus was
 * normalized to (see scripts/normalize-chordpro.mjs):
 *   {column_break: lg}   start a new column from the `lg` breakpoint up
 *   {x_repeat: n}        play the following block n times
 *   {x_repeat_start: n}  … {x_repeat_end}   repeat just these lines
 *   [*text]              an annotation in the chord slot, never transposed
 */
import type {
  ParseResult, Section, SectionType, Line, Segment, SongItem,
  CommentStyle, ChordDef,
} from '../types';

const DIRECTIVE_RE = /^\{([^:}]+)(?::(.+))?\}\s*$/;
const CHORD_RE = /\[([^\]]*)\]/g;

const SECTION_START_MAP: Record<string, SectionType> = {
  start_of_chorus: 'chorus',
  soc: 'chorus',
  start_of_verse: 'verse',
  sov: 'verse',
  start_of_bridge: 'bridge',
  sob: 'bridge',
  start_of_tab: 'tab',
  sot: 'tab',
};

const SECTION_END = new Set([
  'end_of_chorus', 'eoc',
  'end_of_verse', 'eov',
  'end_of_bridge', 'eob',
  'end_of_tab', 'eot',
]);

const META_DIRECTIVES = new Set([
  'title', 't',
  'artist', 'a',
  'subtitle', 'st',
  'key',
  'tempo', 'x_tempo',
  'capo',
]);

const COMMENT_STYLES: Record<string, CommentStyle> = {
  comment: 'plain',
  c: 'plain',
  comment_italic: 'italic',
  ci: 'italic',
  comment_box: 'box',
  cb: 'box',
};

function parseLine(raw: string): Line {
  const segments: Segment[] = [];
  let lastIndex = 0;

  // Reset regex
  CHORD_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CHORD_RE.exec(raw)) !== null) {
    // Text before this chord
    if (match.index > lastIndex) {
      const prevText = raw.slice(lastIndex, match.index);
      if (segments.length > 0) {
        segments[segments.length - 1].text += prevText;
      } else {
        segments.push({ text: prevText });
      }
    }
    const body = match[1];
    if (body.startsWith('*')) {
      segments.push({ annotation: body.slice(1), text: '' });
    } else {
      segments.push({ chord: body, text: '' });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last chord
  const remaining = raw.slice(lastIndex);
  if (segments.length > 0) {
    segments[segments.length - 1].text += remaining;
  } else {
    segments.push({ text: remaining });
  }

  return { segments };
}

/** `{define: Am base-fret 1 frets x 0 2 2 1 0}` */
function parseDefine(value: string): ChordDef | null {
  const m = value.trim().match(/^(\S+)\s+(.*)$/);
  if (!m) return null;
  const name = m[1];
  const rest = m[2];

  const baseMatch = rest.match(/base-fret\s+(\d+)/i);
  const baseFret = baseMatch ? parseInt(baseMatch[1], 10) : 1;

  const fretsMatch = rest.match(/frets\s+([^}]*)/i);
  const raw = (fretsMatch ? fretsMatch[1] : rest).trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 6) return null;

  const frets = tokens.slice(0, 6).map((t) => {
    if (/^[xX-]$/.test(t) || /^n$/i.test(t)) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  });
  return { name, frets, baseFret };
}

export function parseChordPro(source: string): ParseResult {
  const directives: Record<string, string> = {};
  const chordDefs: Record<string, ChordDef> = {};
  const items: SongItem[] = [];

  let currentSection: Section | null = null;
  let hasColumnBreak = false;
  /** `{x_repeat: n}` waits here for the block it belongs to. */
  let pendingRepeat: number | null = null;

  const lines = source.split(/\r?\n/);

  const pushCurrentSection = () => {
    if (currentSection) {
      items.push(currentSection);
      currentSection = null;
    }
  };

  const takeRepeat = () => {
    const n = pendingRepeat;
    pendingRepeat = null;
    return n ?? undefined;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Empty line
    if (trimmed === '') {
      if (currentSection) {
        currentSection.lines.push({ segments: [{ text: '' }] });
      }
      continue;
    }

    // Try directive
    const dirMatch = trimmed.match(DIRECTIVE_RE);
    if (dirMatch) {
      const name = dirMatch[1].trim().toLowerCase();
      const value = (dirMatch[2] || '').trim();

      // Section start
      if (name in SECTION_START_MAP) {
        pushCurrentSection();
        currentSection = {
          type: SECTION_START_MAP[name],
          label: value || undefined,
          lines: [],
          repeat: takeRepeat(),
        };
        continue;
      }

      // Section end
      if (SECTION_END.has(name)) {
        pushCurrentSection();
        continue;
      }

      // Meta directive
      if (META_DIRECTIVES.has(name)) {
        directives[name] = value;
        continue;
      }

      // Fingering
      if (name === 'define' || name === 'chord') {
        const def = parseDefine(value);
        if (def) chordDefs[def.name] = def;
        continue;
      }

      // Comment — positional, so it stays where the author put it
      if (name in COMMENT_STYLES) {
        const style = COMMENT_STYLES[name];
        if (currentSection) currentSection.lines.push({ segments: [], marker: { kind: 'comment', text: value, style } });
        else items.push({ type: 'comment', text: value, style });
        continue;
      }

      // Column break
      if (name === 'column_break' || name === 'colb') {
        pushCurrentSection();
        hasColumnBreak = true;
        items.push({ type: 'column_break', breakpoint: value || 'lg' });
        continue;
      }

      // Chorus recall
      if (name === 'chorus') {
        pushCurrentSection();
        items.push({ type: 'chorus_recall', repeat: takeRepeat() });
        continue;
      }

      // Repeat markers
      if (name === 'x_repeat') {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) pendingRepeat = n;
        continue;
      }
      if (name === 'x_repeat_start') {
        const n = parseInt(value, 10) || 2;
        if (!currentSection) currentSection = { type: 'verse', lines: [] };
        currentSection.lines.push({ segments: [], marker: { kind: 'repeat_start', count: n } });
        continue;
      }
      if (name === 'x_repeat_end') {
        if (!currentSection) currentSection = { type: 'verse', lines: [] };
        currentSection.lines.push({ segments: [], marker: { kind: 'repeat_end' } });
        continue;
      }

      // Unknown directive — store as raw
      items.push({ type: 'raw', text: rawLine });
      continue;
    }

    // Content line — ensure we have a section
    if (!currentSection) {
      currentSection = { type: 'verse', lines: [], repeat: takeRepeat() };
    }
    // Tab columns only line up if the original spacing survives.
    if (currentSection.type === 'tab') {
      currentSection.lines.push({ segments: [{ text: rawLine }], raw: rawLine });
    } else {
      currentSection.lines.push(parseLine(trimmed));
    }
  }

  pushCurrentSection();

  const title = directives['title'] || directives['t'] || 'Untitled';
  const artist = directives['artist'] || directives['a'] || '';
  const key = directives['key'] || '';
  const tempoStr = directives['x_tempo'] || directives['tempo'] || '';
  const tempo = tempoStr ? parseInt(tempoStr, 10) || null : null;
  const capoStr = directives['capo'] || '';
  const capo = capoStr ? parseInt(capoStr, 10) || null : null;

  return { title, artist, key, tempo, capo, items, directives, chordDefs, hasColumnBreak };
}

/** Extract plain text (no chords, no directives) */
export function extractPlainText(result: ParseResult): string {
  const parts: string[] = [];
  for (const item of result.items) {
    if (!('lines' in item)) continue;
    for (const line of item.lines) {
      if (line.marker) continue;
      const text = line.segments.map((s) => s.text).join('');
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join('\n');
}

/** Extract unique chords used */
export function extractChords(result: ParseResult): string[] {
  const chords = new Set<string>();
  for (const item of result.items) {
    if (!('lines' in item)) continue;
    if (item.type === 'tab') continue;
    for (const line of item.lines) {
      if (line.marker) continue;
      for (const seg of line.segments) {
        if (seg.chord) chords.add(seg.chord);
      }
    }
  }
  return [...chords];
}

/** Remove diacritics and lowercase */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
