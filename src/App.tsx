import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomeScreen } from './screens/HomeScreen';
import { PlayScreen } from './screens/PlayScreen';
import { SetlistScreen, SetlistDetailScreen } from './screens/SetlistScreen';
import { seedSongsIfNeeded } from './lib/db';
import { checkForUpdate, shouldCheckForUpdate, applyUpdate } from './lib/version';
import { songFiles } from './songs';
import './App.css';

function App() {
  const [ready, setReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const songs = songFiles.map(sf => ({ id: sf.id, chordpro: sf.content }));
      await seedSongsIfNeeded(songs);
      setReady(true);
    }
    init();
  }, []);

  useEffect(() => {
    const check = async () => {
      if (shouldCheckForUpdate()) {
        const v = await checkForUpdate();
        if (v) setUpdateAvailable(v);
      }
    };
    check();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  if (!ready) {
    return (
      <div className="splash">
        <h1>Zpěvník</h1>
        <p>Načítám písně…</p>
      </div>
    );
  }

  const basename = import.meta.env.BASE_URL;

  return (
    <BrowserRouter basename={basename}>
      {updateAvailable && (
        <div className="update-banner" onClick={() => applyUpdate()}>
          Nová verze {updateAvailable} — obnovit
        </div>
      )}
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/play/:id" element={<PlayScreen />} />
        <Route path="/setlists" element={<SetlistScreen />} />
        <Route path="/setlist/:id" element={<SetlistDetailScreen />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
