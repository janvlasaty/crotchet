/**
 * Publishes the on-screen keyboard's height as `--kb`.
 *
 * iOS does not shrink the layout viewport when the keyboard opens — it only
 * shrinks the *visual* viewport and slides the page. In a fixed shell like this
 * one nothing reflows at all, so anything anchored with `bottom: 0` stays put
 * and ends up behind the keyboard, search field included.
 *
 * `visualViewport` is the only place the keyboard's height shows up, so read it
 * from there and let CSS subtract it. Zero whenever the keyboard is closed, so
 * `calc(16px + var(--kb))` is safe to write unconditionally.
 */

/** Keyboard height in CSS px, or 0 when it is closed. */
function keyboardHeight(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // offsetTop covers the case where iOS slides the page up instead of, or as
  // well as, shrinking the visual viewport.
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function installKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;

  let frame = 0;
  const update = () => {
    // The viewport fires a burst of events through the keyboard animation;
    // one write per frame is enough to keep up without thrashing layout.
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      document.documentElement.style.setProperty('--kb', `${keyboardHeight()}px`);
    });
  };

  update();
  vv.addEventListener('resize', update);
  // iOS reports keyboard-driven page shifts as visual-viewport scrolls.
  vv.addEventListener('scroll', update);
}
