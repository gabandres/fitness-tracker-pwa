import { useCallback, useEffect, useRef, useState } from 'react';
import * as haptics from '@/lib/haptics';

export interface RestTimer {
  /** Seconds left; 0 = idle (the rest bar hides). */
  remaining: number;
  /** `m:ss` display of `remaining`. */
  label: string;
  /** Start (or replace) a countdown for `seconds`. No-op for ≤ 0. */
  start: (seconds: number) => void;
  /** Cancel the countdown and go idle. Idempotent. */
  stop: () => void;
}

function formatMMSS(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Between-sets rest countdown. Mirrors the PWA rest-timer state machine
 * (start replaces, never stacks; auto-stops at 0; idempotent stop). Local
 * only — no Firestore. A single interval ticks once a second.
 */
export function useRestTimer(): RestTimer {
  const [remaining, setRemaining] = useState(0);
  const handle = useRef<ReturnType<typeof setInterval> | null>(null);
  /** When the rest ends, epoch ms. The interval only REDRAWS from this — it
   *  never counts. JS timers are suspended while the screen is locked, and a
   *  lifter locks the phone between sets: a tick-counting timer that slept 60 s
   *  of a 90 s rest woke up still showing ~90 s, and buzzed a minute late. */
  const deadline = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (handle.current) {
      clearInterval(handle.current);
      handle.current = null;
    }
    deadline.current = null;
    setRemaining(0);
  }, []);

  const start = useCallback(
    (seconds: number) => {
      if (handle.current) clearInterval(handle.current);
      if (!(seconds > 0)) {
        handle.current = null;
        deadline.current = null;
        setRemaining(0);
        return;
      }
      const secs = Math.round(seconds);
      deadline.current = Date.now() + secs * 1000;
      setRemaining(secs);
      handle.current = setInterval(() => {
        const end = deadline.current;
        const left = end == null ? 0 : Math.max(0, Math.ceil((end - Date.now()) / 1000));
        if (left <= 0) {
          if (handle.current) clearInterval(handle.current);
          handle.current = null;
          deadline.current = null;
          // Buzz on natural completion (time to lift) — skip/stop stays silent.
          haptics.success();
          setRemaining(0);
          return;
        }
        setRemaining(left);
      }, 1000);
    },
    [],
  );

  // Clear the interval if the component unmounts mid-countdown.
  useEffect(() => () => {
    if (handle.current) clearInterval(handle.current);
  }, []);

  return { remaining, label: formatMMSS(remaining), start, stop };
}
