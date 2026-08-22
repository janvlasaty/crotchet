import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ParseResult,
  Section as SectionType,
  Line,
  ChordDef,
  CommentStyle,
  ChordMode,
} from '../types';
import { transposeChord } from '../lib/transpose';
import { expandChorusRecalls } from '../lib/chorus';
import { getChordShape } from '../lib/chordShapes';
import { ChordDiagram } from './ChordDiagram';

interface SongRendererProps {
  parsed: ParseResult;
  transpose: number;
  targetKey?: string;
  chordMode: ChordMode;
  chordColor?: string;
  fontScale: number;
}

export const SongRenderer: React.FC<SongRendererProps> = ({
  parsed,
  transpose,
  targetKey,
  chordMode,
  chordColor,
  fontScale,
}) => {
  // Shortened chorus recalls ({chorus}, a lone "Refrén", a first line trailing
  // off in dots) are written out in full before anything else looks at the song.
  const song = useMemo(() => expandChorusRecalls(parsed), [parsed]);

  const cls = ['song-content'];
  if (song.hasColumnBreak) cls.push('song-columns');

  /**
   * In 'first' mode only the opening section of each kind carries chords: the
   * first verse, the first chorus, the first bridge. Every later verse or
   * chorus prints lyrics alone, since the changes are already above.
   */
  const chordsBySection = useMemo(() => {
    const map = new Map<number, boolean>();
    if (chordMode !== 'first') return map;
    const seen = new Set<string>();
    song.items.forEach((item, idx) => {
      if (item.type === 'raw' || item.type === 'comment' || item.type === 'column_break'
        || item.type === 'chorus_recall') return;
      map.set(idx, !seen.has(item.type));
      seen.add(item.type);
    });
    return map;
  }, [song.items, chordMode]);

  const style = {
    fontSize: `${fontScale}em`,
    ...(chordColor ? { '--text-chord': chordColor } : {}),
  } as React.CSSProperties;

  return (
    <div className={cls.join(' ')} style={style}>
      {song.items.map((item, idx) => {
        switch (item.type) {
          case 'raw':
            return <div key={idx} className="raw-line">{item.text}</div>;
          case 'comment':
            return <Comment key={idx} text={item.text} style={item.style} />;
          case 'column_break':
            return <div key={idx} className={`column-break bp-${item.breakpoint}`} aria-hidden />;
          case 'chorus_recall':
            return (
              <div key={idx} className="chorus-recall">
                Refrén{item.repeat && item.repeat > 1 ? ` ×${item.repeat}` : ''}
              </div>
            );
          default:
            return (
              <SectionBlock
                key={idx}
                section={item}
                transpose={transpose}
                targetKey={targetKey}
                chordsVisible={chordMode === 'all' || chordsBySection.get(idx) === true}
                chordDefs={song.chordDefs}
              />
            );
        }
      })}
    </div>
  );
};

const Comment: React.FC<{ text: string; style: CommentStyle }> = ({ text, style }) => (
  <div className={`song-comment comment-${style}`}>{text}</div>
);

interface SectionBlockProps {
  section: SectionType;
  transpose: number;
  targetKey?: string;
  chordsVisible: boolean;
  chordDefs: Record<string, ChordDef>;
}

const SectionBlock: React.FC<SectionBlockProps> = ({
  section,
  transpose,
  targetKey,
  chordsVisible,
  chordDefs,
}) => {
  const sectionClass = `section section-${section.type}${section.recalled ? ' section-recalled' : ''}`;

  // Tab blocks are verbatim: no chord parsing, no reflow, spacing preserved.
  if (section.type === 'tab') {
    return (
      <div className={sectionClass}>
        {section.label && <div className="section-label">{section.label}</div>}
        {section.repeat && section.repeat > 1 && (
          <div className="section-repeat">×{section.repeat}</div>
        )}
        <pre className="tab-block">
          {section.lines.map((l) => l.raw ?? l.segments.map((s) => s.text).join('')).join('\n')}
        </pre>
      </div>
    );
  }

  return (
    <div className={sectionClass}>
      {section.label && <div className="section-label">{section.label}</div>}
      {section.repeat && section.repeat > 1 && (
        <div className="section-repeat">×{section.repeat}</div>
      )}
      {renderLines(section.lines, transpose, targetKey, chordsVisible, chordDefs)}
    </div>
  );
};

