/**
 * Multi-step domain operations over the ledger.
 *
 * `ledger.ts` is shaped like the Firestore schema: ~72 verbs, one per document
 * shape, each a single write. That is the right shape for a data layer and the
 * wrong shape for the things a user actually DOES, which are almost never one
 * write — finishing a workout is six. Those sequences used to be reassembled
 * inside screen hooks, where they sat above the test seam: three of them were
 * only reachable through `renderHook`, so the ordering, the value-range
 * backstop and the analytics conditions were pinned by nothing.
 *
 * ## Why this module exists rather than more verbs in `ledger.ts`
 *
 * `ledger.ts` already holds the operations that are pure-Firestore —
 * `switchToMaintenance`, `markExercised`, `startFast`/`breakFast` — and that is
 * still where a new one belongs if it can go there. These three cannot:
 *
 * - `health-sync.ts` **imports** `ledger.ts` (it is the thing that writes what
 *   the OS health store reports), so anything calling `exportDaily` /
 *   `exportWorkout` from inside `ledger.ts` would be a cycle. That rules out
 *   `finishWorkout` and the write-then-mirror pair.
 * - `pending-logs.ts` imports `ledger.ts` too (`addLogWithId`), so the same
 *   cycle rules out `repeatYesterday`, which is otherwise pure-Firestore — the
 *   durable queue is below it, not beside it.
 *
 * So this module sits one layer ABOVE `ledger.ts`, `health-sync.ts`,
 * `pending-logs.ts` and `analytics.ts` and is imported by none of them. Nothing
 * here may ever be imported by those four, or the layering that makes this file
 * possible is gone.
 *
 * ## What stays in the hooks
 *
 * React: state, `useCallback` identity, which failures become a visible error.
 * A function here throws or resolves; it never knows a screen exists.
 */
import {
  type DayBoundary,
  type DailyLog,
  type UsageEvent,
  dayKeyAt,
  fillMissingClusterLoads,
  isStorableWeight,
} from '@macrolog/core';
import { track } from './analytics';
import { exportDaily, exportWorkout } from './health-sync';
import {
  markExercised,
  setDailySleep,
  setDailyWater,
  setDailyWeight,
  updateSession,
} from './ledger';
import {
  type WorkoutSession,
  dropEmptyCardio,
  dropEmptySets,
} from './workout';

/**
 * The durable write queue is required LAZILY, and that is not cosmetic — it is
 * the same rule `analytics.ts` follows for the same reason.
 *
 * `pending-logs.ts` reaches `quick-add.ts` and therefore `firebase.ts`, so a
 * static import here would put the Firestore SDK in the import graph of every
 * module that touches ANY operation in this file — including `useTrain`, which
 * has nothing to do with logging meals. Under jest that is immediate breakage
 * (`@firebase/util` ships untranspiled ESM), and in the app it drags the SDK
 * into bundles that had no reason to hold it.
 *
 * `ledger.ts` and `health-sync.ts` are imported statically because every
 * consumer of this module already pulls them.
 */
type AddLogDurably = typeof import('./pending-logs').addLogDurably;
function addLogDurably(): AddLogDurably {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see above.
  return (require('./pending-logs') as { addLogDurably: AddLogDurably }).addLogDurably;
}

/**
 * The daily scalars a USER writes, which are exactly the ones that have both a
 * `users/{uid}/daily*` document and a Health counterpart.
 *
 * A strict subset of core's `WritableKind`: `bodyFat` is derived rather than
 * entered, so it is mirrored to Health with no Firestore write of its own and
 * has nothing to do here.
 */
type DailyMetric = 'weight' | 'water' | 'sleep';

/** One Firestore writer per metric. Same table shape `health-sync.ts` keeps for
 *  the import direction; each writer clamps to its own canonical unit. */
const WRITER: Record<DailyMetric, (uid: string, dateKey: string, value: number) => Promise<void>> = {
  weight: setDailyWeight,
  water: setDailyWater,
  sleep: setDailySleep,
};

/**
 * Write one daily scalar, then mirror it to the OS health store.
 *
 * Three call sites had this pair written out by hand — water and sleep on
 * Today, weight on Body — and a fourth pair lives inside {@link finishWorkout}.
 * The order is the whole content of the operation:
 *
 * - the Firestore write is **awaited**, because it is the one the user is
 *   waiting on and the one whose failure they must hear about;
 * - the Health write is **fire-and-forget**, because `exportDaily` already
 *   swallows its own errors (it is best-effort by construction) and a health
 *   permission that was revoked last week must not make today's weigh-in look
 *   like it failed.
 *
 * So a failed write mirrors nothing, and a failed mirror fails nothing.
 *
 * `event` is optional because only one of the four sites counts: Body's
 * weigh-in fires `weight_logged`, and it fires it AFTER the write landed and
 * before the mirror. Water, sleep and the workout-extras weight were never
 * counted and still are not — adding an event here would be a new analytics
 * event, not a refactor.
 *
 * **No value-range guard.** Deliberate: the callers that need one apply it
 * themselves (see {@link finishWorkout}), and the clamps that are unconditional
 * live at the ledger write where even a caller that never reaches this module
 * gets them.
 */
export async function writeDailyMetric(
  uid: string,
  kind: DailyMetric,
  dateKey: string,
  value: number,
  event?: UsageEvent,
): Promise<void> {
  await WRITER[kind](uid, dateKey, value);
  if (event) track(event);
  void exportDaily(kind, dateKey, value);
}

