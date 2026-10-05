import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { isAnySheetActive, onSheetsIdle } from '@/lib/sheet-portal';

type Effect = () => void | (() => void);

/**
 * `useFocusEffect`, except a native sheet pushed over the screen is not a blur
 * (UX_AUDIT S20).
 *
 * Since S20 a `BottomSheet native` is a ROUTE on the root stack, so opening the
 * meal sheet blurs Today exactly as leaving it would. Every focus-gated
 * listener (ADR-0016) then unsubscribed on each open and resubscribed on each
 * close: the cache is memory-only, so each add re-read logs, presets, foods,
 * water, sleep and weights from the server — billed — and the lists INSIDE the
 * open sheet froze (a hidden recent stayed visible, a new food never appeared).
 *
 * Here a blur while a sheet is presented (`isAnySheetActive`, marked before the
 * push) defers the cleanup until the last sheet goes. If the screen is focused
 * again by then — the usual case, the sheet closed back onto it — the
 * subscription simply carries on. If the user left from inside the sheet (to
 * Scan, say), it is released the moment the sheet is gone.
 *
 * A changed `effect` (new deps) restarts the subscription on the next focus,
 * as `useFocusEffect` would.
 */
export function useFocusEffectThroughSheets(effect: Effect): void {
  const state = useRef<{ effect: Effect | null; cleanup: (() => void) | null; idle: (() => void) | null }>({
    effect: null,
    cleanup: null,
    idle: null,
  });

  useFocusEffect(
    useCallback(() => {
      const s = state.current;
      s.idle?.();
      s.idle = null;
      if (s.effect !== effect) {
        s.cleanup?.();
        const c = effect();
        s.cleanup = typeof c === 'function' ? c : null;
        s.effect = effect;
      }
      return () => {
        const stop = () => {
          s.idle = null;
          s.cleanup?.();
          s.cleanup = null;
          s.effect = null;
        };
        if (isAnySheetActive()) s.idle = onSheetsIdle(stop);
        else stop();
      };
    }, [effect]),
  );

  // Unmounting releases whatever is still held, sheet or not.
  useEffect(
    () => () => {
      const s = state.current;
      s.idle?.();
      s.cleanup?.();
      s.cleanup = null;
      s.effect = null;
    },
    [],
  );
}
