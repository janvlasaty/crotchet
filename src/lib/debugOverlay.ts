/**
 * TEMPORARY layout debugging aid — remove once the iOS bottom-of-screen issue
 * is settled. Paints a coloured border on every element (colour varies by
 * nesting depth) and pins a readout of the real viewport numbers to the middle
 * of the screen, so a single screenshot from the installed PWA shows both what
 * the layout is doing and whether iOS is letterboxing the window.
 */

import { viewportInfo } from './viewportInfo';

const HUES = [0, 30, 60, 120, 180, 210, 260, 300];

/**
 * `html > body > * > *` … one rule per depth, each a different hue.
 *
 * Outlines rather than borders: an outline draws outside the box model, so the
 * layout we are trying to measure stays exactly as it is unmarked.
 */
function outlineCss(depth: number): string {
  let selector = 'html';
  const rules: string[] = [
    // Ring the document edges too — a letterbox shows as black outside these.
    'html{outline:2px solid magenta!important;outline-offset:-2px}',
    'body{outline:2px solid cyan!important;outline-offset:-2px}',
  ];
  for (let i = 0; i < depth; i++) {
    selector += ' > *';
    const hue = HUES[i % HUES.length];
    rules.push(
      `${selector}{outline:1px solid hsl(${hue} 100% 55% / 0.9)!important;outline-offset:-1px}`,
    );
  }
  return rules.join('\n');
}

/** A red hairline at the window's bottom edge, and the safe-area band above it. */
function mountEdgeMarkers(): void {
  const edge = document.createElement('div');
  edge.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;height:3px;background:red;' +
    'z-index:99998;pointer-events:none';

  const band = document.createElement('div');
  band.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:99997;pointer-events:none;' +
    'height:env(safe-area-inset-bottom,0px);' +
    'background:repeating-linear-gradient(45deg,rgba(255,255,0,0.35) 0 6px,transparent 6px 12px)';

  document.body.append(band, edge);
}

export function mountDebugOverlay(): void {
  const style = document.createElement('style');
  style.id = 'debug-outline';
  style.textContent = outlineCss(14);
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'z-index:99999;pointer-events:none;' +
    'background:rgba(0,0,0,0.82);color:#0f0;border:1px solid #0f0;' +
    'font:11px/1.45 ui-monospace,Menlo,monospace;padding:8px 10px;' +
    'white-space:pre;text-align:left;border-radius:6px';

  const paint = () => {
    box.textContent = viewportInfo().lines.join('\n');
  };
  paint();
  document.body.appendChild(box);
  mountEdgeMarkers();

  window.addEventListener('resize', paint);
  window.addEventListener('orientationchange', paint);
  window.visualViewport?.addEventListener('resize', paint);
}
