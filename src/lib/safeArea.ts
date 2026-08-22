/**
 * Corrects `--sat` for iOS home-screen web apps.
 *
 * With `apple-mobile-web-app-status-bar-style: black-translucent` the window is
 * meant to span the whole screen, with `env(safe-area-inset-top)` telling us how
 * much of it the status bar covers. Current iOS does not honour that in a
 * standalone web app: the window it hands us already starts *below* the status
 * bar (innerHeight === screen height − status bar), yet the inset still reports
 * the status bar height. Padding by the raw inset therefore reserves the same
 * 50-odd pixels twice and shrinks the usable page by that much.
 *
 * So subtract whatever iOS already took off the top. Where the window really is
 * full-screen (correct `viewport-fit=cover` behaviour, or any browser tab) there
 * is nothing to subtract and the raw inset survives untouched.
 */

import { readInsets } from './viewportInfo';

/** True inside an iOS home-screen app or any installed standalone PWA. */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function apply(): void {
  const root = document.documentElement;

  // Outside a standalone window the browser's own chrome accounts for the
  // difference, so there is nothing to correct — hand `--sat` back to CSS.
  if (!isStandalone()) {
    root.style.removeProperty('--sat');
    return;
  }

  const insetTop = readInsets().t;
  // The app is portrait-locked; screen.* is reported unrotated on iPhone.
  const screenHeight = Math.max(window.screen.height, window.screen.width);
  const takenByChrome = Math.max(0, screenHeight - window.innerHeight);

  root.style.setProperty('--sat', `${Math.max(0, insetTop - takenByChrome)}px`);
}

export function installSafeAreaFix(): void {
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}
