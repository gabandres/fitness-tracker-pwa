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

/**
 * **The only supported way to read a daily calorie target.**
 *
 * `TdeeResult.newDailyTarget` is a raw branch output, not the answer. Two of
 * the three branches in `tdee.ts` apply the floor themselves and one — the seed
 * fallback — does not: `SEED_RESULT.newDailyTarget` is a hardcoded 1800, which
 * is below a user floor of 1850 and below any floor above 1800.
 *
 * That gap was live. `coach-prompt.ts`, `weekly-report-prompt.ts` and
 * `tdee-recalibration.ts` each read `tdee.newDailyTarget` directly, so all
 * three could state a target under the user's own floor — and two of them feed
 * an LLM, which then advises against it in prose.
 *
 * Routing every read through here means the floor is applied exactly once, in
 * one place, on every path. `Math.max` is idempotent, so a value `tdee.ts`
 * already lifted comes back byte-identical.
 *
 * `tdee-consumers.test.ts` fails the build if any file outside `tdee.ts` and
 * this one reads `.newDailyTarget`, including files that do not exist yet.
 */
export function finalCalorieTarget(
  tdee: TdeeResult,
  profile?: { calorieFloor?: number } | null,
): number {
  return Math.max(calorieFloor(profile), tdee.newDailyTarget);
}

export function dailyTargets(
  profile: Profile | null,
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
): DailyTargets {
  const merged = mergeDailyWeights(logs, dailyWeights);
  const fields = toProfileFields(profile);
  // `travelMode` is READ-ONLY BACK-COMPAT as of 2026-08-11 — no client can set
  // it any more. It only ever meant "pace = 0", which the pace control already
  // expresses (0 = Maintain), and the v1 toggle that wrote it was retired long
  // before its plumbing was; the setter and its strings sat unreachable for
  // months. Honouring it here is deliberate and must stay: accounts that
  // switched it on under the old UI still carry `travelMode: true` in
  // Firestore, and dropping this line would un-zero their pace and silently
  // cut their daily target. The category treats a break as a temporary goal
  // change rather than a mode — see docs/research/tdee-logging-gaps.md §2.
  const adjusted = fields?.travelMode ? { ...fields, targetPaceLbsPerWeek: 0 } : fields;
  const tdee = calculateTdee(merged, adjusted);

  // `targetMode: 'custom'` means the user typed these numbers and they win —
  // including over a measured estimate. Omitted (every account predating the
  // field) means 'auto', which keeps the branch below byte-for-byte.
  //
  // The distinction matters more than it looks. Under 'auto' the manual value
  // is a SEED: it is used until the estimator has enough data, and then
  // silently replaced. That is correct for onboarding's computed heuristic and
  // wrong for a number a person chose — a user who set 2,000 watched it become
  // 2,410 a fortnight later with nothing telling them why (UX_AUDIT, Abdiel
  // Medina, 2026-08-21). Per-field on purpose: a `manual*` left unset stays
  // automatic even in custom mode.
  const custom = profile?.targetMode === 'custom';

  let calorieTarget: number;
  const manualKcal = profile?.manualCaloriesTarget;
  const hasManualKcal = manualKcal != null && manualKcal > 0;
  if (custom && hasManualKcal) {
    calorieTarget = manualKcal;
  } else if (tdee.source === 'measured' && tdee.reliable) {
    calorieTarget = tdee.newDailyTarget;
  } else {
    calorieTarget = hasManualKcal ? manualKcal : tdee.newDailyTarget;
  }

  const w = currentWeight(logs, dailyWeights);

  let proteinTarget: number;
  const perKg = profile?.proteinPerKg;
  const manualProtein = profile?.manualProteinTarget;
  const hasManualProtein = manualProtein != null && manualProtein > 0;
  // Same rule as calories: an explicit custom number outranks the g/kg basis,
  // which is itself a derived value. Outside custom mode the order is
  // unchanged — perKg first, then the frozen onboarding snapshot.
  if (custom && hasManualProtein) {
    proteinTarget = manualProtein;
  } else if (perKg != null && perKg > 0 && w) {
    proteinTarget = computeProtein(w, perKg);
  } else {
    proteinTarget = hasManualProtein ? manualProtein : w ? computeProtein(w) : 0;
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
    // NB: not `finalCalorieTarget` — `calorieTarget` here may have come from
    // `manualCaloriesTarget` rather than from `tdee`, so the clamp is applied
    // to the chosen value, not to `tdee.newDailyTarget`. Same floor, same
    // expression; `finalCalorieTarget` is the entry point for callers that
    // hold only a `TdeeResult`.
    proteinTarget: Math.max(proteinFloor(profile), proteinTarget),
    proteinMinTarget,
    currentWeight: w,
    tdee,
  };
}
