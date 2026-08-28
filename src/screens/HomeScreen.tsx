import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllSongs,
  getRecentPlays,
  getAllSetlists,
  saveSetlist,
  getRecentCache,
  saveRecentCache,
  getArtistLetter,
  saveArtistLetter,
  getSetlistCache,
  getWarmLibrary,
  getHomeTab,
  saveHomeTab,
  importSongs,
  warmSong,
  type RecentEntry,
  type HomeTab,
} from '../lib/db';
import { initSearch } from '../lib/search';
import { applyUpdate } from '../lib/version';
import { readSongPack } from '../lib/songpack';
import { SearchFab, songCountLabel } from '../components/SearchFab';
import { Logo } from '../components/Logo';
import { RefreshCw, Plus, Ellipsis, Download, House, Users, ListMusic } from 'lucide-react';
import { UNKNOWN_ARTIST, indexLetter } from '../lib/artists';
import { morphKey, morphNavigate, morphPair } from '../lib/morph';
import type { Song, Setlist } from '../types';

/** How long the outgoing cards take to fade before the next letter arrives. */
const GRID_FADE_MS = 150;

/** The three tabs, in the order the pill lays them out. */
const TABS: { id: HomeTab; label: string; Icon: typeof House }[] = [
  { id: 'home', label: 'Domů', Icon: House },
  { id: 'artists', label: 'Interpreti', Icon: Users },
  { id: 'setlists', label: 'Setlisty', Icon: ListMusic },
];

/** Progress of a song-pack import, or null when no import is in flight. */
type ImportState =
  | { phase: 'working'; done: number; total: number }
  | { phase: 'done'; count: number }
  | { phase: 'error'; message: string }
  | null;

