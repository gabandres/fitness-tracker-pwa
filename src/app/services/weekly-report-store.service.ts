import { Injectable, Signal, inject, signal } from '@angular/core';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import { WeeklyReport } from './firebase.service';
import { FitnessStore } from './fitness-store.service';
import { BodyMetricStore } from './body-metric-store.service';
import { MilestoneTracker } from './milestone-tracker.service';
import { GeminiService } from './gemini.service';
import { SubscriptionService } from './subscription.service';
import { TranslationService } from './translation.service';
import { extractErrorCode } from '../models/error-codes';

/**
 * Owns the AI-generated weekly readout: latest cached report, in-flight
 * loading flag, error surface, generate + refresh-on-staleness flow.
 *
 * Extracted from FitnessStore so the report machinery (Gemini call,
 * 7-day staleness check, milestone-context assembly) doesn't bloat the
 * core store. Reads derivations + log windows from FitnessStore as a
 * downstream consumer — derivations still live on the hub.
 */
@Injectable({ providedIn: 'root' })
export class WeeklyReportStore {
  private readonly fb = inject(LEDGER_PORT);
  private readonly store = inject(FitnessStore);
  private readonly body = inject(BodyMetricStore);
  private readonly milestones = inject(MilestoneTracker);
  private readonly gemini = inject(GeminiService);
  private readonly subs = inject(SubscriptionService);
  private readonly translation = inject(TranslationService);

  private readonly _weeklyReport = signal<WeeklyReport | null>(null);
  private readonly _reportLoading = signal(false);
  private readonly _reportError = signal<string | null>(null);

  readonly weeklyReport: Signal<WeeklyReport | null> = this._weeklyReport.asReadonly();
  readonly reportLoading: Signal<boolean> = this._reportLoading.asReadonly();
  readonly reportError: Signal<string | null> = this._reportError.asReadonly();

  constructor() {
    // Register lifecycle callbacks with FitnessStore so it can refresh
    // the report after sign-in / log mutations and clear on sign-out.
    // Keeps FitnessStore from having to inject WeeklyReportStore (which
    // would create a circular dependency — this store depends on
    // FitnessStore for derivations + logs).
    this.store._registerWeeklyReportHooks(
      () => this.checkWeeklyReport(),
      () => this.clear(),
    );
  }

  /** Reset on sign-out. Driven by FitnessStore's lifecycle effect. */
  clear(): void {
    this._weeklyReport.set(null);
    this._reportLoading.set(false);
    this._reportError.set(null);
  }

  /**
   * Fetch the latest cached report so the Trends card renders it.
   * READ-ONLY by design: generation is strictly user-initiated via the
   * Trends card's generate/regenerate buttons. This used to auto-fire
   * `generateWeeklyReport` when the cached report went >7 days stale,
   * which burned a Gemini call per Pro/admin/comped user per week with
   * nobody asking for it — removed 2026-06-12 as a cost control.
   * Called fire-and-forget from FitnessStore's load + refresh paths.
   */
  async checkWeeklyReport(): Promise<void> {
    try {
      const report = await this.fb.getLatestReport();
      this._weeklyReport.set(report);
    } catch (err) {
      console.error('Weekly report check failed:', err);
    }
  }

  /** True when there is no report yet or the cached one is older than
   *  7 days — drives the Trends card's regenerate affordance. */
  isReportStale(): boolean {
    const report = this._weeklyReport();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return !report || report.generatedAt.getTime() < sevenDaysAgo;
  }

  async generateWeeklyReport(): Promise<void> {
    if (this._reportLoading()) return;
    // Pro gate — see checkWeeklyReport for rationale.
    if (!this.subs.isPaid()) return;
    this._reportLoading.set(true);
    this._reportError.set(null);
    try {
      const tdee = this.store.tdee();
      const profile = this.store.profileFields();
      // All-time signals fuel the quiet-milestone line in the report.
      // Use the internal uncapped signal (not the 90-day-windowed public
      // `allTimeLogs`) so milestones track lifetime, not visible history.
      // `logsForLastDays(14)` hydrates `_allTimeLogs` if needed, then
      // filters by local-date key — silently falling back to `_logs()`
      // (14-ROW cap, ~3 days for heavy loggers) would re-introduce the
      // bug this report was rewritten to fix.
      const logs = await this.store.logsForLastDays(14);
      const milestoneContext = this.milestones.buildContext(
        this.store.rawAllTimeLogs(),
        this.store.streak(),
      );
      const result = await this.gemini.generateWeeklyReport(logs, tdee, profile, this.body.dailyWeights(), milestoneContext);
      this._weeklyReport.set({
        id: result.id,
        markdown: result.markdown,
        generatedAt: new Date(result.generatedAt),
      });
    } catch (err) {
      console.error('Weekly report generation failed:', err);
      const code = extractErrorCode(err);
      this._reportError.set(this.translation.tError(code));
    } finally {
      this._reportLoading.set(false);
    }
  }

  clearReportError(): void {
    this._reportError.set(null);
  }
}