/**
 * Close out an in-progress training session: persist it, file the extras the
 * finish sheet collected, mark the day as exercised, and mirror the session to
 * Health.
 *
 * `boundary` is a PARAMETER rather than a profile this function re-reads, the
 * same way `markExercised` and `setDayStartHour` take theirs — the caller
 * already holds the profile, and a read here would race the snapshot about to
 * deliver the same document. ADR-0030: which day a session belongs to is a
 * property of the user's boundary, not of the calendar.
 *
 * ## The order is load-bearing, top to bottom
 *
 * 1. **Prune before writing.** `fillMissingClusterLoads` heals a logged set
 *    that never got a weight from its siblings, and it has to run BEFORE
 *    `dropEmptySets` or the pruner discards the rows it was about to heal.
 *    `dropEmptyCardio` is the same act for a prescribed block the user never
 *    performed (ADR-0025 — a run lives in Train's one history, so an unperformed
 *    block would enter that history as a real one).
 * 2. **`cardio` only when it is defined.** Absent stays absent: a strength-only
 *    session must not gain an empty array, and a session that HAS cardio must
 *    not silently lose it. Same rule `persist` follows.
 * 3. **The weight backstop.** `> 0` is not a body weight — an 11 lb session
 *    bodyweight reached `dailyWeights` once. `isStorableWeight` is the store's
 *    own range and applies here like on every other weight write; a rejected
 *    value still rides on the session document, it just does not become a
 *    weigh-in.
 * 4. **`markExercised` after the session write**, so the streak marker only
 *    exists for a session that is actually recorded. It writes a 0-kcal
 *    `DailyLog`, and the zero is ADR-0026 decision 5: this row is an input to
 *    energy balance, so it is the one place an imported cardio calorie could
 *    reach a measured target, and it must not.
 * 5. **`track` before the Health mirror**, and the mirror last and fire-and-
 *    forget — a workout is finished whether or not Health hears about it.
 *
 * Everything up to and including `markExercised` is awaited, so a failure at
 * any step rejects and the caller can say so. The mirror cannot reject.
 */
export async function finishWorkout(
  uid: string,
  session: WorkoutSession,
  boundary: DayBoundary,
  extras: { bodyweight?: number; sleepHours?: number },
): Promise<void> {
  const id = session.id;
  if (!id) return;
  const date = session.date;
  const exercises = dropEmptySets(fillMissingClusterLoads(session.exercises));
  const cardio = dropEmptyCardio(session.cardio);
  await updateSession(uid, id, {
    status: 'completed',
    exercises,
    ...(cardio !== undefined ? { cardio } : {}),
    bodyweight: extras.bodyweight,
    sleepHours: extras.sleepHours,
  });
  const dateKey = dayKeyAt(date, boundary);
  if (extras.bodyweight != null && isStorableWeight(extras.bodyweight)) {
    await writeDailyMetric(uid, 'weight', dateKey, extras.bodyweight);
  }
  if (extras.sleepHours != null && extras.sleepHours > 0) {
    await writeDailyMetric(uid, 'sleep', dateKey, extras.sleepHours);
  }
  await markExercised(uid, date, boundary);
  track('workout_finished');
  // Mirror the finished session to Health (ends now; strength training).
  void exportWorkout({ start: date, end: new Date() });
}

/**
 * Copy yesterday's food rows onto today, keeping each row's time of day.
 * Returns how many were copied.
 *
 * `logs` and `boundary` are parameters rather than reads, matching
 * `switchToMaintenance` and `setDayStartHour`: the caller is a screen that
 * already holds a live window of rows, and a second read here would both cost a
 * query and be able to disagree with what the user is looking at.
 *
 * **"Yesterday" is a boundary question, not a calendar one** (ADR-0030). The
 * key is derived by stepping the date back one and asking `dayKeyAt` — so for a
 * 3am day start, a row logged at 01:00 belongs to the day before the one the
 * clock names, and it is copied or not on that basis.
 *
 * Each copy is a NEW timestamp — today's date carrying yesterday's hour and
 * minute, seconds zeroed — not the original `date`. Reusing the original would
 * file the copy back onto yesterday, which is the one thing this shortcut must
 * not do.
 *
 * Writes go through `addLogDurably` like every other add: a repeat is the
 * one-tap path a user reaches for precisely when they cannot be bothered to
 * retype a day, and losing it offline would be losing a whole day of meals at
 * once (ADR-0020).
 *
 * The event is counted **once per use, not once per row**, and not at all when
 * there was nothing to copy — the question it answers is whether the shortcut
 * earns its place on an empty Today, and a use that copied nothing is evidence
 * against it, not for it.
 */
export async function repeatYesterday(
  uid: string,
  logs: DailyLog[],
  boundary: DayBoundary,
): Promise<number> {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = dayKeyAt(y, boundary);
  const yLogs = logs.filter((l) => dayKeyAt(l.date, boundary) === yKey && l.calories > 0);
  for (const l of yLogs) {
    const ts = new Date();
    ts.setHours(l.date.getHours(), l.date.getMinutes(), 0, 0);
    await addLogDurably()(uid, {
      calories: l.calories,
      protein: l.protein,
      carbs: l.carbs,
      fat: l.fat,
      mealLabel: l.mealLabel,
      mealType: l.mealType,
      timestamp: ts,
    });
  }
  if (yLogs.length > 0) track('repeat_yesterday');
  return yLogs.length;
}
