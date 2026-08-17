import { useState, useEffect, useCallback } from 'react';

/** Wake Lock hook for playing screen */
export function useWakeLock() {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;

    const request = async () => {
      try {
        if ('wakeLock' in navigator) {
          sentinel = await navigator.wakeLock.request('screen');
          setLocked(true);
          sentinel.addEventListener('release', () => setLocked(false));
        }
      } catch {
        setLocked(false);
      }
    };

    request();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      sentinel?.release();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return locked;
}

/** Tap tempo hook */
export function useTapTempo() {
  const [taps, setTaps] = useState<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);

  const tap = useCallback(() => {
    const now = Date.now();
    setTaps(prev => {
      const newTaps = [...prev, now].slice(-8); // keep last 8 taps
      if (newTaps.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < newTaps.length; i++) {
          intervals.push(newTaps[i] - newTaps[i - 1]);
        }
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const newBpm = Math.round(60000 / avg);
        setBpm(newBpm);
      }
      return newTaps;
    });
  }, []);

  const reset = useCallback(() => {
    setTaps([]);
    setBpm(null);
  }, []);

  return { bpm, tap, reset };
}
