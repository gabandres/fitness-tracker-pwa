import type { DailyLog, Profile, ProfileFields } from './types';
import { localDateKey } from './date';
import { computeProtein } from './macro-heuristic';
import { calculateTdee, type TdeeResult } from './tdee';

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

  return { calorieTarget, proteinTarget, proteinMinTarget, currentWeight: w, tdee };
}
