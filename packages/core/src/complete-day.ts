/**
 * Complete day — whether a day's food diary is complete enough for its intake
 * to count toward the measured maintenance fit (owner decision, 2026-10-24;
 * ADR-0024 amendment, `CONTEXT.md` "Complete day").
 *
 * Stored as `users/{uid}/dailyLogged/{dateKey} = { complete, updatedAt }`,
 * written by the "Day fully logged?" control on Today. Tri-state: no doc =
 * unset, `complete: true` = "yes, that is everything I ate", `complete: false`
 * = "no, I missed things".
 */

/**
 * The per-day answers, `dateKey → complete`, as the ledger reads them. A day
 * with no answer is ABSENT from the map — never `undefined`, never a default.
 */
export type DayCompleteMap = Readonly<Record<string, boolean>>;

/** The answer in a `dailyLogged/{dateKey}` doc, or null when it holds none
 *  (no doc, or a doc without a boolean `complete`). */
export function readDayLogged(data: unknown): boolean | null {
  const complete = (data as { complete?: unknown } | null | undefined)?.complete;
  return typeof complete === 'boolean' ? complete : null;
}

/**
 * Intake below which a finished day does NOT count toward the measured
 * maintenance fit unless the user has said it is complete.
 *
 * ## Why a floor at all (owner decision, 2026-10-24)
 *
 * `TDEE = intake + deficit` assumes the intake column is everything that was
 * eaten. A day logged in part — breakfast and nothing else — enters the fit as
 * a day the user ate 400 kcal, and with a flat scale beside it the estimator
 * can only conclude the user maintains on 400. The account that prompted this
 * logged many days at 262–1,150 kcal while weighing a flat 150–153 lb, and its
 * measured maintenance came out at **931 kcal** — a number no adult maintains
 * on, presented as measured and driving a target.
 *
 * The estimator had no way to tell a partial day from a small one: every
 * intake path filtered only `calories > 0`. Nothing in the record says which
 * days are complete, so the rule supplies a default and the user can override
 * it either way ("Day fully logged?" on Today).
 *
 * ## Why 1,000
 *
 * It sits below the resting energy of almost any adult (Mifflin-St Jeor basal
 * for a 45 kg, 150 cm, 80-year-old woman is ~830), so a day under it is far
 * more likely a partial log than a real day of eating. It is a plausibility
 * floor, not a target: a user who genuinely ate 900 (illness, a fast-mimicking
 * day) marks the day "fully logged" and it counts. It applies to every
 * account, not only the one that surfaced it.
 */
export const COMPLETE_DAY_MIN_KCAL = 1000;

/**
 * Whether a FINISHED day's intake may enter the maintenance fit.
 *
 * - `complete === false` — the user said the diary is incomplete: never.
 * - `complete === true`  — the user said it is complete: always, even under
 *   {@link COMPLETE_DAY_MIN_KCAL}. (A 0-kcal day still carries no intake;
 *   every intake average filters `calories > 0` after this.)
 * - unset — only at or above {@link COMPLETE_DAY_MIN_KCAL}.
 *
 * The day in progress is not a finished day and is not judged here — the
 * estimator zeroes its intake regardless (`withoutInProgressIntake`).
 */
export function isCompleteDay(kcal: number, complete: boolean | null | undefined): boolean {
  if (complete === false) return false;
  if (complete === true) return true;
  return kcal >= COMPLETE_DAY_MIN_KCAL;
}
