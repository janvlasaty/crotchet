import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Plus, Check } from 'lucide-react';
import { getAllSongs } from '../lib/db';
import { initSearch, isSearchReady, search, searchArtists, type ArtistHit } from '../lib/search';
import type { Song } from '../types';

/** Lens with a plus, for the screens where searching means adding. */
export const SearchPlusIcon: React.FC = () => (
  <span className="icon-stack">
    <Search size={22} strokeWidth={2.5} />
    <Plus size={13} strokeWidth={4} className="icon-badge" />
  </span>
);

interface SearchFabProps {
  onPickSong: (songId: string) => void;
  onPickArtist: (artist: string) => void;
  /** Extra classes on the pill — used to place it inside another control bar. */
  className?: string;
  /** Tucked away (scaled out) while some other control owns the corner. */
  hidden?: boolean;
  /** Glyph on the collapsed circle — a plain lens unless told otherwise. */
  icon?: React.ReactNode;
  /**
   * Stay open after a pick and tick off what has already been taken, so several
   * songs can be picked in one go.
   */
  multiPick?: boolean;
  /** Ids already in the target collection; shown with a check. */
  pickedIds?: string[];
}

/**
 * Circle that morphs into a search field, with the results filling the screen
 * above it. Shared by the home screen and the end of a song.
 */
export const SearchFab: React.FC<SearchFabProps> = ({
  onPickSong,
  onPickArtist,
  className = '',
  hidden = false,
  icon,
  multiPick = false,
  pickedIds,
}) => {
  const [ready, setReady] = useState(isSearchReady());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [songResults, setSongResults] = useState<Song[]>([]);
  const [artistResults, setArtistResults] = useState<ArtistHit[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;
    const q = query.trim();
    setSongResults(q ? search(q) : []);
    setArtistResults(q ? searchArtists(q).slice(0, 8) : []);
  }, [query, ready]);

  const openSearch = useCallback(() => {
    setOpen(true);
    // Focus after the expand starts so iOS keeps the caret inside the growing pill
    requestAnimationFrame(() => input.current?.focus());
    if (isSearchReady()) {
      // Built by the screen after this component mounted — pick it up now
      setReady(true);
    } else {
      // Deep-linked into a song: nothing has built the index yet
      getAllSongs().then(songs => {
        initSearch(songs);
        setReady(true);
      });
    }
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery('');
    input.current?.blur();
  }, []);

  const picked = useMemo(() => new Set(pickedIds ?? []), [pickedIds]);

  const pickSong = (songId: string) => {
    // Collecting songs: the overlay stays put so the next one is a tap away
    if (!multiPick) closeSearch();
    onPickSong(songId);
  };

  const pickArtist = (artist: string) => {
    closeSearch();
    onPickArtist(artist);
  };

  const hasQuery = query.trim() !== '';

  return (
    <>
      {/* Blurred scrim: dims the page behind, and tapping it closes the search */}
      <div className={`search-dismiss ${open ? 'visible' : ''}`} onClick={closeSearch} />

      {open && hasQuery && (
        <div className="search-results">
          {songResults.length === 0 && artistResults.length === 0 ? (
            <div className="empty-state">Nic nenalezeno</div>
          ) : (
            <>
              {/* Labels only earn their place when both kinds of result are present */}
              {artistResults.length > 0 && (
                <>
                  {songResults.length > 0 && <div className="search-group-label">Interpreti</div>}
                  <div className="song-grid">
                    {artistResults.map(a => (
                      <div
                        key={a.artist}
                        className="song-card search-artist-card"
                        onClick={() => pickArtist(a.artist)}
                      >
                        <div className="song-card-title">{a.artist}</div>
                        <div className="song-card-artist">{songCountLabel(a.count)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {songResults.length > 0 && (
                <>
                  {artistResults.length > 0 && <div className="search-group-label">Písně</div>}
                  <div className="song-grid">
                    {songResults.map(s => (
                      <div
                        key={s.id}
                        className={`song-card ${picked.has(s.id) ? 'picked' : ''}`}
                        onClick={() => pickSong(s.id)}
                      >
                        {picked.has(s.id) && (
                          <span className="card-check" aria-label="Přidáno">
                            <Check size={12} strokeWidth={4} />
                          </span>
                        )}
                        <div className="song-card-title">{s.index.title}</div>
                        <div className="song-card-artist">{s.index.artist}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Fade under the field so scrolled results dissolve into black */}
      <div className={`search-fade ${open ? 'visible' : ''}`} />

      {/* One element that morphs: circle → pill with the field inside */}
      <div className={`search-fab ${open ? 'open' : ''} ${hidden ? 'tucked' : ''} ${className}`}>
        <button
          className="search-fab-trigger"
          onClick={openSearch}
          aria-label="Hledat"
          aria-hidden={open}
        >
          {icon ?? <Search size={22} strokeWidth={2.5} />}
        </button>
        <input
          ref={input}
          type="text"
          placeholder="Hledat píseň…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && closeSearch()}
          autoComplete="off"
          autoCorrect="off"
          tabIndex={open ? 0 : -1}
        />
        <button
          className="search-fab-close"
          onClick={closeSearch}
          aria-label="Zavřít"
          tabIndex={open ? 0 : -1}
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>
    </>
  );
};

/** Czech plural for the song count on an artist card. */
export function songCountLabel(n: number): string {
  if (n === 1) return '1 píseň';
  if (n < 5) return `${n} písně`;
  return `${n} písní`;
}
