import { type BalanceVerdict, type TdeeResult, type UnitSystem, bodyWeightUnit, toDisplayWeight } from '@macrolog/core';
import type { Locale, TFn } from '@/i18n';
import { formatNumber } from '@/lib/date-format';

/**
 * Trends sentences that need a little logic — kept out of the route file so
 * they can be unit-tested (`src/app/` holds routes and nothing else).
 */

/** Same rule as Body's trend chip: the steady threshold stays in POUNDS (a
 *  statement about the measurement), the shown number follows the user's
 *  unit. This printed the pound value under "lb/wk" to metric users once, and
 *  `toFixed(1)` printed "0.5" to Brazilian users after that — the decimal is
 *  the locale's (`0,5 kg/sem`), which is why it goes through `formatNumber`. */
export function slopeLabel(slopeLbPerWeek: number, unitSystem: UnitSystem, t: TFn, locale: Locale): string {
  if (Math.abs(slopeLbPerWeek) < 0.1) return t('body.holdingSteady');
  const shown = toDisplayWeight(Math.abs(slopeLbPerWeek), unitSystem);
  const n = formatNumber(shown, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${slopeLbPerWeek < 0 ? '−' : '+'}${n} ${bodyWeightUnit(unitSystem)}/${t('body.perWeek')}`;
}

/**
 * "168 kcal/day under maintenance" — a whole sentence per side, never a sign
 * glyph glued to a noun. The tile used to print "−1 Avg deficit" against the
 * TARGET while the real deficit against maintenance was ~170 (owner's device,
 * 2026-10-04).
 */
export function maintenanceLine(v: BalanceVerdict, t: TFn, locale: Locale): string {
  if (v.kind === 'on') return t('trends.atMaintenance');
  return t(v.kind === 'under' ? 'trends.underMaintenance' : 'trends.overMaintenance', {
    n: formatNumber(v.kcal, locale),
  });
}

/** The labelled vs-target line: "1 kcal under target" never; "On target" within
 *  the dead band (`ON_TARGET_BAND_KCAL`). */
export function targetLine(v: BalanceVerdict, t: TFn, locale: Locale): string {
  if (v.kind === 'on') return t('trends.onTarget');
  return t(v.kind === 'under' ? 'trends.underTarget' : 'trends.overTarget', {
    n: formatNumber(v.kcal, locale),
  });
}

/**
 * "You averaged 2,100 kcal/day while your trend moved −0.3 kg/wk — so you
 * burn about 2,450 kcal/day." The hero's arithmetic, in the user's unit and
 * locale (sim review 2026-10-06: the hero said only "From your logged intake +
 * weight trend", which names the inputs and shows neither).
 *
 * Display only — every number is a field `calculateTdee` already produced
 * (`avgDailyIntake`, `weightSlopeLbsPerDay`, `measuredTdee`); nothing is
 * recomputed here. When the estimate was damped toward the profile anchor
 * (`confidence` < 1) the raw sum and the hero differ, and a second sentence
 * says so rather than printing an equation that does not add up. Null outside
 * measured mode or without intake to quote.
 */
export function maintenanceBreakdown(
  tdee: TdeeResult,
  unitSystem: UnitSystem,
  t: TFn,
  locale: Locale,
): { line: string; blended: string | null } | null {
  if (tdee.source !== 'measured' || !(tdee.avgDailyIntake > 0) || !(tdee.measuredTdee > 0)) return null;
  const slopeLbPerWeek = tdee.weightSlopeLbsPerDay * 7;
  const intake = formatNumber(Math.round(tdee.avgDailyIntake), locale);
  const burn = formatNumber(Math.round(tdee.measuredTdee), locale);
  const line =
    Math.abs(slopeLbPerWeek) < 0.1
      ? t('trends.breakdownSteady', { intake, burn })
      : t('trends.breakdown', { intake, rate: slopeLabel(slopeLbPerWeek, unitSystem, t, locale), burn });
  const blended =
    Math.abs(Math.round(tdee.trueTdee) - Math.round(tdee.measuredTdee)) >= 10
      ? t('trends.breakdownBlended', { kcal: formatNumber(Math.round(tdee.trueTdee), locale) })
      : null;
  return { line, blended };
}
