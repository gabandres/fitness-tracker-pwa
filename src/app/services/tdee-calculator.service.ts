import { Injectable } from '@angular/core';
import { DailyLog, ProfileFields } from './firebase.service';
import { calculateTdee, aggregateByDay, type TdeeResult } from '@macrolog/core/tdee';

// The TDEE algorithm is single-sourced in `@macrolog/core/tdee` (shared with
// the Expo app so both frontends compute the same calorie target — ADR-0012).
// Re-exported here so existing `import { TdeeResult } from
// './tdee-calculator.service'` sites keep working.
export type { TdeeResult };

/**
 * Thin Angular seam over the shared TDEE core: `calculate` / `aggregateByDay`
 * delegate to `@macrolog/core/tdee`, the canonical unit-tested implementation.
 * The derivation math that used to live here (streak, weekly summary/envelope,
 * EMA) now lives in `@macrolog/core` — the `FitnessStore` hub wires those pure
 * functions into its signals directly.
 */
@Injectable({ providedIn: 'root' })
export class TdeeCalculatorService {
  /**
   * Aggregate multiple log entries per day into one row per day.
   * Delegates to the shared core so both frontends group identically.
   */
  aggregateByDay(logs: DailyLog[]): DailyLog[] {
    return aggregateByDay(logs);
  }

  /** Total Daily Energy Expenditure — delegates to the shared core. */
  calculate(logs: DailyLog[], profile?: ProfileFields | null): TdeeResult {
    return calculateTdee(logs, profile);
  }
}
