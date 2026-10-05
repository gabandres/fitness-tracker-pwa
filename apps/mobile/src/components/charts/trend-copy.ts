import { type BalanceVerdict, type UnitSystem, bodyWeightUnit, toDisplayWeight } from '@macrolog/core';
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
