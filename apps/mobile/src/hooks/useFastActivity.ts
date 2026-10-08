import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';
import { useLocale } from '@/i18n';
import { reconcileFastActivity } from '@/lib/fast-activity';

/**
 * Keeps the fasting Live Activity in step with `profile.fastStartedAt` (N3).
 *
 * Mounted on Today, which already reads `fastStartedAt` through `useToday`, so
 * this takes it as an argument rather than opening a second profile listener —
 * the same reasoning `useWidgetSync` states, and the duplication ADR-0016's
 * focus-gating budget does not cover.
 *
 * iOS-only in effect: every call underneath is a no-op on Android, in Expo Go
 * and on web, so it is safe to mount unconditionally.
 *
 * The decision that matters — reconcile on every foreground rather than react to
 * start/break — and the reasons for it live in `@/lib/fast-activity`. This file
 * is the two triggers and nothing else:
 *
 *   1. the fast or the locale changed, and
 *   2. the app came back to the foreground, which is the only moment an
 *      Activity the system ended at its 8-hour ceiling can be replaced.
 *
 * Fire-and-forget. `reconcileFastActivity` never rejects.
 */
export function useFastActivity(fastStartedAt: Date | null): void {
  const locale = useLocale();

  // An effect event, so the AppState subscription is registered once rather
  // than torn down and rebuilt whenever the fast or the locale moves, and still
  // reads the latest of both. (It was a ref written during render, which made
  // the React Compiler skip this hook.)
  const onForeground = useEffectEvent(() => {
    void reconcileFastActivity(fastStartedAt, locale);
  });

  useEffect(() => {
    void reconcileFastActivity(fastStartedAt, locale);
  }, [fastStartedAt, locale]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      onForeground();
    });
    return () => sub.remove();
  }, []);
}
