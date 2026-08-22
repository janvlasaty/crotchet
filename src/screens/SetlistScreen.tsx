import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAllSetlists, getSetlist, saveSetlist, deleteSetlist, getAllSongs } from '../lib/db';
import { FloatingHeader, useHeaderReveal } from '../components/FloatingHeader';
import { SearchFab, SearchPlusIcon, songCountLabel } from '../components/SearchFab';
import { ChevronLeft, Plus, Trash2, X, GripVertical } from 'lucide-react';
import type { Setlist, Song } from '../types';

export const SetlistScreen: React.FC = () => {
  const navigate = useNavigate();
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const loadSetlists = useCallback(async () => {
    const all = await getAllSetlists();
    setSetlists(all);
  }, []);

  useEffect(() => { loadSetlists(); }, [loadSetlists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const id = Date.now().toString(36);
    await saveSetlist({ id, name: newName.trim(), songIds: [], createdAt: Date.now() });
    setNewName('');
    setShowCreate(false);
    loadSetlists();
  };

  const handleDelete = async (id: string) => {
    await deleteSetlist(id);
    loadSetlists();
  };

  return (
    <div className="screen setlist-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}><ChevronLeft size={24} strokeWidth={2.5} /></button>
        <h1>Setlisty</h1>
        <button className="add-btn" onClick={() => setShowCreate(true)}><Plus size={24} strokeWidth={2.5} /></button>
      </header>

      {showCreate && (
        <div className="create-setlist">
          <input
            type="text"
            placeholder="Název setlistu"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <button onClick={handleCreate}>Vytvořit</button>
          <button onClick={() => setShowCreate(false)}>Zrušit</button>
        </div>
      )}

      <div className="setlist-list">
        {setlists.map(sl => (
          <div key={sl.id} className="setlist-item">
            <div className="setlist-info" onClick={() => navigate(`/setlist/${sl.id}`)}>
              <div className="setlist-name">{sl.name}</div>
              <div className="setlist-count">{sl.songIds.length} písní</div>
            </div>
            <button className="delete-btn" onClick={() => handleDelete(sl.id)} aria-label="Smazat">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        {setlists.length === 0 && (
          <div className="empty-state">Žádné setlisty</div>
        )}
      </div>
    </div>
  );
};

export const SetlistDetailScreen: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [setlist, setSetlist] = useState<Setlist | null>(null);
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Non-null while the rename dialog is open, holding the edited name. */
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { revealed, heroRef, scrimRef, updateReveal } = useHeaderReveal();
  /** Row being dragged, and the pointer Y its current slot was claimed at. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragAnchorY = useRef(0);

  useEffect(() => {
    if (!id) return;
    Promise.all([getSetlist(id), getAllSongs()]).then(([sl, songs]) => {
      if (sl) setSetlist(sl);
      setAllSongs(songs);
    });
  }, [id]);

  const persist = useCallback(async (songIds: string[]) => {
    setSetlist(current => {
      if (!current) return current;
      const updated = { ...current, songIds };
      saveSetlist(updated);
      return updated;
    });
  }, []);

  /** Search picks toggle membership, so a mis-tap is undone with a second tap. */
  const handleToggleSong = useCallback((songId: string) => {
    setSetlist(current => {
      if (!current) return current;
      const songIds = current.songIds.includes(songId)
        ? current.songIds.filter(s => s !== songId)
        : [...current.songIds, songId];
      const updated = { ...current, songIds };
      saveSetlist(updated);
      return updated;
    });
  }, []);

  const handleRemoveSong = useCallback(
    (songId: string) => {
      setSetlist(current => {
        if (!current) return current;
        const updated = { ...current, songIds: current.songIds.filter(s => s !== songId) };
        saveSetlist(updated);
        return updated;
      });
    },
    []
  );

  /** Copy under a fresh id, then open it — the original is left alone. */
  const handleDuplicate = useCallback(async () => {
    if (!setlist) return;
    const copy: Setlist = {
      id: Date.now().toString(36),
      name: `${setlist.name} (kopie)`,
      songIds: [...setlist.songIds],
      createdAt: Date.now(),
    };
    await saveSetlist(copy);
    navigate(`/setlist/${copy.id}`, { replace: true });
  }, [setlist, navigate]);

  const handleRename = useCallback(async () => {
    const name = renameTo?.trim();
    if (!setlist || !name) return;
    const updated = { ...setlist, name };
    await saveSetlist(updated);
    setSetlist(updated);
    setRenameTo(null);
  }, [renameTo, setlist]);

  const handleDeleteSetlist = useCallback(async () => {
    if (!id) return;
    await deleteSetlist(id);
    navigate('/', { replace: true });
  }, [id, navigate]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) updateReveal(el);
  }, [updateReveal]);

  /* Drag to reorder: the list reshuffles under the finger as it crosses rows,
     so there is no ghost element to position. */
  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragAnchorY.current = e.clientY;
    setDragIndex(index);
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (dragIndex === null || !setlist) return;
    const rowHeight = listRef.current?.firstElementChild?.getBoundingClientRect().height ?? 56;
    const delta = e.clientY - dragAnchorY.current;
    if (Math.abs(delta) < rowHeight * 0.6) return;

    const direction = delta > 0 ? 1 : -1;
    const target = dragIndex + direction;
    if (target < 0 || target >= setlist.songIds.length) return;

    const ids = [...setlist.songIds];
    [ids[dragIndex], ids[target]] = [ids[target], ids[dragIndex]];
    persist(ids);
    dragAnchorY.current += direction * rowHeight;
    setDragIndex(target);
  };

  const endDrag = () => setDragIndex(null);

  if (!setlist) return <div className="screen loading">Načítám…</div>;

  const songsInSetlist = setlist.songIds
    .map(songId => allSongs.find(s => s.id === songId))
    .filter((s): s is Song => !!s);

  return (
    <div className="screen setlist-detail-screen">
      <FloatingHeader
        title={setlist.name}
        subtitle={songCountLabel(songsInSetlist.length)}
        icon={<X size={22} strokeWidth={2.5} />}
        actionLabel="Zavřít"
        onAction={() => navigate('/')}
        revealed={revealed}
        onTitleClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        scrimRef={scrimRef}
      />

      <div className="page-scroll" ref={scrollRef} onScroll={handleScroll}>
        <header className="hero" ref={heroRef}>
          <h1 className="hero-title">{setlist.name}</h1>
          <div className="hero-meta">
            <span>{songCountLabel(songsInSetlist.length)}</span>
            <button className="meta-chip" onClick={() => setRenameTo(setlist.name)}>
              PŘEJMENOVAT
            </button>
            <button className="meta-chip" onClick={handleDuplicate}>
              DUPLIKOVAT
            </button>
            <button className="meta-chip danger" onClick={() => setConfirmDelete(true)}>
              SMAZAT
            </button>
          </div>
        </header>

        {songsInSetlist.length === 0 ? (
          <div className="empty-state">
            Setlist je prázdný — přidej písně hledáním
          </div>
        ) : (
          <div className="setlist-rows" ref={listRef}>
            {songsInSetlist.map((s, idx) => (
              <div key={s.id} className={`setlist-row ${dragIndex === idx ? 'dragging' : ''}`}>
                <span className="setlist-order">{idx + 1}</span>
                <div
                  className="setlist-row-main"
                  // The play screen finds its place in the queue from the song id
                  onClick={() => navigate(`/play/${s.id}?setlist=${setlist.id}`)}
                >
                  <div className="song-title">{s.index.title}</div>
                  <div className="song-artist">{s.index.artist}</div>
                </div>
                <button
                  className="setlist-row-btn"
                  onClick={() => handleRemoveSong(s.id)}
                  aria-label="Odebrat ze setlistu"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
                <button
                  className="setlist-row-btn drag-handle"
                  onPointerDown={startDrag(idx)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  aria-label="Přesunout"
                >
                  <GripVertical size={18} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {renameTo !== null && (
        <>
          <div className="modal-scrim" onClick={() => setRenameTo(null)} />
          <div className="modal-card" role="dialog" aria-label="Přejmenovat setlist">
            <h3>Přejmenovat setlist</h3>
            <input
              type="text"
              placeholder="Název setlistu"
              value={renameTo}
              onChange={e => setRenameTo(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setRenameTo(null);
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setRenameTo(null)}>Zrušit</button>
              <button
                className="modal-btn primary"
                onClick={handleRename}
                disabled={!renameTo.trim()}
              >
                Uložit
              </button>
            </div>
          </div>
        </>
      )}

      {confirmDelete && (
        <>
          <div className="modal-scrim" onClick={() => setConfirmDelete(false)} />
          <div className="modal-card" role="dialog" aria-label="Smazat setlist">
            <h3>Smazat „{setlist.name}“?</h3>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setConfirmDelete(false)}>Zrušit</button>
              <button className="modal-btn primary" onClick={handleDeleteSetlist}>Smazat</button>
            </div>
          </div>
        </>
      )}

      {/* The same search as everywhere else, wired to add rather than navigate */}
      <SearchFab
        icon={<SearchPlusIcon />}
        multiPick
        pickedIds={setlist.songIds}
        onPickSong={handleToggleSong}
        onPickArtist={artist => navigate(`/artist/${encodeURIComponent(artist)}`)}
      />
    </div>
  );
};
