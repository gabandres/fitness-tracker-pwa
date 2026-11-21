import {
  type BalanceVerdict,
  type ProteinFirstView,
  type TdeeResult,
  type UnitSystem,
  type WeeklyInsights,
  MIN_INSIGHT_DAYS,
  balanceVerdict,
  bodyWeightUnit,
  calorieRangeState,
  toDisplayWeight,
} from '@macrolog/core';
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
 * Glue every number to its unit and every unit to its "/day" so a sentence
 * can only wrap BETWEEN quantities: "2,641 kcal/day" broke as "kcal/" ↵
 * "day." in the Trends breakdown (S21 simulator QA). A no-break space after
 * the number (U+00A0) and a word joiner either side of the slash (U+2060 —
 * iOS and Android both offer a break after "/" otherwise). Applies to every
 * locale's units: kcal, kg, lb, g, and the "/día" / "/sem" / "/dia" suffixes.
 */
export function keepUnitsTogether(s: string): string {
  return s
    .replace(/(\d) (?=(?:kcal|kg|lb|g)(?![\p{L}]))/gu, '$1\u00a0')
    .replace(/(\p{L})\/(?=\p{L})/gu, '$1\u2060/\u2060');
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
  return { line: keepUnitsTogether(line), blended: blended == null ? null : keepUnitsTogether(blended) };
}

/** Weigh-ins a weight direction needs before it can be stated at all. */
export const ANSWER_WEIGH_INS = 2;

/**
 * What Trends says FIRST (UX_AUDIT S24-5, 2026-11-19). The screen opened on
 * "Maintenance estimate 2,665 kcal" and five lines of method; a new user wants
 * to know two things — which way the weight is going and how the eating
 * compares with the plan — and both were already computed further down.
 *
 * Display only: `weightSlopeLbPerWeek` and `avgUnderTarget` come from
 * `calculateWeeklyInsights`, the same seven complete days the Last-7-days card
 * reads, and `balanceVerdict` supplies the dead band. Kilocalories round to
 * the nearest 10 because the sentence says "about".
 *
 * Below the insight gate there is no sentence to make, so the answer is the
 * two things that produce one: food on {@link MIN_INSIGHT_DAYS} days, and
 * {@link ANSWER_WEIGH_INS} weigh-ins.
 */
export type TrendsAnswer =
  | { kind: 'sentence'; weight: string | null; eating: string | null; needsWeighIns: boolean }
  | { kind: 'checklist'; foodDays: number; foodNeeded: number; weighIns: number; weighInsNeeded: number };

/**
 * Where the week's average calories sit against the protein-first range — a
 * place, never a verdict: "inside", "below" or "above", with no "over target"
 * and nothing in red. A range that has collapsed to one number says nothing.
 */
export function rangeLine(
  avgCalories: number,
  view: Pick<ProteinFirstView, 'kcalMin' | 'kcalMax'>,
  t: TFn,
  locale: Locale,
): string | null {
  if (!(view.kcalMin < view.kcalMax)) return null;
  const state = calorieRangeState(avgCalories, view);
  return keepUnitsTogether(
    t(state === 'in' ? 'trends.pfRangeIn' : state === 'below' ? 'trends.pfRangeBelow' : 'trends.pfRangeAbove', {
      min: formatNumber(view.kcalMin, locale),
      max: formatNumber(view.kcalMax, locale),
    }),
  );
}

export function trendsAnswer(input: {
  insights: (Pick<WeeklyInsights, 'avgUnderTarget' | 'weightSlopeLbPerWeek'> & Partial<Pick<WeeklyInsights, 'avgCalories' | 'avgProtein'>>) | null;
  /** Protein-first mode (core `protein-first.ts`): the eating sentence is
   *  about protein, and calories are placed in the range. */
  proteinFirst?: ProteinFirstView | null;
  loggedThisWeek: number;
  weighIns: number;
  hasTarget: boolean;
  unitSystem: UnitSystem;
  t: TFn;
  locale: Locale;
}): TrendsAnswer {
  const { insights, unitSystem, t, locale } = input;
  if (!insights) {
    return {
      kind: 'checklist',
      foodDays: Math.max(0, Math.min(input.loggedThisWeek, MIN_INSIGHT_DAYS)),
      foodNeeded: MIN_INSIGHT_DAYS,
      weighIns: Math.max(0, Math.min(input.weighIns, ANSWER_WEIGH_INS)),
      weighInsNeeded: ANSWER_WEIGH_INS,
    };
  }
  const slope = insights.weightSlopeLbPerWeek;
  let weight: string | null = null;
  if (slope != null) {
    if (Math.abs(slope) < 0.1) {
      weight = t('trends.answer.steady');
    } else {
      const shown = toDisplayWeight(Math.abs(slope), unitSystem);
      const n = formatNumber(shown, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      weight = t(slope < 0 ? 'trends.answer.losing' : 'trends.answer.gaining', {
        rate: `${n} ${bodyWeightUnit(unitSystem)}`,
      });
    }
  }
  let eating: string | null = null;
  const pf = input.proteinFirst;
  if (pf && insights.avgProtein != null && insights.avgCalories != null) {
    const protein = t('trends.answer.pfProtein', {
      n: formatNumber(Math.round(insights.avgProtein), locale),
      target: formatNumber(pf.proteinTarget, locale),
    });
    const state = calorieRangeState(insights.avgCalories, pf);
    const calories =
      pf.kcalMin < pf.kcalMax
        ? t(state === 'in' ? 'trends.answer.pfKcalIn' : state === 'below' ? 'trends.answer.pfKcalBelow' : 'trends.answer.pfKcalAbove', {
            n: formatNumber(Math.round(insights.avgCalories), locale),
            min: formatNumber(pf.kcalMin, locale),
            max: formatNumber(pf.kcalMax, locale),
          })
        : null;
    eating = calories ? `${protein} ${calories}` : protein;
  } else if (input.hasTarget) {
    const v = balanceVerdict(insights.avgUnderTarget);
    const rounded = Math.max(10, Math.round(v.kcal / 10) * 10);
    eating =
      v.kind === 'on'
        ? t('trends.answer.eatOn')
        : t(v.kind === 'under' ? 'trends.answer.eatUnder' : 'trends.answer.eatOver', {
            n: formatNumber(rounded, locale),
          });
  }
  return {
    kind: 'sentence',
    weight: weight == null ? null : keepUnitsTogether(weight),
    eating: eating == null ? null : keepUnitsTogether(eating),
    needsWeighIns: slope == null,
  };
}
