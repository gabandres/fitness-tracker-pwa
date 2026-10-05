import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { nextTemplateUp } from '@macrolog/core';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import type { TrainState } from '@/hooks/useTrain';
import { SPOKEN_ACTION_MAX_AGE_MS } from '@/lib/fast-activity';
import {
  peekWorkoutStartActions,
  subscribeIntentInbox,
  takeWorkoutStartActions,
} from '../../modules/intent-inbox';

/**
 * "Start my next workout in Ignia" — Siri / Shortcuts / the Action button
 * (`StartNextWorkoutIntent`, `targets/_shared/AppActionIntents.swift`) and the
 * deep link `ignia://train?start=next`.
 *
 * The intent only opens the app and leaves a `workoutStart` note in the intent
 * inbox (`IntentInbox.swift` explains why intents record intent and the app
 * does the work). Two halves pick it up, because the consumer is a TAB that
 * may never have mounted:
 *
 * - {@link useWorkoutIntentRouter} — on the tab layout, always mounted: PEEKS
 *   and, when a start is pending, sends the user to Train.
 * - {@link useStartNextWorkoutIntent} — on the Train screen: TAKES the note
 *   and starts the workout through the same calls the "Next up" card's Start
 *   button makes (`StartView`): `startFromTemplate(nextTemplateUp(...))`, or
 *   `startWorkout()` with no templates. A workout already running is shown,
 *   never replaced — a second Siri phrase mid-set must not start over.
 *
 * Both are no-ops where the intent-inbox module is absent (Android, Expo Go,
 * an older iOS binary): `take`/`peek` resolve empty. The deep-link half works
 * everywhere.
 */

/** What to do about one "start my next workout" request. Pure — tested. */
export type StartNextWorkoutPlan =
  | { type: 'none' }
  | { type: 'show' }
  | { type: 'template'; template: WorkoutTemplate }
  | { type: 'empty' };

export function planStartNextWorkout(input: {
  /** When the request was made, epoch ms. */
  atMs: number;
  active: WorkoutSession | null;
  templates: readonly WorkoutTemplate[];
  recentSessions: readonly WorkoutSession[];
  now: number;
}): StartNextWorkoutPlan {
  // The same freshness bound as the spoken fast/weight intents: a phrase
  // spoken ten minutes ago into an app that never finished opening is not a
  // request to start a workout now.
  if (input.now - input.atMs > SPOKEN_ACTION_MAX_AGE_MS) return { type: 'none' };
  if (input.active) return { type: 'show' };
  const next = nextTemplateUp(input.templates, input.recentSessions, input.now);
  return next ? { type: 'template', template: next.template } : { type: 'empty' };
}

type TrainForIntent = Pick<
  TrainState,
  'loading' | 'active' | 'templates' | 'recentSessions' | 'startFromTemplate' | 'startWorkout'
>;

/**
 * Mount on the Train screen (`src/app/(app)/train.tsx` → `TrainScreen`), once:
 *
 *     useStartNextWorkoutIntent(train);
 *
 * Waits for `train.loading` to clear — until then `templates` and `active` are
 * empty for every user, and "no workout running, no templates" would start an
 * empty session over one that was merely still loading.
 */
export function useStartNextWorkoutIntent(train: TrainForIntent): void {
  const latest = useRef(train);
  useEffect(() => {
    latest.current = train;
  });
  const { start } = useLocalSearchParams<{ start?: string }>();
  const router = useRouter();
  /** A start in flight: a doorbell or a re-render during the async start must
   *  not start a second workout before `active` has caught up. */
  const starting = useRef(false);
  const ready = !train.loading;

  // Stable (reads everything through refs), so the effects below register once.
  const run = useCallback((atMs: number) => {
    if (starting.current) return;
    const t = latest.current;
    const plan = planStartNextWorkout({
      atMs,
      active: t.active,
      templates: t.templates,
      recentSessions: t.recentSessions,
      now: Date.now(),
    });
    if (plan.type !== 'template' && plan.type !== 'empty') return;
    starting.current = true;
    const go = plan.type === 'template' ? t.startFromTemplate(plan.template) : t.startWorkout();
    void Promise.resolve(go)
      .catch(() => {})
      .finally(() => {
        starting.current = false;
      });
  }, []);

  // The deep link: `ignia://train?start=next`. Cleared once handled, so a
  // re-render (or returning to the tab) does not start another.
  useEffect(() => {
    if (!ready || start !== 'next') return;
    run(Date.now());
    router.setParams({ start: undefined });
  }, [ready, start, router, run]);

  // The inbox: on mount, on foreground, on the doorbell.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const drain = async () => {
      const actions = await takeWorkoutStartActions();
      if (!alive || actions.length === 0) return;
      // Several phrases queued while the app was closed are ONE request.
      run(Math.max(...actions.map((a) => a.atMs)));
    };
    void drain();
    const unsubscribe = subscribeIntentInbox(() => void drain());
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') void drain();
    });
    return () => {
      alive = false;
      unsubscribe();
      appState.remove();
    };
  }, [ready, run]);
}

/**
 * Mount on the tab layout (`src/app/(app)/_layout.tsx` → `AppTabsLayout`), once:
 *
 *     useWorkoutIntentRouter();
 *
 * Sends the user to Train when a "start my next workout" is pending and they
 * are elsewhere — the app reopens on whatever tab it was left on, and Train
 * (which takes the note) may not have mounted yet. Peeks only; never takes.
 */
export function useWorkoutIntentRouter(): void {
  const router = useRouter();
  const segments = useSegments();
  const onTrain = (segments as readonly string[]).includes('train');
  const latest = useRef({ router, onTrain });
  useEffect(() => {
    latest.current = { router, onTrain };
  });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const pending = await peekWorkoutStartActions();
      if (!alive || pending.length === 0) return;
      const now = Date.now();
      if (!pending.some((a) => now - a.atMs <= SPOKEN_ACTION_MAX_AGE_MS)) return;
      if (!latest.current.onTrain) latest.current.router.navigate('/train');
    };
    void check();
    const unsubscribe = subscribeIntentInbox(() => void check());
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      alive = false;
      unsubscribe();
      appState.remove();
    };
  }, []);
}
