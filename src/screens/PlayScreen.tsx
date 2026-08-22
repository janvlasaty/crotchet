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
import {
  X,
  Settings,
  Play,
  Pause,
  ChevronRight,
  ChevronDown,
  Turtle,
  Rabbit,
  AArrowDown,
  AArrowUp,
  Music,
  Volume2,
  VolumeX,
  Minus,
  Plus,
} from 'lucide-react';
import { CHORD_COLORS } from '../lib/chordColors';
import { KeyControl, CapoControl, TempoControl } from '../components/SongControls';
import type { Song, SongPrefs, ParseResult, ChordMode, Setlist } from '../types';

/** Up-next rows shown before the rest of the setlist has to be asked for. */
const QUEUE_PREVIEW = 5;

/** Font size dial in the footer: 10% per tap. */
const FONT_STEP = 0.1;
const FONT_MIN = 0.75;
const FONT_MAX = 2.3;

/** Autoscroll pace dial: 15% per tap of turtle/rabbit, half to double speed. */
const SPEED_STEP = 0.15;
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const clampSpeed = (s: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, s));
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const [showPrep, setShowPrep] = useState(false);
  const [chordColor, setChordColor] = useState(() => getAppSettings().chordColor);
  /** Audible click, owned here so it survives the panel being dismissed. */
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  /** Which meta chip owns the open popover, plus the geometry it was opened at. */
  const [metaPanel, setMetaPanel] = useState<{ panel: MetaPanel; box: MetaBox } | null>(null);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  /** Autoscroll ran to the end on its own — worth marking on the button. */
  const [justFinished, setJustFinished] = useState(false);
  const [songEnded, setSongEnded] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const [library, setLibrary] = useState<Song[]>([]);
  const [playedIds, setPlayedIds] = useState<Set<string>>(new Set());
  const [scrollProgress, setScrollProgress] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const { revealed, setRevealed, heroRef, scrimRef, updateReveal } = useHeaderReveal();
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setAutoScrolling(s => !s);
  }, []);

  /** Turtle/rabbit: nudge the pace without leaving the song. */
  const adjustScrollSpeed = useCallback((delta: number) => {
    setScrollSpeed(s => clampSpeed(round2(s + delta)));
  }, []);

  // The loop lives in an effect so a speed change re-times it on the spot
  useEffect(() => {
    if (!autoScrolling) return;
    const el = contentRef.current;
    if (!el) return;
    const bpm = prefs?.tempo || parsed?.tempo || 100;
    // Compute line height from the actual rendered font size
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 16;
    const lineHeight = fontSize * 1.4; // matches .song-content line-height
    // Scroll 3 rows at a time with smooth animation
    const rowsPerJump = 3;
    const jumpPx = Math.round(lineHeight * rowsPerJump);
    // Interval: at 100 BPM jump every ~2.5s, scaled by tempo and the speed dial
    const intervalMs = Math.max(300, Math.round(250000 / bpm / scrollSpeed));

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
    };
    scrollIntervalRef.current = setInterval(tick, intervalMs);
    return stopScroll;
  }, [autoScrolling, scrollSpeed, prefs, parsed, stopScroll]);

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
    updateReveal(el);
    // songEnded is sticky (the recommendations stay put once revealed), while
    // atBottom tracks the live position — scrolling back up returns the play
    // button, so the search only owns the corner while you are at the end.
    const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    setAtBottom(bottom);
    if (bottom) setSongEnded(true);
  }, [updateReveal]);

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

  const toggleMetaPanel = useCallback(
    (panel: MetaPanel, event: React.MouseEvent<HTMLButtonElement>) => {
      const anchor = event.currentTarget.closest('.hero-meta-wrap');
      const box = measureMetaBox(panel, event.currentTarget, anchor);
      setMetaPanel(current => (current?.panel === panel ? null : { panel, box }));
    },
    []
  );

  const closeMetaPanel = useCallback(() => setMetaPanel(null), []);

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
  const firstChord = chords[0];
  const heroTempo = prefs.tempo || parsed.tempo;
  // The tone is what the room hears, so it counts the capo the song ships with
  const referenceChord = firstChord
    ? transposeChord(firstChord, baseCapo + prefs.transpose, currentKey)
    : undefined;
  const panel = metaPanel?.panel;
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
    <div className="screen play-screen">
      <FloatingHeader
        title={parsed.title}
        subtitle={artist}
        accessory={currentKey}
        icon={<X size={22} strokeWidth={2.5} />}
        actionLabel="Zavřít"
        onAction={handleClose}
        revealed={revealed}
        onTitleClick={handleScrollToTop}
        scrimRef={scrimRef}
      />

      {/* Song content */}
      <div
        className="play-content"
        ref={contentRef}
        onScroll={handleScroll}
        onTouchStart={() => {
          if (autoScrolling) setAutoScrolling(false);
        }}
      >
        <header className="hero" ref={heroRef}>
          <h1 className="hero-title">{parsed.title}</h1>
          <div className="hero-meta-wrap">
            <div className="hero-meta">
              {artist && (
                <button
                  className="hero-meta-lead hero-meta-link"
                  onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}
                >
                  {artist}
                </button>
              )}
              {/* One unit: if it cannot sit beside the artist, it all wraps together */}
              <div className="meta-chips">
              <button
                className={`meta-chip ${panel === 'key' ? 'open' : ''}`}
                onClick={e => toggleMetaPanel('key', e)}
              >
                {currentKey || 'TÓNINA'}
              </button>
              <button
                className={`meta-chip ${panel === 'capo' ? 'open' : ''}`}
                onClick={e => toggleMetaPanel('capo', e)}
              >
                <span className={prefs.capo ? '' : 'meta-off'}>
                  {/* The shape key is the payoff: what you actually finger */}
                  {prefs.capo
                    ? `CAPO ${prefs.capo}${shapeKey ? ` · ${shapeKey}` : ''}`
                    : 'CAPO'}
                </span>
              </button>
              <button
                className={`meta-chip ${panel === 'tempo' ? 'open' : ''} ${
                  metronomeOn ? 'ticking' : ''
                }`}
                onClick={e => toggleMetaPanel('tempo', e)}
              >
                {heroTempo ? `${heroTempo} BPM` : 'TEMPO'}
              </button>
              <button
                className="meta-chip meta-chip-icon"
                onClick={() => referenceChord && playReferenceTone(referenceChord)}
                disabled={!referenceChord}
                title={referenceChord ? `Referenční tón (${referenceChord})` : 'Referenční tón'}
                aria-label="Referenční tón"
              >
                <Music size={14} strokeWidth={2.5} />
              </button>
              </div>
            </div>

            {panel === 'key' && (
              <MetaPopover box={metaPanel!.box} onClose={closeMetaPanel}>
                <KeyControl
                  currentKey={currentKey}
                  transpose={prefs.transpose}
                  onTranspose={handleTranspose}
                />
              </MetaPopover>
            )}

            {panel === 'capo' && (
              <MetaPopover box={metaPanel!.box} onClose={closeMetaPanel}>
                <CapoControl capo={prefs.capo} onCapoChange={handleCapoChange} />
              </MetaPopover>
            )}

            {panel === 'tempo' && (
              <MetaPopover box={metaPanel!.box} onClose={closeMetaPanel}>
                <TempoControl
                  bpm={heroTempo}
                  onSetTempo={handleSetTempo}
                  audible={metronomeOn}
                  onToggleAudible={toggleMetronome}
                />
              </MetaPopover>
            )}
          </div>
        </header>

        <SongRenderer
          parsed={parsed}
          transpose={shapeShift}
          targetKey={shapeKey}
          chordMode={prefs.chordMode}
          chordColor={chordColor}
          fontScale={prefs.fontScale}
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
                  <h3>Další od {artist}</h3>
                  <button
                    className="rec-head-link"
                    onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}
                  >
                    Vše
                    <ChevronRight size={14} strokeWidth={2.5} />
                  </button>
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

      {/* Autoscroll position indicator */}
      {autoScrolling && (
        <div
          className="scroll-indicator"
          style={{ top: `${60 + scrollProgress * (window.innerHeight - 130)}px` }}
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
            <Turtle size={20} strokeWidth={2.5} />
          </button>
          <button
            className="scroll-speed-btn"
            onClick={() => adjustScrollSpeed(SPEED_STEP)}
            disabled={scrollSpeed >= SPEED_MAX}
            title="Zrychlit"
            aria-label="Zrychlit"
            tabIndex={autoScrolling ? 0 : -1}
          >
            <Rabbit size={20} strokeWidth={2.5} />
          </button>
        </div>
        <div className="control-pill-right">
          <button
            className="control-btn muted"
            onClick={() => handleFontScale(Math.max(FONT_MIN, round2(prefs.fontScale - FONT_STEP)))}
            disabled={prefs.fontScale <= FONT_MIN}
            title="Menší písmo"
            aria-label="Menší písmo"
          >
            <AArrowDown size={20} strokeWidth={2.5} />
          </button>
          <button
            className="control-btn muted"
            onClick={() => handleFontScale(Math.min(FONT_MAX, round2(prefs.fontScale + FONT_STEP)))}
            disabled={prefs.fontScale >= FONT_MAX}
            title="Větší písmo"
            aria-label="Větší písmo"
          >
            <AArrowUp size={20} strokeWidth={2.5} />
          </button>
          <button
            // Lit while the metronome ticks, so the click is traceable to here
            className={`control-btn ${showPrep || metronomeOn ? 'active' : ''}`}
            onClick={() => setShowPrep(!showPrep)}
            title="Nastavení"
          >
            <Settings size={20} strokeWidth={2.5} />
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

      {/* Chord display settings */}
      {showPrep && (
        <SettingsPanel
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
          onChordColor={handleChordColor}
          onClose={() => setShowPrep(false)}
        />
      )}
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
  <div className="rec-rail">
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

type MetaPanel = 'key' | 'capo' | 'tempo';

/** Where a panel sits, measured once when it opens. */
interface MetaBox {
  /** Offset from the meta row's left edge. */
  left: number;
  /** Arrow centre, relative to the panel's own left edge. */
  arrow: number;
  /** Not enough headroom above the row — hang below it instead. */
  drop: boolean;
}

const META_PANEL_WIDTH = 176; // keep in step with .meta-popover in App.css
/** Rough panel heights, only used to decide whether it fits above the row. */
const META_PANEL_HEIGHTS: Record<MetaPanel, number> = { key: 72, capo: 72, tempo: 146 };
/** Clear of the row, and of the header gradient at the top of the screen. */
const META_PANEL_GAP = 12;
const META_PANEL_TOP_MARGIN = 8;

/** Centre the panel on the tapped chip, kept inside the row and the screen. */
function measureMetaBox(
  panel: MetaPanel,
  chipEl: HTMLElement,
  anchorEl: Element | null
): MetaBox {
  const chip = chipEl.getBoundingClientRect();
  const anchor = anchorEl?.getBoundingClientRect();
  if (!anchor) return { left: 0, arrow: META_PANEL_WIDTH / 2, drop: false };

  const centre = chip.left - anchor.left + chip.width / 2;
  const maxLeft = Math.max(0, anchor.width - META_PANEL_WIDTH);
  const left = Math.min(Math.max(0, centre - META_PANEL_WIDTH / 2), maxLeft);
  const room = anchor.top - META_PANEL_GAP - META_PANEL_TOP_MARGIN;

  return { left, arrow: centre - left, drop: room < META_PANEL_HEIGHTS[panel] };
}

/**
 * Narrow glass column floating above the meta row, arrow aimed at the chip that
 * opened it. Rows are fixed height, so changing a value never moves a control.
 */
interface MetaPopoverProps {
  box: MetaBox;
  onClose: () => void;
  children: React.ReactNode;
}

const MetaPopover: React.FC<MetaPopoverProps> = ({ box, onClose, children }) => (
  <>
    <div className="meta-dismiss" onClick={onClose} />
    <div
      className={`meta-popover ${box.drop ? 'drop' : ''}`}
      style={{ left: box.left, '--arrow': `${box.arrow}px` } as React.CSSProperties}
    >
      {children}
    </div>
  </>
);

/** Cog dropdown — the same song controls as the meta row, plus chord display. */
const CHORD_MODES: { mode: ChordMode; label: string }[] = [
  { mode: 'all', label: 'Všude' },
  { mode: 'first', label: '1. výskyt' },
  { mode: 'none', label: 'Žádné' },
];

interface SettingsPanelProps {
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
  onChordColor: (color: string) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
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
  onClose,
}) => (
  <>
    {/* Tapping anywhere else closes the panel */}
    <div className="prep-dismiss" onClick={onClose} />

    <div className="prep-panel-dropdown">
      {/* Same controls as the hero chips, reachable without scrolling back up */}
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
        <label>Akordy</label>
        <div className="segmented">
          {CHORD_MODES.map(m => (
            <button
              key={m.mode}
              className={prefs.chordMode === m.mode ? 'active' : ''}
              onClick={() => onChordMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
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
    </div>
  </>
);
