import {
  endRestActivity,
  startRestActivity,
  updateRestActivity,
} from '../../modules/rest-timer-activity';
import type { IntentInboxAction } from '../../modules/intent-inbox';

/**
 * The rest countdown on the lock screen and in the Dynamic Island (Train review
 * item 20).
 *
 * A lifter locks the phone between sets. The local "rest over" notification
 * (`useRestTimer`) covers the END of a rest; what it cannot show is the time
 * LEFT, which is what Strong and Hevy put on the lock screen through a Live
 * Activity. On iOS that is `modules/rest-timer-activity` →
 * `targets/_shared/RestActivity.swift` → `targets/widget/RestActivityWidget.swift`.
 * Android has no Live Activity and the module is absent there, so every call
 * below is a no-op on Android, in Expo Go, on web, and in iOS binaries older
 * than the one that introduced the module (an OTA can still reach them).
 *
 * Called from the three right places in `ActiveSession`:
 *
 * - {@link start} when a rest begins (a set is ticked),
 * - {@link update} when it moves (+30 s, −30 s in the app),
 * - {@link end} when it stops (skipped, run out, or the workout closes).
 *
 * `endsAt` is an absolute epoch-ms deadline rather than a duration on purpose:
 * a Live Activity renders a system timer counting down to a DATE, so it keeps
 * ticking while the JS runtime is suspended — the same reason `useRestTimer`
 * redraws from a deadline instead of counting ticks.
 *
 * ## The other direction: the Lock Screen's own buttons
 *
 * "+30 s" and "Skip" on the Activity run natively (`LiveActivityIntents.swift`)
 * and move the Activity and the pending notification themselves. What they
 * cannot move is the in-app rest bar, so each leaves a `rest` entry in the
 * intent inbox. {@link applyRestInboxAction} turns that entry into what
 * `ActiveSession` should do to its own timer; `ActiveSession` drains on mount,
 * on foreground and on the inbox's doorbell. See `IntentInbox.swift` for the
 * whole hand-off.
 *
 * Fire-and-forget throughout: a rest timer that throws is worse than one that
 * is only on screen, and the module's functions never reject.
 */

export interface RestActivityState {
  /** When the rest is over, epoch ms. */
  endsAt: number;
  /** The exercise the rest follows — the Live Activity's title. */
  exerciseName: string;
  /** When this rest began, epoch ms. Lock Screen actions older than this
   *  belong to an earlier rest and are ignored. */
  startedAt: number;
  /** The profile locale the Activity was armed with. */
  locale: string;
}

let current: RestActivityState | null = null;
/** The last exercise a rest followed, kept after `end` — what a `resume`
 *  re-arms the Activity with (see `applyRestInboxAction`). */
let lastExercise: { name: string; locale: string } | null = null;

/** Start (or retarget) the lock-screen countdown. */
export function start(endsAt: number, exerciseName: string, locale = 'en', now = Date.now()): void {
  current = { endsAt, exerciseName, startedAt: now, locale };
  lastExercise = { name: exerciseName, locale };
  void startRestActivity(endsAt, exerciseName, locale);
}

/** Move the deadline of the countdown already showing. No-op when none is. */
export function update(endsAt: number): void {
  if (!current) return;
  current = { ...current, endsAt };
  void updateRestActivity(endsAt);
}

/** Remove the countdown. Idempotent. */
export function end(): void {
  if (!current) return;
  current = null;
  void endRestActivity();
}

/** What the seam believes is on the lock screen — for tests. */
export function __currentRestActivity(): RestActivityState | null {
  return current;
}

/** How old a Lock Screen action may be and still revive a rest the app had
 *  already closed. Past this it belongs to some earlier workout. */
export const REST_ACTION_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * What the in-app timer should do about one Lock Screen action.
 *
 * - `skip` — the lifter tapped Skip: stop the rest bar silently (a skip never
 *   buzzes or announces, same as the in-app skip).
 * - `retarget` — +30 s on a rest the app is still showing: run the bar to the
 *   new deadline.
 * - `resume` — +30 s on a rest the app had ALREADY closed. This is the race
 *   where the phone sat locked past the deadline, the lifter tapped +30 s on
 *   the "Rest over" face, and the app's own tick ended the rest (and the
 *   Activity) on unlock a beat before this drain ran. The lifter asked for 30 s
 *   more; `ActiveSession` restarts the bar AND re-arms the Activity.
 * - `null` — nothing to do: an action from an earlier rest, a skip with no rest
 *   running, or a deadline already in the past.
 *
 * Updates this seam's own `current` to match, WITHOUT calling native — the
 * button already changed the Activity, and echoing it back would be a second
 * update racing the first.
 *
 * Pure apart from that bookkeeping; `now` is injectable for tests.
 */
export type RestInboxOutcome =
  | { type: 'skip' }
  | { type: 'retarget'; endsAt: number; seconds: number }
  | { type: 'resume'; endsAt: number; seconds: number; exerciseName: string; locale: string }
  | null;

export function applyRestInboxAction(
  action: Extract<IntentInboxAction, { kind: 'rest' }>,
  now = Date.now(),
): RestInboxOutcome {
  if (action.endsAtMs === 0) {
    if (!current || action.atMs < current.startedAt) return null;
    current = null;
    return { type: 'skip' };
  }

  const seconds = Math.round((action.endsAtMs - now) / 1000);
  if (seconds <= 0) return null;

  if (current) {
    if (action.atMs < current.startedAt) return null;
    current = { ...current, endsAt: action.endsAtMs };
    return { type: 'retarget', endsAt: action.endsAtMs, seconds };
  }

  if (now - action.atMs > REST_ACTION_MAX_AGE_MS || !lastExercise) return null;
  return {
    type: 'resume',
    endsAt: action.endsAtMs,
    seconds,
    exerciseName: lastExercise.name,
    locale: lastExercise.locale,
  };
}

/** Test-only: forget all seam state between cases. */
export function __resetRestActivity(): void {
  current = null;
  lastExercise = null;
}
