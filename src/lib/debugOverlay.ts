/**
 * TEMPORARY layout probe — remove once the iOS viewport-height issue is settled.
 *
 * The question it has to answer is exactly one thing: where does our window sit
 * on the physical screen? `window.innerHeight` reports 762 on an 812pt phone,
 * and the 50pt difference is either above us (iOS placed the window below an
 * opaque status bar) or below us (the window starts at the top and something
 * withholds a strip at the bottom). Those two cases need opposite fixes, and
 * element outlines made the screen too busy to tell them apart.
 *
 * So: draw one bright line flush against each edge of the window, and nothing
 * else. Whatever black remains beyond a line is outside our window.
 *   - lime line hidden behind the clock  → window starts at screen top
 *   - lime line below the status bar     → iOS inset us from the top
 *   - black below the red line           → a strip is withheld at the bottom
 *   - red line at the screen's edge      → we already own the full height
 */

import { viewportInfo } from './viewportInfo';

function edge(side: 'top' | 'bottom', color: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    `position:fixed;left:0;right:0;${side}:0;height:4px;background:${color};` +
    'z-index:99999;pointer-events:none';

  const tag = document.createElement('div');
  tag.textContent = label;
  tag.style.cssText =
    `position:absolute;${side === 'top' ? 'top:6px' : 'bottom:6px'};right:6px;` +
    `color:${color};font:bold 11px ui-monospace,Menlo,monospace;` +
    'background:#000;padding:1px 4px;border-radius:3px';
  el.appendChild(tag);
  return el;
}

export function mountDebugOverlay(): void {
  // The safe-area band, read straight from env() rather than from our corrected
  // --sab, so the probe shows what iOS claims and not what we did about it.
  const band = document.createElement('div');
  band.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:99997;pointer-events:none;' +
    'height:env(safe-area-inset-bottom,0px);' +
    'background:repeating-linear-gradient(45deg,rgba(255,255,0,0.5) 0 6px,transparent 6px 12px)';

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'z-index:99999;pointer-events:none;' +
    'background:rgba(0,0,0,0.85);color:#0f0;border:1px solid #0f0;' +
    'font:11px/1.45 ui-monospace,Menlo,monospace;padding:8px 10px;' +
    'white-space:pre;text-align:left;border-radius:6px';

  const paint = () => {
    box.textContent = viewportInfo().lines.join('\n');
  };
  paint();

  document.body.append(
    band,
    edge('top', '#00ff66', 'WIN TOP'),
    edge('bottom', '#ff2222', 'WIN BOTTOM'),
    box,
  );

  window.addEventListener('resize', paint);
  window.addEventListener('orientationchange', paint);
  window.visualViewport?.addEventListener('resize', paint);
}
