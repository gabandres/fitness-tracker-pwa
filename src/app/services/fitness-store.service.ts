import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import {
  DailyLog,
  LogEntry,
  MealPreset,
  ProfileFields,
  UserProfile,
  WeeklyReport,
  Measurement,
} from './firebase.service';
import { TdeeCalculatorService, TdeeResult, WeeklySummary, WeeklyEnvelope } from './tdee-calculator.service';
import { localDateKey } from '../utils/date';
import { GeminiService } from './gemini.service';
import { SubscriptionService } from './subscription.service';
import { TranslationService } from './translation.service';
import { extractErrorCode } from '../models/error-codes';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Max preset slots for non-paid users (matches freemium table). */
export const PRESET_LIMIT_FREE = 10;

/** Free-tier visible chart history window. Pro sees all-time. */
export const CHART_HISTORY_DAYS_FREE = 90;

/** Thrown by FitnessStore.addPreset when a free-tier user is at cap.
    Carries the limit so the UI can show a specific message. */
export class PresetLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Preset limit of ${limit} reached.`);
    this.name = 'PresetLimitError';
  }
}

export interface GoalProgress {
  startWeight: number;
  currentWeight: number;
  goalWeight: number;
  pct: number;
  remaining: number;
}

export interface MonthlySummary {
  daysTracked: number;
  weeksTracked: number;
  firstWeight: number;
  lastWeight: number;
  totalChange: number;     // + = gained, - = lost
  avgWeeklyChange: number;
  avgCalories: number;
  adherencePct: number;
  startDate: Date;
}

export interface TodaySummary {
  totalCalories: number;
  totalProtein: number;
}

/**
 * Single reactive data layer for the entire app. Owns the canonical
 * log + preset cache, all derived computations (TDEE, streak, weekly,
 * EMA, goal progress, today summary), and mutation methods that
 * auto-refresh all consumers via Angular signals.
 *
 * Components inject this one service and read signals. They never
 * call LEDGER_PORT or TdeeCalculatorService directly.
 *
 * Lifecycle: loads on sign-in, clears on sign-out — driven by an
 * effect watching AuthService.isSignedIn().
 */
@Injectable({ providedIn: 'root' })
export class FitnessStore {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(LEDGER_PORT);
  private readonly calc = inject(TdeeCalculatorService);
  private readonly gemini = inject(GeminiService);
  private readonly subs = inject(SubscriptionService);
  private readonly translation = inject(TranslationService);

  // ─── Private mutable state ──────────────────────────────────
  private readonly _logs = signal<DailyLog[]>([]);
  private readonly _presets = signal<MealPreset[]>([]);
  private readonly _status = signal<StoreStatus>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _allTimeLogs = signal<DailyLog[]>([]);
  private readonly _weeklyReport = signal<WeeklyReport | null>(null);
  private readonly _reportLoading = signal(false);
  private readonly _reportError = signal<string | null>(null);
  /** Surfaced once per day when the user first crosses their daily
      calorie budget. Cleared on ack or on day rollover. */
  private readonly _budgetCrossed = signal(false);
  private readonly _measurements = signal<Measurement[]>([]);
  private readonly _dailyWeights = signal<Record<string, number>>({});
  private readonly _dailyWater = signal<Record<string, number>>({});
  private readonly _undoEntry = signal<DailyLog | null>(null);
  private _undoTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Public read-only state ─────────────────────────────────
  readonly logs: Signal<DailyLog[]> = this._logs.asReadonly();
  readonly presets: Signal<MealPreset[]> = this._presets.asReadonly();
  readonly profile: Signal<UserProfile | null> = this.fb.profile;
  readonly status: Signal<StoreStatus> = this._status.asReadonly();
  readonly undoEntry: Signal<DailyLog | null> = this._undoEntry.asReadonly();
  readonly weeklyReport: Signal<WeeklyReport | null> = this._weeklyReport.asReadonly();
  readonly reportLoading: Signal<boolean> = this._reportLoading.asReadonly();
  readonly reportError: Signal<string | null> = this._reportError.asReadonly();
  readonly budgetCrossed: Signal<boolean> = this._budgetCrossed.asReadonly();
  readonly measurements: Signal<Measurement[]> = this._measurements.asReadonly();
  readonly dailyWeights: Signal<Record<string, number>> = this._dailyWeights.asReadonly();
  readonly dailyWater: Signal<Record<string, number>> = this._dailyWater.asReadonly();
  readonly latestMeasurement: Signal<Measurement | null> = computed(() => this._measurements()[0] ?? null);
  readonly previousMeasurement: Signal<Measurement | null> = computed(() => this._measurements()[1] ?? null);
  /**
   * Last 5 unique meal labels, newest first, from the current loaded
   * logs window (`FitnessStore._load()` fetches `getRecentLogs(14)`, a
   * 14-ROW cap — so a heavy logger may only span 2 days, a sparse
   * logger may span weeks). Used by the entry form's "recent" row for
   * one-tap re-log — the second highest-leverage retention feature
   * after repeat-yesterday, because most users' meal vocabulary is
   * small and recurring. Skips empty labels (weight-only / 0-cal
   * training-marker entries) and de-dupes case-insensitively so the
   * row doesn't fill with five copies of "pollo con arroz".
   */
  readonly recentEntries: Signal<DailyLog[]> = computed(() => {
    const seen = new Set<string>();
    const out: DailyLog[] = [];
    const list = this._logs();
    // `_logs()` is oldest-first (the adapter reverses
    // the desc-ordered query before returning). Iterate end-to-start so
    // the user sees their newest meals first.
    for (let i = list.length - 1; i >= 0 && out.length < 5; i--) {
      const log = list[i];
      const label = log.mealLabel?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(log);
    }
    return out;
  });

  readonly measurementDeltas: Signal<{ waist?: number; chest?: number; bicep?: number; hip?: number } | null> = computed(() => {
    const latest = this.latestMeasurement();
    const prev = this.previousMeasurement();
    if (!latest || !prev) return null;
    const delta = (a?: number, b?: number) => (a != null && b != null) ? +(a - b).toFixed(1) : undefined;
    return { waist: delta(latest.waist, prev.waist), chest: delta(latest.chest, prev.chest), bicep: delta(latest.bicep, prev.bicep), hip: delta(latest.hip, prev.hip) };
  });
  readonly error: Signal<string | null> = this._error.asReadonly();

  // ─── Profile fields extraction (single source of truth) ─────
  private readonly _profileFields = computed<ProfileFields | null>(() => {
    const p = this.fb.profile();
    if (!p?.profileCompleted) return null;
    return {
      heightIn: p.heightIn!,
      age: p.age!,
      sex: p.sex!,
      activityLevel: p.activityLevel!,
      targetPaceLbsPerWeek: p.targetPaceLbsPerWeek!,
      goalWeightLbs: p.goalWeightLbs,
      travelMode: p.travelMode,
    };
  });

  /** True when the user has travel mode enabled (target = maintenance). */
  readonly travelMode: Signal<boolean> = computed(() =>
    this.fb.profile()?.travelMode === true,
  );

  // ─── Pre-computed derivations ───────────────────────────────
  readonly tdee: Signal<TdeeResult> = computed(() => {
    const fields = this._profileFields();
    // In travel mode, override pace to 0 (maintenance — no deficit).
    const adjusted = fields?.travelMode
      ? { ...fields, targetPaceLbsPerWeek: 0 as any }
      : fields;
    return this.calc.calculate(this._logs(), adjusted);
  });

  readonly targetCalories: Signal<number> = computed(() =>
    this.tdee().newDailyTarget,
  );

  /**
   * One-time adaptive TDEE notification: when measured mode first kicks in,
   * show the delta between the formula estimate and the real measured TDEE.
   * Returns null if not in measured mode or if already dismissed.
   */
  readonly tdeeTransition: Signal<{ formulaTdee: number; measuredTdee: number; diffPct: number } | null> = computed(() => {
    const tdee = this.tdee();
    if (tdee.source !== 'measured') return null;
    // Check if already dismissed
    if (localStorage.getItem('macrolog.tdee-transition-dismissed')) return null;
    // Compute what formula would have said
    const fields = this._profileFields();
    if (!fields) return null;
    const formulaResult = this.calc.calculate([], fields); // empty logs = formula mode
    const diff = tdee.trueTdee - formulaResult.trueTdee;
    const diffPct = Math.round((diff / formulaResult.trueTdee) * 100);
    return { formulaTdee: formulaResult.trueTdee, measuredTdee: tdee.trueTdee, diffPct };
  });

  /** Most recent non-null weight (daily weights first, then log weights). */
  readonly currentWeight: Signal<number | null> = computed(() => {
    const dw = this._dailyWeights();
    const keys = Object.keys(dw).sort();
    if (keys.length > 0) return dw[keys[keys.length - 1]];
    const list = this._logs();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].weight != null) return list[i].weight!;
    }
    return null;
  });

  /** Evidence-based protein target: 0.75g/lb (midpoint of 0.7–0.8 range). */
  readonly proteinTarget: Signal<number> = computed(() => {
    const w = this.currentWeight();
    return w ? Math.round(w * 0.75) : 0;
  });

  /** Minimum adequate protein: 0.7g/lb (lower bound of evidence-based range). */
  readonly proteinMinTarget: Signal<number> = computed(() => {
    const w = this.currentWeight();
    return w ? Math.round(w * 0.70) : 0;
  });

  /** Visible chart history. Free tier is windowed to the last
      CHART_HISTORY_DAYS_FREE days; Pro sees everything. The internal
      _allTimeLogs signal stays uncapped so CSV export and
      long-horizon stats (monthlySummary) can still read full history. */
  readonly allTimeLogs: Signal<DailyLog[]> = computed(() => {
    const all = this._allTimeLogs();
    if (this.subs.isPaid()) return all;
    const cutoff = Date.now() - CHART_HISTORY_DAYS_FREE * 24 * 60 * 60 * 1000;
    return all.filter((l) => l.date.getTime() >= cutoff);
  });

  readonly streak: Signal<number> = computed(() =>
    this.calc.computeStreak(this._logs()),
  );

  readonly weekly: Signal<WeeklySummary | null> = computed(() =>
    this.calc.weeklySummary(this._logs(), this.targetCalories()),
  );

  readonly envelope: Signal<WeeklyEnvelope | null> = computed(() =>
    this.calc.weeklyEnvelope(this._logs(), this.targetCalories()),
  );

  readonly ema: Signal<number[]> = computed(() => {
    const dw = this._dailyWeights();
    const logWeights = this._logs().map((l) => {
      const key = localDateKey(l.date);
      return dw[key] ?? l.weight;
    }).filter((w): w is number => w != null);
    return this.calc.ema(logWeights, 7);
  });

  readonly trendLabel: Signal<string> = computed(() => {
    const change = this.tdee().weightChangeTrend;
    if (change === 0) return '—';
    return `${change > 0 ? '↓' : '↑'} ${Math.abs(change).toFixed(1)} lbs`;
  });

  readonly goalProgress: Signal<GoalProgress | null> = computed(() => {
    const profile = this.fb.profile();
    const goal = profile?.goalWeightLbs;
    const current = this.currentWeight();
    if (!goal || current == null) return null;

    // Starting weight: the earliest weight on record across ALL sources,
    // not the rolling 14-day window. Previously the loop walked `_logs()`
    // (14-day cap) for an `l.weight` — both assumptions were wrong:
    //   1. The 14-day window made `start` drift forward as old days rolled
    //      off, shrinking the (start - current) numerator and pinning the
    //      progress bar at ~0% even after real progress.
    //   2. Log-embedded `l.weight` is the legacy path; current writes go
    //      to the `dailyWeights` subcollection, so daily-weight-only users
    //      had `start === current` from day one.
    // Now: prefer the oldest dailyWeights entry, then fall back to the
    // oldest all-time log with a weight, then the current reading.
    const dw = this._dailyWeights();
    const dwKeys = Object.keys(dw).sort();
    let start: number | null = dwKeys.length > 0 ? dw[dwKeys[0]] : null;
    if (start == null) {
      const all = this._allTimeLogs();
      // _allTimeLogs is oldest-first (same as _logs); walk forward for the
      // first weighted entry.
      for (const l of all) {
        if (l.weight != null) { start = l.weight; break; }
      }
    }
    if (start == null) start = current;

    // Supports both cut (start > goal) and bulk (start < goal). Guarding
    // on identity avoids a divide-by-zero when the user picks a goal
    // equal to their starting weight — in that edge case, progress is
    // undefined and we hide the bar.
    const totalDelta = Math.abs(goal - start);
    if (totalDelta === 0) return null;

    const progressed = start > goal
      ? start - current   // cutting: progress counts pounds lost
      : current - start;  // bulking: progress counts pounds gained
    const pct = Math.min(100, Math.max(0, Math.round((progressed / totalDelta) * 100)));
    const remaining = Math.max(0, +Math.abs(current - goal).toFixed(1));
    return { startWeight: start, currentWeight: current, goalWeight: goal, pct, remaining };
  });

  readonly todaySummary: Signal<TodaySummary | null> = computed(() => {
    const today = localDateKey(new Date());
    const todayLogs = this._logs().filter(
      (l) => localDateKey(l.date) === today,
    );
    if (todayLogs.length === 0) return null;
    return {
      totalCalories: todayLogs.reduce((s, l) => s + l.calories, 0),
      totalProtein: todayLogs.reduce((s, l) => s + (l.protein ?? 0), 0),
    };
  });

  readonly hasLoggedToday: Signal<boolean> = computed(() =>
    this.todaySummary() !== null,
  );

  /** Long-term summary computed from all-time logs (loaded on demand). */
  readonly monthlySummary: Signal<MonthlySummary | null> = computed(() => {
    const logs = this._allTimeLogs();
    if (logs.length < 7) return null;
    const daily = this.calc.aggregateByDay(logs);
    const weights = daily.map((d) => d.weight).filter((w): w is number => w != null);
    if (weights.length < 2) return null;

    const firstWeight = weights[0];
    const lastWeight = weights[weights.length - 1];
    const totalChange = +(lastWeight - firstWeight).toFixed(1);
    const firstDate = daily[0].date;
    const lastDate = daily[daily.length - 1].date;
    const daysTracked = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));
    const weeksTracked = +(daysTracked / 7).toFixed(1);
    const avgWeeklyChange = +(totalChange / Math.max(1, weeksTracked)).toFixed(2);

    const allCals = daily.map((d) => d.calories);
    const avgCalories = Math.round(allCals.reduce((s, c) => s + c, 0) / allCals.length);

    const target = this.targetCalories();
    const adherentDays = allCals.filter((c) => Math.abs(c - target) <= 100).length;
    const adherencePct = Math.round((adherentDays / allCals.length) * 100);

    return {
      daysTracked,
      weeksTracked,
      firstWeight,
      lastWeight,
      totalChange,
      avgWeeklyChange,
      avgCalories,
      adherencePct,
      startDate: firstDate,
    };
  });

  // ─── Lifecycle ──────────────────────────────────────────────
  constructor() {
    effect(() => {
      // Wait for both sign-in AND email verification before hitting
      // Firestore — unverified users can't pass the rule guard, and
      // a failed _load() leaves the UI in a confusing error state.
      // The verify-email gate in the App shell handles the in-between.
      if (this.auth.isSignedIn() && this.auth.emailVerified()) {
        this._load();
      } else {
        this._clear();
      }
    });

    // Budget-crossing toast: fire once per calendar day when today's
    // total calories crosses the computed daily target. localStorage
    // flag is keyed by date so the toast doesn't re-fire across reloads
    // within the same day, and auto-resets the next morning.
    effect(() => {
      const summary = this.todaySummary();
      const target = this.targetCalories();
      if (!summary || target <= 0) return;
      if (summary.totalCalories <= target) return;
      const key = `macrolog.budget-crossed.${localDateKey(new Date())}`;
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
      } catch { /* private mode — still show the toast this session */ }
      this._budgetCrossed.set(true);
    });
  }

  /** Dismiss the budget-crossed toast. The localStorage day-key stays
      set so it doesn't re-fire after reload on the same day. */
  ackBudgetCrossed(): void {
    this._budgetCrossed.set(false);
  }

  /** The user's webhook API key, or null if not generated. */
  readonly webhookApiKey: Signal<string | null> = computed(() =>
    this.fb.profile()?.webhookApiKey ?? null,
  );

  /** The fasting start time, or null if not fasting. */
  readonly fastStartedAt: Signal<Date | null> = computed(() => {
    const p = this.fb.profile();
    if (!p) return null;
    const raw = (p as any).fastStartedAt;
    if (!raw) return null;
    // Could be a Firestore Timestamp or a Date depending on how it was read.
    return raw instanceof Date ? raw : raw.toDate?.() ?? null;
  });

  readonly isFasting: Signal<boolean> = computed(() => this.fastStartedAt() !== null);

  // ─── Mutations (fire-and-forget, auto-refresh) ──────────────
  async startFast(startedAt?: Date): Promise<void> {
    await this.fb.startFast(startedAt);
  }

  async breakFast(): Promise<void> {
    await this.fb.breakFast();
  }

  async generateWebhookApiKey(): Promise<string> {
    return this.fb.generateWebhookApiKey();
  }

  async revokeWebhookApiKey(): Promise<void> {
    await this.fb.revokeWebhookApiKey();
  }

  async toggleTravelMode(): Promise<void> {
    const next = !this.travelMode();
    await this.fb.setTravelMode(next);
    // Profile signal updates inside setTravelMode, which triggers
    // the computed _profileFields → tdee → targetCalories chain.
  }

  async setDailyWeight(dateKey: string, weight: number): Promise<void> {
    await this.fb.setDailyWeight(dateKey, weight);
    this._dailyWeights.update((prev) => ({ ...prev, [dateKey]: weight }));
  }

  /** Overwrite the water intake total for a specific day (ml). */
  async setDailyWater(dateKey: string, ml: number): Promise<void> {
    const clamped = Math.max(0, Math.min(20000, Math.round(ml)));
    await this.fb.setDailyWater(dateKey, clamped);
    this._dailyWater.update((prev) => ({ ...prev, [dateKey]: clamped }));
  }

  /** Increment water intake for a specific day by `deltaMl`. Computes
      the next total client-side from the current signal value — no
      transactional read/modify/write since a single-user app doesn't
      have concurrent writers for the same day. */
  async addWater(dateKey: string, deltaMl: number): Promise<void> {
    const current = this._dailyWater()[dateKey] ?? 0;
    await this.setDailyWater(dateKey, current + deltaMl);
  }

  async addLog(entry: LogEntry): Promise<void> {
    await this.fb.addLog(entry);
    await this._refreshLogs();
  }

  /**
   * Clone every non-weight log from yesterday into today, preserving
   * calories, protein, meal labels, and exercise flags. Weight is NOT
   * copied — weight is strictly a same-day measurement, not a "same
   * as yesterday" signal. Timestamps are rewritten to today at the
   * same hour-of-day as the original so the ordering stays sensible.
   *
   * Returns the number of entries cloned, 0 if yesterday was empty
   * (callers can use this to decide whether to show the CTA at all).
   */
  async repeatYesterday(): Promise<number> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const yKey = localDateKey(yesterday);

    const yesterdayLogs = this._logs().filter(
      (l) => localDateKey(l.date) === yKey,
    );
    if (yesterdayLogs.length === 0) return 0;

    // Write sequentially so Firestore ordering matches the source day.
    // Wrap in try/finally so a mid-loop failure still reloads the store —
    // otherwise the partial state written to Firestore wouldn't appear in
    // the UI until the next manual refresh, which is confusing.
    let cloned = 0;
    try {
      for (const src of yesterdayLogs) {
        const clonedAt = new Date(
          today.getFullYear(), today.getMonth(), today.getDate(),
          src.date.getHours(), src.date.getMinutes(), src.date.getSeconds(),
        );
        const entry: LogEntry = {
          calories: src.calories,
          timestamp: clonedAt,
        };
        if (src.protein != null) entry.protein = src.protein;
        if (src.mealLabel) entry.mealLabel = src.mealLabel;
        // Carry exercise flag but collapse the legacy split flags into the
        // modern `exerciseCompleted` so we don't re-persist deprecated fields.
        if (src.exerciseCompleted || src.liftCompleted || src.cardioCompleted) {
          entry.exerciseCompleted = true;
        }
        // Weight deliberately omitted — not a "same as yesterday" signal.
        await this.fb.addLog(entry);
        cloned += 1;
      }
    } finally {
      // Always reload so any partial clones are visible; catch + swallow
      // reload errors so the original failure (if any) is what propagates.
      try { await this._refreshLogs(); } catch { /* noop */ }
    }
    return cloned;
  }

  /**
   * Generalized bulk-copy: clone every log on the given source date into
   * today, preserving time-of-day. Mirrors `repeatYesterday` but takes
   * an arbitrary date key so the daily-ledger can offer a per-day
   * "copy this day to today" action — useful when yesterday is wrong
   * (rest day / travel) and you want to seed today from a different
   * representative day.
   *
   * Returns number of entries cloned. 0 if the source day is empty or
   * is today itself (cloning today into today would double-count).
   */
  async copyDayToToday(sourceDateKey: string): Promise<number> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayKey = localDateKey(today);
    if (sourceDateKey === todayKey) return 0;

    const sourceLogs = this._logs().filter(
      (l) => localDateKey(l.date) === sourceDateKey,
    );
    if (sourceLogs.length === 0) return 0;

    let cloned = 0;
    try {
      for (const src of sourceLogs) {
        const clonedAt = new Date(
          today.getFullYear(), today.getMonth(), today.getDate(),
          src.date.getHours(), src.date.getMinutes(), src.date.getSeconds(),
        );
        const entry: LogEntry = {
          calories: src.calories,
          timestamp: clonedAt,
        };
        if (src.protein != null) entry.protein = src.protein;
        if (src.mealLabel) entry.mealLabel = src.mealLabel;
        if (src.exerciseCompleted || src.liftCompleted || src.cardioCompleted) {
          entry.exerciseCompleted = true;
        }
        await this.fb.addLog(entry);
        cloned += 1;
      }
    } finally {
      try { await this._refreshLogs(); } catch { /* noop */ }
    }
    return cloned;
  }

  async updateLog(id: string, entry: LogEntry): Promise<void> {
    await this.fb.updateLog(id, entry);
    await this._refreshLogs();
  }

  /**
   * Toggle the exercise flag on a day. Applied to the first log entry that
   * already carries the flag (including legacy lift/cardio flags, so
   * historic days can be un-marked with one tap), or the first entry
   * otherwise. Creates a zero-calorie marker entry for empty days.
   */
  async toggleDayExercise(dateKey: string): Promise<void> {
    const dayLogs = this._logs().filter(
      (l) => localDateKey(l.date) === dateKey,
    );

    const isExercised = (l: DailyLog) =>
      !!(l.exerciseCompleted || l.liftCompleted || l.cardioCompleted);

    if (dayLogs.length > 0) {
      const target = dayLogs.find(isExercised) ?? dayLogs[0];
      const patch: LogEntry = {
        calories: target.calories,
        exerciseCompleted: !isExercised(target),
      };
      // Preserve unrelated fields that updateLog would otherwise clear.
      if (target.protein != null) patch.protein = target.protein;
      if (target.mealLabel) patch.mealLabel = target.mealLabel;
      if (target.weight != null) patch.weight = target.weight;
      await this.updateLog(target.id!, patch);
    } else {
      const [y, m, d] = dateKey.split('-').map(Number);
      const entry: LogEntry = {
        calories: 0,
        timestamp: new Date(y, m - 1, d, 12, 0, 0),
        mealLabel: 'Training',
        exerciseCompleted: true,
      };
      await this.addLog(entry);
    }
  }

  async deleteLog(id: string): Promise<void> {
    // Cache entry for undo before deleting.
    const entry = this._logs().find((l) => l.id === id) ?? null;
    await this.fb.deleteLog(id);
    await this._refreshLogs();

    if (entry) {
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._undoEntry.set(entry);
      this._undoTimer = setTimeout(() => {
        this._undoEntry.set(null);
        this._undoTimer = null;
      }, 8000);
    }
  }

  async undoDelete(): Promise<void> {
    const entry = this._undoEntry();
    if (!entry) return;
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this._undoEntry.set(null);
    this._undoTimer = null;

    const logEntry: LogEntry = {
      calories: entry.calories,
      timestamp: entry.date, // restore at original time
    };
    if (entry.weight != null) logEntry.weight = entry.weight;
    if (entry.protein != null) logEntry.protein = entry.protein;
    // Collapse legacy lift/cardio flags into the unified exercise flag.
    if (entry.exerciseCompleted || entry.liftCompleted || entry.cardioCompleted) {
      logEntry.exerciseCompleted = true;
    }
    if (entry.mealLabel) logEntry.mealLabel = entry.mealLabel;

    await this.addLog(logEntry);
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<void> {
    if (!this.subs.isPaid() && this._presets().length >= PRESET_LIMIT_FREE) {
      throw new PresetLimitError(PRESET_LIMIT_FREE);
    }
    await this.fb.addPreset(preset);
    this._presets.set(await this.fb.getPresets());
  }

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    await this.fb.addMeasurement(entry);
    this._measurements.set(await this.fb.getRecentMeasurements());
  }

  async deleteMeasurement(id: string): Promise<void> {
    await this.fb.deleteMeasurement(id);
    this._measurements.set(await this.fb.getRecentMeasurements());
  }

  async deletePreset(id: string): Promise<void> {
    await this.fb.deletePreset(id);
    this._presets.set(await this.fb.getPresets());
  }

  /** Explicit re-fetch for the refresh button. */
  async refresh(): Promise<void> {
    await this._load();
  }

  /** All logs uncapped — used only by CSV export. */
  async getAllLogs(): Promise<DailyLog[]> {
    return this.fb.getRecentLogs(9999);
  }

  // ─── Private helpers ────────────────────────────────────────
  private async _load(): Promise<void> {
    this._status.set('loading');
    this._error.set(null);
    try {
      // Ensure the user profile doc exists before fetching data.
      // On first sign-in this creates the doc; on subsequent sign-ins
      // it bumps lastSeenAt. Idempotent.
      await this.fb.ensureUserProfile();

      const [logs, presets, measurements, dailyWeights, dailyWater] = await Promise.all([
        this.fb.getRecentLogs(14),
        this.fb.getPresets(),
        this.fb.getRecentMeasurements(),
        this.fb.getDailyWeights(),
        this.fb.getDailyWater(),
      ]);
      this._logs.set(logs);
      this._presets.set(presets);
      this._measurements.set(measurements);
      this._dailyWeights.set(dailyWeights);
      this._dailyWater.set(dailyWater);
      this._status.set('ready');

      // Fire-and-forget background tasks.
      this._checkWeeklyReport();
      this._loadAllTimeLogs();
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Load failed.');
      this._status.set('error');
    }
  }

  /** Reload just the log window after a log mutation. Avoids the
   *  5-collection full reload (`_load`) that the mutation path used to
   *  trigger, which redundantly refetched profile/presets/measurements/
   *  weights/water on every entry. All-time logs + the weekly-report
   *  staleness check stay fire-and-forget so derived signals (monthly
   *  summary, goal progress, report autogenerate) keep their behavior. */
  private async _refreshLogs(): Promise<void> {
    this._logs.set(await this.fb.getRecentLogs(14));
    this._loadAllTimeLogs();
    this._checkWeeklyReport();
  }

  private async _checkWeeklyReport(): Promise<void> {
    try {
      const report = await this.fb.getLatestReport();
      this._weeklyReport.set(report);

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const isStale = !report || report.generatedAt.getTime() < sevenDaysAgo;

      // Weekly report is a Pro feature. The client-side gate below is
      // cosmetic — real enforcement lives in the `generateWeeklyReport`
      // Cloud Function (entitlement check + 6-day rate limit + server-
      // only writes via admin SDK). Past reports stay readable for
      // users who dropped off Pro; only NEW generations are gated.
      if (isStale && this._logs().length >= 3 && this.subs.isPaid()) {
        await this.generateWeeklyReport();
      }
    } catch (err) {
      console.error('Weekly report check failed:', err);
    }
  }

  private async _loadAllTimeLogs(): Promise<void> {
    try {
      const all = await this.fb.getRecentLogs(9999);
      this._allTimeLogs.set(all);
    } catch { /* non-critical */ }
  }

  async generateWeeklyReport(): Promise<void> {
    if (this._reportLoading()) return;
    // Pro gate — see _checkWeeklyReport for rationale.
    if (!this.subs.isPaid()) return;
    this._reportLoading.set(true);
    this._reportError.set(null);
    try {
      const logs = this._logs();
      const tdee = this.tdee();
      const profile = this._profileFields();
      // All-time signals fuel the quiet-milestone line in the report.
      // Use the internal uncapped signal (not the 90-day-windowed public
      // `allTimeLogs`) so milestones track lifetime, not visible history.
      const allTime = this._allTimeLogs();
      const earliestLogAt = allTime.length > 0
        ? allTime.reduce((min, l) => l.date.getTime() < min ? l.date.getTime() : min, Infinity)
        : null;
      const milestoneContext = {
        totalLogs: allTime.length,
        earliestLogAt: earliestLogAt != null && isFinite(earliestLogAt) ? new Date(earliestLogAt) : null,
        currentStreak: this.streak(),
      };
      const result = await this.gemini.generateWeeklyReport(logs, tdee, profile, this._dailyWeights(), milestoneContext);
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

  private _clear(): void {
    this._logs.set([]);
    this._presets.set([]);
    this._status.set('idle');
    this._error.set(null);
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this._undoEntry.set(null);
    this._weeklyReport.set(null);
    this._reportLoading.set(false);
    this._reportError.set(null);
    this._measurements.set([]);
    this._dailyWater.set({});
    this._allTimeLogs.set([]);
  }
}
