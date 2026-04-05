import { Injectable } from '@angular/core';
import { DailyLog } from './firebase.service';

export interface TdeeResult {
  trueTdee: number;
  newDailyTarget: number;
  /** Pounds lost (positive) or gained (negative) across the 14-day window. */
  weightChangeTrend: number;
}

/**
 * TDEE = Total Daily Energy Expenditure.
 *
 * This engine is intentionally strict: it only produces a "real" estimate
 * once we have a full 14-day rolling window. With fewer days it returns
 * hard-coded seed values so the UI can still render.
 *
 * Algorithm (per spec):
 *   - Sort logs ascending by date.
 *   - Split into two 7-day halves.
 *   - weightChange = week1Avg - week2Avg   (positive = weight lost)
 *   - dailyDeficit = (weightChange * 3500) / 7   (1 lb fat ~= 3500 kcal)
 *   - trueTdee    = avgDailyIntake + dailyDeficit
 *   - newDailyTarget = trueTdee - 750  (targets ~1.5 lb/week cut)
 *   - Safety floor: newDailyTarget is clamped at 1500.
 */
@Injectable({ providedIn: 'root' })
export class TdeeCalculatorService {
  private static readonly SEED_RESULT: TdeeResult = {
    trueTdee: 2450,
    newDailyTarget: 1800,
    weightChangeTrend: 0,
  };

  private static readonly KCAL_PER_POUND = 3500;
  private static readonly WEEKLY_CUT_LBS = 1.5;
  private static readonly DAILY_DEFICIT_TARGET =
    (TdeeCalculatorService.WEEKLY_CUT_LBS * TdeeCalculatorService.KCAL_PER_POUND) / 7; // 750
  private static readonly MIN_DAILY_TARGET = 1500;

  calculate(logs: DailyLog[]): TdeeResult {
    if (!logs || logs.length < 14) {
      return { ...TdeeCalculatorService.SEED_RESULT };
    }

    // Defensive sort ascending by date.
    const sorted = [...logs].sort((a, b) => a.date.getTime() - b.date.getTime());
    const window = sorted.slice(-14); // take the most recent 14 if more were passed

    const week1 = window.slice(0, 7);
    const week2 = window.slice(7, 14);

    const week1AvgWeight = this.average(week1.map((l) => l.weight));
    const week2AvgWeight = this.average(week2.map((l) => l.weight));
    const weightChange = week1AvgWeight - week2AvgWeight; // positive = lost

    const avgDailyIntake = this.average(window.map((l) => l.calories));
    const dailyDeficitAchieved =
      (weightChange * TdeeCalculatorService.KCAL_PER_POUND) / 7;

    const trueTdee = avgDailyIntake + dailyDeficitAchieved;
    const rawTarget = trueTdee - TdeeCalculatorService.DAILY_DEFICIT_TARGET;
    const newDailyTarget = Math.max(
      TdeeCalculatorService.MIN_DAILY_TARGET,
      Math.round(rawTarget),
    );

    return {
      trueTdee: Math.round(trueTdee),
      newDailyTarget,
      weightChangeTrend: this.round(weightChange, 2),
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return sum / values.length;
  }

  private round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
