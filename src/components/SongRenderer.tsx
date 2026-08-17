import React from 'react';
import type { ParseResult, Section as SectionType } from '../types';
import { transposeChord } from '../lib/transpose';

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
                <span
                  className={`chord-slot ${chordsVisible ? '' : 'chord-hidden'}`}
                  aria-hidden={!chordsVisible}
                >
                  {seg.chord
                    ? transposeChord(seg.chord, transpose, targetKey)
                    : '\u00A0'}
                </span>
                <span className="lyric">{seg.text || '\u00A0'}</span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
};
