import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllSongs, getRecentPlays, getSong } from '../lib/db';
import { initSearch, search as doSearch } from '../lib/search';
import { applyUpdate } from '../lib/version';
import type { Song, PlayRecord } from '../types';

export const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [recentPlays, setRecentPlays] = useState<PlayRecord[]>([]);
  const [recentSongs, setRecentSongs] = useState<Song[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const allSongs = await getAllSongs();
      setSongs(allSongs);
      initSearch(allSongs);

      const plays = await getRecentPlays(20);
      setRecentPlays(plays);

      // Resolve recent songs
      const resolved: Song[] = [];
      for (const p of plays) {
        const s = allSongs.find(s => s.id === p.songId);
        if (s) resolved.push(s);
      }
      setRecentSongs(resolved);
      setLoaded(true);
    }
    load();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (query.trim()) {
      setSearchResults(doSearch(query));
    } else {
      setSearchResults([]);
    }
  }, [query, loaded]);

  const showSearch = query.trim().length > 0;

  return (
    <div className="screen home-screen">
      <header className="home-header">
        <h1>Zpěvník</h1>
      </header>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Hledat píseň…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
        />
        {query && (
          <button className="clear-btn" onClick={() => setQuery('')}>✕</button>
        )}
      </div>

      <div className="home-scroll">
        {showSearch ? (
          <div className="search-results">
            {searchResults.length === 0 ? (
              <div className="empty-state">Nic nenalezeno</div>
            ) : (
              searchResults.map(s => (
                <SongListItem key={s.id} song={s} onClick={() => navigate(`/play/${s.id}`)} />
              ))
            )}
          </div>
        ) : (
          <>
            {recentSongs.length > 0 && (
              <section className="home-section">
                <h2>Naposledy hrané</h2>
                {recentSongs.map(s => (
                  <SongListItem key={s.id} song={s} onClick={() => navigate(`/play/${s.id}`)} />
                ))}
              </section>
            )}

            <section className="home-section">
              <h2>Všechny písně</h2>
              {songs
                .sort((a, b) => a.index.title.localeCompare(b.index.title, 'cs'))
                .map(s => (
                  <SongListItem key={s.id} song={s} onClick={() => navigate(`/play/${s.id}`)} />
                ))}
              <button className="reload-btn" onClick={() => applyUpdate()}>
                Obnovit aplikaci<span className="reload-version"> v{__APP_VERSION__}</span>
              </button>
            </section>
          </>
        )}
      </div>

      <nav className="bottom-nav">
        <button className="nav-btn active" aria-label="Domů">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </button>
        <button className="nav-btn" onClick={() => navigate('/setlists')} aria-label="Setlisty">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
      </nav>
    </div>
  );
};

interface SongListItemProps {
  song: Song;
  onClick: () => void;
}

const SongListItem: React.FC<SongListItemProps> = ({ song, onClick }) => (
  <div className="song-list-item" onClick={onClick}>
    <div className="song-title">{song.index.title}</div>
    <div className="song-artist">{song.index.artist}</div>
  </div>
);
