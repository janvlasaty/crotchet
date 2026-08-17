import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSong, getSongPrefs, saveSongPrefs, recordPlay, getAllSongs } from '../lib/db';
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
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAnimRef = useRef<number | null>(null);
  const scrollStartRef = useRef<number>(0);

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
    // Load recommendations (random other songs)
    getAllSongs().then(allSongs => {
      const others = allSongs.filter(s => s.id !== id);
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
    if (scrollAnimRef.current) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
  }, []);

  const handleToggleScroll = useCallback(() => {
    if (autoScrolling) {
      stopScroll();
    } else {
      const bpm = prefs?.tempo || parsed?.tempo || 100;
      // pixels per second: at 100 BPM we want ~25px/s, scale linearly
      const pxPerSec = bpm * 0.25;
      scrollStartRef.current = performance.now();
      let lastTime = scrollStartRef.current;

      const tick = (now: number) => {
        const el = contentRef.current;
        if (!el) return;
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        el.scrollTop += pxPerSec * dt;

        // Check if reached end
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
          setSongEnded(true);
          setAutoScrolling(false);
          scrollAnimRef.current = null;
          return;
        }
        scrollAnimRef.current = requestAnimationFrame(tick);
      };
      scrollAnimRef.current = requestAnimationFrame(tick);
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
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    };
  }, []);

  // Detect when user scrolls to end
  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
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
        <button className="prep-btn" onClick={(e) => { e.stopPropagation(); setShowPrep(!showPrep); }}>
          ⚙
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

      {/* Bottom controls — 3 buttons only */}
      <div className="play-controls">
        <button
          className={`control-btn ${autoScrolling ? 'active' : ''}`}
          onClick={handleToggleScroll}
          title="Autoscroll"
        >
          {autoScrolling ? '⏸' : '▶'}
        </button>
        <button
          className={`control-btn ${prefs.chordsVisible ? 'active' : ''}`}
          onClick={handleToggleChords}
          title="Akordy"
        >
          ♫
        </button>
        <button
          className={`control-btn ${metronomeOn ? 'active' : ''}`}
          onClick={handleToggleMetronome}
          title="Metronom"
        >
          ⏱
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
            🔊 Referenční tón ({firstChord})
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
