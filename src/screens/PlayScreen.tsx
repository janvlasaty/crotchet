import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getSong,
  getSongPrefs,
  saveSongPrefs,
  recordPlay,
  getAllSongs,
  getRecentPlays,
  saveAppSettings,
  getAppSettings,
  getSetlist,
} from '../lib/db';
import { parseChordPro, extractChords } from '../lib/parser';
import { transposeKey, transposeChord } from '../lib/transpose';
import { playReferenceTone, playClick, Metronome } from '../lib/audio';
import { SongRenderer } from '../components/SongRenderer';
import { FloatingHeader, useHeaderReveal } from '../components/FloatingHeader';
import { SearchFab } from '../components/SearchFab';
import { useWakeLock } from '../hooks/useWakeLock';
import { usePinchZoom } from '../hooks/usePinchZoom';
import {
  X,
  Play,
  Pause,
  ChevronRight,
  ChevronDown,
  Minus,
  Plus,
  Guitar,
  // `Metronome` here would collide with the audio clock of the same name
  Metronome as MetronomeIcon,
  Music,
  Ellipsis,
} from 'lucide-react';
import { CHORD_COLORS } from '../lib/chordColors';
import {
  KeyControl,
  CapoControl,
  TempoControl,
  FontControl,
  FONT_MIN,
  FONT_MAX,
  FONT_STEP,
} from '../components/SongControls';
import type { Song, SongPrefs, ParseResult, ChordMode, Setlist } from '../types';

/** Up-next rows shown before the rest of the setlist has to be asked for. */
const QUEUE_PREVIEW = 5;

/**
 * Autoscroll advances three lyric rows a tick, which is also what the dot
 * ladder on the right edge counts. The ratio matches .song-content's
 * line-height, and the scale is the one the lyrics are actually rendered at —
 * bigger text means taller rows, so it means longer steps and fewer of them.
 */
const LINE_HEIGHT = 1.4;
const ROWS_PER_JUMP = 3;

/** One autoscroll step, in px. */
function scrollJumpPx(el: HTMLElement, fontScale: number): number {
  const base = parseFloat(getComputedStyle(el).fontSize) || 16;
  return Math.max(1, Math.round(base * fontScale * LINE_HEIGHT * ROWS_PER_JUMP));
}

/** How long the dot ladder takes to fade away once autoscroll stops. */
const LADDER_FADE_MS = 320;

/** Autoscroll pace dial: 15% per tap of minus/plus, half to double speed. */
const SPEED_STEP = 0.15;
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const clampSpeed = (s: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, s));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The pill's four panels. Each one unfolds from its own icon, so what used to be
 * three chip popovers plus a settings sheet is now one surface with one origin.
 */
type ToolMenu = 'key' | 'tempo' | 'tone' | 'more';

/**
 * The pill's own box, which the panel grows out of. The panel is bigger in both
 * directions and shares the pill's corner, so the morph is pure growth — the
 * shape never has to shrink first to become the box.
 */
interface MorphOrigin {
  width: number;
  height: number;
}

const TOOL_TITLE: Record<ToolMenu, string> = {
  key: 'Tónina a capo',
  tempo: 'Tempo',
  tone: 'Referenční tóny',
  more: 'Nastavení',
};

