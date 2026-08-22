/**
 * Chorus recalls, written out in full.
 *
 * The corpus shortens repeated choruses in three ways:
 *   {chorus}                            a bare recall directive
 *   a section holding just "Refrén" / "Chorus"
 *   a chorus trimmed to its opening words, usually ending in "..."
 *
 * All three are useless while playing: the chords sit somewhere further up the
 * page. `expandChorusRecalls` swaps each one for the chorus it points at, chords
 * and all, and flags the result so the renderer can still show it is a repeat.
 */
import type { ParseResult, Section, SongItem } from '../types';

/** Words that stand in for the whole chorus when a section holds nothing else. */
const RECALL_WORDS = new Set(['refren', 'ref', 'r', 'chorus', 'refrain', 'rf']);

/** Letters and digits only — spacing, chords, punctuation and accents all go. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** What a section says: its lyrics normalized, plus the chords in order. */
interface SectionKey {
  text: string;
  chords: string[];
}

function sectionKey(section: Section): SectionKey {
  const lines = section.lines.filter((l) => !l.marker);
  return {
    text: normalize(lines.map((l) => l.segments.map((s) => s.text).join('')).join(' ')),
    chords: lines.flatMap((l) => l.segments.map((s) => s.chord).filter((c): c is string => !!c)),
  };
}

/**
 * True when `stub` is only a pointer at `full`: the recall word on its own, or
 * its opening words. Whatever chords the stub carries have to line up with the
 * source's too — a shortened chorus reprinted in another key is a variant to
 * keep, not a stub to overwrite.
 */
function isPointerTo(stub: SectionKey, full: SectionKey): boolean {
  if (!stub.text) return false;
  if (stub.chords.length > full.chords.length) return false;
  if (stub.chords.some((c, i) => c !== full.chords[i])) return false;
  if (RECALL_WORDS.has(stub.text)) return true;
  return stub.text.length < full.text.length && full.text.startsWith(stub.text);
}

export function expandChorusRecalls(parsed: ParseResult): ParseResult {
  // Pass 1 — which chorus blocks hold the real thing, and what each one says.
  const keys = new Map<number, SectionKey>();
  const full: number[] = [];
  parsed.items.forEach((item, idx) => {
    if (item.type !== 'chorus' && item.type !== 'verse') return;
    const key = sectionKey(item);
    keys.set(idx, key);
    // A chorus counts as the real thing unless an earlier full one contains it.
    if (item.type !== 'chorus' || !key.text) return;
    if (full.some((f) => isPointerTo(key, keys.get(f)!))) return;
    full.push(idx);
  });

  if (full.length === 0) return parsed;

  /** Index of the chorus a recall at `idx` refers to: the nearest one above. */
  const sourceFor = (idx: number): number => {
    const above = full.filter((f) => f < idx);
    return above.length ? above[above.length - 1] : full[0];
  };

  const expand = (src: Section, own: Partial<Section>): Section => ({
    ...src,
    label: own.label ?? src.label,
    repeat: own.repeat ?? src.repeat,
    recalled: true,
  });

  let changed = false;
  const items: SongItem[] = parsed.items.map((item, idx) => {
    if (item.type === 'chorus_recall') {
      changed = true;
      return expand(parsed.items[sourceFor(idx)] as Section, { repeat: item.repeat });
    }

    if (item.type !== 'chorus' && item.type !== 'verse') return item;
    if (full.includes(idx)) return item;

    const key = keys.get(idx);
    if (!key?.text) return item;
    // A lone "Refrén" in a verse block is a recall too; anything longer is not.
    if (item.type === 'verse' && !RECALL_WORDS.has(key.text)) return item;

    const srcIdx = sourceFor(idx);
    const src = keys.get(srcIdx);
    if (!src || !isPointerTo(key, src)) return item;

    changed = true;
    return expand(parsed.items[srcIdx] as Section, { label: item.label, repeat: item.repeat });
  });

  return changed ? { ...parsed, items } : parsed;
}
