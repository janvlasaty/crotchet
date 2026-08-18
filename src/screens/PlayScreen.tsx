import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSong, getSongPrefs, saveSongPrefs, recordPlay, getAllSongs, getRecentPlays, saveAppSettings } from '../lib/db';
import { parseChordPro, extractChords } from '../lib/parser';
import { transposeKey } from '../lib/transpose';
import { playReferenceTone, Metronome, playClick } from '../lib/audio';
import { SongRenderer } from '../components/SongRenderer';
import { useWakeLock } from '../hooks/useWakeLock';
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
      {/* Header */}
      <div className="play-header" onClick={handleScrollToTop}>
        <button className="back-btn" onClick={(e) => { e.stopPropagation(); navigate(-1); }}>
          ←
        </button>
        <div className="play-title">
          <h1>{parsed.title}</h1>
          <span className="play-artist">{parsed.artist}</span>
        </div>
        {currentKey && <span className="play-key">{currentKey}</span>}
        {prefs.capo !== null && prefs.capo > 0 && (
          <span className="play-capo">kapo {prefs.capo}</span>
        )}
        <button className="prep-btn" onClick={(e) => { e.stopPropagation(); setShowPrep(!showPrep); }} aria-label="Nastavení">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/></svg>
        </button>
      </div>

      {/* Preparation panel */}
      {showPrep && (
        <PrepPanel
          prefs={prefs}
          parsed={parsed}
          onTranspose={handleTranspose}
          onCapoChange={handleCapoChange}
          onFontScale={handleFontScale}
          onSetTempo={handleSetTempo}
          firstChord={firstChord}
          onClose={() => setShowPrep(false)}
        />
      )}

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
      <div className="play-controls">
        <button
          className={`control-btn ${autoScrolling ? 'active' : ''}`}
          onClick={handleToggleScroll}
          title="Autoscroll"
        >
          {autoScrolling ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          )}
        </button>
        <button
          className={`control-btn ${prefs.chordsVisible ? 'active' : ''}`}
          onClick={handleToggleChords}
          title="Akordy"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </button>
        <button
          className={`control-btn ${metronomeOn ? 'active' : ''}`}
          onClick={handleToggleMetronome}
          title="Metronom"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L8 22h8L12 2z"/><line x1="12" y1="8" x2="18" y2="4"/></svg>
        </button>
      </div>
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
  firstChord,
  onClose,
}) => {
  const { bpm, tap, reset } = useTapTempoLocal();

  useEffect(() => {
    if (bpm !== null) onSetTempo(bpm);
  }, [bpm, onSetTempo]);

  return (
    <div className="prep-panel">
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
            🔉 Referenční tón ({firstChord})
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
