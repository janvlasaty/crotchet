/**
 * Leaving a screen by the chevron in its header.
 *
 * This is an *up* button and not a back button: it climbs the hierarchy — song
 * to artist to home — and is allowed to disagree with history. That is the whole
 * point. Ten recommendations deep the song belongs to nobody on screen, and back
 * would return to an artist the music left behind long ago; up goes home, which
 * is where a song with no parent actually sits.
 *
 * `origin` is that parent, as the caller understands it: a path to climb to, or
 * `null` for "no parent left, go home".
 *
 * Climbing by `-1` rather than navigating to the same path is deliberate — only
 * `-1` restores the parent's scroll position, which is the difference between
 * returning to a long artist list where you left it and returning to its top.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { morphNavigate } from '../lib/morph';

/** Position in the history stack; 0 means nothing was pushed before this. */
function historyIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

/**
 * @param morph  key of the hero to shrink back into the card that opened it
 * @param origin path of this screen's parent, or null for home
 */
export function useCloseScreen(morph: string | undefined, origin: string | null) {
  const navigate = useNavigate();

  return useCallback(() => {
    morphNavigate(morph, () => {
      // The origin is always the previous entry when there is one: the screens
      // that push into a song leave their name in the URL, and the hops that
      // replace it never touch what sits behind.
      if (origin && historyIndex() > 0) navigate(-1);
      else navigate(origin ?? '/', { replace: true });
    });
  }, [navigate, morph, origin]);
}
