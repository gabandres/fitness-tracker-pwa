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
