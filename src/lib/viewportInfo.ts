/**
 * Viewport diagnostics for the installed iOS PWA.
 *
 * There is no way to inspect a home-screen web app from the desktop, so the
 * numbers that decide whether iOS is letterboxing the window have to be read
 * on the device itself. Two very different faults look the same from the
 * outside ("the app does not reach the bottom of the screen"):
 *
 *   - iOS letterboxes the web app: the insets come back as 0 and innerHeight
 *     is well short of screen.height.
 *   - Our own layout leaves a gap: innerHeight matches screen.height and the
 *     bottom inset is the real home-indicator value (34px on most iPhones).
 */

/** Reads the four `env(safe-area-inset-*)` values as they resolve right now. */
export function readInsets(): { t: number; r: number; b: number; l: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'top:0;left:0;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const insets = {
    t: parseFloat(s.paddingTop) || 0,
    r: parseFloat(s.paddingRight) || 0,
    b: parseFloat(s.paddingBottom) || 0,
    l: parseFloat(s.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

/**
 * Height a given CSS length actually resolves to, right now.
 *
 * The viewport units are the interesting part: if iOS has handed us a stale
 * `innerHeight` on cold start, `100vh` / `100lvh` can still resolve to the real
 * screen height, which would mean the missing strip is ours to claim after all.
 */
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

/** Resolved value of a custom property on the root element. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '?';
}

export interface ViewportInfo {
  lines: string[];
  /** True when the window is measurably shorter than the screen it sits on. */
  letterboxed: boolean;
}

export function viewportInfo(): ViewportInfo {
  const i = readInsets();
  const vv = window.visualViewport;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS-only flag, still the more reliable of the two inside a home-screen app
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  // Portrait screen height in CSS px; iOS reports screen.* unrotated on iPhone.
  const screenH = Math.max(window.screen.height, window.screen.width);
  // A letterboxed web app loses ~2×40px of chrome-free screen and reports no
  // insets; a few px of slack keeps rounding from tripping the check.
  const letterboxed = standalone && i.b === 0 && screenH - window.innerHeight > 20;

  return {
    letterboxed,
    lines: [
      `win ${window.innerWidth}×${window.innerHeight}`,
      `screen ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}`,
      vv ? `visual ${Math.round(vv.width)}×${Math.round(vv.height)} off ${Math.round(vv.offsetTop)}` : 'visual n/a',
      `inset t${i.t} r${i.r} b${i.b} l${i.l}`,
      `vh ${probeHeight('100vh')} lvh ${probeHeight('100lvh')}`,
      `dvh ${probeHeight('100dvh')} svh ${probeHeight('100svh')}`,
      `clientH ${document.documentElement.clientHeight} rootH ${Math.round(
        document.getElementById('root')?.getBoundingClientRect().height ?? 0,
      )}`,
      `--sat ${cssVar('--sat')} --sab ${cssVar('--sab')}`,
      `short by ${Math.max(0, screenH - window.innerHeight)}`,
      `standalone ${standalone ? 'yes' : 'no'}`,
      letterboxed ? 'LETTERBOXED' : 'full height',
    ],
  };
}
