/**
 * The top-right pill of icon actions, and the panel that unfolds out of it.
 *
 * Both screens that carry one work the same way: a row of icons in a pill
 * opposite the close button, an ellipsis at its end, and one panel surface that
 * grows out of the pill's own box when something is tapped. What differs is only
 * what the panel holds — a named menu of the same actions on a setlist, a
 * different set of dials per icon on a song — so that is what the caller
 * supplies, as a function of whichever key is open.
 *
 * The growth is pure CSS: the panel is laid out at full size and revealed by an
 * animated clip-path starting at `--morph-width`/`--morph-height`, which is the
 * pill's box measured here on the way in. Nothing reflows mid-morph and the
 * panel's height can stay `auto`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { morphSettled } from '../lib/morph';

/** The ellipsis's own key — it always opens a panel, never runs an action. */
export const MORE_KEY = 'more';

export interface PillAction<K extends string> {
  key: K;
  /** Lucide component; drawn at the pill's own 20px. */
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** aria-label, and the tooltip unless `title` says otherwise. */
  label: string;
  /** Tooltip, when it has more to say than the label — a live BPM, say. */
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Extra class on the button, for a state of its own (`ticking`). */
  className?: string;
  /**
   * Runs on tap instead of unfolding a panel. An action with one never becomes
   * the open key, so nothing asks the caller to render a panel for it.
   */
  run?: () => void;
}

interface ActionPillProps<K extends string> {
  actions: PillAction<K>[];
  /** aria-label for the pill as a group. */
  label: string;
  /** The page has scrolled: the actions fold away behind the ellipsis. */
  collapsed: boolean;
  /**
   * The ellipsis is the one that folds away, rather than what is left over —
   * for a pill whose actions are its whole content and so have nothing to stand
   * behind while they are all reachable. See `.top-actions.more-on-fold`.
   */
  moreOnFold?: boolean;
  /** Something is still running behind the fold: the ellipsis wears a dot. */
  hasRunning?: boolean;
  /** aria-label and tooltip for the ellipsis. */
  moreLabel?: string;
  /** aria-label for the panel, per key. */
  panelLabel?: (key: K | typeof MORE_KEY) => string;
  /** The open panel's content. `close` folds it back into the pill. */
  children: (key: K | typeof MORE_KEY, close: () => void) => React.ReactNode;
}

/** Fallback box, for the impossible frame where the pill is not on the page. */
const FALLBACK_ORIGIN = { width: 200, height: 56 };

export function ActionPill<K extends string>({
  actions,
  label,
  collapsed,
  moreOnFold = false,
  hasRunning = false,
  moreLabel = 'Další',
  panelLabel,
  children,
}: ActionPillProps<K>) {
  type Key = K | typeof MORE_KEY;
  /**
   * Which panel was unfolded, and the box it grew out of. The key outlives
   * `open` so the content is still there to animate shut.
   */
  const [active, setActive] = useState<Key | null>(null);
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN);
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  /**
   * The pill arrives folded and unfolds a beat after the screen has landed —
   * the same movement, and the same 260ms, as when the page is scrolled back to
   * the top (see `.top-action`'s width transition). Folded it is the circle the
   * corner it grew out of already was, so the morph carries a circle across to
   * this corner and the unfold is a beat of its own, after it.
   *
   * It cannot begin any earlier and still be seen: the pill is named, so it is
   * captured, and its snapshot is drawn in the box it was captured as — an
   * unfold inside that folded circle is clipped away to nothing. Leaving it
   * unnamed to escape that costs the travel, which is the better half of the
   * movement, so the unfold waits.
   */
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => {
    let live = true;
    let frame = 0;
    morphSettled().then(() => {
      // A frame after the morph, so the folded pill has been painted once and
      // there is a width for the unfold to run from.
      frame = requestAnimationFrame(() => live && setUnfolded(true));
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  /**
   * Tapping the icon whose panel is already unfolded folds it back; any other
   * one swaps the content. Growth starts from the pill's box rather than the
   * icon's, so the panel is the pill's own shape for its first frame however
   * wide the pill happens to be.
   */
  const toggle = useCallback((key: Key) => {
    if (open && active === key) {
      setOpen(false);
      return;
    }
    const box = pillRef.current?.getBoundingClientRect();
    setOrigin({
      width: box?.width ?? FALLBACK_ORIGIN.width,
      height: box?.height ?? FALLBACK_ORIGIN.height,
    });
    setActive(key);
    setOpen(true);
  }, [active, open]);

  /** Only a panel that is actually unfolded lights up its icon. */
  const openKey = open ? active : null;
  /** Scrolled shut, or not yet unfolded on arrival — the same shape either way. */
  const folded = collapsed || !unfolded;
  const morphVars = {
    '--morph-width': `${origin.width}px`,
    '--morph-height': `${origin.height}px`,
  } as React.CSSProperties;

  return (
    <>
      <div
        ref={pillRef}
        className={`top-actions ${moreOnFold ? 'more-on-fold' : ''} ${
          folded ? 'collapsed' : ''
        } ${hasRunning ? 'has-running' : ''} ${open ? 'morphed' : ''}`}
        style={morphVars}
        role="group"
        aria-label={label}
      >
        {actions.map(a => (
          <button
            key={a.key}
            className={`top-action ${openKey === a.key ? 'open' : ''} ${
              a.danger ? 'danger' : ''
            } ${a.className ?? ''}`}
            tabIndex={folded ? -1 : 0}
            onClick={() => (a.run ? a.run() : toggle(a.key))}
            disabled={a.disabled}
            title={a.title ?? a.label}
            aria-label={a.label}
            aria-expanded={a.run ? undefined : openKey === a.key}
          >
            <a.icon size={20} strokeWidth={2.5} />
          </button>
        ))}
        {/*
          Last in the pill, and it has to stay last: the fold's cross-fade puts
          it on top of `:nth-last-child(2)` — see .top-actions.more-on-fold.
        */}
        <button
          className={`top-action top-action-more ${openKey === MORE_KEY ? 'open' : ''}`}
          // Folded out of the way while the actions themselves are reachable
          tabIndex={moreOnFold && !folded ? -1 : 0}
          onClick={() => toggle(MORE_KEY)}
          title={moreLabel}
          aria-label={moreLabel}
          aria-expanded={openKey === MORE_KEY}
        >
          <Ellipsis size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* Tapping anywhere else folds the panel back into the pill */}
      {open && <div className="tool-dismiss" onClick={close} />}

      <div
        className={`tool-panel ${open ? 'open' : ''}`}
        role="dialog"
        aria-label={active && panelLabel ? panelLabel(active) : label}
        aria-hidden={!open}
        // A folded panel is still in the page so it can animate shut; `inert`
        // keeps everything inside it out of the tab order meanwhile, so no
        // caller has to guard its own controls.
        inert={!open}
        style={morphVars}
      >
        {active && children(active, close)}
      </div>
    </>
  );
}
