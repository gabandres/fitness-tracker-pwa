/**
 * The rest countdown on the lock screen — the JS seam, with no native half yet.
 *
 * A lifter locks the phone between sets. The local "rest over" notification
 * (`useRestTimer`) covers the END of a rest; what it cannot show is the time
 * LEFT, which is what Strong and Hevy put on the lock screen and in the Dynamic
 * Island through a Live Activity (ActivityKit on iOS, an ongoing notification
 * with a chronometer on Android). That needs a native module, which is not
 * built yet (Train review item 20).
 *
 * So this file is the contract that module will satisfy, already called from
 * the three right places in `ActiveSession`:
 *
 * - {@link start} when a rest begins (a set is ticked),
 * - {@link update} when it moves (+30 s, −30 s, a new set ticked mid-rest),
 * - {@link end} when it stops (skipped, run out, or the workout closes).
 *
 * `endsAt` is an absolute epoch-ms deadline rather than a duration on purpose:
 * a Live Activity renders a system timer counting down to a DATE, so it keeps
 * ticking while the JS runtime is suspended — the same reason `useRestTimer`
 * redraws from a deadline instead of counting ticks.
 *
 * Every function is a no-op until the native module lands, and must stay safe
 * to call when it is absent (Expo Go, Android, a build without the target):
 * a rest timer that throws is worse than one that is only on screen.
 */

export interface RestActivityState {
  /** When the rest is over, epoch ms. */
  endsAt: number;
  /** The exercise the rest follows — the Live Activity's title. */
  exerciseName: string;
}

let current: RestActivityState | null = null;

/** Start (or replace) the lock-screen countdown. */
export function start(endsAt: number, exerciseName: string): void {
  current = { endsAt, exerciseName };
  // Native module goes here: `RestActivity.start(endsAt, exerciseName)`.
}

/** Move the deadline of the countdown already showing. No-op when none is. */
export function update(endsAt: number): void {
  if (!current) return;
  current = { ...current, endsAt };
  // Native module goes here: `RestActivity.update(endsAt)`.
}

/** Remove the countdown. Idempotent. */
export function end(): void {
  if (!current) return;
  current = null;
  // Native module goes here: `RestActivity.end()`.
}

/** What the seam believes is on the lock screen — for tests. */
export function __currentRestActivity(): RestActivityState | null {
  return current;
}
