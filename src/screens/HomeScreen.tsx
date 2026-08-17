import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllSongs, getRecentPlays, getSong } from '../lib/db';
import { initSearch, search as doSearch } from '../lib/search';
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
          </section>
        </>
      )}

      <nav className="bottom-nav">
        <button className="nav-btn active">🏠</button>
        <button className="nav-btn" onClick={() => navigate('/setlists')}>📋</button>
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
