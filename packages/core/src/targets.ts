import type { DailyLog, Profile, ProfileFields } from './types';
import { localDateKey } from './date';
import { computeProtein } from './macro-heuristic';
import { calculateTdee, calorieFloor, type TdeeResult } from './tdee';

/**
 * Daily calorie + protein targets — pure port of the precedence chain in
 * the Angular `FitnessStore` (`targetCalories` / `proteinTarget`), shared
 * with the Expo app so both surfaces show identical numbers.
 */

/** Overlay the dailyWeights map onto each log's `weight` (weights are stored
 *  separately from logs; TDEE's trend must see them). */
export function mergeDailyWeights(
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
): DailyLog[] {
  if (!dailyWeights || Object.keys(dailyWeights).length === 0) return logs;
  return logs.map((l) => {
    const w = dailyWeights[localDateKey(l.date)];
    return w != null ? { ...l, weight: w } : l;
  });
}

/** Most recent non-null weight: daily weights first, then log weights. */
export function currentWeight(
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
): number | null {
  const keys = Object.keys(dailyWeights ?? {}).sort();
  if (keys.length > 0) return dailyWeights[keys[keys.length - 1]];
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].weight != null) return logs[i].weight!;
  }
  return null;
}

export interface GoalProgress {
  startWeight: number;
  currentWeight: number;
  goalWeight: number;
  /** Percent of the way from start to goal, 0–100 (clamped). */
  pct: number;
  /** Pounds still to go (absolute, 1 decimal). */
  remaining: number;
}

/**
 * Progress from the earliest recorded weight toward the goal weight — cut-
 * and bulk-aware. Start weight is the oldest dailyWeight entry, else the
 * oldest log-embedded weight, else the current reading. Returns null when
 * there's no goal, no current weight, or start === goal (progress undefined).
 * Pure port of the Angular FitnessStore.goalProgress derivation.
 */
export function computeGoalProgress(
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
  goalWeight: number | null | undefined,
): GoalProgress | null {
  const current = currentWeight(logs, dailyWeights);
  if (!goalWeight || current == null) return null;

  const keys = Object.keys(dailyWeights ?? {}).sort();
  let start: number | null = keys.length > 0 ? dailyWeights[keys[0]] : null;
  if (start == null) {
    for (const l of logs) {
      if (l.weight != null) {
        start = l.weight;
        break;
      }
    }
  }
  if (start == null) start = current;

  const totalDelta = Math.abs(goalWeight - start);
  if (totalDelta === 0) return null;
  const progressed = start > goalWeight ? start - current : current - start;
  const pct = Math.min(100, Math.max(0, Math.round((progressed / totalDelta) * 100)));
  const remaining = Math.max(0, +Math.abs(current - goalWeight).toFixed(1));
  return { startWeight: start, currentWeight: current, goalWeight, pct, remaining };
}

/** Extract the TDEE-relevant ProfileFields, or null when onboarding is
 *  incomplete (forces seed mode, mirroring the Angular store). */
export function toProfileFields(p?: Profile | null): ProfileFields | null {
  if (!p) return null;
  if (
    p.heightIn == null ||
    p.age == null ||
    !p.sex ||
    !p.activityLevel ||
    p.targetPaceLbsPerWeek == null
  ) {
    return null;
  }
  return { ...p } as ProfileFields;
}

export interface DailyTargets {
  calorieTarget: number;
  proteinTarget: number;
  /** The 1.6 g/kg muscle-retention floor. */
  proteinMinTarget: number;
  currentWeight: number | null;
  tdee: TdeeResult;
}

/** The protein-target safety floor, in grams. Unlike `calorieFloor` there is
 *  NO built-in default: an unset `proteinFloor` returns 0, so the clamp below
 *  is a no-op and protein behaves exactly as it did before the field existed.
 *  Opt-in only — the 1.6 g/kg muscle-retention minimum is already the default
 *  basis, and a second implicit floor on top of it would be a silent change to
 *  every existing user's target. */
export function proteinFloor(profile?: { proteinFloor?: number } | null): number {
  const f = profile?.proteinFloor;
  return f != null && f > 0 ? f : 0;
}

export function dailyTargets(
  profile: Profile | null,
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
): DailyTargets {
  const merged = mergeDailyWeights(logs, dailyWeights);
  const fields = toProfileFields(profile);
  const adjusted = fields?.travelMode ? { ...fields, targetPaceLbsPerWeek: 0 } : fields;
  const tdee = calculateTdee(merged, adjusted);

  let calorieTarget: number;
  if (tdee.source === 'measured' && tdee.reliable) {
    calorieTarget = tdee.newDailyTarget;
  } else {
    const manual = profile?.manualCaloriesTarget;
    calorieTarget = manual != null && manual > 0 ? manual : tdee.newDailyTarget;
  }

  const w = currentWeight(logs, dailyWeights);

  let proteinTarget: number;
  const perKg = profile?.proteinPerKg;
  if (perKg != null && perKg > 0 && w) {
    proteinTarget = computeProtein(w, perKg);
  } else {
    const manual = profile?.manualProteinTarget;
    proteinTarget = manual != null && manual > 0 ? manual : w ? computeProtein(w) : 0;
  }

  const proteinMinTarget = w ? computeProtein(w) : 0;

  // ── Safety floors, applied once, on the way out ──
  // The floors used to live inside `calculateTdee`, which meant they only
  // covered the two branches that module computes (measured, formula). The
  // manual heuristic above and the seed fallback both bypassed them entirely,
  // so a user who raised their floor still saw a target below it.
  //
  // Clamping here instead of at each branch covers all four paths with one
  // expression. It cannot double-clamp: `Math.max` is idempotent, so a
  // measured or formula target that tdee.ts already lifted to the floor is
  // returned byte-identical. The floor is read off the RAW profile, not the
  // derived ProfileFields — `toProfileFields` returns null when onboarding is
  // incomplete, and a floor set by such a user still has to hold.
  //
  // Protein's floor is opt-in and defaults to 0 (see `proteinFloor`), so this
  // line is inert for every profile that has not set one.
  return {
    calorieTarget: Math.max(calorieFloor(profile), calorieTarget),
    proteinTarget: Math.max(proteinFloor(profile), proteinTarget),
    proteinMinTarget,
    currentWeight: w,
    tdee,
  };
}
