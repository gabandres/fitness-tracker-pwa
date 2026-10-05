import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { markFastEnding, planFastInboxAction, SPOKEN_ACTION_MAX_AGE_MS } from '@/lib/fast-activity';
import { subscribeIntentInbox, takeIntentInbox } from '../../modules/intent-inbox';

/**
 * Applies what the Lock Screen and Siri left for Today in the intent inbox:
 * the fasting Live Activity's "End", and the spoken "Start fast", "End fast"
 * and "Log weight" (`targets/_shared/AppActionIntents.swift`). The rest timer's
 * buttons are Train's to apply (`ActiveSession`), so this never takes `rest`.
 *
 * Every action runs through the SAME JS path a tap in the app takes — that is
 * the design (`targets/_shared/IntentInbox.swift`): `breakFast` with its Undo
 * toast, `startFast`, the weigh-in sheet. The intents only record intent.
 *
 * ## When it drains
 *
 * On mount, on every foreground, and the moment the inbox rings — the doorbell
 * fires while the app process is alive, which it is whenever a
 * `LiveActivityIntent` has just run. But never before `ready`: until the
 * profile has loaded, `fastStartedAt` is null for every user, and a Lock Screen
 * "End" judged against that would look like "no fast running" and be dropped.
 *
 * Mounted on Today (which already owns the fast state and stays mounted under
 * the tab bar), so this adds no listener of its own to Firestore.
 */
export interface IntentInboxHandlers {
  /** False while the profile is loading. Nothing is taken until true. */
  ready: boolean;
  fastStartedAt: Date | null;
  /** End the running fast at `endedAt` (the toast + Undo path). */
  onEndFast: (endedAt: Date) => Promise<unknown>;
  onStartFast: (at: Date) => Promise<unknown> | void;
  /** Open the fast sheet. */
  onShowFast: () => void;
  /** Open the weigh-in sheet, prefilled with `value` (display unit) if given. */
  onLogWeight: (value: number | undefined) => void;
}

export function useIntentInbox(handlers: IntentInboxHandlers): void {
  // Read through a ref so the three triggers register once, rather than being
  // torn down and rebuilt whenever the fast or a handler identity moves.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  /** A drain in flight, and whether another trigger arrived during it — a
   *  doorbell rung mid-drain may name an entry the in-flight `take` missed, so
   *  it earns one more pass rather than being dropped. */
  const draining = useRef(false);
  const again = useRef(false);

  const { ready } = handlers;

  useEffect(() => {
    if (!ready) return;
    let alive = true;

    const drain = async () => {
      again.current = true;
      if (draining.current) return;
      draining.current = true;
      while (again.current && alive) {
        again.current = false;
        const actions = await takeIntentInbox(['fastEnd', 'fastStart', 'fastStop', 'weight']);
        if (alive) apply(actions);
      }
      draining.current = false;
    };

    const apply = (actions: Awaited<ReturnType<typeof takeIntentInbox>>) => {
      const now = Date.now();
      for (const action of actions) {
        const h = latest.current;
        if (action.kind === 'weight') {
          if (now - action.atMs <= SPOKEN_ACTION_MAX_AGE_MS) h.onLogWeight(action.value);
          continue;
        }
        if (action.kind === 'rest') continue;
        const step = planFastInboxAction(action, h.fastStartedAt, now);
        if (step.type === 'end' && h.fastStartedAt) {
          // Held until the write settles, so a reconcile in between cannot
          // re-arm the Activity the user just dismissed (`markFastEnding`).
          const startMs = h.fastStartedAt.getTime();
          markFastEnding(startMs);
          void Promise.resolve(h.onEndFast(step.endedAt))
            .catch(() => {})
            .then(() => markFastEnding(null));
        } else if (step.type === 'start') {
          void Promise.resolve(h.onStartFast(step.at)).catch(() => {});
        } else if (step.type === 'show') {
          h.onShowFast();
        }
      }
    };

    void drain();
    const unsubscribe = subscribeIntentInbox(() => void drain());
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void drain();
    });
    return () => {
      alive = false;
      unsubscribe();
      appState.remove();
    };
  }, [ready]);
}
