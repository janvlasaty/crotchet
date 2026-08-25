import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAllSongs, getWarmLibrary, warmSong } from '../lib/db';
import { UNKNOWN_ARTIST } from '../lib/artists';
import { FloatingHeader, useHeaderReveal } from '../components/FloatingHeader';
import { ChevronLeft } from 'lucide-react';
import { useCloseScreen } from '../hooks/useCloseScreen';
import { morphKey, morphNavigate, morphPair } from '../lib/morph';
import type { Song } from '../types';

/** All songs by one artist, as a card grid. */
export const ArtistScreen: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  /**
   * Seeded from the library the home screen has already read, so the grid is on
   * the page from the first frame — the card that opened this screen is morphing
   * into its hero, and a screen still saying nothing while that happens arrives
   * as a blank cross-fade instead.
   */
  const [songs, setSongs] = useState<Song[] | null>(getWarmLibrary);
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

  /** Back to whatever opened this artist — home, a song, a setlist. */
  const handleClose = useCloseScreen(morphKey.artist(artist), '/');

  return (
    <div className="screen artist-screen">
      <FloatingHeader
        title={artist}
        icon={<ChevronLeft size={22} strokeWidth={2.5} />}
        actionLabel="Zpět"
        onAction={handleClose}
        revealed={revealed}
        onTitleClick={scrollToTop}
        scrimRef={scrimRef}
      />

      <div className="artist-scroll" ref={scrollRef} onScroll={handleScroll}>
        {/* The card that opened this screen grew into this block, and closing
            shrinks it back into the same one — see src/lib/morph.ts */}
        <header className="hero" ref={heroRef} {...morphPair(morphKey.artist(artist))}>
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
              <div
                key={s.id}
                className="song-card"
                {...morphPair(morphKey.song(s.id))}
                // The artist rides along in the URL, so closing the song comes
                // back here for as long as its suggestions stay on this artist
                onClick={() =>
                  morphNavigate(
                    morphKey.song(s.id),
                    () => navigate(`/play/${s.id}?artist=${encodeURIComponent(artist)}`),
                    () => warmSong(s.id)
                  )
                }
              >
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
