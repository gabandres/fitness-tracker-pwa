/**
 * How far an account is from its first MEASURED burn — the footer the Today
 * hero shows before `maintenanceView` has anything honest to say.
 *
 * ## Why this exists (measured 2026-09-10)
 *
 * `config/retention`, 120-day window, synthetic accounts excluded: activated
 * users were logging **0.15 meals a day** (down from 0.48 on 09-02), and the
 * recent signups followed one shape — a burst on day 0 (10, 12, 22 logs) and
 * nothing on day 1. The product's one differentiator, a maintenance figure
 * measured from the user's own intake and weight trend, needs
 * {@link MEASURED_MIN_DAYS} logged days before it exists at all, and NOTHING
 * on Today said so. The only disclosure was a hint on Trends, "Default until
 * you log ~14 days", on a screen a day-0 user has no reason to open.
 *
 * So a new user sees a ring, a formula target and an empty entries list, and
 * has no way to know that day 14 is when the app starts doing the thing the
 * store listing promised. This readout is that sentence, on the screen they
 * open, with the count moving under it — a progress-toward-value bar of the
 * kind the retention research files under "triggers tied to something the
 * user did" (`STATUS.md` §3).
 *
 * ## What it is, and is not
 *
 * A **state readout**, not a Nudge (`CONTEXT.md`): it asks for nothing and
 * cannot be dismissed, so it does not compete for Today's one-Nudge slot
 * (`useTodayNudge`). It lives in the hero footer that `maintenanceView` owns
 * once measured mode opens — the two are mutually exclusive by construction,
 * because this returns `null` the moment `tdee.source === 'measured'`.
 *
 * ## No math is invented here
 *
 * The count is the estimator's own: `calculateTdee` opens measured mode at
 * MEASURED_MIN_DAYS COMPLETE days (`complete-day.ts`, since 2026-10-24 — it
 * was every `aggregateByDay(merged)` row until then). A day with three meals
 * counts once, the day in progress counts (the estimator zeroes its intake but
 * keeps the row), and a finished day under 1,000 kcal or marked "not fully
 * logged" does not — a weigh-in-only row included. When the rule left a day
 * out the estimator reports its own count and this reads it. The weigh-in requirement is
 * `TREND_MIN_WEIGH_INS`, the floor `weightTrendLbsPerDay` returns null under.
 * If either constant moves in `tdee.ts` this readout moves with it; that is
 * why they are exported from there rather than restated here.
 *
 * `MIDNIGHT` is the boundary on purpose: `dailyTargets` merges weights and
 * runs the estimator under MIDNIGHT, not the profile's day boundary, and the
 * readout must count what the estimator counts.
 */
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { addDays, calendarDateKey, parseYmd } from './date';
import type { DailyLog } from './types';
import { mergeDailyWeights } from './targets';
import { aggregateByDay, MEASURED_MIN_DAYS, TREND_MIN_WEIGH_INS, UNANCHORED_MIN_WEIGH_INS, type TdeeResult } from './tdee';

export interface MeasurementProgress {
  /** Distinct logged days the estimator can see, capped at `neededDays`. */
  loggedDays: number;
  /** {@link MEASURED_MIN_DAYS}. */
  neededDays: number;
  /** `neededDays - loggedDays`, never negative. */
  daysToGo: number;
  /** Days carrying a weigh-in, capped at `neededWeighIns`. */
  weighIns: number;
  /** {@link TREND_MIN_WEIGH_INS}. */
  neededWeighIns: number;
  /** `neededWeighIns - weighIns`, never negative. */
  weighInsToGo: number;
  /** 0..1, the fraction of `neededDays` reached — for the track. */
  fraction: number;
  /**
   * True when the complete-day rule left at least one finished day out
   * (`tdee.notEnoughCompleteDays`, 2026-10-24), so `loggedDays` counts
   * COMPLETE days and the UI should say so — "Maintenance: not enough complete
   * days (9 of 14)" — rather than "9 of 14 logged days", which would read as
   * if the other days were never logged.
   */
  notEnoughCompleteDays: boolean;
}

/**
 * The progress readout, or `null` when there is nothing to count toward —
 * measured mode is already open. A formula or seed result always returns a
 * reading, including "14 of 14" for an account that has the days but not the
 * weigh-ins: that is a true statement of what is missing, and the second line
 * the UI draws from `weighInsToGo` is the one thing that account can act on.
 */
export function measurementProgress(
  tdee: TdeeResult,
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
  boundary: DayBoundary = MIDNIGHT,
): MeasurementProgress | null {
  if (tdee.source === 'measured') return null;
  const daily = aggregateByDay(mergeDailyWeights(logs ?? [], dailyWeights ?? {}, boundary), boundary);
  // Since the complete-day rule (2026-10-24) the estimator counts COMPLETE
  // days, not rows. When it left a day out it says how many it kept
  // (`notEnoughCompleteDays.valid`) — read that rather than re-deriving the
  // rule here; when it left none out, every row is a complete day and the row
  // count below is already its count.
  const incomplete = tdee.notEnoughCompleteDays ?? null;
  const loggedDays = Math.min(incomplete ? incomplete.valid : daily.length, MEASURED_MIN_DAYS);
  // Weigh-ins on days with no log row count too, inside the reach the
  // estimator gives them (`withWeighIns` in tdee.ts): after the first logged
  // day and at most MAX_INTRA_RUN_GAP_DAYS (3) past the last.
  let weighed = daily.filter((d) => d.weight != null).length;
  if (daily.length > 0) {
    const keys = new Set<string>(daily.map((d) => dayKeyAt(d.date, boundary)));
    const first = dayKeyAt(daily[0].date, boundary);
    const reach = calendarDateKey(addDays(parseYmd(dayKeyAt(daily[daily.length - 1].date, boundary)), 3));
    for (const k of Object.keys(dailyWeights ?? {})) {
      if (k > first && k <= reach && !keys.has(k)) weighed++;
    }
  }
  // Still the seed with the days AND the two weigh-ins in hand means the
  // estimator refused a two-point trend it had no profile to anchor
  // (`UNANCHORED_MIN_WEIGH_INS`, audit 2026-10-15). Name the third weigh-in
  // rather than read "0 to go" forever.
  const needed =
    tdee.source === 'seed' && loggedDays >= MEASURED_MIN_DAYS && weighed >= TREND_MIN_WEIGH_INS
      ? UNANCHORED_MIN_WEIGH_INS
      : TREND_MIN_WEIGH_INS;
  const weighIns = Math.min(weighed, needed);
  return {
    loggedDays,
    neededDays: MEASURED_MIN_DAYS,
    daysToGo: MEASURED_MIN_DAYS - loggedDays,
    weighIns,
    neededWeighIns: needed,
    weighInsToGo: needed - weighIns,
    fraction: loggedDays / MEASURED_MIN_DAYS,
    notEnoughCompleteDays: incomplete != null,
  };
}
