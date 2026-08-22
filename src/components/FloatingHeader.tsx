import React, { useCallback, useRef, useState } from 'react';

/**
 * Reveal state for a FloatingHeader: the compact centered title shows only once
 * the page's hero heading has scrolled up behind the scrim.
 *
 * Put `heroRef` on the hero element inside the scroller, `scrimRef` on the
 * header, and call `updateReveal` from the scroller's onScroll.
 */
export function useHeaderReveal() {
  const [revealed, setRevealed] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  const updateReveal = useCallback((scroller: HTMLElement) => {
    const hero = heroRef.current;
    const scrimBottom = scrimRef.current?.getBoundingClientRect().bottom ?? 76;
    setRevealed(hero ? hero.getBoundingClientRect().bottom < scrimBottom : scroller.scrollTop > 36);
  }, []);

  return { revealed, setRevealed, heroRef, scrimRef, updateReveal };
}

interface FloatingHeaderProps {
  /** Compact title, revealed once the hero has scrolled away */
  title: string;
  /** Small muted line under the title (e.g. the artist) */
  subtitle?: string;
  /** Trailing detail next to the title, accent-coloured (e.g. the current key) */
  accessory?: React.ReactNode;
  /** Glyph for the circular button on the left */
  icon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  revealed: boolean;
  onTitleClick?: () => void;
  scrimRef?: React.Ref<HTMLDivElement>;
}

/** Circular action button + revealing centered title over a top-edge scrim. */
export const FloatingHeader: React.FC<FloatingHeaderProps> = ({
  title,
  subtitle,
  accessory,
  icon,
  actionLabel,
  onAction,
  revealed,
  onTitleClick,
  scrimRef,
}) => (
  <>
    {/* Content scrolling up fades out into black behind the header */}
    <div className="floating-scrim" ref={scrimRef} />

    <button className="back-btn-floating" onClick={onAction} aria-label={actionLabel}>
      {icon}
    </button>

    <div className={`floating-title ${revealed ? 'visible' : ''}`} onClick={onTitleClick}>
      <span className="floating-title-text">
        <span className="floating-title-name">{title}</span>
        {subtitle && <span className="floating-title-sub">{subtitle}</span>}
      </span>
      {accessory && <span className="floating-title-accessory">{accessory}</span>}
    </div>
  </>
);
