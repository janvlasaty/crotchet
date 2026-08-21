import React from 'react';
import type { ChordShape } from '../lib/chordShapes';

const STRINGS = 6;
const FRETS = 4; // visible fret window

interface ChordDiagramProps {
  shape: ChordShape;
  /** Label above the grid; defaults to the shape's resolved name. */
  label?: string;
}

/** Small guitar chord grid. Left-most string is the low E. */
export const ChordDiagram: React.FC<ChordDiagramProps> = ({ shape, label }) => {
  const played = shape.frets.filter((f): f is number => f !== null && f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const maxFret = played.length ? Math.max(...played) : 1;
  // Window starts at fret 1 unless the shape sits higher up the neck.
  const start = maxFret <= FRETS ? 1 : Math.max(1, minFret);

  const w = 68;
  const padX = 9;
  const top = 28;
  const gridH = 56;
  const stringGap = (w - padX * 2) / (STRINGS - 1);
  const fretGap = gridH / FRETS;
  const x = (s: number) => padX + s * stringGap;
  const y = (fretOffset: number) => top + fretOffset * fretGap;

  return (
    <svg
      className="chord-diagram"
      viewBox={`0 0 ${w} ${top + gridH + 8}`}
      width={w}
      height={top + gridH + 8}
      role="img"
      aria-label={`Akord ${label ?? shape.name}`}
    >
      <text className="cd-name" x={w / 2} y={10} textAnchor="middle">
        {label ?? shape.name}
      </text>

      {/* nut or fret-position marker */}
      {start === 1 ? (
        <rect x={padX - 1} y={top - 2.5} width={w - padX * 2 + 2} height={2.5} className="cd-nut" />
      ) : (
        <text className="cd-pos" x={padX - 4} y={y(0.75)} textAnchor="end">
          {start}
        </text>
      )}

      {/* frets */}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line key={`f${i}`} x1={padX} y1={y(i)} x2={w - padX} y2={y(i)} className="cd-line" />
      ))}
      {/* strings */}
      {Array.from({ length: STRINGS }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} y1={y(0)} x2={x(s)} y2={y(FRETS)} className="cd-line" />
      ))}

      {/* barre */}
      {shape.barre !== undefined && shape.barre >= start && shape.barre < start + FRETS && (() => {
        const strs = shape.frets
          .map((f, s) => (f === shape.barre ? s : -1))
          .filter(s => s >= 0);
        if (strs.length < 2) return null;
        const from = Math.min(...strs);
        const to = Math.max(...strs);
        return (
          <rect
            x={x(from) - 3.5}
            y={y(shape.barre - start + 0.5) - 3.5}
            width={x(to) - x(from) + 7}
            height={7}
            rx={3.5}
            className="cd-dot"
          />
        );
      })()}

      {/* dots, open and muted markers */}
      {shape.frets.map((f, s) => {
        if (f === null) {
          return (
            <g key={s} className="cd-mute">
              <line x1={x(s) - 3} y1={top - 13} x2={x(s) + 3} y2={top - 7} />
              <line x1={x(s) + 3} y1={top - 13} x2={x(s) - 3} y2={top - 7} />
            </g>
          );
        }
        if (f === 0) {
          return <circle key={s} cx={x(s)} cy={top - 10} r={3} className="cd-open" />;
        }
        const offset = f - start + 0.5;
        if (offset < 0 || offset > FRETS) return null;
        return <circle key={s} cx={x(s)} cy={y(offset)} r={4} className="cd-dot" />;
      })}
    </svg>
  );
};
