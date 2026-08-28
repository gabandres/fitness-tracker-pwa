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
