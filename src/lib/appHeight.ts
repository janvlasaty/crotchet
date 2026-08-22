/**
 * Publishes the app shell's height as `--app-h`.
 *
 * An installed iOS PWA gets a window as tall as the screen — content draws under
 * the status bar — but on cold start iOS reports a *layout viewport* one
 * status-bar shorter: 762 on an 812pt iPhone 13 mini. Everything that sizes
 * against that short value (`inset: 0`, `bottom: 0`, `100%`, `100dvh`, `100svh`,
 * `window.innerHeight`) leaves a 50pt strip of screen unused at the bottom until
 * the device is rotated. Only `100vh` reports the true height right away.
 *
 * Measuring `100vh` here rather than relying on `@media (display-mode:
 * standalone)` in CSS: that query does not reliably match in an iOS home-screen
 * app, and picking the wrong branch is exactly the bug being fixed.
 *
 * In a browser tab the situation reverses — there `100vh` is the *large*
 * viewport, which extends behind Safari's collapsing toolbar — so the visible
 * height wins instead.
 */

/** Height a CSS length actually resolves to, measured against a real element. */
export function probeHeight(css: string): number {
  const el = document.createElement('div');
  el.style.cssText =
    `position:fixed;top:0;left:0;width:1px;height:${css};` +
    'visibility:hidden;pointer-events:none';
  document.body.appendChild(el);
  const h = Math.round(el.getBoundingClientRect().height);
  el.remove();
  return h;
}

/** True inside an iOS home-screen app or any installed standalone PWA. */
export function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

function apply(): void {
  const visible = window.innerHeight;
  // Trust the taller of the two only where there is no browser chrome that the
  // extra height could hide behind.
  const height = isStandalone() ? Math.max(probeHeight('100vh'), visible) : visible;
  document.documentElement.style.setProperty('--app-h', `${height}px`);
}

export function installAppHeight(): void {
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.visualViewport?.addEventListener('resize', apply);
}
