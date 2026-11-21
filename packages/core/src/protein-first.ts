/**
 * Protein-first mode (2026-11-20).
 *
 * The day read the other way round: protein is the headline, calories are a
 * RANGE to land inside, and nothing grades a deficit. Two people asked for it
 * in the same week — someone eating little by appetite (a GLP-1 medication),
 * for whom the risk is too little protein and too few calories, never too
 * many; and the owner on a trip with no kitchen, where a calorie figure is an
 * estimate and only protein is worth steering by.
 *
 * Two things turn it on, the dated one winning:
 *
 * - a `homePlan.nutrition` window covering today (owner-data; its own protein
 *   target, floor and calorie range);
 * - the profile's `proteinFirst` setting — the range then runs from the
 *   calorie safety minimum (`calorieFloor`) to the day's calorie target, and
 *   the protein floor is the 1.6 g/kg muscle-retention minimum.
 *
 * Presentation only: no target, no maintenance estimate and no stored number
 * changes. Pure; no I/O, no clock.
 */
import { type HomePlanNutrition, homePlanOf, nutritionWindowToday } from './home-plan';
import { calorieFloor } from './tdee';

export interface ProteinFirstView {
  /** Why it is on: a dated plan window, or the profile's setting. */
  source: 'plan' | 'setting';
  /** Protein to aim for, g. */
  proteinTarget: number;
  /** The least that still counts as a good day, g. Null when there is none
   *  below the target. */
  proteinFloor: number | null;
  /** The calorie range. `kcalMin === kcalMax` when the minimum has reached the
   *  target: then it is one number, shown as one. */
  kcalMin: number;
  kcalMax: number;
  note?: string;
}

export interface ProteinFirstInput {
  /** The plan window covering today (`nutritionWindowToday`), or null. */
  window: HomePlanNutrition | null;
  /** The profile's setting. */
  enabled: boolean;
  /** Today's targets, as Today already shows them. */
  calorieTarget: number;
  proteinTarget: number;
  /** The calorie safety minimum (`calorieFloor(profile)`). */
  calorieFloor: number;
  /** The 1.6 g/kg minimum (`TargetsResult.proteinMinTarget`), when known. */
  proteinMin?: number | null;
}

/** The protein-first view for today, or null when the mode is off or the
 *  targets are not known yet (nothing honest to show). */
export function proteinFirstView(input: ProteinFirstInput): ProteinFirstView | null {
  const w = input.window;
  if (w) {
    const target = w.proteinTarget ?? input.proteinTarget;
    if (!(target > 0)) return null;
    return {
      source: 'plan',
      proteinTarget: target,
      proteinFloor: w.proteinFloor != null && w.proteinFloor < target ? w.proteinFloor : null,
      kcalMin: w.kcalMin,
      kcalMax: w.kcalMax,
      ...(w.note ? { note: w.note } : {}),
    };
  }
  if (!input.enabled) return null;
  if (!(input.proteinTarget > 0) || !(input.calorieTarget > 0)) return null;
  const max = Math.round(input.calorieTarget);
  const min = Math.min(Math.round(input.calorieFloor), max);
  const floor = input.proteinMin != null && input.proteinMin > 0 ? Math.round(input.proteinMin) : null;
  return {
    source: 'setting',
    proteinTarget: Math.round(input.proteinTarget),
    proteinFloor: floor != null && floor < Math.round(input.proteinTarget) ? floor : null,
    kcalMin: min > 0 ? min : max,
    kcalMax: max,
  };
}

/** Where today's calories sit against the range. */
/**
 * Whether a day reads protein first for this profile, and with which numbers.
 *
 * The one place the two triggers are read off a profile. Today's hero was its
 * only caller until 2026-11-20, and assembled the inputs itself; Trends and
 * the home-screen widget read the same day, so the assembly lives here — a
 * surface cannot now disagree with the hero about whether the mode is on.
 */
export function proteinFirstForDay(
  profile: { homePlan?: unknown; proteinFirst?: boolean; calorieFloor?: number } | null | undefined,
  day: string,
  targets: { calorieTarget: number; proteinTarget: number; proteinMin?: number | null },
): ProteinFirstView | null {
  return proteinFirstView({
    window: nutritionWindowToday(homePlanOf(profile ?? null), day),
    enabled: profile?.proteinFirst === true,
    calorieTarget: targets.calorieTarget || 0,
    proteinTarget: targets.proteinTarget || 0,
    calorieFloor: calorieFloor(profile ?? null),
    proteinMin: targets.proteinMin,
  });
}

export type CalorieRangeState = 'below' | 'in' | 'above';

export function calorieRangeState(kcal: number, view: Pick<ProteinFirstView, 'kcalMin' | 'kcalMax'>): CalorieRangeState {
  if (kcal < view.kcalMin) return 'below';
  return kcal > view.kcalMax ? 'above' : 'in';
}

/** Where today's protein sits: under the floor, between floor and target, or
 *  at the target. With no floor, `floor` never happens. */
export type ProteinState = 'under-floor' | 'floor' | 'target';

export function proteinState(grams: number, view: Pick<ProteinFirstView, 'proteinTarget' | 'proteinFloor'>): ProteinState {
  if (grams >= view.proteinTarget) return 'target';
  return view.proteinFloor != null && grams >= view.proteinFloor ? 'floor' : 'under-floor';
}
