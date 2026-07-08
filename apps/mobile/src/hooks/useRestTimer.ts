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

  const stop = useCallback(() => {
    if (handle.current) {
      clearInterval(handle.current);
      handle.current = null;
    }
    setRemaining(0);
  }, []);

  const start = useCallback(
    (seconds: number) => {
      if (handle.current) clearInterval(handle.current);
      if (!(seconds > 0)) {
        handle.current = null;
        setRemaining(0);
        return;
      }
      setRemaining(Math.round(seconds));
      handle.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            if (handle.current) clearInterval(handle.current);
            handle.current = null;
            // Buzz on natural completion (time to lift) — skip/stop stays silent.
            haptics.success();
            return 0;
          }
          return r - 1;
        });
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
