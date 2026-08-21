import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllSongs, getRecentPlays, getAllSetlists, saveSetlist } from '../lib/db';
import { initSearch, search as doSearch } from '../lib/search';
import { applyUpdate } from '../lib/version';
import { Search, X, RefreshCw, Plus, ChevronRight } from 'lucide-react';
import { UNKNOWN_ARTIST, indexLetter } from '../lib/artists';
import type { Song, Setlist } from '../types';

export const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [recentSongs, setRecentSongs] = useState<Song[]>([]);
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

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

  const visibleGroups = letter ? artistGroups.filter(g => g.letter === letter) : artistGroups;

  const loadSetlists = useCallback(async () => {
    setSetlists(await getAllSetlists());
  }, []);

  useEffect(() => {
    async function load() {
      const allSongs = await getAllSongs();
      setSongs(allSongs);
      initSearch(allSongs);

      const plays = await getRecentPlays(20);
      const resolved: Song[] = [];
      for (const p of plays) {
        const s = allSongs.find(s => s.id === p.songId);
        if (s) resolved.push(s);
      }
      setRecentSongs(resolved);
      await loadSetlists();
      setLoaded(true);
    }
    load();
  }, [loadSetlists]);

  useEffect(() => {
    if (!loaded) return;
    setSearchResults(query.trim() ? doSearch(query) : []);
  }, [query, loaded]);

  const openSearch = () => {
    setSearchOpen(true);
    // Focus after the expand starts so iOS keeps the caret inside the growing pill
    requestAnimationFrame(() => searchInput.current?.focus());
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    searchInput.current?.blur();
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
        <h1>Zpěvník</h1>
      </header>

      <div className="home-scroll">
        {recentSongs.length > 0 && (
          <section className="home-section">
            <h2>Naposledy hrané</h2>
            <div className="song-grid">
              {recentSongs.map(s => (
                <SongCard key={s.id} song={s} onClick={() => navigate(`/play/${s.id}`)} />
              ))}
            </div>
          </section>
        )}

        <section className="home-section">
          <div className="section-head">
            <h2>Setlisty</h2>
            <button
              className="section-action"
              onClick={() => setNewName(newName === null ? '' : null)}
              aria-label="Nový setlist"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>

          {newName !== null && (
            <div className="inline-create">
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
              <button onClick={handleCreateSetlist}>Vytvořit</button>
            </div>
          )}

          {setlists.length === 0 && newName === null ? (
            <div className="section-empty">Žádné setlisty</div>
          ) : (
            setlists.map(sl => (
              <div key={sl.id} className="setlist-row" onClick={() => navigate(`/setlist/${sl.id}`)}>
                <div>
                  <div className="song-title">{sl.name}</div>
                  <div className="song-artist">{sl.songIds.length} písní</div>
                </div>
                <ChevronRight size={18} className="row-chevron" />
              </div>
            ))
          )}
        </section>

        <section className="home-section">
          <div className="section-head">
            <h2>Interpreti</h2>
            {letter && (
              <button className="section-action" onClick={() => setLetter(null)} aria-label="Zrušit filtr">
                <X size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="alpha-strip">
            {letters.map(l => (
              <button
                key={l}
                className={`alpha-key ${letter === l ? 'active' : ''}`}
                onClick={() => setLetter(letter === l ? null : l)}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="song-grid">
            {visibleGroups.map(g => (
              <div
                key={g.artist}
                className="song-card"
                onClick={() => navigate(`/artist/${encodeURIComponent(g.artist)}`)}
              >
                <div className="song-card-title">{g.artist}</div>
                <div className="song-card-artist">{songCountLabel(g.count)}</div>
              </div>
            ))}
          </div>

          <button className="reload-btn" onClick={() => applyUpdate()}>
            <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Obnovit aplikaci<span className="reload-version"> v{__APP_VERSION__}</span>
          </button>
        </section>
      </div>

      {/* Transparent catcher: tapping the page behind closes the search */}
      {searchOpen && <div className="search-dismiss" onClick={closeSearch} />}

      {searchOpen && query.trim() !== '' && (
        <div className="search-dropdown">
          {searchResults.length === 0 ? (
            <div className="empty-state">Nic nenalezeno</div>
          ) : (
            <div className="search-dropdown-list">
              {searchResults.map(s => (
                <SongListItem key={s.id} song={s} onClick={() => navigate(`/play/${s.id}`)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* One element that morphs: circle → pill with the field inside */}
      <div className={`search-fab ${searchOpen ? 'open' : ''}`}>
        <button
          className="search-fab-trigger"
          onClick={openSearch}
          aria-label="Hledat"
          aria-hidden={searchOpen}
        >
          <Search size={22} strokeWidth={2.5} />
        </button>
        <input
          ref={searchInput}
          type="text"
          placeholder="Hledat píseň…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && closeSearch()}
          autoComplete="off"
          autoCorrect="off"
          tabIndex={searchOpen ? 0 : -1}
        />
        <button className="search-fab-close" onClick={closeSearch} aria-label="Zavřít" tabIndex={searchOpen ? 0 : -1}>
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

/** Czech plural for the song count on an artist card. */
function songCountLabel(n: number): string {
  if (n === 1) return '1 píseň';
  if (n < 5) return `${n} písně`;
  return `${n} písní`;
}

interface SongItemProps {
  song: Song;
  onClick: () => void;
  /** Hide the artist line where the surrounding group already names them. */
  hideArtist?: boolean;
}

const SongCard: React.FC<SongItemProps> = ({ song, onClick }) => (
  <div className="song-card" onClick={onClick}>
    <div className="song-card-title">{song.index.title}</div>
    <div className="song-card-artist">{song.index.artist}</div>
  </div>
);

const SongListItem: React.FC<SongItemProps> = ({ song, onClick, hideArtist }) => (
  <div className="song-list-item" onClick={onClick}>
    <div className="song-title">{song.index.title}</div>
    {!hideArtist && <div className="song-artist">{song.index.artist}</div>}
  </div>
);
