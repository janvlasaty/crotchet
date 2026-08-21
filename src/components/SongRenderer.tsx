import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParseResult, Section as SectionType } from '../types';
import { transposeChord } from '../lib/transpose';
import { getChordShape } from '../lib/chordShapes';
import { ChordDiagram } from './ChordDiagram';

interface SongRendererProps {
  parsed: ParseResult;
  transpose: number;
  targetKey?: string;
  chordsVisible: boolean;
  fontScale: number;
}

export const SongRenderer: React.FC<SongRendererProps> = ({
  parsed,
  transpose,
  targetKey,
  chordsVisible,
  fontScale,
}) => {
  return (
    <div className="song-content" style={{ fontSize: `${fontScale}em` }}>
      {parsed.items.map((item, idx) => {
        if (item.type === 'raw') {
          return (
            <div key={idx} className="raw-line">
              {item.text}
            </div>
          );
        }
        return (
          <SectionBlock
            key={idx}
            section={item}
            transpose={transpose}
            targetKey={targetKey}
            chordsVisible={chordsVisible}
          />
        );
      })}
    </div>
  );
};

interface SectionBlockProps {
  section: SectionType;
  transpose: number;
  targetKey?: string;
  chordsVisible: boolean;
}

const SectionBlock: React.FC<SectionBlockProps> = ({
  section,
  transpose,
  targetKey,
  chordsVisible,
}) => {
  const sectionClass = `section section-${section.type}`;
  return (
    <div className={sectionClass}>
      {section.label && (
        <div className="section-label">{section.label}</div>
      )}
      {section.lines.map((line, li) => {
        const isEmpty = line.segments.length === 1 && !line.segments[0].chord && !line.segments[0].text.trim();
        if (isEmpty) return <div key={li} className="empty-line" />;

        return (
          <div key={li} className="song-line">
            {line.segments.map((seg, si) => (
              <span key={si} className="segment">
                {seg.chord && chordsVisible ? (
                  <ChordToken chord={transposeChord(seg.chord, transpose, targetKey)} />
                ) : (
                  <span
                    className={`chord-slot ${chordsVisible ? '' : 'chord-hidden'}`}
                    aria-hidden={!chordsVisible}
                  >
                    {seg.chord
                      ? transposeChord(seg.chord, transpose, targetKey)
                      : ' '}
                  </span>
                )}
                <span className="lyric">{seg.text || ' '}</span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
};

/** Chord label that reveals a guitar fingering diagram on hover / tap. */
const ChordToken: React.FC<{ chord: string }> = ({ chord }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const shape = useMemo(() => getChordShape(chord), [chord]);

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
