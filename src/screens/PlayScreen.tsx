import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSong, getSongPrefs, saveSongPrefs, recordPlay, getAllSongs, getRecentPlays, saveAppSettings } from '../lib/db';
import { parseChordPro, extractChords } from '../lib/parser';
import { transposeKey } from '../lib/transpose';
import { playReferenceTone, Metronome, playClick } from '../lib/audio';
import { SongRenderer } from '../components/SongRenderer';
import { FloatingHeader, useHeaderReveal } from '../components/FloatingHeader';
import { useWakeLock } from '../hooks/useWakeLock';
import { X, Settings, Play, Pause, Timer, Volume2, ChevronRight } from 'lucide-react';
import type { Song, SongPrefs, ParseResult } from '../types';

const metronome = new Metronome();

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
  const [song, setSong] = useState<Song | null>(null);
  const [prefs, setPrefs] = useState<SongPrefs | null>(null);
  const [showPrep, setShowPrep] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [songEnded, setSongEnded] = useState(false);
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
    setScrollProgress(0);
    setRevealed(false);
    contentRef.current?.scrollTo({ top: 0 });
    Promise.all([getSong(id), getSongPrefs(id)]).then(([s, p]) => {
      if (s) {
        setSong(s);
        setPrefs(p);
        recordPlay(id);
      }
    });
    // Pool for the end-of-song recommendations
    Promise.all([getAllSongs(), getRecentPlays(10)]).then(([allSongs, recentPlays]) => {
      setLibrary(allSongs);
      setPlayedIds(new Set([id!, ...recentPlays.map(p => p.songId)]));
    });
  }, [id]);

  const parsed = useMemo<ParseResult | null>(() => {
    if (!song) return null;
    return parseChordPro(song.chordpro);
  }, [song]);

  const currentKey = useMemo(() => {
    if (!parsed || !prefs) return '';
    // No {key} directive: the first chord of the song stands in for it
    const key = parsed.key || keyFromChord(extractChords(parsed)[0]);
    return key ? transposeKey(key, prefs.transpose) : '';
  }, [parsed, prefs]);

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

  const handleToggleChords = useCallback(() => {
    if (!prefs) return;
    const updated = { ...prefs, chordsVisible: !prefs.chordsVisible };
    setPrefs(updated);
    saveSongPrefs(updated);
    saveAppSettings({ fontScale: updated.fontScale, chordsVisible: updated.chordsVisible });
  }, [prefs]);

  const handleToggleMetronome = useCallback(() => {
    if (metronomeOn) {
      metronome.stop();
    } else {
      const bpm = prefs?.tempo || parsed?.tempo || 120;
      metronome.bpm = bpm;
      metronome.start();
    }
    setMetronomeOn(!metronomeOn);
  }, [metronomeOn, prefs, parsed]);

  const stopScroll = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, []);

  const handleToggleScroll = useCallback(() => {
    if (autoScrolling) {
      stopScroll();
    } else {
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
      // Interval: at 100 BPM jump every ~2.5s, scale inversely with tempo
      const intervalMs = Math.max(800, Math.round(250000 / bpm));

      const tick = () => {
        const container = contentRef.current;
        if (!container) return;

        // Check if reached end
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
          setSongEnded(true);
          setAutoScrolling(false);
          stopScroll();
          return;
        }
        container.scrollBy({ top: jumpPx, behavior: 'smooth' });
      };
      scrollIntervalRef.current = setInterval(tick, intervalMs);
    }
    setAutoScrolling(!autoScrolling);
  }, [autoScrolling, prefs, parsed, stopScroll]);

  // Close leaves the song: back to where we came from, or home on a deep link.
  // History idx stays put across replace-navigations between recommendations.
  const handleClose = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate]);

  // replace: chaining recommendations must not stack up history
  const playRecommendation = useCallback(
    (songId: string) => navigate(`/play/${songId}`, { replace: true }),
    [navigate]
  );

  const handleScrollToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setSongEnded(false);
    if (autoScrolling) {
      stopScroll();
      setAutoScrolling(false);
    }
  }, [autoScrolling, stopScroll]);

  useEffect(() => {
    return () => {
      metronome.stop();
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
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) {
      setSongEnded(true);
    }
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
    saveAppSettings({ fontScale: scale, chordsVisible: updated.chordsVisible });
  }, [prefs]);

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

  return (
    <div className="screen play-screen">
      <FloatingHeader
        title={parsed.title}
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
          if (autoScrolling) {
            stopScroll();
            setAutoScrolling(false);
          }
        }}
      >
        <header className="hero" ref={heroRef}>
          <h1 className="hero-title">{parsed.title}</h1>
          <div className="hero-meta">
            {artist && (
              <button
                className="hero-meta-lead hero-meta-link"
                onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}
              >
                {artist}
              </button>
            )}
            {currentKey && <span className="hero-meta-accent">{currentKey}</span>}
            {!!prefs.capo && <span>Kapo {prefs.capo}</span>}
            {heroTempo && <span>{heroTempo} BPM</span>}
          </div>
        </header>

        <SongRenderer
          parsed={parsed}
          transpose={prefs.transpose}
          targetKey={currentKey}
          chordsVisible={prefs.chordsVisible}
          fontScale={prefs.fontScale}
        />
        {songEnded && (artistRecs.length > 0 || otherRecs.length > 0) && (
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
                <RecommendationRail songs={otherRecs} onPick={playRecommendation} showArtist />
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
        <button
          className={`control-circle ${autoScrolling ? 'active' : ''}`}
          onClick={handleToggleScroll}
          title="Autoscroll"
        >
          {autoScrolling ? <Pause size={20} strokeWidth={2.5} /> : <Play size={20} strokeWidth={2.5} />}
        </button>
        <div className="control-pill-right">
          <button
            className={`control-btn ${metronomeOn ? 'active' : ''}`}
            onClick={handleToggleMetronome}
            title="Metronom"
          >
            <Timer size={20} strokeWidth={2.5} />
          </button>
          <button
            className={`control-btn ${showPrep ? 'active' : ''}`}
            onClick={() => setShowPrep(!showPrep)}
            title="Nastavení"
          >
            <Settings size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Settings dropdown */}
      {showPrep && (
        <PrepPanel
          prefs={prefs}
          parsed={parsed}
          onTranspose={handleTranspose}
          onCapoChange={handleCapoChange}
          onFontScale={handleFontScale}
          onSetTempo={handleSetTempo}
          onToggleChords={handleToggleChords}
          chordsVisible={prefs.chordsVisible}
          firstChord={firstChord}
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
}

/** Cards in two rows, scrolling sideways. */
const RecommendationRail: React.FC<RecommendationRailProps> = ({ songs, onPick, showArtist }) => (
  <div className="rec-rail">
    {songs.map(s => (
      <div key={s.id} className="song-card" onClick={() => onPick(s.id)}>
        <div className="song-card-title">{s.index.title}</div>
        {showArtist ? (
          <div className="song-card-artist">{s.index.artist}</div>
        ) : (
          s.index.originalKey && <div className="song-card-artist">{s.index.originalKey}</div>
        )}
      </div>
    ))}
  </div>
);

// Preparation panel
interface PrepPanelProps {
  prefs: SongPrefs;
  parsed: ParseResult;
  onTranspose: (delta: number) => void;
  onCapoChange: (capo: number | null) => void;
  onFontScale: (scale: number) => void;
  onSetTempo: (tempo: number) => void;
  onToggleChords: () => void;
  chordsVisible: boolean;
  firstChord?: string;
  onClose: () => void;
}

const PrepPanel: React.FC<PrepPanelProps> = ({
  prefs,
  parsed,
  onTranspose,
  onCapoChange,
  onFontScale,
  onSetTempo,
  onToggleChords,
  chordsVisible,
  firstChord,
  onClose,
}) => {
  const { bpm, tap, reset } = useTapTempoLocal();

  useEffect(() => {
    if (bpm !== null) onSetTempo(bpm);
  }, [bpm, onSetTempo]);

  return (
    <div className="prep-panel-dropdown">
      <div className="prep-section">
        <label>Akordy</label>
        <div className="prep-row">
          <button className={chordsVisible ? 'active' : ''} onClick={onToggleChords}>
            {chordsVisible ? 'Skrýt' : 'Zobrazit'}
          </button>
        </div>
      </div>

      <div className="prep-section">
        <label>Transpozice</label>
        <div className="prep-row">
          <button onClick={() => onTranspose(-1)}>−1</button>
          <span>{prefs.transpose > 0 ? '+' : ''}{prefs.transpose}</span>
          <button onClick={() => onTranspose(1)}>+1</button>
        </div>
      </div>

      <div className="prep-section">
        <label>Kapo</label>
        <div className="prep-row">
          <button onClick={() => onCapoChange(Math.max(0, (prefs.capo ?? 0) - 1))}>−</button>
          <span>{prefs.capo ?? 0}</span>
          <button onClick={() => onCapoChange((prefs.capo ?? 0) + 1)}>+</button>
          {prefs.capo !== null && prefs.capo > 0 && (
            <button onClick={() => onCapoChange(null)}>✕</button>
          )}
        </div>
      </div>

      <div className="prep-section">
        <label>Velikost písma</label>
        <div className="prep-row">
          <button onClick={() => onFontScale(Math.max(0.5, prefs.fontScale - 0.1))}>A−</button>
          <span>{Math.round(prefs.fontScale * 100)}%</span>
          <button onClick={() => onFontScale(Math.min(2, prefs.fontScale + 0.1))}>A+</button>
        </div>
      </div>

      <div className="prep-section">
        <label>Tempo</label>
        <div className="prep-row">
          <button className="tap-btn" onClick={tap}>TAP</button>
          <span>{prefs.tempo || parsed.tempo || '—'} BPM</span>
        </div>
      </div>

      {firstChord && (
        <div className="prep-section">
          <button className="ref-tone-btn" onClick={() => playReferenceTone(firstChord)}>
            <Volume2 size={16} style={{ marginRight: 6, verticalAlign: -3 }} /> Referenční tón ({firstChord})
          </button>
        </div>
      )}

      <button className="prep-close" onClick={onClose}>Zavřít</button>
    </div>
  );
};

function useTapTempoLocal() {
  const [taps, setTaps] = useState<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);

  const tap = useCallback(() => {
    playClick();
    const now = Date.now();
    setTaps(prev => {
      const newTaps = [...prev, now].slice(-8);
      if (newTaps.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < newTaps.length; i++) {
          intervals.push(newTaps[i] - newTaps[i - 1]);
        }
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        setBpm(Math.round(60000 / avg));
      }
      return newTaps;
    });
  }, []);

  const reset = useCallback(() => {
    setTaps([]);
    setBpm(null);
  }, []);

  return { bpm, tap, reset };
}
