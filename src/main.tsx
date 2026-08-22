import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
// TEMPORARY: layout debugging for the iOS bottom-of-screen issue. Remove this
// import and src/lib/debugOverlay.ts once it is resolved.
import { mountDebugOverlay } from './lib/debugOverlay';

// Register service worker for offline support
registerSW({ immediate: true });

mountDebugOverlay();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
