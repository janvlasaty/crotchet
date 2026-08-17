/**
 * ChordPro parser — never throws, never loses data.
 */
import type { ParseResult, Section, SectionType, Line, Segment, RawDirective } from '../types';

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
  'key',
  'tempo', 'x_tempo',
  'capo',
  'comment', 'c',
  'comment_italic', 'ci',
  'comment_box', 'cb',
]);

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
    segments.push({ chord: match[1], text: '' });
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

export function parseChordPro(source: string): ParseResult {
  const directives: Record<string, string> = {};
  const items: (Section | RawDirective)[] = [];

  let currentSection: Section | null = null;

  const lines = source.split(/\r?\n/);

  const pushCurrentSection = () => {
    if (currentSection) {
      items.push(currentSection);
      currentSection = null;
    }
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

      // Unknown directive — store as raw
      items.push({ type: 'raw', text: rawLine });
      continue;
    }

    // Content line — ensure we have a section
    if (!currentSection) {
      currentSection = { type: 'verse', lines: [] };
    }
    currentSection.lines.push(parseLine(trimmed));
  }

  pushCurrentSection();

  const title = directives['title'] || directives['t'] || 'Untitled';
  const artist = directives['artist'] || directives['a'] || '';
  const key = directives['key'] || '';
  const tempoStr = directives['x_tempo'] || directives['tempo'] || '';
  const tempo = tempoStr ? parseInt(tempoStr, 10) || null : null;

  return { title, artist, key, tempo, items, directives };
}

/** Extract plain text (no chords, no directives) */
export function extractPlainText(result: ParseResult): string {
  const parts: string[] = [];
  for (const item of result.items) {
    if (item.type === 'raw') continue;
    for (const line of item.lines) {
      const text = line.segments.map(s => s.text).join('');
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join('\n');
}

/** Extract unique chords used */
export function extractChords(result: ParseResult): string[] {
  const chords = new Set<string>();
  for (const item of result.items) {
    if (item.type === 'raw') continue;
    for (const line of item.lines) {
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
