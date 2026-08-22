import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { installKeyboardInset } from './lib/keyboardInset';
import './index.css';

// Register service worker for offline support
registerSW({ immediate: true });

// Lets the search panel resize to the space the keyboard leaves.
installKeyboardInset();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