export const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  // The library as it was last read, so the grid is on the page with the screen
  // rather than a frame or two into it — see `getWarmLibrary`.
  const [songs, setSongs] = useState<Song[]>(() => getWarmLibrary() ?? []);
  // Straight from cache, so the rail is on screen before IndexedDB answers
  const [recentSongs, setRecentSongs] = useState<RecentEntry[]>(getRecentCache);
  // Cached too, so coming back from a setlist does not blink the rail out
  const [setlists, setSetlists] = useState<Setlist[]>(getSetlistCache);
  const [newName, setNewName] = useState<string | null>(null);
  // Where the strip was left, so coming home lands on your place in it
  const [letter, setLetter] = useState<string | null>(getArtistLetter);
  const [infoOpen, setInfoOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>(null);
  // Which tab the pill is on, kept across trips home — see `getHomeTab`
  const [tab, setTab] = useState<HomeTab>(getHomeTab);
  // The search field grows across the whole bottom of the screen, over where the
  // tab bar sits, so the bar steps aside while it is open
  const [searchOpen, setSearchOpen] = useState(false);
  const packInput = useRef<HTMLInputElement>(null);
  /**
   * The letter the grid is currently showing, and whether it is on its way out.
   * Seeded from the remembered one as well: null here means "every group", so
   * with a warm library the grid would paint unfiltered for a frame first.
   */
  const [shownLetter, setShownLetter] = useState<string | null>(getArtistLetter);
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

  /**
   * The opening filter, once there are letters to pick from: the one the strip
   * was left on, or A, or whatever the first letter happens to be. A remembered
   * letter whose artists have since gone — a deleted or re-imported library —
   * falls back the same way rather than filtering the grid down to nothing.
   *
   * Runs once per visit to the tab, not once per mount: the strip is unmounted
   * with its tab and comes back scrolled to its start, so without re-centring
   * the first swipe after switching back would adopt whatever letter happened to
   * be near the middle and throw the chosen one away.
   */
  const positioned = useRef(false);
  useEffect(() => {
    if (tab !== 'artists') {
      positioned.current = false;
      return;
    }
    if (positioned.current || letters.length === 0 || !alphaRef.current) return;
    positioned.current = true;
    const start =
      letter && letters.includes(letter) ? letter : letters.includes('A') ? 'A' : letters[0];
    if (start !== letter) setLetter(start);
    centred.current = start;
    const key = alphaRef.current.querySelector<HTMLElement>(`[data-letter="${start}"]`);
    key?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [letters, letter, tab]);

  // Remembered as it is chosen, so the next trip home opens here
  useEffect(() => {
    if (letter) saveArtistLetter(letter);
  }, [letter]);

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

  const loadLibrary = useCallback(async () => {
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
  }, [loadSetlists]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  /** Read the picked song pack and write it into the library. */
  const handlePackPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear it now, so picking the same file again still fires a change event
    e.target.value = '';
    if (!file) return;

    setInfoOpen(false);
    setImportState({ phase: 'working', done: 0, total: 0 });
    try {
      const pack = await readSongPack(file);
      setImportState({ phase: 'working', done: 0, total: pack.length });
      await importSongs(pack, (done, total) => setImportState({ phase: 'working', done, total }));
      await loadLibrary();
      setImportState({ phase: 'done', count: pack.length });
    } catch (err) {
      setImportState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Import se nezdařil.',
      });
    }
  };

  /**
   * Switching tabs: remember it. The scroller is keyed by tab, so the new one
   * mounts at the top by itself — nothing to reset here.
   */
  const pickTab = (next: HomeTab) => {
    if (next === tab) return;
    setTab(next);
    saveHomeTab(next);
  };

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
        {/* The mark and the name as one thing, so the ellipsis keeps its corner */}
        <div className="home-title">
          <Logo className="home-logo" />
          <h1>Zpěvník</h1>
        </div>

        <button
          className={`info-btn ${infoOpen ? 'active' : ''}`}
          onClick={() => setInfoOpen(o => !o)}
          aria-label="O aplikaci"
          aria-expanded={infoOpen}
        >
          <Ellipsis size={20} strokeWidth={2.5} />
        </button>

        {/* iOS offers Files/iCloud from here; .gz packs are unzipped in-app */}
        <input
          ref={packInput}
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          hidden
          onChange={handlePackPicked}
        />
      </header>

      {/*
        Backdrop and panel are siblings of the header, not children of it — the
        same three layers the song screen's tools use: the header band, then the
        dismiss layer over it, then the panel over that. Inside the header they
        would be trapped under its band, since the band has to sit above the
        cards scrolling beneath it.
      */}
      {infoOpen && <div className="info-backdrop" onClick={() => setInfoOpen(false)} />}

      {/* Stays mounted so it can animate shut as well as open; while closed
          it is clipped to the button's own square and made invisible. */}
      <div className={`info-dropdown ${infoOpen ? 'open' : ''}`} role="menu">
        <div className="info-version">Verze {__APP_VERSION__}</div>
        <button className="info-action" onClick={() => applyUpdate()} tabIndex={infoOpen ? 0 : -1}>
          <RefreshCw size={14} />
          Obnovit aplikaci
        </button>
        <button
          className="info-action"
          onClick={() => packInput.current?.click()}
          tabIndex={infoOpen ? 0 : -1}
        >
          <Download size={14} />
          Importovat písně
        </button>
      </div>

      {/* Keyed by tab, so each one arrives with its own short fade-up */}
      <div className="home-scroll" key={tab}>
        {tab === 'home' && (
          <section className="home-section tab-panel">
            <h2>Naposledy hrané</h2>
            {recentSongs.length === 0 ? (
              <div className="section-empty">
                Zatím nic zahraného — najdi píseň lupou v pravém dolním rohu.
              </div>
            ) : (
              <div className="song-grid">
                {recentSongs.map(r => (
                  <div
                    key={r.id}
                    className="song-card"
                    {...morphPair(morphKey.song(r.id))}
                    onClick={() =>
                      morphNavigate(
                        morphKey.song(r.id),
                        () => navigate(`/play/${r.id}`),
                        () => warmSong(r.id)
                      )
                    }
                  >
                    <div className="song-card-title">{r.title}</div>
                    <div className="song-card-artist">{r.artist}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'setlists' && (
          <section className="home-section tab-panel">
            {/* The whole tab is setlists now, so they get the grid rather than a
                rail — no sideways scrolling to reach the fifth one. */}
            <div className="song-grid">
              {setlists.map(sl => (
                <div
                  key={sl.id}
                  className="song-card"
                  {...morphPair(morphKey.setlist(sl.id))}
                  onClick={() =>
                    morphNavigate(morphKey.setlist(sl.id), () => navigate(`/setlist/${sl.id}`))
                  }
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
        )}

        {tab === 'artists' && (
          <section className="home-section tab-panel">
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
                  {...morphPair(morphKey.artist(g.artist))}
                  onClick={() =>
                    morphNavigate(morphKey.artist(g.artist), () =>
                      navigate(`/artist/${encodeURIComponent(g.artist)}`)
                    )
                  }
                >
                  <div className="song-card-title">{g.artist}</div>
                  <div className="song-card-artist">{songCountLabel(g.count)}</div>
                </div>
              ))}
            </div>
          </section>
        )}
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

      {importState && (
        <>
          {/* No dismiss-on-tap while writing — a half-finished import would
              leave the grid disagreeing with the database. */}
          <div
            className="modal-scrim"
            onClick={() => importState.phase !== 'working' && setImportState(null)}
          />
          <div className="modal-card" role="dialog" aria-label="Import písní">
            <h3>Import písní</h3>

            {importState.phase === 'working' && (
              <>
                <p className="import-status" aria-live="polite">
                  {importState.total
                    ? `Ukládám ${importState.done} z ${importState.total} písní…`
                    : 'Načítám balíček…'}
                </p>
                <div className="import-bar">
                  <div
                    className="import-bar-fill"
                    style={{
                      width: importState.total
                        ? `${Math.round((importState.done / importState.total) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
              </>
            )}

            {importState.phase === 'done' && (
              <p className="import-status">
                Hotovo — {songCountLabel(importState.count)} v knihovně.
              </p>
            )}

            {importState.phase === 'error' && (
              <p className="import-status error">{importState.message}</p>
            )}

            <div className="modal-actions">
              <button
                className="modal-btn primary"
                onClick={() => setImportState(null)}
                disabled={importState.phase === 'working'}
              >
                {importState.phase === 'working' ? 'Probíhá…' : 'Zavřít'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Tab bar: the bottom-left corner, opposite the search button. Icon over
          label, with a thumb that slides to whichever tab was tapped. */}
      <div
        className={`tab-pill ${searchOpen ? 'tucked' : ''}`}
        role="tablist"
        aria-label="Sekce"
      >
        <span
          className="tab-pill-thumb"
          aria-hidden="true"
          style={{ '--tab-index': TABS.findIndex(t => t.id === tab) } as React.CSSProperties}
        />
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`tab-pill-btn ${tab === id ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === id}
            onClick={() => pickTab(id)}
          >
            <Icon size={19} strokeWidth={tab === id ? 2.5 : 2} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <SearchFab
        onOpenChange={setSearchOpen}
        onPickSong={id =>
          morphNavigate(
            morphKey.song(id),
            () => navigate(`/play/${id}`),
            () => warmSong(id)
          )
        }
        onPickArtist={artist =>
          morphNavigate(morphKey.artist(artist), () =>
            navigate(`/artist/${encodeURIComponent(artist)}`)
          )
        }
      />
    </div>
  );
};