/** Key implied by a chord: its root, minor only for plain m/min qualities. */
function keyFromChord(chord: string | undefined): string {
  if (!chord) return '';
  const match = /^([A-H][#b]?)(.*)$/.exec(chord.split('/')[0]);
  if (!match) return '';
  const [, rawRoot, rest] = match;
  // Czech H is B, as elsewhere in the app — keeps transposeKey able to parse it
  const root = rawRoot[0] === 'H' ? `B${rawRoot.slice(1)}` : rawRoot;
  const minor = /^(m|min)(?!aj)/.test(rest);
  return minor ? `${root}m` : root;
}

export const PlayScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /** Set while playing through a setlist: the queue replaces the suggestions. */
  const setlistId = searchParams.get('setlist');
  const [setlist, setSetlist] = useState<Setlist | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [prefs, setPrefs] = useState<SongPrefs | null>(null);
  /**
   * Which tool panel the pill has unfolded, and the icon it grew out of. The
   * name outlives `toolOpen` so the content is still there to animate shut.
   */
  const [tool, setTool] = useState<{ name: ToolMenu; origin: MorphOrigin } | null>(null);
  const [toolOpen, setToolOpen] = useState(false);
  const [chordColor, setChordColor] = useState(() => getAppSettings().chordColor);
  /** Audible click, owned here so it survives the panel being dismissed. */
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  /** Autoscroll ran to the end on its own — worth marking on the button. */
  const [justFinished, setJustFinished] = useState(false);
  const [songEnded, setSongEnded] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const [library, setLibrary] = useState<Song[]>([]);
  const [playedIds, setPlayedIds] = useState<Set<string>>(new Set());
  const [scrollProgress, setScrollProgress] = useState(0);
  /** Autoscroll steps left to the end — one dot each on the ladder, plus one. */
  const [scrollShifts, setScrollShifts] = useState(0);
  /** One of those steps as a fraction of the scrollable distance. */
  const [scrollStep, setScrollStep] = useState(0);
  /**
   * Where the travelling dot is heading and how long it has to get there. The
   * page moves in jumps, so the dot cannot be driven by the scroll position or
   * it would jump too; instead it is aimed at the stop the *next* jump will
   * land on, over exactly one interval, and so crawls there at a steady rate.
   */
  const [cursor, setCursor] = useState({ progress: 0, ms: 0 });
  /**
   * Outlives autoScrolling by the length of the fade, so the ladder can be
   * animated out instead of disappearing. Unmounting after it keeps the dots
   * off the page — and their re-render off every manual scroll event — while
   * the ladder is not wanted, and makes the next start a fresh mount that
   * paints straight at the planted position.
   */
  const [ladderShown, setLadderShown] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  /**
   * Where the last autoscroll tick left the page, in px, or null while nothing
   * is driving it. Any scroll that ends up further than one step from here was
   * not ordered by a tick — a fling, a pinch reflow, a jump to the top — and the
   * travelling dot has to be re-planted rather than crawl over from a stop the
   * reader has already left.
   */
  const expectedTopRef = useRef<number | null>(null);
  /** autoScrolling readable from the scroll handler without re-binding it. */
  const autoScrollingRef = useRef(false);
  const { revealed, setRevealed, heroRef, scrimRef, updateReveal } = useHeaderReveal();
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Measured on open: the shape the tool panel grows out of. */
  const pillRef = useRef<HTMLDivElement>(null);
  /** The size the lyrics are on screen right now, pinch included. */
  const fontScaleRef = useRef(1);

  /**
   * How many autoscroll steps still separate the top from the end. Read from
   * the laid-out page rather than the source, so the chord mode, the recommended
   * songs appearing and the font size all count without being tracked.
   */
  const measureShifts = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight;
    if (distance <= 0) {
      setScrollShifts(0);
      setScrollStep(0);
      return;
    }
    // Both numbers, so the ladder can place a dot where a step actually lands
    // instead of spacing them evenly. The last step is nearly always a partial
    // one, and dividing the strip into equal parts made every dot after the
    // first sit a little short of its step — a gap that compounds downwards.
    const jump = scrollJumpPx(el, fontScaleRef.current);
    setScrollShifts(Math.ceil(distance / jump));
    setScrollStep(jump / distance);
  }, []);

  useEffect(() => {
    autoScrollingRef.current = autoScrolling;
  }, [autoScrolling]);

  /** Put the travelling dot exactly where the page stands, with no crawl. */
  const plantCursor = useCallback(() => {
    const el = contentRef.current;
    const distance = el ? el.scrollHeight - el.clientHeight : 0;
    setCursor({ progress: el && distance > 0 ? el.scrollTop / distance : 0, ms: 0 });
    expectedTopRef.current = el ? el.scrollTop : null;
  }, []);

  useWakeLock();

  useEffect(() => {
    if (!id) return;
    // Switching songs (e.g. from the recommendations) starts fresh at the top
    setSongEnded(false);
    setAtBottom(false);
    setQueueExpanded(false);
    setJustFinished(false);
    setScrollProgress(0);
    setRevealed(false);
    contentRef.current?.scrollTo({ top: 0 });
    // Prefs come second: a fresh row seeds its capo from the song's {capo}
    getSong(id).then(async s => {
      if (!s) return;
      const p = await getSongPrefs(id, parseChordPro(s.chordpro).capo);
      setSong(s);
      setPrefs(p);
      recordPlay(id);
    });
    // Pool for the end-of-song recommendations
    Promise.all([getAllSongs(), getRecentPlays(10)]).then(([allSongs, recentPlays]) => {
      setLibrary(allSongs);
      setPlayedIds(new Set([id!, ...recentPlays.map(p => p.songId)]));
    });
  }, [id]);

  useEffect(() => {
    if (!setlistId) {
      setSetlist(null);
      return;
    }
    getSetlist(setlistId).then(sl => setSetlist(sl ?? null));
  }, [setlistId]);

  const parsed = useMemo<ParseResult | null>(() => {
    if (!song) return null;
    return parseChordPro(song.chordpro);
  }, [song]);

  /**
   * The key the chords are *written* in. No {key} directive: the first chord
   * stands in for it. With a {capo} these are shapes, not sounding pitches.
   */
  const writtenKey = useMemo(() => {
    if (!parsed) return '';
    return parsed.key || keyFromChord(extractChords(parsed)[0]);
  }, [parsed]);

  /**
   * The song's own {capo}: the fret the written chords assume. It is the zero
   * point, not an extra shift — at this fret the page reads as authored.
   */
  const baseCapo = parsed?.capo ?? 0;

  /** What the room hears. Transpose moves it; moving the capo never does. */
  const currentKey = useMemo(() => {
    if (!prefs || !writtenKey) return '';
    return transposeKey(writtenKey, baseCapo + prefs.transpose);
  }, [writtenKey, baseCapo, prefs]);

  /**
   * What the hands play. A capo raises every string, so shapes behind it are
   * written that many semitones lower to keep the sounding key put — counted
   * from the song's own capo, so leaving that alone rewrites nothing.
   */
  const shapeShift = prefs ? prefs.transpose - ((prefs.capo ?? 0) - baseCapo) : 0;
  const shapeKey = useMemo(() => {
    return writtenKey ? transposeKey(writtenKey, shapeShift) : '';
  }, [writtenKey, shapeShift]);

  const artist = song?.index.artist?.trim() || '';

  /** Other songs by the same artist — never the open one, never recently played. */
  const artistRecs = useMemo(() => {
    if (!artist) return [];
    return library
      .filter(s => (s.index.artist?.trim() || '') === artist && !playedIds.has(s.id))
      .sort((a, b) => a.index.title.localeCompare(b.index.title, 'cs'));
  }, [library, playedIds, artist]);

  /** Fresh picks from other artists, in random order. */
  const otherRecs = useMemo(() => {
    return library
      .filter(s => !playedIds.has(s.id) && (s.index.artist?.trim() || '') !== artist)
      .sort(() => Math.random() - 0.5)
      .slice(0, 10);
  }, [library, playedIds, artist]);

  const handleChordMode = useCallback((chordMode: ChordMode) => {
    if (!prefs) return;
    const updated = { ...prefs, chordMode };
    setPrefs(updated);
    saveSongPrefs(updated);
    saveAppSettings({ ...getAppSettings(), fontScale: updated.fontScale, chordMode });
  }, [prefs]);

  const handleChordColor = useCallback((chordColor: string) => {
    setChordColor(chordColor);
    saveAppSettings({ ...getAppSettings(), chordColor });
  }, []);

  const stopScroll = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, []);

  const handleToggleScroll = useCallback(() => {
    setJustFinished(false);
    // Either way, put the dot where the page stands. Starting, because its last
    // run left it aimed a step ahead and letting that stale target paint first
    // sent it travelling backwards into position; stopping, because a dot left
    // a step ahead of the page is a lie for as long as the ladder is fading,
    // and it is the position the next start would have to teleport away from.
    plantCursor();
    setAutoScrolling(s => !s);
  }, [plantCursor]);

  /** Minus/plus: nudge the pace without leaving the song. */
  const adjustScrollSpeed = useCallback((delta: number) => {
    setScrollSpeed(s => clampSpeed(round2(s + delta)));
  }, []);

  // The loop lives in an effect so a speed change re-times it on the spot
  useEffect(() => {
    if (!autoScrolling) return;
    const el = contentRef.current;
    if (!el) return;
    const bpm = prefs?.tempo || parsed?.tempo || 100;
    const jumpPx = scrollJumpPx(el, fontScaleRef.current);
    // Interval: at 100 BPM jump every ~2.5s, scaled by tempo and the speed dial
    const intervalMs = Math.max(300, Math.round(250000 / bpm / scrollSpeed));

    /**
     * Progress `px` further down than the page stands now. Read before the
     * jump, so one jumpPx is where this jump lands and two is the stop after.
     */
    const ahead = (container: HTMLElement, px: number) => {
      const distance = container.scrollHeight - container.clientHeight;
      return distance > 0 ? Math.min(1, (container.scrollTop + px) / distance) : 1;
    };

    // Send it off for the first stop, a frame after the position it was planted
    // at has painted — otherwise there is nothing to animate away from.
    expectedTopRef.current = el.scrollTop;
    const start = requestAnimationFrame(() =>
      setCursor({ progress: ahead(el, jumpPx), ms: intervalMs })
    );

    const tick = () => {
      const container = contentRef.current;
      if (!container) return;

      // Check if reached end
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
        setSongEnded(true);
        setAtBottom(true);
        // Same state change as a manual pause, so the pill collapses the same
        // way; the flag only adds a one-shot pulse to mark the finish.
        setAutoScrolling(false);
        setJustFinished(true);
        return;
      }
      container.scrollBy({ top: jumpPx, behavior: 'smooth' });
      // Where this jump is meant to end up, so the scroll handler can tell the
      // jump itself apart from the reader moving the page
      expectedTopRef.current = container.scrollTop + jumpPx;
      // The dot leaves the stop the page is arriving at, for the one after it,
      // so it is always exactly one interval ahead of the page and lands on a
      // grey dot at the instant the page jumps to it. Measured off the live
      // scrollTop, so a manual scroll re-aims it rather than desyncing it.
      setCursor({ progress: ahead(container, 2 * jumpPx), ms: intervalMs });
    };
    scrollIntervalRef.current = setInterval(tick, intervalMs);
    return () => {
      cancelAnimationFrame(start);
      stopScroll();
    };
  }, [autoScrolling, scrollSpeed, prefs, parsed, stopScroll]);

  useEffect(() => {
    if (autoScrolling) {
      setLadderShown(true);
      return;
    }
    if (!ladderShown) return;
    const fade = setTimeout(() => setLadderShown(false), LADDER_FADE_MS);
    return () => clearTimeout(fade);
  }, [autoScrolling, ladderShown]);

  // Close leaves the song: back to where we came from, or home on a deep link.
  // History idx stays put across replace-navigations between recommendations.
  const handleClose = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate]);

  // replace: chaining recommendations must not stack up history
  /** Next song in the queue, keeping the setlist context in the URL. */
  const playInSetlist = useCallback(
    (songId: string) => navigate(`/play/${songId}?setlist=${setlistId}`, { replace: true }),
    [navigate, setlistId]
  );

  /** Leave the queue but stay on this song; the suggestions come back. */
  const exitSetlist = useCallback(
    () => navigate(`/play/${id}`, { replace: true }),
    [navigate, id]
  );

  const playRecommendation = useCallback(
    (songId: string) => navigate(`/play/${songId}`, { replace: true }),
    [navigate]
  );

  const handleScrollToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setSongEnded(false);
    setAtBottom(false);
    setQueueExpanded(false);
    setAutoScrolling(false);
    setJustFinished(false);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    };
  }, []);

  // Detect when user scrolls to end
  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll > 0) {
      setScrollProgress(el.scrollTop / maxScroll);
    }
    // Keep the travelling dot honest about where the page actually is. Idle, it
    // simply rides the page, so a start never has to teleport it. Running, a
    // move no tick ordered re-plants it — a smooth jump stays within one step of
    // its target, so anything further is the reader's own scrolling.
    const expected = expectedTopRef.current;
    if (!autoScrollingRef.current) {
      plantCursor();
    } else if (
      expected !== null &&
      Math.abs(el.scrollTop - expected) > scrollJumpPx(el, fontScaleRef.current)
    ) {
      plantCursor();
    }
    // The page grows under the reader (recommendations), so re-count the steps
    measureShifts();
    updateReveal(el);
    // songEnded is sticky (the recommendations stay put once revealed), while
    // atBottom tracks the live position — scrolling back up returns the play
    // button, so the search only owns the corner while you are at the end.
    const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    setAtBottom(bottom);
    if (bottom) setSongEnded(true);
  }, [updateReveal, measureShifts, plantCursor]);

  // Prep panel handlers
  const handleTranspose = useCallback((delta: number) => {
    if (!prefs) return;
    const updated = { ...prefs, transpose: prefs.transpose + delta };
    setPrefs(updated);
    saveSongPrefs(updated);
  }, [prefs]);

  const handleCapoChange = useCallback((capo: number | null) => {
    if (!prefs) return;
    const updated = { ...prefs, capo };
    setPrefs(updated);
    saveSongPrefs(updated);
  }, [prefs]);

  const handleFontScale = useCallback((scale: number) => {
    if (!prefs) return;
    const updated = { ...prefs, fontScale: scale };
    setPrefs(updated);
    saveSongPrefs(updated);
    saveAppSettings({ ...getAppSettings(), fontScale: scale });
  }, [prefs]);

  // Pinch the lyrics — touch screen or trackpad — on the same grid as the ± taps
  const pinch = usePinchZoom(contentRef, prefs?.fontScale ?? 1, handleFontScale, {
    min: FONT_MIN,
    max: FONT_MAX,
    step: FONT_STEP,
  }, !!prefs);

  fontScaleRef.current = pinch.scale;

  // Anything that reflows the lyrics changes the step count: a new song, a new
  // size, chords appearing, the recommendations unfolding, a rotated screen.
  // songEnded stands in for the recommendations, which are derived below the
  // loading guard and so out of reach of a hook.
  useEffect(() => {
    measureShifts();
    window.addEventListener('resize', measureShifts);
    return () => window.removeEventListener('resize', measureShifts);
  }, [measureShifts, parsed, pinch.scale, prefs?.chordMode, songEnded, autoScrolling]);

  // Ticks until switched off or the song is left, panel open or not
  const metronomeBpm = prefs?.tempo || parsed?.tempo || null;
  useEffect(() => {
    if (!metronomeOn || !metronomeBpm) return;
    const metronome = new Metronome();
    metronome.bpm = metronomeBpm;
    metronome.start();
    return () => metronome.stop();
  }, [metronomeOn, metronomeBpm]);

  const toggleMetronome = useCallback(() => setMetronomeOn(on => !on), []);

  /**
   * Unfolds a tool panel from the icon that was tapped: the icon's geometry is
   * measured here and handed to the panel, which starts its reveal as a sliver
   * the pill's own shape. Tapping the same icon again folds it back.
   */
  const toggleTool = useCallback(
    (name: ToolMenu, event: React.MouseEvent<HTMLButtonElement>) => {
      if (toolOpen && tool?.name === name) {
        setToolOpen(false);
        return;
      }
      // The pill, not the icon: growth starts from the whole shape on screen
      const box = pillRef.current?.getBoundingClientRect();
      setTool({
        name,
        origin: { width: box?.width ?? 200, height: box?.height ?? 56 },
      });
      setToolOpen(true);
    },
    [tool, toolOpen]
  );

  const closeTool = useCallback(() => setToolOpen(false), []);

  const handleSetTempo = useCallback((tempo: number) => {
    if (!prefs) return;
    const updated = { ...prefs, tempo };
    setPrefs(updated);
    saveSongPrefs(updated);
  }, [prefs]);

  if (!song || !parsed || !prefs) {
    return <div className="screen loading">Načítám…</div>;
  }

  const chords = extractChords(parsed);
  // The shapes actually fingered, in the order they first appear — the compact
  // header trades the artist for these, since mid-song that is what you want
  const shapeChords = [...new Set(chords.map(c => transposeChord(c, shapeShift, shapeKey)))];
  const heroTempo = prefs.tempo || parsed.tempo;
  /** Only a panel that is actually unfolded lights up its icon. */
  const openTool = toolOpen ? tool?.name : null;
  /** The pill's box — where the panel's growth starts. */
  const morphVars = {
    '--morph-width': `${tool?.origin.width ?? 200}px`,
    '--morph-height': `${tool?.origin.height ?? 56}px`,
  } as React.CSSProperties;
  // Tones are what the room hears, so they count the capo the song ships with
  const toneChords = [
    ...new Set(chords.map(c => transposeChord(c, baseCapo + prefs.transpose, currentKey))),
  ];
  // Songs still to come in the setlist, in setlist order
  const setlistPos = setlist ? setlist.songIds.indexOf(id ?? '') : -1;
  const setlistQueue = setlist
    ? setlist.songIds
        .slice(setlistPos + 1)
        .map(songId => library.find(s => s.id === songId))
        .filter((s): s is Song => !!s)
    : [];
  /** 1-based number the queue continues from. */
  const queueStart = setlistPos + 2;
  // A long setlist would bury the page; show the next few and offer the rest
  const visibleQueue = queueExpanded ? setlistQueue : setlistQueue.slice(0, QUEUE_PREVIEW);
  const hiddenQueueCount = setlistQueue.length - visibleQueue.length;
  const showRecs = songEnded && (setlist ? true : artistRecs.length > 0 || otherRecs.length > 0);

  return (
    <div className={`screen play-screen ${revealed ? 'tools-collapsed' : ''}`}>
      <FloatingHeader
        title={parsed.title}
        subtitle={
          shapeChords.length > 0 && (
            <span className="floating-chords" style={{ color: chordColor || undefined }}>
              {shapeChords.join(' · ')}
            </span>
          )
        }
        icon={<X size={20} strokeWidth={2.5} />}
        actionLabel="Zavřít"
        onAction={handleClose}
        revealed={revealed}
        onTitleClick={handleScrollToTop}
        scrimRef={scrimRef}
      />

      {/*
        Four actions in one pill, opposite the close button. Once the page has
        scrolled the three dials fold away and only the ellipsis is left, so the
        lyrics get the top edge back; the panel behind it carries them all.
      */}
      <div
        className={`top-actions ${revealed ? 'collapsed' : ''} ${
          metronomeOn ? 'has-running' : ''
        } ${toolOpen ? 'morphed' : ''}`}
        ref={pillRef}
        style={morphVars}
        role="group"
        aria-label="Nástroje písně"
      >
        <button
          className={`top-action ${openTool === 'key' ? 'open' : ''}`}
          tabIndex={revealed ? -1 : 0}
          onClick={e => toggleTool('key', e)}
          title="Tónina a capo"
          aria-label="Tónina a capo"
          aria-expanded={openTool === 'key'}
        >
          <Guitar size={20} strokeWidth={2.5} />
        </button>
        <button
          className={`top-action ${openTool === 'tempo' ? 'open' : ''} ${
            metronomeOn ? 'ticking' : ''
          }`}
          tabIndex={revealed ? -1 : 0}
          onClick={e => toggleTool('tempo', e)}
          title={metronomeBpm ? `Tempo (${metronomeBpm} BPM)` : 'Tempo'}
          aria-label="Tempo a metronom"
          aria-expanded={openTool === 'tempo'}
        >
          <MetronomeIcon size={20} strokeWidth={2.5} />
        </button>
        <button
          className={`top-action ${openTool === 'tone' ? 'open' : ''}`}
          tabIndex={revealed ? -1 : 0}
          onClick={e => toggleTool('tone', e)}
          disabled={toneChords.length === 0}
          title="Referenční tóny"
          aria-label="Referenční tóny"
          aria-expanded={openTool === 'tone'}
        >
          <Music size={20} strokeWidth={2.5} />
        </button>
        <button
          className={`top-action top-action-more ${openTool === 'more' ? 'open' : ''}`}
          onClick={e => toggleTool('more', e)}
          title="Nastavení"
          aria-label="Nastavení"
          aria-expanded={openTool === 'more'}
        >
          <Ellipsis size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* Tapping anywhere else folds the panel back into its icon */}
      {toolOpen && <div className="tool-dismiss" onClick={closeTool} />}

      {/*
        One surface for all four panels, unfolding from the icon that opened it:
        laid out at full size and revealed by an animated clip-path, so nothing
        reflows mid-morph and the height can stay `auto` (see .info-dropdown,
        which does the same on the home screen).
      */}
      <div
        className={`tool-panel ${toolOpen ? 'open' : ''}`}
        role="dialog"
        aria-label={tool ? TOOL_TITLE[tool.name] : undefined}
        aria-hidden={!toolOpen}
        style={morphVars}
      >
        {tool?.name === 'key' && (
          <>
            {/* Combined: transposing and capoing are the same decision twice */}
            <div className="prep-section">
              <label>Tónina</label>
              <KeyControl
                currentKey={currentKey}
                transpose={prefs.transpose}
                onTranspose={handleTranspose}
              />
            </div>
            <div className="prep-section">
              <label>Capo{shapeKey ? ` · hmaty ${shapeKey}` : ''}</label>
              <CapoControl capo={prefs.capo} onCapoChange={handleCapoChange} />
            </div>
          </>
        )}

        {tool?.name === 'tempo' && (
          <div className="prep-section">
            <label>Tempo</label>
            <TempoControl
              bpm={heroTempo}
              onSetTempo={handleSetTempo}
              audible={metronomeOn}
              onToggleAudible={toggleMetronome}
            />
          </div>
        )}

        {tool?.name === 'tone' && (
          <div className="prep-section">
            <label>Referenční tóny</label>
            {/* Every chord in the song, sounding pitch — tap one to hear it */}
            <div className="tone-row">
              {toneChords.map(c => (
                <button key={c} className="tone-key" onClick={() => playReferenceTone(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {tool?.name === 'more' && (
          <SongSettings
            prefs={prefs}
            currentKey={currentKey}
            tempo={heroTempo}
            chordColor={chordColor}
            metronomeOn={metronomeOn}
            onToggleMetronome={toggleMetronome}
            onTranspose={handleTranspose}
            onCapoChange={handleCapoChange}
            onSetTempo={handleSetTempo}
            onChordMode={handleChordMode}
            onFontScale={handleFontScale}
            onChordColor={handleChordColor}
          />
        )}
      </div>

      {/* Song content */}
      <div
        className={`play-content ${pinch.pinching ? 'pinching' : ''}`}
        ref={contentRef}
        onScroll={handleScroll}
        onTouchStart={() => {
          if (!autoScrolling) return;
          // Down goes the finger, off goes the crawl — and the dot drops back to
          // the page before the drag moves it, so it rides the gesture instead
          // of standing a step ahead until the ladder has faded out.
          plantCursor();
          setAutoScrolling(false);
        }}
      >
        <header className="hero" ref={heroRef}>
          <h1 className="hero-title">{parsed.title}</h1>
          {/* Just the interpret. Key, capo and tempo are set and read in the
              pill's panels, so restating them here only crowded the title. */}
          {artist && (
            <div className="hero-meta">
              <button
                className="hero-meta-lead hero-meta-link"
                onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}
              >
                {artist}
              </button>
            </div>
          )}
        </header>

        <SongRenderer
          parsed={parsed}
          transpose={shapeShift}
          targetKey={shapeKey}
          chordMode={prefs.chordMode}
          chordColor={chordColor}
          fontScale={pinch.scale}
        />
        {/* Empty tail below the lyrics, handed over to the recommendations */}
        {!showRecs && <div className="song-tail" aria-hidden="true" />}

        {showRecs && setlist && (
          <div className="song-recommendations">
            <section className="rec-section">
              <div className="rec-head">
                <h3>
                  {/* Straight to the setlist, to see the whole running order */}
                  <button
                    className="rec-head-title"
                    onClick={() => navigate(`/setlist/${setlist.id}`)}
                  >
                    Další z {setlist.name}
                    <ChevronRight size={14} strokeWidth={2.5} />
                  </button>
                </h3>
                <button className="rec-head-link danger" onClick={exitSetlist}>
                  <X size={14} strokeWidth={2.5} />
                  Ukončit setlist
                </button>
              </div>
              {setlistQueue.length > 0 ? (
                /* Rows, matching the setlist screen — this is a running order,
                   not a set of suggestions to browse */
                <div className="setlist-rows setlist-queue">
                  {visibleQueue.map((s, i) => (
                    <div
                      key={s.id}
                      className="setlist-row"
                      style={{ animationDelay: `${i * 45}ms` }}
                      onClick={() => playInSetlist(s.id)}
                    >
                      <span className="setlist-order">{queueStart + i}</span>
                      <div className="setlist-row-main">
                        <div className="song-title">{s.index.title}</div>
                        <div className="song-artist">{s.index.artist}</div>
                      </div>
                    </div>
                  ))}
                  {hiddenQueueCount > 0 && (
                    <button className="queue-more" onClick={() => setQueueExpanded(true)}>
                      Zobrazit dalších {hiddenQueueCount}
                      <ChevronDown size={14} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="section-empty">Konec setlistu</div>
              )}
            </section>
          </div>
        )}

        {showRecs && !setlist && (
          <div className="song-recommendations">
            {artistRecs.length > 0 && (
              <section className="rec-section">
                <div className="rec-head">
                  <h3>
                    {/* Only the name and its chevron lead anywhere — "Další od"
                        is the label, and a tap target that swallowed it would
                        claim half the heading for nothing. */}
                    Další od{' '}
                    <button
                      className="rec-head-title rec-head-name"
                      onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}
                    >
                      {artist}
                      <ChevronRight size={14} strokeWidth={2.5} />
                    </button>
                  </h3>
                </div>
                <RecommendationRail songs={artistRecs} onPick={playRecommendation} />
              </section>
            )}
            {otherRecs.length > 0 && (
              <section className="rec-section">
                <h3>Další písně</h3>
                <RecommendationRail
                  songs={otherRecs}
                  onPick={playRecommendation}
                  showArtist
                  startDelay={artistRecs.length > 0 ? 140 : 0}
                />
              </section>
            )}
          </div>
        )}
      </div>

      {/* Autoscroll position: one dot per step, and where the song is in them */}
      {ladderShown && (
        <ScrollLadder
          shifts={scrollShifts}
          step={scrollStep}
          progress={scrollProgress}
          cursor={cursor.progress}
          travelMs={cursor.ms}
          visible={autoScrolling}
        />
      )}

      {/* Bottom controls */}
      <div className="play-controls-bar">
        {/* Circle that expands on play to reveal the pace controls. At the end
            of the song it hands the corner over to the search field. */}
        <div
          className={`scroll-control ${autoScrolling ? 'open' : ''} ${justFinished ? 'finished' : ''} ${
            atBottom ? 'tucked' : ''
          }`}
        >
          <button className="control-circle" onClick={handleToggleScroll} title="Autoscroll">
            {autoScrolling ? <Pause size={20} strokeWidth={2.5} /> : <Play size={20} strokeWidth={2.5} />}
          </button>
          <button
            className="scroll-speed-btn"
            onClick={() => adjustScrollSpeed(-SPEED_STEP)}
            disabled={scrollSpeed <= SPEED_MIN}
            title="Zpomalit"
            aria-label="Zpomalit"
            tabIndex={autoScrolling ? 0 : -1}
          >
            <Minus size={20} strokeWidth={2.5} />
          </button>
          <button
            className="scroll-speed-btn"
            onClick={() => adjustScrollSpeed(SPEED_STEP)}
            disabled={scrollSpeed >= SPEED_MAX}
            title="Zrychlit"
            aria-label="Zrychlit"
            tabIndex={autoScrolling ? 0 : -1}
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Takes the play button's place once the song has been scrolled through */}
      <SearchFab
        className="in-control-bar"
        hidden={!atBottom}
        onPickSong={playRecommendation}
        onPickArtist={artist => navigate(`/artist/${encodeURIComponent(artist)}`)}
      />

    </div>
  );
};

/**
 * The autoscroll's route down the right edge: a grey dot for every step it will
 * take, plus one for where it starts, and an accent dot travelling the same line
 * at the song's real position. Because a step is a fixed number of rows, the
 * travelling dot arrives on a grey one each time the page jumps — and the dot it
 * has reached is lit, so the next stop is always the one after the bright one.
 */
interface ScrollLadderProps {
  /** Steps to the end. One more dot than this is drawn. */
  shifts: number;
  /** One step as a fraction of the scrollable distance. */
  step: number;
  /** 0…1 of the scrollable distance — where the page actually is. */
  progress: number;
  /** 0…1 the travelling dot is heading for. */
  cursor: number;
  /** How long it has to get there: one autoscroll interval, hence its pace. */
  travelMs: number;
  /** False once autoscroll has stopped — the ladder fades before it goes. */
  visible: boolean;
}

const ScrollLadder: React.FC<ScrollLadderProps> = ({
  shifts,
  step,
  progress,
  cursor,
  travelMs,
  visible,
}) => {
  // Nothing to travel: the whole song already fits on the screen
  if (shifts < 1 || step <= 0) return null;
  // Which step the page is standing on, in the same units the dots are placed
  const reached = Math.min(shifts, Math.round(progress / step));
  return (
    <div className={`scroll-ladder ${visible ? 'visible' : ''}`} aria-hidden="true">
      {Array.from({ length: shifts + 1 }, (_, i) => (
        <span
          key={i}
          className={`scroll-dot ${i === reached ? 'reached' : ''}`}
          /* Where step i actually lands, so the dot and the page agree. The
             final one is clamped to the very end, which is where the last,
             short step stops. */
          style={{ top: `${Math.min(1, i * step) * 100}%` }}
        />
      ))}
      {/* Same 0…100% line as the dots, so it lands dead on them */}
      <span
        className="scroll-cursor"
        style={{ top: `${cursor * 100}%`, '--travel': `${travelMs}ms` } as React.CSSProperties}
      />
    </div>
  );
};

interface RecommendationRailProps {
  songs: Song[];
  onPick: (songId: string) => void;
  /** Second line on the card — the artist, where the section isn't one artist. */
  showArtist?: boolean;
  /** Offset for the reveal cascade, so a later section starts after this one. */
  startDelay?: number;
}

/** Column-flow grid: index 0 is top-left, 1 sits below it, 2 is the next column. */
const RAIL_ROWS = 2;
/** Sweep left to right, the bottom row trailing just behind the top one. */
const COLUMN_STEP = 55;
const ROW_STEP = 30;
const MAX_CASCADE = 700;

/** Cards in two rows, scrolling sideways. */
const RecommendationRail: React.FC<RecommendationRailProps> = ({
  songs,
  onPick,
  showArtist,
  startDelay = 0,
}) => (
  <div className="card-rail rec-rail">
    {songs.map((s, i) => {
      const column = Math.floor(i / RAIL_ROWS);
      const row = i % RAIL_ROWS;
      const delay = Math.min(MAX_CASCADE, column * COLUMN_STEP + row * ROW_STEP);
      return (
        <div
          key={s.id}
          className="song-card"
          style={{ animationDelay: `${startDelay + delay}ms` }}
          onClick={() => onPick(s.id)}
        >
          <div className="song-card-title">{s.index.title}</div>
          {showArtist ? (
            <div className="song-card-artist">{s.index.artist}</div>
          ) : (
            s.index.originalKey && <div className="song-card-artist">{s.index.originalKey}</div>
          )}
        </div>
      );
    })}
  </div>
);

/** Chord visibility, in a select — the labels can say it properly there. */
const CHORD_MODES: { mode: ChordMode; label: string }[] = [
  { mode: 'all', label: 'Všechny akordy' },
  { mode: 'first', label: 'Jen první výskyt' },
  { mode: 'none', label: 'Bez akordů' },
];

interface SongSettingsProps {
  prefs: SongPrefs;
  currentKey: string;
  tempo: number | null;
  chordColor: string;
  metronomeOn: boolean;
  onToggleMetronome: () => void;
  onTranspose: (delta: number) => void;
  onCapoChange: (capo: number | null) => void;
  onSetTempo: (tempo: number) => void;
  onChordMode: (mode: ChordMode) => void;
  onFontScale: (scale: number) => void;
  onChordColor: (color: string) => void;
}

/** Everything at once, for the ellipsis panel — no surface of its own. */
const SongSettings: React.FC<SongSettingsProps> = ({
  prefs,
  currentKey,
  tempo,
  chordColor,
  metronomeOn,
  onToggleMetronome,
  onTranspose,
  onCapoChange,
  onSetTempo,
  onChordMode,
  onChordColor,
  onFontScale,
}) => (
  <>
      <div className="prep-section">
        <label>Tónina</label>
        <KeyControl currentKey={currentKey} transpose={prefs.transpose} onTranspose={onTranspose} />
      </div>

      <div className="prep-section">
        <label>Capo</label>
        <CapoControl capo={prefs.capo} onCapoChange={onCapoChange} />
      </div>

      <div className="prep-section">
        <label>Tempo</label>
        <TempoControl
          bpm={tempo}
          onSetTempo={onSetTempo}
          audible={metronomeOn}
          onToggleAudible={onToggleMetronome}
        />
      </div>

      <div className="prep-section">
        <label>Velikost písma</label>
        <FontControl fontScale={prefs.fontScale} onFontScale={onFontScale} />
      </div>

      <div className="prep-section">
        <label>Akordy</label>
        {/* A select, not three squeezed buttons: one row whatever the labels say,
            and iOS hands it its own picker */}
        <select
          className="ui-select"
          value={prefs.chordMode}
          onChange={e => onChordMode(e.target.value as ChordMode)}
        >
          {CHORD_MODES.map(m => (
            <option key={m.mode} value={m.mode}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="prep-section">
        <label>Barva akordů</label>
        <div className="swatch-row">
          {CHORD_COLORS.map(c => (
            <button
              key={c.value}
              className={`swatch ${chordColor === c.value ? 'active' : ''}`}
              style={{ background: c.value }}
              onClick={() => onChordColor(c.value)}
              title={c.name}
              aria-label={c.name}
            />
          ))}
        </div>
      </div>
  </>
);
