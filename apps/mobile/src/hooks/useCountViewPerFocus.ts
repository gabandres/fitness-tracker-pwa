import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffectThroughSheets } from '@/hooks/useFocusEffectThroughSheets';
import { track } from '@/lib/analytics';
import type { UsageEvent } from '@macrolog/core';

/**
 * Count `event` once per focus of the calling screen, and only once the thing
 * it measures is actually `shown` — not while the screen is still loading, and
 * not again if `shown` flaps within one focus (an admin claim that resolves
 * late, a listener that re-answers). A focus in which it never shows counts
 * nothing.
 */
export function useCountViewPerFocus(event: UsageEvent, shown: boolean): void {
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const focused = useRef(false);
  const counted = useRef(false);

  const count = useCallback(() => {
    if (!focused.current || !shownRef.current || counted.current) return;
    counted.current = true;
    track(event);
  }, [event]);

  // Through sheets: closing the meal sheet is not a second view of Today.
  useFocusEffectThroughSheets(
    useCallback(() => {
      focused.current = true;
      counted.current = false;
      count();
      return () => {
        focused.current = false;
      };
    }, [count]),
  );

  useEffect(() => {
    if (shown) count();
  }, [shown, count]);
}
