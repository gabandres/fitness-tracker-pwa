import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { type DateKey, type DayBoundary, dayKeyAt, dayRange } from '@macrolog/core';

/** Retry interval for the one case where a timer fires and the day has NOT
 *  turned — the device clock moved backwards under us. Without a floor the
 *  re-arm below would spin on a zero-length timeout. */
const CLOCK_SKEW_RETRY_MS = 60_000;

/**
 * Today's day key under `boundary`, and it CHANGES when the day does.
 *
 * Today used to compute its key inline on every render, which is correct right
 * up until nothing renders: a phone left on Today overnight, or backgrounded at
 * 23:00 and resumed at 07:00, kept showing yesterday's ring, yesterday's
 * entries and yesterday's water under a "Today" title — because the only thing
 * that recomputed the key was a re-render, and nothing caused one. A user who
 * then logged breakfast saw it vanish from the list (it filed under the real
 * today, which the screen was not showing).
 *
 * Two triggers, because each covers the other's blind spot:
 *   1. **A timer to the end of the day**, from core's `dayRange` — so a
 *      boundary user (`dayStartHour: 3`) rolls over at 03:00, not midnight.
 *      Re-armed if it fires early, which a clock change can cause.
 *   2. **AppState → `active`.** iOS suspends JS timers in the background, so
 *      the timer alone misses the overnight-backgrounded case entirely.
 *
 * State only changes when the key does, so a foreground on the same day costs
 * no render.
 */
export function useDayKey(boundary: DayBoundary): DateKey {
  const [state, setState] = useState(() => ({
    boundary,
    key: dayKeyAt(new Date(), boundary),
  }));

  // A boundary change (the Settings row) re-keys on THIS render rather than one
  // effect later — a frame keyed to the old boundary is the "two derivations of
  // which day it is" bug `useToday` exposes `todayKey` to prevent.
  let key = state.key;
  if (state.boundary !== boundary) {
    key = dayKeyAt(new Date(), boundary);
    setState({ boundary, key });
  }

  useEffect(() => {
    /** Re-derive the key; true when it moved (the effect then re-runs). */
    const refresh = (): boolean => {
      const next = dayKeyAt(new Date(), boundary);
      if (next === key) return false;
      setState({ boundary, key: next });
      return true;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const ms = dayRange(key, boundary).end.getTime() - Date.now();
      // A small margin past the boundary instant so `dayKeyAt` is unambiguous.
      timer = setTimeout(() => {
        if (!refresh()) arm();
      }, ms > 0 ? ms + 250 : CLOCK_SKEW_RETRY_MS);
    };
    arm();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [key, boundary]);

  return key;
}
