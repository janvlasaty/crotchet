import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAllSetlists, saveSetlist, deleteSetlist, getAllSongs } from '../lib/db';
import { Home, ListMusic, ChevronLeft, Plus, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react';
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

      <nav className="bottom-nav">
        <button className="nav-btn" onClick={() => navigate('/')} aria-label="Domů">
          <Home size={22} strokeWidth={2.5} />
          <span className="nav-label">Domů</span>
        </button>
        <button className="nav-btn active" aria-label="Setlisty">
          <ListMusic size={22} strokeWidth={2.5} />
          <span className="nav-label">Setlisty</span>
        </button>
      </nav>
    </div>
  );
};

export const SetlistDetailScreen: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [setlist, setSetlist] = useState<Setlist | null>(null);
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    async function load() {
      const { getSetlist } = await import('../lib/db');
      if (!id) return;
      const sl = await getSetlist(id);
      if (sl) setSetlist(sl);
      const songs = await getAllSongs();
      setAllSongs(songs);
    }
    load();
  }, [id]);

  const handleAddSong = async (songId: string) => {
    if (!setlist) return;
    const updated = { ...setlist, songIds: [...setlist.songIds, songId] };
    await saveSetlist(updated);
    setSetlist(updated);
    setShowAdd(false);
  };

  const handleRemoveSong = async (songId: string) => {
    if (!setlist) return;
    const updated = { ...setlist, songIds: setlist.songIds.filter(s => s !== songId) };
    await saveSetlist(updated);
    setSetlist(updated);
  };

  const handleMoveSong = async (fromIdx: number, toIdx: number) => {
    if (!setlist) return;
    const ids = [...setlist.songIds];
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    const updated = { ...setlist, songIds: ids };
    await saveSetlist(updated);
    setSetlist(updated);
  };

  if (!setlist) return <div className="screen loading">Načítám…</div>;

  const songsInSetlist = setlist.songIds
    .map(id => allSongs.find(s => s.id === id))
    .filter((s): s is Song => !!s);

  const songsNotInSetlist = allSongs.filter(s => !setlist.songIds.includes(s.id));

  return (
    <div className="screen setlist-detail-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/setlists')}><ChevronLeft size={24} strokeWidth={2.5} /></button>
        <h1>{setlist.name}</h1>
        <button className="add-btn" onClick={() => setShowAdd(!showAdd)}><Plus size={24} strokeWidth={2.5} /></button>
      </header>

      {showAdd && (
        <div className="add-song-list">
          <h3>Přidat píseň</h3>
          {songsNotInSetlist.map(s => (
            <div key={s.id} className="song-list-item" onClick={() => handleAddSong(s.id)}>
              <div className="song-title">{s.index.title}</div>
              <div className="song-artist">{s.index.artist}</div>
            </div>
          ))}
        </div>
      )}

      <div className="setlist-songs">
        {songsInSetlist.map((s, idx) => (
          <div key={s.id} className="setlist-song-item">
            <span className="song-order">{idx + 1}.</span>
            <div className="song-info" onClick={() => navigate(`/play/${s.id}?setlist=${setlist.id}&idx=${idx}`)}>
              <div className="song-title">{s.index.title}</div>
              <div className="song-artist">{s.index.artist}</div>
            </div>
            <div className="song-actions">
              {idx > 0 && <button onClick={() => handleMoveSong(idx, idx - 1)}><ChevronUp size={16} /></button>}
              {idx < songsInSetlist.length - 1 && <button onClick={() => handleMoveSong(idx, idx + 1)}><ChevronDown size={16} /></button>}
              <button onClick={() => handleRemoveSong(s.id)}><X size={16} /></button>
            </div>
          </div>
        ))}
        {songsInSetlist.length === 0 && (
          <div className="empty-state">Setlist je prázdný</div>
        )}
      </div>
    </div>
  );
};
