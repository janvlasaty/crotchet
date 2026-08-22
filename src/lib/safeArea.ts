/**
 * Corrects `--sab` for iOS home-screen web apps.
 *
 * iOS hands a standalone web app a window that starts at the very top of the
 * screen (page content really does render under the status bar) but is one
 * status-bar height shorter than the screen — 762pt on an 812pt phone. The
 * missing strip sits at the bottom, outside the window, and no CSS can paint
 * into it. That strip is also where the home indicator lives.
 *
 * `env(safe-area-inset-bottom)` still reports its usual 34pt, so padding by it
 * clears the home indicator a second time and leaves a visibly dead gap above
 * the app's own bottom edge. Subtract the strip iOS already withheld.
 *
 * Where the window really is full-screen — correct `viewport-fit=cover`
 * behaviour, or any browser tab, where the difference is the browser's own
 * chrome — there is nothing to subtract and the raw inset survives untouched.
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

  // In a browser tab the shortfall is address/toolbar chrome, not a dead strip.
  if (!isStandalone()) {
    root.style.removeProperty('--sab');
    return;
  }

  const insetBottom = readInsets().b;
  // The app is portrait-locked; screen.* is reported unrotated on iPhone.
  const screenHeight = Math.max(window.screen.height, window.screen.width);
  const withheld = Math.max(0, screenHeight - window.innerHeight);

  root.style.setProperty('--sab', `${Math.max(0, insetBottom - withheld)}px`);
}

export function installSafeAreaFix(): void {
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}
