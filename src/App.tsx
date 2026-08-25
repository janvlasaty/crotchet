import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomeScreen } from './screens/HomeScreen';
import { PlayScreen } from './screens/PlayScreen';
import { SetlistScreen, SetlistDetailScreen } from './screens/SetlistScreen';
import { ArtistScreen } from './screens/ArtistScreen';
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

  /*
   * `useTransitions={false}`: the router's own default wraps every route change
   * in `React.startTransition`, and a transition update is exactly the one kind
   * `flushSync` cannot force out. The screen morph flushes the navigation inside
   * `document.startViewTransition` so the browser can snapshot the page before
   * and after in one go (see src/lib/morph.ts) — deferred, the new screen landed
   * after the snapshot had already been taken and every morph came out as a
   * flicker on the old screen instead.
   */
  return (
    <BrowserRouter basename={basename} useTransitions={false}>
      {updateAvailable && (
        <div className="update-banner" onClick={() => applyUpdate()}>
          Nová verze {updateAvailable} — obnovit
        </div>
      )}
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/play/:id" element={<PlayScreen />} />
        <Route path="/artist/:name" element={<ArtistScreen />} />
        <Route path="/setlists" element={<SetlistScreen />} />
        <Route path="/setlist/:id" element={<SetlistDetailScreen />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
