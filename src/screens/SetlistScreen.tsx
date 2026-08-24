import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAllSetlists, getSetlist, saveSetlist, deleteSetlist, getAllSongs } from '../lib/db';
import { FloatingHeader, useHeaderReveal } from '../components/FloatingHeader';
import { SearchFab, SearchPlusIcon, songCountLabel } from '../components/SearchFab';
import { ChevronLeft, Plus, Trash2, X, GripVertical, Pencil, Copy, Ellipsis } from 'lucide-react';
import type { Setlist, Song } from '../types';

/** How long a released row takes to slide into the slot it claimed. */
const ROW_SETTLE_MS = 200;

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
  /** The folded pill's panel of named commands. */
  const [menuOpen, setMenuOpen] = useState(false);
  /** The pill's box, so the panel can start its reveal as exactly that shape. */
  const [morph, setMorph] = useState({ width: 200, height: 56 });
  const pillRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { revealed, heroRef, scrimRef, updateReveal } = useHeaderReveal();
  /** Row being dragged, and the pointer Y its current slot was claimed at. */
  /**
   * A drag in progress: the row it started on, how far it has been moved, and
   * whether it is in the closing beat where it slides into its slot. The order
   * itself is left alone until then — nothing reshuffles under the finger.
   */
  const [drag, setDrag] = useState<{ from: number; offset: number; settling: boolean } | null>(
    null
  );
  /**
   * True for the single frame the new order lands in. Every displaced row is
   * already sitting in its new place, held there by a transform — so when the
   * rewrite moves it there for real and the transform drops to zero, the two
   * cancel out only if neither is animated. Without this the rows jump a place
   * and then slide the same place back.
   */
  const [reordering, setReordering] = useState(false);
  const dragStartY = useRef(0);
  /** Measured once per drag; the rows are uniform. */
  const rowHeight = useRef(56);

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

  /**
   * Folded into the ellipsis, the three actions still need somewhere to be, so
   * the pill unfolds into a panel that names them. Growth starts from the pill's
   * box on screen, measured on the way in, so the panel is the pill's own shape
   * for its first frame however wide the pill happens to be.
   */
  const toggleMenu = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const box = pillRef.current?.getBoundingClientRect();
    setMorph({ width: box?.width ?? 200, height: box?.height ?? 56 });
    setMenuOpen(true);
  }, [menuOpen]);

  /** Every command closes the pill behind it before it does anything else. */
  const runFromMenu = useCallback((action: () => void) => {
    setMenuOpen(false);
    action();
  }, []);

  /*
   * Drag to reorder. The picked-up row tracks the finger exactly and the rows
   * it passes slide a place out of its way, so the list is only ever animated,
   * never reshuffled under the hand. The array is rewritten once, on release,
   * after the row has settled into the slot it is claiming.
   */
  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    rowHeight.current =
      listRef.current?.firstElementChild?.getBoundingClientRect().height ?? 56;
    dragStartY.current = e.clientY;
    setDrag({ from: index, offset: 0, settling: false });
  };

  const onDragMove = (e: React.PointerEvent) => {
    // Read before the updater runs — it may be deferred past this handler
    const y = e.clientY;
    setDrag(d => (d && !d.settling ? { ...d, offset: y - dragStartY.current } : d));
  };

  /** Slot the row is over: whole rows travelled, kept inside the list. */
  const dropIndex = useCallback(
    (d: { from: number; offset: number }, count: number) =>
      Math.max(0, Math.min(count - 1, d.from + Math.round(d.offset / rowHeight.current))),
    []
  );

  /** Let go: run the row the rest of the way into its slot, then rewrite. */
  const endDrag = () => {
    const count = setlist?.songIds.length ?? 0;
    setDrag(d =>
      d && !d.settling
        ? {
            from: d.from,
            offset: (dropIndex(d, count) - d.from) * rowHeight.current,
            settling: true,
          }
        : d
    );
  };

  /*
   * The rewrite waits out the settle, so the row is already sitting exactly
   * where its new index will put it and the swap is invisible.
   */
  useEffect(() => {
    if (!drag?.settling || !setlist) return;
    const to = dropIndex(drag, setlist.songIds.length);
    const commit = setTimeout(() => {
      if (to !== drag.from) {
        const ids = [...setlist.songIds];
        const [moved] = ids.splice(drag.from, 1);
        ids.splice(to, 0, moved);
        // Same batch as the rewrite, so the frame it lands in has no transitions
        setReordering(true);
        persist(ids);
      }
      setDrag(null);
    }, ROW_SETTLE_MS);
    return () => clearTimeout(commit);
  }, [drag, setlist, persist, dropIndex]);

  // One frame is all it takes: by the next, every transform is already zero,
  // so restoring the transitions cannot animate anything.
  useEffect(() => {
    if (!reordering) return;
    const frame = requestAnimationFrame(() => setReordering(false));
    return () => cancelAnimationFrame(frame);
  }, [reordering]);

  if (!setlist) return <div className="screen loading">Načítám…</div>;

  const songsInSetlist = setlist.songIds
    .map(songId => allSongs.find(s => s.id === songId))
    .filter((s): s is Song => !!s);

  /**
   * Where a row sits and what number it wears while a drag is live: the picked
   * row follows the finger, the ones between it and the slot it is over step a
   * place towards where it came from, and the numbers follow the positions so
   * the list reads correctly all the way through the gesture.
   */
  const to = drag ? dropIndex(drag, songsInSetlist.length) : -1;
  const rowShift = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.offset;
    if (drag.from < to && i > drag.from && i <= to) return -rowHeight.current;
    if (drag.from > to && i < drag.from && i >= to) return rowHeight.current;
    return 0;
  };
  const rowNumber = (i: number) => {
    if (!drag) return i + 1;
    if (i === drag.from) return to + 1;
    if (drag.from < to && i > drag.from && i <= to) return i;
    if (drag.from > to && i < drag.from && i >= to) return i + 2;
    return i + 1;
  };

  const actions = [
    { key: 'rename', label: 'Přejmenovat', icon: Pencil, run: () => setRenameTo(setlist.name) },
    { key: 'duplicate', label: 'Duplikovat', icon: Copy, run: handleDuplicate },
    { key: 'delete', label: 'Smazat', icon: Trash2, run: () => setConfirmDelete(true), danger: true },
  ];

  return (
    <div className={`screen setlist-detail-screen ${revealed ? 'tools-collapsed' : ''}`}>
      <FloatingHeader
        title={setlist.name}
        subtitle={songCountLabel(songsInSetlist.length)}
        icon={<X size={20} strokeWidth={2.5} />}
        actionLabel="Zavřít"
        onAction={() => navigate('/')}
        revealed={revealed}
        onTitleClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        scrimRef={scrimRef}
      />

      {/*
        The setlist's own actions, in one pill opposite the close button — the
        same top-right group the song screen carries its tools in. Once the page
        has scrolled the three fold away and only the ellipsis is left, so the
        list gets the top edge back; the panel behind it names them all.
      */}
      <div
        ref={pillRef}
        className={`top-actions more-on-fold ${revealed ? 'collapsed' : ''} ${
          menuOpen ? 'morphed' : ''
        }`}
        role="group"
        aria-label="Akce setlistu"
      >
        {actions.map(a => (
          <button
            key={a.key}
            className={`top-action ${a.danger ? 'danger' : ''}`}
            tabIndex={revealed ? -1 : 0}
            onClick={a.run}
            title={a.label}
            aria-label={a.label}
          >
            <a.icon size={20} strokeWidth={2.5} />
          </button>
        ))}
        <button
          className={`top-action top-action-more ${menuOpen ? 'open' : ''}`}
          tabIndex={revealed ? 0 : -1}
          onClick={toggleMenu}
          title="Další"
          aria-label="Další"
          aria-expanded={menuOpen}
        >
          <Ellipsis size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* Tapping anywhere else folds the panel back into the pill */}
      {menuOpen && <div className="tool-dismiss" onClick={() => setMenuOpen(false)} />}

      {/* Laid out at full size and revealed by an animated clip-path, so nothing
          reflows mid-morph — the same surface the song screen's tools use. */}
      <div
        className={`tool-panel ${menuOpen ? 'open' : ''}`}
        role="dialog"
        aria-label="Akce setlistu"
        aria-hidden={!menuOpen}
        style={{
          '--morph-width': `${morph.width}px`,
          '--morph-height': `${morph.height}px`,
        } as React.CSSProperties}
      >
        <div className="tool-menu">
          {actions.map(a => (
            <button
              key={a.key}
              className={`tool-menu-item ${a.danger ? 'danger' : ''}`}
              onClick={() => runFromMenu(a.run)}
              tabIndex={menuOpen ? 0 : -1}
            >
              <a.icon size={18} strokeWidth={2.5} />
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="page-scroll" ref={scrollRef} onScroll={handleScroll}>
        <header className="hero" ref={heroRef}>
          <h1 className="hero-title">{setlist.name}</h1>
          <div className="hero-meta">
            <span>{songCountLabel(songsInSetlist.length)}</span>
          </div>
        </header>

        {songsInSetlist.length === 0 ? (
          <div className="empty-state">
            Setlist je prázdný — přidej písně hledáním
          </div>
        ) : (
          <div
            className={`setlist-rows ${reordering ? 'reordering' : ''}`}
            ref={listRef}
          >
            {songsInSetlist.map((s, idx) => (
              <div
                key={s.id}
                className={`setlist-row ${drag?.from === idx ? 'dragging' : ''} ${
                  drag?.settling ? 'settling' : ''
                }`}
                style={{ transform: `translateY(${rowShift(idx)}px)` }}
              >
                <span className="setlist-order">{rowNumber(idx)}</span>
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
