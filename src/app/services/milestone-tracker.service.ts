import { Injectable, inject } from '@angular/core';
import { DailyLog } from './firebase.service';
import { AnalyticsService } from './analytics.service';

/**
 * Lifecycle context derived from all-time logs that drives the quiet-
 * milestone line in the weekly report prompt + the first-meal analytics
 * latch. Pulled out of FitnessStore so the report flow doesn't have to
 * reach into private signal internals and so the latch persistence
 * detail lives in one place.
 */
export interface MilestoneContext {
  totalLogs: number;
  earliestLogAt: Date | null;
  currentStreak: number;
}

@Injectable({ providedIn: 'root' })
export class MilestoneTracker {
  private readonly analytics = inject(AnalyticsService);

  private static readonly FIRST_MEAL_LATCH = 'macrolog.first-meal-tracked';

  private firstMealLatchSet(): boolean {
    try { return !!localStorage.getItem(MilestoneTracker.FIRST_MEAL_LATCH); } catch { return false; }
  }

  private setFirstMealLatch(): void {
    try { localStorage.setItem(MilestoneTracker.FIRST_MEAL_LATCH, '1'); } catch { /* ignore */ }
  }

  /** Clear the first-meal latch — used on sign-out so a different user
      signing in on the same browser gets correctly tracked on their
      first entry. */
  clearFirstMealLatch(): void {
    try { localStorage.removeItem(MilestoneTracker.FIRST_MEAL_LATCH); } catch { /* ignore */ }
  }

  /**
   * Fire `first_meal_logged` analytics exactly once per account. Caller
   * supplies the pre-mutation snapshot of both log windows; both must be
   * empty AND the localStorage latch must be unset for the event to fire.
   */
  checkFirstMeal(args: { recentLogsEmpty: boolean; allTimeLogsEmpty: boolean }): void {
    if (!args.recentLogsEmpty || !args.allTimeLogsEmpty) return;
    if (this.firstMealLatchSet()) return;
    this.setFirstMealLatch();
    this.analytics.track('first_meal_logged');
  }

  /**
   * Build the milestone context block consumed by the weekly-report
   * prompt builder. Uses all-time logs (not the rolling 14-day window)
   * so milestones track lifetime, not visible history.
   */
  buildContext(allTimeLogs: DailyLog[], currentStreak: number): MilestoneContext {
    const earliestLogAt = allTimeLogs.length > 0
      ? allTimeLogs.reduce((min, l) => l.date.getTime() < min ? l.date.getTime() : min, Infinity)
      : null;
    return {
      totalLogs: allTimeLogs.length,
      earliestLogAt: earliestLogAt != null && isFinite(earliestLogAt) ? new Date(earliestLogAt) : null,
      currentStreak,
    };
  }
}
