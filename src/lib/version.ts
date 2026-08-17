/**
 * Version checking — compare local build version vs server.
 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastCheck = 0;

export async function checkForUpdate(): Promise<string | null> {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const remote = await res.json();
    return remote.version !== __APP_VERSION__ ? remote.version : null;
  } catch {
    return null;
  }
}

export function shouldCheckForUpdate(): boolean {
  const now = Date.now();
  if (now - lastCheck < CHECK_INTERVAL_MS) return false;
  lastCheck = now;
  return true;
}

export async function applyUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg?.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  // Never delete IndexedDB — that's user data
  location.reload();
}
