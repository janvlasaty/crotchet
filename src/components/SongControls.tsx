/**
 * Key, capo and tempo controls, shared by the meta-row popovers and the
 * settings dropdown. Both places render the same components, so a change to a
 * control lands in both at once. Rows are rigid: changing a value never moves a
 * button, whatever container the control sits in.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { playClick } from '../lib/audio';

/** Highest fret worth capoing on a guitar — past this the neck runs out. */
export const CAPO_MAX = 7;

/** Tempo steppers: 2 BPM a tap, within what anyone would actually play. */
export const TEMPO_STEP = 2;
export const TEMPO_MIN = 40;
export const TEMPO_MAX = 240;
export const TEMPO_FALLBACK = 120;

const clampTempo = (bpm: number) => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm));

/** Value flanked by steppers — the shape every control shares. */
interface StepperProps {
  value: React.ReactNode;
  /** Small line under the value; a reset when `onSub` is given. */
  sub: string;
  onSub?: () => void;
  subDisabled?: boolean;
  accent?: boolean;
  onDown: () => void;
  onUp: () => void;
  downDisabled?: boolean;
  upDisabled?: boolean;
  downLabel: string;
  upLabel: string;
}

const Stepper: React.FC<StepperProps> = ({
  value,
  sub,
  onSub,
  subDisabled,
  accent,
  onDown,
  onUp,
  downDisabled,
  upDisabled,
  downLabel,
  upLabel,
}) => (
  <div className="meta-step-row">
    <button className="meta-btn" onClick={onDown} disabled={downDisabled} aria-label={downLabel}>
      <Minus size={18} strokeWidth={2.5} />
    </button>
    <div className="meta-readout">
      <span className={`meta-value ${accent ? 'accent' : ''}`}>{value}</span>
      {onSub ? (
        <button className="meta-sub" onClick={onSub} disabled={subDisabled}>
          {sub}
        </button>
      ) : (
        <span className="meta-sub as-text">{sub}</span>
      )}
    </div>
    <button className="meta-btn" onClick={onUp} disabled={upDisabled} aria-label={upLabel}>
      <Plus size={18} strokeWidth={2.5} />
    </button>
  </div>
);

export const KeyControl: React.FC<{
  currentKey: string;
  transpose: number;
  onTranspose: (delta: number) => void;
}> = ({ currentKey, transpose, onTranspose }) => (
  <Stepper
    value={currentKey || '—'}
    accent
    sub={transpose === 0 ? 'původní' : `${transpose > 0 ? '+' : ''}${transpose} ✕`}
    onSub={() => onTranspose(-transpose)}
    subDisabled={transpose === 0}
    onDown={() => onTranspose(-1)}
    onUp={() => onTranspose(1)}
    downLabel="O půltón níž"
    upLabel="O půltón výš"
  />
);

export const CapoControl: React.FC<{
  capo: number | null;
  onCapoChange: (capo: number | null) => void;
}> = ({ capo, onCapoChange }) => (
  <Stepper
    value={capo ?? '—'}
    accent={!!capo}
    sub={capo ? 'pražec ✕' : 'bez capa'}
    onSub={() => onCapoChange(null)}
    subDisabled={!capo}
    onDown={() => onCapoChange(Math.max(0, (capo ?? 0) - 1) || null)}
    onUp={() => onCapoChange((capo ?? 0) + 1)}
    downDisabled={!capo}
    upDisabled={(capo ?? 0) >= CAPO_MAX}
    downLabel="Nižší pražec"
    upLabel="Vyšší pražec"
  />
);

/**
 * Steppers, a beat travelling along a line, tap tempo and an audible click.
 * The click itself is owned by the screen, so it keeps ticking after this panel
 * is dismissed.
 */
export const TempoControl: React.FC<{
  bpm: number | null;
  onSetTempo: (tempo: number) => void;
  audible: boolean;
  onToggleAudible: () => void;
}> = ({ bpm, onSetTempo, audible, onToggleAudible }) => {
  const { bpm: tapped, tap } = useTapTempo();

  useEffect(() => {
    if (tapped !== null) onSetTempo(tapped);
  }, [tapped, onSetTempo]);

  // One crossing per beat, so a full there-and-back is two beats
  const beatMs = bpm ? 60000 / bpm : null;

  return (
    <>
      <Stepper
        value={bpm ?? '—'}
        accent
        sub="BPM"
        onDown={() => onSetTempo(clampTempo((bpm ?? TEMPO_FALLBACK) - TEMPO_STEP))}
        onUp={() => onSetTempo(clampTempo((bpm ?? TEMPO_FALLBACK) + TEMPO_STEP))}
        downLabel="Pomalejší tempo"
        upLabel="Rychlejší tempo"
      />
      <div className="metronome-track">
        {beatMs && (
          <span
            className="metronome-dot"
            style={{ '--beat': `${beatMs}ms` } as React.CSSProperties}
          />
        )}
      </div>
      <div className="meta-btn-row">
        <button className="meta-btn tap-btn" onClick={tap}>TAP</button>
        <button
          className={`meta-btn narrow ${audible ? 'active' : ''}`}
          onClick={onToggleAudible}
          disabled={!bpm}
          aria-label={audible ? 'Ztlumit metronom' : 'Přehrát metronom'}
        >
          {audible ? <VolumeX size={18} strokeWidth={2.5} /> : <Volume2 size={18} strokeWidth={2.5} />}
        </button>
      </div>
    </>
  );
};

/** Average of the last few taps, in BPM. */
function useTapTempo() {
  const [taps, setTaps] = useState<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);

  const tap = useCallback(() => {
    playClick();
    const now = Date.now();
    setTaps(prev => {
      const next = [...prev, now].slice(-8);
      if (next.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < next.length; i++) intervals.push(next[i] - next[i - 1]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        setBpm(clampTempo(Math.round(60000 / avg)));
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setTaps([]);
    setBpm(null);
  }, []);

  return { bpm, tap, reset };
}
