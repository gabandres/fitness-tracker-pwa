/**
 * When Today is allowed to draw numbers. Pure, and a module of its own with NO
 * imports for the same reason `health-errors.ts` is: `useToday` reaches
 * Firestore through `ledger.ts`, so a test cannot reach past the global mock
 * without pulling Firebase's ESM build through a transform jest cannot handle.
 * A rule that decides whether a user is shown someone else's calorie target
 * deserves a seam a test can reach.
 */

/**
 * True while Today must show a spinner rather than a hero.
 *
 * Three inputs, and each clause is a bug that has actually happened here.
 *
 * **`logsReady`** — a server snapshot OR a disk-cache hit. Without the cache
 * half, a cold start offline spins forever: the listener never answers, and the
 * whole point of the cache is that it does not have to.
 *
 * **`profileReady`** — added 2026-08-28. `snapshotArrived` is latched by the
 * LOGS listener alone, so the spinner used to clear while `profile` was still
 * null, and `dailyTargets(null, …)` returns a SEED rather than the user's
 * numbers: measured, `calorieTarget: 1800` and `proteinTarget: 0`. Today
 * therefore painted a hero belonging to nobody and then count-upped to the real
 * target once the profile landed, sweeping the big number through values that
 * were never true. That sweep is what made the clipped `"1,14"` visible at all
 * — and it is the more serious half of that report, because clipping is
 * cosmetic and a wrong calorie target is not.
 *
 * Note the deliberate ASYMMETRY: `profileReady` is satisfied by any answer,
 * including a cache-only one, while `logsReady`'s server half is authoritative.
 * Requiring an authoritative profile would hang a cold-cache offline start
 * forever, which is exactly the trade rejected for logs.
 *
 * **`failed`** — the exit, and it short-circuits BOTH. A failure must end the
 * spinner rather than convert it into a permanent one; Today renders its error
 * line instead. This is why the clause is checked first.
 */
export function isTodayLoading(input: {
  logsReady: boolean;
  profileReady: boolean;
  failed: boolean;
}): boolean {
  if (input.failed) return false;
  return !input.logsReady || !input.profileReady;
}

/**
 * Whether this account has logged a food, ever — as far as Today can tell.
 *
 * Keyed on the log window Today already holds (`subscribeRecentLogs`, the
 * newest `LOG_WINDOW_ROWS` rows of ALL time, not a date range): a food row
 * (`calories > 0`) today, or on any earlier day in it. There is no lifetime
 * "first entry" field on the profile, and none is needed — the window is the
 * newest 400 rows, so for an account to have logged food and show none here it
 * would need 400 newer non-food rows. `null` while the rows are not in yet
 * (`dataReady` false): unknown is neither answer, so no card keyed on it can
 * flash for a returning user while the feed loads.
 */
export function everLoggedFood(input: {
  dataReady: boolean;
  todayEntries: number;
  hasPriorEntries: boolean;
}): boolean | null {
  if (!input.dataReady) return null;
  return input.todayEntries > 0 || input.hasPriorEntries;
}

/**
 * The first-meal card (2026-11-19): only on today, only on an empty day, only
 * for an account that has never logged — and only once that is KNOWN
 * (`everLogged === false`, never `null`).
 */
export function showFirstMealCard(input: {
  isToday: boolean;
  todayEntries: number;
  everLogged: boolean | null;
}): boolean {
  return input.isToday && input.todayEntries === 0 && input.everLogged === false;
}

/**
 * Whether Today wants to ask about meal reminders (2026-11-19: the ask moved
 * here from onboarding, after the first log). It only CLAIMS the Nudge slot;
 * `useTodayNudge` decides whether it gets it. `remindersOn` / `answered` are
 * `null` until their device reads land, and unknown never asks.
 *
 * Exclusive with {@link showFirstMealCard} by construction: this needs
 * `everLogged === true`, that needs `false`.
 */
export function wantsReminderAsk(input: {
  isToday: boolean;
  everLogged: boolean | null;
  remindersOn: boolean | null;
  answered: boolean | null;
}): boolean {
  return input.isToday && input.everLogged === true && input.remindersOn === false && input.answered === false;
}
