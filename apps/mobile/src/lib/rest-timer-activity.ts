import {
  endAllRestActivities,
  endRestActivity,
  getRestActivityStatus,
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
 * Called from the right places in `ActiveSession`:
 *
 * - {@link start} when a rest begins (a set is ticked),
 * - {@link update} when it moves (+30 s, −30 s in the app),
 * - {@link end} when it stops (skipped, run out, or the workout closes),
 *
 * and {@link reconcileWithNative} once on mount, for an Activity that outlived
 * a JS restart.
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

/**
 * Remove the countdown. Idempotent.
 *
 * ALWAYS reaches native, even when this seam believes nothing is showing.
 * `current` is module state and does not survive an iOS memory kill or a
 * reload while the phone is locked — the Activity does. Returning early on a
 * null `current` left a stale "Rest over" face on the Lock Screen through the
 * Finish and every later rest, until iOS's 8-hour ceiling (Train re-score
 * bug 2). Native `end` with nothing to end is a no-op, so the call is cheap.
 */
export function end(): void {
  current = null;
  void endRestActivity();
}

/** What {@link reconcileWithNative} found on the Lock Screen. */
export type RestReconcileOutcome = { type: 'restore'; endsAt: number; seconds: number } | null;

/**
 * Re-adopt a rest the Lock Screen is still counting after the JS runtime
 * restarted (Train re-score bug 2).
 *
 * The Activity outlives the runtime; this seam's memory does not. So on mount
 * `ActiveSession` asks native what is showing:
 *
 * - `running:<ms>` with time left → adopt it as `current` (so +30 s / Skip on
 *   the Lock Screen apply again, and Finish ends it) and tell the caller to
 *   put the rest bar back, for the seconds that are really left;
 * - `running:<ms>` already past → a stale "Rest over" face nobody will clear;
 *   end it;
 * - anything else, or a rest this seam already knows about → nothing.
 *
 * `exerciseName` is the Activity's title if a later `resume` has to re-arm it;
 * native does not report the one it is showing. `now` is injectable for tests.
 */
export async function reconcileWithNative(
  exerciseName: string,
  locale = 'en',
  now = Date.now(),
): Promise<RestReconcileOutcome> {
  if (current) return null;
  const status = await getRestActivityStatus();
  const m = /^running:(\d+(?:\.\d+)?)$/.exec(status);
  if (!m) return null;
  const endsAt = Math.round(Number(m[1]));
  // A start that raced this read already owns the Lock Screen.
  if (current) return null;
  const seconds = Math.round((endsAt - now) / 1000);
  if (seconds <= 0) {
    void endRestActivity();
    return null;
  }
  current = { endsAt, exerciseName, startedAt: now, locale };
  lastExercise = { name: exerciseName, locale };
  return { type: 'restore', endsAt, seconds };
}

/** What the seam believes is on the lock screen — for tests. */
/**
 * End rest activities nobody owns. `current` lives in JS memory, so after an
 * iOS memory kill or a reload mid-rest the Lock Screen kept a countdown the app
 * no longer knew about — and `end()` returns early with nothing to end. Called
 * once from the tab layout, AFTER a live session has had its chance to restore
 * its own rest (that effect runs first), so a real rest is kept.
 */
export function sweepOrphans(): void {
  if (!current) void endAllRestActivities();
}

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
