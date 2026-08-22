import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllSongs,
  getRecentPlays,
  getAllSetlists,
  saveSetlist,
  getRecentCache,
  saveRecentCache,
  type RecentEntry,
} from '../lib/db';
import { initSearch } from '../lib/search';
import { applyUpdate } from '../lib/version';
import { SearchFab, songCountLabel } from '../components/SearchFab';
import { RefreshCw, Plus, Info } from 'lucide-react';
import { UNKNOWN_ARTIST, indexLetter } from '../lib/artists';
import type { Song, Setlist } from '../types';

/** How long the outgoing cards take to fade before the next letter arrives. */
const GRID_FADE_MS = 150;

export const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  // Straight from cache, so the rail is on screen before IndexedDB answers
  const [recentSongs, setRecentSongs] = useState<RecentEntry[]>(getRecentCache);
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [newName, setNewName] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  /** The letter the grid is currently showing, and whether it is on its way out. */
  const [shownLetter, setShownLetter] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const alphaRef = useRef<HTMLDivElement>(null);
  const alphaFrame = useRef<number | null>(null);
  const alphaSettle = useRef<number | null>(null);
  /** Letter under the centre line right now, tracked outside React. */
  const centred = useRef<string | null>(null);

  // Songs grouped by artist, alphabetically, with an index letter per group
  const artistGroups = useMemo(() => {
    const map = new Map<string, Song[]>();
    for (const s of songs) {
      const artist = s.index.artist?.trim() || UNKNOWN_ARTIST;
      const list = map.get(artist);
      if (list) list.push(s);
      else map.set(artist, [s]);
    }
    return [...map.entries()]
      .map(([artist, list]) => ({
        artist,
        letter: indexLetter(artist),
        count: list.length,
      }))
      .sort((a, b) => {
        // Unknown artist last, everything else alphabetical
        if (a.artist === UNKNOWN_ARTIST) return 1;
        if (b.artist === UNKNOWN_ARTIST) return -1;
        return a.artist.localeCompare(b.artist, 'cs');
      });
  }, [songs]);

  const letters = useMemo(
    () => [...new Set(artistGroups.map(g => g.letter))].sort((a, b) => a.localeCompare(b, 'cs')),
    [artistGroups]
  );

  // shownLetter lags behind letter by one fade-out, so the outgoing cards can
  // leave before the incoming ones cascade in
  const visibleGroups = shownLetter
    ? artistGroups.filter(g => g.letter === shownLetter)
    : artistGroups;

  /** Scroll a letter under the centre line; the scroll handler adopts it. */
  const centreLetter = useCallback((value: string) => {
    const key = alphaRef.current?.querySelector<HTMLElement>(`[data-letter="${value}"]`);
    key?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, []);

  /**
   * Moves the lens by touching the DOM directly. Re-rendering here would
   * re-filter the artist grid on every letter and kill the fling mid-swipe, so
   * the filter itself is committed only once the strip settles.
   */
  const paintLens = useCallback(() => {
    const strip = alphaRef.current;
    if (!strip) return;
    const middle = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    let nearest: { value: string; distance: number } | null = null;
    const keys = strip.querySelectorAll<HTMLElement>('[data-letter]');
    for (const key of keys) {
      const box = key.getBoundingClientRect();
      const distance = Math.abs(box.left + box.width / 2 - middle);
      if (!nearest || distance < nearest.distance) {
        nearest = { value: key.dataset.letter!, distance };
      }
    }
    if (!nearest || nearest.value === centred.current) return;
    centred.current = nearest.value;
    for (const key of keys) key.classList.toggle('active', key.dataset.letter === nearest.value);
  }, []);

  const handleAlphaScroll = useCallback(() => {
    if (alphaFrame.current === null) {
      alphaFrame.current = requestAnimationFrame(() => {
        alphaFrame.current = null;
        paintLens();
      });
    }
    // Scrolling stopped for a moment: adopt the centred letter as the filter
    if (alphaSettle.current !== null) clearTimeout(alphaSettle.current);
    alphaSettle.current = window.setTimeout(() => {
      alphaSettle.current = null;
      if (centred.current) setLetter(centred.current);
    }, 160);
  }, [paintLens]);

  // A is the opening filter; the strip starts with it under the centre
  useEffect(() => {
    if (letter !== null || letters.length === 0) return;
    const start = letters.includes('A') ? 'A' : letters[0];
    setLetter(start);
    centred.current = start;
    const key = alphaRef.current?.querySelector<HTMLElement>(`[data-letter="${start}"]`);
    key?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [letters, letter]);

  // Fade the old letter's cards out, then swap in the new ones
  useEffect(() => {
    if (letter === shownLetter) return;
    if (shownLetter === null) {
      setShownLetter(letter);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setShownLetter(letter);
      setLeaving(false);
    }, GRID_FADE_MS);
    return () => clearTimeout(timer);
  }, [letter, shownLetter]);

  useEffect(() => () => {
    if (alphaFrame.current !== null) cancelAnimationFrame(alphaFrame.current);
    if (alphaSettle.current !== null) clearTimeout(alphaSettle.current);
  }, []);

  const loadSetlists = useCallback(async () => {
    setSetlists(await getAllSetlists());
  }, []);

  useEffect(() => {
    async function load() {
      const allSongs = await getAllSongs();
      setSongs(allSongs);
      initSearch(allSongs);

      // Ten is what the two-row rail can show without endless sideways scrolling
      const plays = await getRecentPlays(10);
      const resolved: RecentEntry[] = [];
      for (const p of plays) {
        const song = allSongs.find(s => s.id === p.songId);
        if (song) {
          resolved.push({ id: song.id, title: song.index.title, artist: song.index.artist });
        }
      }
      setRecentSongs(resolved);
      saveRecentCache(resolved);
      await loadSetlists();
    }
    load();
  }, [loadSetlists]);

  const handleCreateSetlist = async () => {
    if (!newName?.trim()) return;
    const id = Date.now().toString(36);
    await saveSetlist({ id, name: newName.trim(), songIds: [], createdAt: Date.now() });
    setNewName(null);
    loadSetlists();
  };

  return (
    <div className="screen home-screen">
      <header className="home-header">
        <h1>Zpěvník</h1>

        <div className="info-menu">
          <button
            className={`info-btn ${infoOpen ? 'active' : ''}`}
            onClick={() => setInfoOpen(o => !o)}
            aria-label="O aplikaci"
            aria-expanded={infoOpen}
          >
            <Info size={18} strokeWidth={2.5} />
          </button>

          {infoOpen && (
            <div className="info-dropdown" role="menu">
              <div className="info-version">Verze {__APP_VERSION__}</div>
              <button className="info-action" onClick={() => applyUpdate()}>
                <RefreshCw size={14} />
                Obnovit aplikaci
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Tap anywhere else to dismiss the dropdown */}
      {infoOpen && <div className="info-backdrop" onClick={() => setInfoOpen(false)} />}

      <div className="home-scroll">
        {recentSongs.length > 0 && (
          <section className="home-section">
            <h2>Naposledy hrané</h2>
            {/* Two rows scrolling sideways, same rail as the play screen */}
            <div className="rec-rail">
              {recentSongs.map(r => (
                <div key={r.id} className="song-card" onClick={() => navigate(`/play/${r.id}`)}>
                  <div className="song-card-title">{r.title}</div>
                  <div className="song-card-artist">{r.artist}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="home-section">
          <h2>Setlisty</h2>

          <div className="song-grid">
            {setlists.map(sl => (
              <div
                key={sl.id}
                className="song-card"
                onClick={() => navigate(`/setlist/${sl.id}`)}
              >
                <div className="song-card-title">{sl.name}</div>
                <div className="song-card-artist">{songCountLabel(sl.songIds.length)}</div>
              </div>
            ))}

            {/* Placeholder card that starts a new setlist */}
            <button className="song-card card-add" onClick={() => setNewName('')}>
              <Plus size={20} strokeWidth={2.5} />
              <span>Nový setlist</span>
            </button>
          </div>
        </section>

        <section className="home-section">
          <h2>Interpreti</h2>

          {/* Picker: whatever letter sits under the centre line is the filter */}
          <div className="alpha-picker" ref={alphaRef} onScroll={handleAlphaScroll}>
            {/* No gaps between the buttons: every pixel belongs to a letter,
                the separator dots sit inside the padding and take no taps */}
            <span className="alpha-pad" aria-hidden="true" />
            {letters.map(l => (
              <button
                key={l}
                className={`alpha-key ${letter === l ? 'active' : ''}`}
                data-letter={l}
                onClick={() => centreLetter(l)}
                aria-pressed={letter === l}
              >
                <span className="alpha-glyph">{l}</span>
              </button>
            ))}
            <span className="alpha-pad" aria-hidden="true" />
          </div>

          {/* Keyed by letter, so switching filter replays the cascade */}
          <div
            className={`song-grid reveal-grid ${leaving ? 'leaving' : ''}`}
            key={shownLetter ?? 'all'}
          >
            {visibleGroups.map((g, i) => (
              <div
                key={g.artist}
                className="song-card"
                style={{ animationDelay: `${Math.min(i * 35, 420)}ms` }}
                onClick={() => navigate(`/artist/${encodeURIComponent(g.artist)}`)}
              >
                <div className="song-card-title">{g.artist}</div>
                <div className="song-card-artist">{songCountLabel(g.count)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {newName !== null && (
        <>
          <div className="modal-scrim" onClick={() => setNewName(null)} />
          <div className="modal-card" role="dialog" aria-label="Nový setlist">
            <h3>Nový setlist</h3>
            <input
              type="text"
              placeholder="Název setlistu"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateSetlist();
                if (e.key === 'Escape') setNewName(null);
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setNewName(null)}>Zrušit</button>
              <button
                className="modal-btn primary"
                onClick={handleCreateSetlist}
                disabled={!newName.trim()}
              >
                Vytvořit
              </button>
            </div>
          </div>
        </>
      )}

      <SearchFab
        onPickSong={id => navigate(`/play/${id}`)}
        onPickArtist={artist => navigate(`/artist/${encodeURIComponent(artist)}`)}
      />
    </div>
  );
};
