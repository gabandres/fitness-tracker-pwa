import type { MeasuredTdee, TdeeResult } from './tdee';

/**
 * Test helpers for the discriminated {@link TdeeResult}.
 *
 * Not a `*.test.ts` file, so vitest does not collect it as a suite.
 *
 * Before the union, a test could write `calculateTdee(logs, p).reliable` and
 * `{ source: 'measured' }` as a whole fixture, because every evidence field was
 * optional on one flat shape. Both now fail to compile — which is the point,
 * and which is also why these two helpers exist: the fix is to state the mode
 * once, not to spray `!` and `as any` over the assertions and lose the checking
 * everywhere else in the same file.
 */

/**
 * Assert a result is measured and return it narrowed.
 *
 * Use at the point a test reads evidence fields off a real `calculateTdee`
 * call. It fails loudly if the branch under test stopped being measured, which
 * is a genuine regression a `!` would have hidden — several of these tests
 * exist precisely because a branch silently fell out of measured mode.
 */
export function asMeasured(result: TdeeResult): MeasuredTdee {
  if (result.source !== 'measured') {
    throw new Error(
      `expected a measured TDEE, got source='${result.source}' (trueTdee ${result.trueTdee})`,
    );
  }
  return result;
}

/** A complete, plausible measured result. Override only what a test is about. */
export function measuredTdeeFixture(over: Partial<MeasuredTdee> = {}): MeasuredTdee {
  return {
    trueTdee: 1870,
    newDailyTarget: 1850,
    weightChangeTrend: -0.1,
    source: 'measured',
    loggingCompletenessPct: 82,
    windowDays: 23,
    spanDays: 28,
    reliable: true,
    outliersDropped: 0,
    measuredTdee: 1870,
    confidence: 1,
    avgDailyIntake: 1700,
    weightSlopeLbsPerDay: -0.0486,
    dailyDeficitAchieved: 170,
    ...over,
  };
}
