import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSong, getSongPrefs, saveSongPrefs, recordPlay, getAllSongs, getRecentPlays, saveAppSettings } from '../lib/db';
import { parseChordPro, extractChords } from '../lib/parser';
import { transposeKey } from '../lib/transpose';
import { playReferenceTone, Metronome, playClick } from '../lib/audio';
import { SongRenderer } from '../components/SongRenderer';
import { useWakeLock } from '../hooks/useWakeLock';
import { ChevronLeft, Settings, Play, Pause, Timer, Volume2 } from 'lucide-react';
import type { Song, SongPrefs, ParseResult } from '../types';

const metronome = new Metronome();

export const PlayScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [song, setSong] = useState<Song | null>(null);
  const [prefs, setPrefs] = useState<SongPrefs | null>(null);
  const [showPrep, setShowPrep] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [songEnded, setSongEnded] = useState(false);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [scrollProgress, setScrollProgress] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useWakeLock();

  useEffect(() => {
    if (!id) return;
    Promise.all([getSong(id), getSongPrefs(id)]).then(([s, p]) => {
      if (s) {
        setSong(s);
        setPrefs(p);
        recordPlay(id);
      }
    });
    // Load recommendations (random songs, excluding recently played)
    Promise.all([getAllSongs(), getRecentPlays(10)]).then(([allSongs, recentPlays]) => {
      const recentIds = new Set(recentPlays.map(p => p.songId));
      recentIds.add(id!);
      const others = allSongs.filter(s => !recentIds.has(s.id));
      const shuffled = others.sort(() => Math.random() - 0.5);
      setRecommendations(shuffled.slice(0, 3));
    });
  }, [id]);

  const parsed = useMemo<ParseResult | null>(() => {
    if (!song) return null;
    return parseChordPro(song.chordpro);
  }, [song]);

  const currentKey = useMemo(() => {
    if (!parsed || !prefs) return '';
    return parsed.key ? transposeKey(parsed.key, prefs.transpose) : '';
  }, [parsed, prefs]);

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
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) {
      setSongEnded(true);
    }
  }, []);

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

  return (
    <div className="screen play-screen">
      {/* Floating back button */}
      <button className="back-btn-floating" onClick={() => navigate(-1)}>
        <ChevronLeft size={22} strokeWidth={2.5} />
      </button>

      {/* Centered song title pill */}
      <div className="title-pill" onClick={handleScrollToTop}>
        <span className="title-pill-name">{parsed.title}</span>
        {currentKey && <span className="title-pill-key">{currentKey}</span>}
      </div>

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
        <SongRenderer
          parsed={parsed}
          transpose={prefs.transpose}
          targetKey={currentKey}
          chordsVisible={prefs.chordsVisible}
          fontScale={prefs.fontScale}
        />
        {songEnded && recommendations.length > 0 && (
          <div className="song-recommendations">
            <h3>Další písně</h3>
            {recommendations.map(r => (
              <div key={r.id} className="recommendation-item" onClick={() => navigate(`/play/${r.id}`)}>
                <span className="rec-title">{r.index.title}</span>
                <span className="rec-artist">{r.index.artist}</span>
              </div>
            ))}
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
