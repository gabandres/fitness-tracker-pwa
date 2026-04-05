import { Injectable } from '@angular/core';
import { DailyLog, ProfileFields, ActivityLevel } from './firebase.service';

export interface TdeeResult {
  trueTdee: number;
  newDailyTarget: number;
  /** Pounds lost (positive) or gained (negative) across the 14-day window. */
  weightChangeTrend: number;
  /** Where the number came from — lets the UI label it honestly. */
  source: 'measured' | 'formula' | 'seed';
}

/**
 * TDEE = Total Daily Energy Expenditure.
 *
 * Two modes:
 *   - MEASURED (logs >= 14): purely data-driven. Uses the observed
 *     weight trend + observed average intake to back out TDEE.
 *     Profile is ignored.
 *   - FORMULA (logs < 14 AND profile available): Mifflin-St Jeor BMR
 *     multiplied by the user's activity factor, using the most recent
 *     logged weight (or a reasonable proxy if no logs yet).
 *   - SEED (logs < 14 AND no profile): hardcoded fallback, used only
 *     if profile gate fails somehow.
 *
 * In every mode `newDailyTarget` = trueTdee − (chosen pace × 3500 / 7),
 * clamped at the 1500 kcal safety floor.
 */
@Injectable({ providedIn: 'root' })
export class TdeeCalculatorService {
  private static readonly KCAL_PER_POUND = 3500;
  private static readonly MIN_DAILY_TARGET = 1500;
  private static readonly DEFAULT_PACE_LBS_PER_WEEK = 1.5;

  private static readonly SEED_RESULT: TdeeResult = {
    trueTdee: 2450,
    newDailyTarget: 1800,
    weightChangeTrend: 0,
    source: 'seed',
  };

  private static readonly ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  calculate(logs: DailyLog[], profile?: ProfileFields | null): TdeeResult {
    const sorted = [...(logs ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime());

    // ── Measured mode: ≥14 days ─────────────────────────────────
    if (sorted.length >= 14) {
      const window = sorted.slice(-14);
      const week1 = window.slice(0, 7);
      const week2 = window.slice(7, 14);

      const week1Avg = this.average(week1.map((l) => l.weight));
      const week2Avg = this.average(week2.map((l) => l.weight));
      const weightChange = week1Avg - week2Avg; // + = lost

      const avgDailyIntake = this.average(window.map((l) => l.calories));
      const dailyDeficitAchieved =
        (weightChange * TdeeCalculatorService.KCAL_PER_POUND) / 7;

      const trueTdee = Math.round(avgDailyIntake + dailyDeficitAchieved);
      const pace = profile?.targetPaceLbsPerWeek ?? TdeeCalculatorService.DEFAULT_PACE_LBS_PER_WEEK;
      const targetDeficit = (pace * TdeeCalculatorService.KCAL_PER_POUND) / 7;
      const newDailyTarget = Math.max(
        TdeeCalculatorService.MIN_DAILY_TARGET,
        Math.round(trueTdee - targetDeficit),
      );

      return {
        trueTdee,
        newDailyTarget,
        weightChangeTrend: this.round(weightChange, 2),
        source: 'measured',
      };
    }

    // ── Formula mode: profile present, < 14 days of data ────────
    if (profile) {
      // Use the most recent logged weight as the basis, else fall back
      // to the goal weight, else a reasonable default.
      const latestWeight = sorted.length > 0
        ? sorted[sorted.length - 1].weight
        : profile.goalWeightLbs ?? 180;

      const trueTdee = Math.round(this.mifflinStJeor(profile, latestWeight));
      const pace = profile.targetPaceLbsPerWeek;
      const targetDeficit = (pace * TdeeCalculatorService.KCAL_PER_POUND) / 7;
      const newDailyTarget = Math.max(
        TdeeCalculatorService.MIN_DAILY_TARGET,
        Math.round(trueTdee - targetDeficit),
      );

      return {
        trueTdee,
        newDailyTarget,
        weightChangeTrend: 0,
        source: 'formula',
      };
    }

    // ── Seed fallback: no profile, no data ──────────────────────
    return { ...TdeeCalculatorService.SEED_RESULT };
  }

  /**
   * Mifflin-St Jeor TDEE estimate (BMR × activity multiplier).
   * Inputs come in imperial; converted to metric internally.
   */
  private mifflinStJeor(profile: ProfileFields, weightLbs: number): number {
    const weightKg = weightLbs * 0.453592;
    const heightCm = profile.heightIn * 2.54;

    const bmr = profile.sex === 'male'
      ? 10 * weightKg + 6.25 * heightCm - 5 * profile.age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * profile.age - 161;

    return bmr * TdeeCalculatorService.ACTIVITY_MULTIPLIERS[profile.activityLevel];
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, v) => a + v, 0) / values.length;
  }

  private round(value: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  }
}