/**
 * Walk the lines, nesting `repeat_start` … `repeat_end` runs into bracketed
 * groups. An unmatched marker degrades to a plain group rather than throwing.
 */
function renderLines(
  lines: Line[],
  transpose: number,
  targetKey: string | undefined,
  chordsVisible: boolean,
  chordDefs: Record<string, ChordDef>,
): React.ReactNode[] {
  const root: React.ReactNode[] = [];
  const stack: { count: number; children: React.ReactNode[] }[] = [];
  const sink = () => (stack.length ? stack[stack.length - 1].children : root);

  lines.forEach((line, li) => {
    const marker = line.marker;

    if (marker?.kind === 'repeat_start') {
      stack.push({ count: marker.count, children: [] });
      return;
    }
    if (marker?.kind === 'repeat_end') {
      const group = stack.pop();
      if (!group) return;
      sink().push(
        <div key={`r${li}`} className="repeat-group">
          <div className="repeat-body">{group.children}</div>
          {group.count > 1 && <span className="repeat-count">×{group.count}</span>}
        </div>
      );
      return;
    }
    if (marker?.kind === 'comment') {
      sink().push(<Comment key={li} text={marker.text} style={marker.style} />);
      return;
    }

    const isEmpty =
      line.segments.length === 0 ||
      (line.segments.length === 1 && !line.segments[0].chord && !line.segments[0].annotation
        && !line.segments[0].text.trim());
    if (isEmpty) {
      sink().push(<div key={li} className="empty-line" />);
      return;
    }

    sink().push(
      <div key={li} className="song-line">
        {line.segments.map((seg, si) => (
          <span key={si} className="segment">
            {seg.annotation !== undefined ? (
              <span className="chord-slot annotation-slot">{seg.annotation}</span>
            ) : seg.chord && chordsVisible ? (
              <ChordToken
                chord={transposeChord(seg.chord, transpose, targetKey)}
                chordDefs={chordDefs}
                originalChord={seg.chord}
                transposed={transpose !== 0}
              />
            ) : (
              <span
                className={`chord-slot ${chordsVisible ? '' : 'chord-hidden'}`}
                aria-hidden={!chordsVisible}
              >
                {seg.chord ? transposeChord(seg.chord, transpose, targetKey) : ' '}
              </span>
            )}
            <span className="lyric">{seg.text || ' '}</span>
          </span>
        ))}
      </div>
    );
  });

  // Unclosed repeat groups: flush what we have so nothing disappears.
  while (stack.length) {
    const group = stack.pop()!;
    sink().push(
      <div key={`rx${stack.length}`} className="repeat-group">
        <div className="repeat-body">{group.children}</div>
        {group.count > 1 && <span className="repeat-count">×{group.count}</span>}
      </div>
    );
  }

  return root;
}

/** Chord label that reveals a guitar fingering diagram on hover / tap. */
const ChordToken: React.FC<{
  chord: string;
  chordDefs: Record<string, ChordDef>;
  originalChord: string;
  transposed: boolean;
}> = ({ chord, chordDefs, originalChord, transposed }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const shape = useMemo(() => {
    // A song-supplied {define:} wins, but only while untransposed — the
    // fingering is absolute and moving it would need a capo, not a shift.
    const def = !transposed ? chordDefs[originalChord] : undefined;
    if (def) return { frets: def.frets, name: originalChord };
    return getChordShape(chord);
  }, [chord, chordDefs, originalChord, transposed]);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 80;
    const h = 100;
    const margin = 8;
    const below = r.top < h + margin;
    const left = Math.min(
      Math.max(margin, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - margin
    );
    setPos({
      left,
      top: below ? r.bottom + 6 : r.top - h - 6,
      below,
    });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Any scroll or outside interaction dismisses it.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const onPointerDown = (e: PointerEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!shape) {
    return <span className="chord-slot">{chord}</span>;
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`chord-slot chord-btn ${open ? 'chord-btn-active' : ''}`}
        aria-expanded={open}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setOpen(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
      >
        {chord}
      </button>
      {open && pos && (
        <span
          className={`chord-popover ${pos.below ? 'below' : 'above'}`}
          style={{ left: pos.left, top: pos.top }}
          role="tooltip"
        >
          <ChordDiagram shape={shape} label={chord} />
        </span>
      )}
    </>
  );
};
