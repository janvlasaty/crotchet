import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAllSongs } from '../lib/db';
import { UNKNOWN_ARTIST } from '../lib/artists';
import { FloatingHeader, useHeaderReveal } from '../components/FloatingHeader';
import { X } from 'lucide-react';
import type { Song } from '../types';

/** All songs by one artist, as a card grid. */
export const ArtistScreen: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { revealed, heroRef, scrimRef, updateReveal } = useHeaderReveal();

  const artist = name ? decodeURIComponent(name) : '';

  useEffect(() => {
    getAllSongs().then(setSongs);
  }, []);

  const artistSongs = useMemo(() => {
    if (!songs) return [];
    return songs
      .filter(s => (s.index.artist?.trim() || UNKNOWN_ARTIST) === artist)
      .sort((a, b) => a.index.title.localeCompare(b.index.title, 'cs'));
  }, [songs, artist]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) updateReveal(el);
  }, [updateReveal]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="screen artist-screen">
      <FloatingHeader
        title={artist}
        icon={<X size={20} strokeWidth={2.5} />}
        actionLabel="Zavřít"
        onAction={() => navigate('/')}
        revealed={revealed}
        onTitleClick={scrollToTop}
        scrimRef={scrimRef}
      />

      <div className="artist-scroll" ref={scrollRef} onScroll={handleScroll}>
        <header className="hero" ref={heroRef}>
          <h1 className="hero-title">{artist}</h1>
          {artistSongs.length > 0 && (
            <div className="hero-meta">
              <span>{artistSongs.length} písní</span>
            </div>
          )}
        </header>

        {songs === null ? null : artistSongs.length === 0 ? (
          <div className="empty-state">Žádné písně</div>
        ) : (
          <div className="song-grid">
            {artistSongs.map(s => (
              <div key={s.id} className="song-card" onClick={() => navigate(`/play/${s.id}`)}>
                <div className="song-card-title">{s.index.title}</div>
                {s.index.originalKey && (
                  <div className="song-card-artist">{s.index.originalKey}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
