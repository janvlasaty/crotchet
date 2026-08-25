/**
 * Opening and closing a screen: the card that was tapped grows into the hero of
 * the screen it opens, and shrinks back into that same card on the way out.
 *
 * Both sides of a pair carry the same `data-morph-key` — `song:42`,
 * `artist:Mig 21`, `setlist:k3f`. The transition looks the key up in the DOM it
 * is leaving, then again in the DOM it has arrived in, and names whichever
 * element it finds. That makes one function do both directions: opening finds a
 * card and then a hero, closing finds the hero and then the card, and neither
 * caller has to know which of the two it is.
 *
 * Anything without a pair (a search result, a deep link, the back gesture) still
 * runs inside the transition and gets the plain cross-fade the root snapshot
 * animates by itself.
 */
import { flushSync } from 'react-dom';

/** Attribute pairing a card with the hero it opens. */
export const MORPH_ATTR = 'data-morph-key';

/** Carries `view-transition-name`, so only ever one element at a time. */
const MORPHING = 'morphing';

/**
 * On the root element for as long as a transition is running. Anything that
 * cannot survive being snapshotted — a backdrop filter, which has no page behind
 * it once the element is captured on its own — stands down under this class for
 * the length of the morph. See the `.morphing-page` rules in App.css.
 */
const MORPHING_PAGE = 'morphing-page';

interface ViewTransition {
  finished: Promise<void>;
  ready?: Promise<void>;
  updateCallbackDone?: Promise<void>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransition;
};

/** Key for a screen and the cards that open it. */
export const morphKey = {
  song: (id: string) => `song:${id}`,
  artist: (name: string) => `artist:${name}`,
  setlist: (id: string) => `setlist:${id}`,
};

/** Attribute spread onto a card or a hero: `<div {...morphPair(key)}>`. */
export const morphPair = (key: string) => ({ [MORPH_ATTR]: key });

function findMorphElement(key: string): HTMLElement | null {
  // Artist names are keys too, so the value has to survive quotes and slashes
  const value = key.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`[${MORPH_ATTR}="${value}"]`);
}

function markMorphElement(key: string | undefined): HTMLElement | null {
  if (!key) return null;
  const el = findMorphElement(key);
  el?.classList.add(MORPHING);
  return el;
}

/**
 * How long the arriving screen gets to put its hero on the page. A song's title
 * lives in its ChordPro and comes back from IndexedDB, so it is never there on
 * the frame the route changes — and a snapshot taken then catches a blank page
 * and morphs the card into nothing.
 */
const HERO_WAIT_MS = 300;

/**
 * Rendering is suspended while this waits, so the old screen stays on view.
 *
 * `from` is the element the outgoing screen was marked on, and the reason this
 * cannot simply look the key up: the card that was tapped carries it too, so a
 * plain lookup answers with the card still sitting in the page the navigation
 * has not yet left and the wait ends before there is anything to wait for. The
 * card going out of the document is what says the new screen is really here.
 */
async function waitForMorphTarget(key: string, from: HTMLElement | null): Promise<void> {
  const deadline = Date.now() + HERO_WAIT_MS;
  while (Date.now() < deadline) {
    const found = findMorphElement(key);
    if (found && found !== from && !from?.isConnected) return;
    // Timers, not rAF: frames are not being produced inside the update callback
    await new Promise(resolve => setTimeout(resolve, 16));
  }
}

function clearMorphing() {
  for (const el of document.querySelectorAll(`.${MORPHING}`)) el.classList.remove(MORPHING);
}

function endMorphingPage() {
  document.documentElement.classList.remove(MORPHING_PAGE);
}

/**
 * How long a screen gets to fetch what it needs before the transition starts.
 * The tap is still waiting here, so this is a ceiling and not a delay: a warm
 * song answers in a millisecond, and a cold database is cut off rather than
 * holding the tap.
 */
const PREPARE_MS = 250;

/** Resolves with `work`, or on its own once the wait has been long enough. */
function atMost(work: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([work, new Promise(resolve => setTimeout(resolve, ms))]);
}

/** The morph in flight, if there is one. Resolved when the page is at rest. */
let settled: Promise<void> = Promise.resolve();

/**
 * Resolves once no morph is running — immediately if none is.
 *
 * For an arriving screen's own animations. A screen mounts *inside* the
 * transition, where its real elements are stood in for by snapshots: anything it
 * animates there is either clipped to the box its snapshot was captured at or
 * over before the page is uncovered, and either way is never seen. Waiting for
 * this puts the animation after the morph, as a beat of the screen's own.
 */
export function morphSettled(): Promise<void> {
  return settled;
}

/**
 * Navigate with the morph. `run` must be the navigation itself and nothing else:
 * it is flushed synchronously inside the transition, which is what lets the
 * browser snapshot the screen before and after in one go.
 *
 * `prepare` is whatever the arriving screen needs in hand to render itself —
 * awaited before the transition opens, while the old screen is still on view, so
 * the screen the browser snapshots afterwards is the finished one.
 */
export async function morphNavigate(
  key: string | undefined,
  run: () => void,
  prepare?: () => Promise<unknown>
): Promise<void> {
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduced) {
    run();
    return;
  }

  if (prepare) await atMost(prepare(), PREPARE_MS);

  // Before the capture, not inside the callback: this has to be true of the page
  // the browser is about to snapshot, both sides of it.
  document.documentElement.classList.add(MORPHING_PAGE);

  const from = markMorphElement(key);
  const transition = doc.startViewTransition(async () => {
    flushSync(run);
    // The screen that just arrived: the other half of the pair, if it has one,
    // once it has had its moment to read what its hero says
    if (key) await waitForMorphTarget(key, from);
    // The card left behind can outlive its screen — a song opened from the song
    // screen's own recommendations is one. Two elements holding the name in the
    // same snapshot makes the browser drop the transition, so the outgoing one
    // is released now that it has been captured.
    clearMorphing();
    markMorphElement(key);
  });
  // The element left behind goes with its screen; this is for the one that came.
  // The blur comes back with it, and on rejection too — a transition the browser
  // gives up on must not leave the chrome flat for the rest of the session.
  const done = () => {
    clearMorphing();
    endMorphingPage();
  };
  settled = transition.finished.then(done, done);
  // A transition the browser skips — the page hidden, another one starting —
  // rejects these. Nothing here needs to know, but a rejection nobody reads
  // surfaces as an uncaught error in the console.
  const ignore = () => {};
  transition.ready?.catch(ignore);
  transition.updateCallbackDone?.catch(ignore);
}
