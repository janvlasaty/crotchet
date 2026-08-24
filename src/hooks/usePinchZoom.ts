/**
 * Pinch to resize the lyrics.
 *
 * The gesture itself is continuous — the text tracks the fingers rather than
 * jumping a tenth at a time — and only what it settles on is snapped onto the
 * same grid as the ± buttons in the settings panel and persisted. So a pinch
 * reads as one smooth movement, yet can never leave the size between two stops
 * where a later tap would jump.
 *
 * Two sources feed it: a two-finger pinch on a touch screen, and ctrl+wheel,
 * which is what a trackpad pinch reports. Both are prevented from reaching the
 * browser, whose own page zoom would fight a layout pinned to the window. The
 * live size is read through a ref, so re-rendering never re-attaches the
 * listeners mid-pinch.
 */
import { useEffect, useRef, useState } from 'react';

interface PinchRange {
  min: number;
  max: number;
  step: number;
}

interface PinchZoom {
  /** Size to render: continuous while pinching, the committed value otherwise. */
  scale: number;
  /** True mid-gesture — the caller drops its font-size transition while it is. */
  pinching: boolean;
}

/** A trackpad pinch arrives as ctrl+wheel; this maps its delta to a factor. */
const WHEEL_SENSITIVITY = 100;

/** A ctrl+wheel burst with no end event: this much quiet ends the gesture. */
const WHEEL_IDLE_MS = 220;

const distance = (touches: TouchList) => {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
};

export function usePinchZoom(
  target: React.RefObject<HTMLElement | null>,
  scale: number,
  onScale: (scale: number) => void,
  { min, max, step }: PinchRange,
  /** False until the target is on the page — the effect re-runs when it lands. */
  enabled = true,
): PinchZoom {
  /** Continuous size while a gesture is live; null when none is. */
  const [live, setLive] = useState<number | null>(null);

  // Read through refs: the effect must not tear down on every frame
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;

  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;

    const clamp = (v: number) => Math.min(max, Math.max(min, v));
    /** Nearest stop on the button grid, to two decimals like the steppers. */
    const snap = (v: number) => {
      const stops = Math.round((clamp(v) - min) / step);
      return clamp(Math.round((min + stops * step) * 100) / 100);
    };

    /** Where the fingers are now, and the frame that will paint it. */
    let pending: number | null = null;
    let frame: number | null = null;

    /**
     * One reflow a frame at most. Resizing text relayouts the whole song, so a
     * touchmove stream straight into state would queue up work it cannot keep
     * up with and the gesture would lag behind the fingers.
     */
    const show = (v: number) => {
      pending = clamp(v);
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (pending !== null) setLive(pending);
      });
    };

    /** Gesture over: settle on a stop, hand it back, stop overriding the size. */
    const commit = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const settled = pending;
      pending = null;
      setLive(null);
      if (settled === null) return;
      const next = snap(settled);
      if (next !== scaleRef.current) onScaleRef.current(next);
    };

    /** Finger spread the pinch started at, and the size it started from. */
    let startDistance: number | null = null;
    let startScale = 1;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDistance = distance(e.touches);
      startScale = scaleRef.current;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startDistance === null || e.touches.length !== 2) return;
      // Ours, not the browser's — this also holds the scroll still
      e.preventDefault();
      show(startScale * (distance(e.touches) / startDistance));
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2 || startDistance === null) return;
      startDistance = null;
      commit();
    };

    let wheelIdle: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // A fresh burst picks up wherever the buttons left the size
      if (wheelIdle === null) pending = scaleRef.current;
      else clearTimeout(wheelIdle);
      show((pending ?? scaleRef.current) * Math.exp(-e.deltaY / WHEEL_SENSITIVITY));
      wheelIdle = setTimeout(() => {
        wheelIdle = null;
        commit();
      }, WHEEL_IDLE_MS);
    };

    /** Safari zooms the page on pinch even under user-scalable=no. */
    const onGesture = (e: Event) => e.preventDefault();

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGesture);
    el.addEventListener('gesturechange', onGesture);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (wheelIdle !== null) clearTimeout(wheelIdle);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
    };
  }, [target, min, max, step, enabled]);

  return { scale: live ?? scale, pinching: live !== null };
}
