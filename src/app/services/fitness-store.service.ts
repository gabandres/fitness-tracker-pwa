import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import {
  DailyLog,
  LogEntry,
  MealPreset,
  ProfileFields,
  Profile,
} from './firebase.service';
import { TdeeCalculatorService, TdeeResult, WeeklySummary, WeeklyEnvelope } from './tdee-calculator.service';
import { addDays, localDateKey } from '../utils/date';
import { computeProtein } from '../utils/macro-heuristic';
import { summarizeDay } from '../utils/day-summary';
import { SubscriptionService } from './subscription.service';
import { BodyMetricStore } from './body-metric-store.service';
import { WorkoutStore } from './workout-store.service';
import { MilestoneTracker } from './milestone-tracker.service';
import type { SessionDraft } from '../models/workout';

import { CHART_HISTORY_DAYS_FREE, PRESET_LIMIT_FREE } from '../models/tier-limits';

// Re-exported so existing import sites (specs, components) keep working;
// the numbers themselves live in models/tier-limits.ts.
export { CHART_HISTORY_DAYS_FREE, PRESET_LIMIT_FREE };

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Pro perk: streak survives up to N consecutive missed days. Free users
    break their streak on any miss. Capped at one week so a Pro user who
    truly stops logging still sees the streak reset eventually. */
export const STREAK_FREEZE_MAX_GAP_PRO = 7;

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
  /** Grams. Zero when no entry today carried the optional field. */
  totalCarbs: number;
  totalFat: number;
}

/**
 * A lifetime-history read that carries its own load state. The lazy
 * all-time cache (`_allTimeLogs`, see [ADR-0004]) is empty until it
 * hydrates in the background, and "empty window" is indistinguishable
 * from "not loaded yet" on a bare array — which is exactly how
 * `goalProgress` / `monthlySummary` used to render wrong values on first
 * paint. This discriminated shape moves that invariant into the type:
 * callers cannot reach `logs` without first handling `loaded: false`, so
 * forgetting the gate is a compile error rather than a silent misrender.
 */
export type HistoryWindow =
  | { readonly loaded: false }
  | { readonly loaded: true; readonly logs: DailyLog[] };

/**
 * Hub for the canonical log + preset cache plus all derived computations
 * (TDEE, streak, weekly, EMA, goal progress, today summary, monthly,
 * etc.) and log mutations. Three sibling stores own focused facets:
 *
 *   - `FastingStore`        — fasting start/end + active boolean
 *   - `BodyMetricStore`     — weights, water, measurements
 *   - `WeeklyReportStore`   — AI report state + generation flow
 *   - `MilestoneTracker`    — first-meal latch + lifetime milestones
 *
 * Components inject whichever store(s) they need; FitnessStore stays the
 * single source for derivations and coordinates the load lifecycle —
 * its sign-in effect calls into `BodyMetricStore.hydrate(...)` and
 * `WeeklyReportStore.clear()` so the four stores stay in sync.
 */
@Injectable({ providedIn: 'root' })
export class FitnessStore {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(LEDGER_PORT);
  private readonly calc = inject(TdeeCalculatorService);
  private readonly subs = inject(SubscriptionService);
  private readonly body = inject(BodyMetricStore);
  private readonly workout = inject(WorkoutStore);
  private readonly milestones = inject(MilestoneTracker);

  // ─── Private mutable state ──────────────────────────────────
  /**
   * Rolling window of recent log entries — populated via
   * `LEDGER_PORT.getRecentLogs(14)`, which is a **14-ROW cap**, NOT a
   * 14-day window. A heavy logger (e.g. 7 entries/day) may span only
   * 2 days; a sparse logger may span weeks. Do NOT use this signal for
   * calendar-day queries (last-N-days reports, streak math beyond the
   * cached window, etc.) — reach for `logsForLastDays(n)` /
   * `logsForLastDaysState(n)` instead, which filter `_allTimeLogs`
   * by local-date key.
   */
  private readonly _logs = signal<DailyLog[]>([]);
  private readonly _presets = signal<MealPreset[]>([]);
  private readonly _status = signal<StoreStatus>('idle');
  private readonly _error = signal<string | null>(null);
  /**
   * Uncapped lifetime log cache. Loaded asynchronously via
   * `_loadAllTimeLogs()` (called opportunistically — e.g. before
   * weekly report generation). May be empty until hydrated. Prefer the
   * typed `allHistoryState()` / `logsForLastDaysState(n)` accessors over
   * reading this directly — they fold in the load state so a computed
   * cannot mistake "not loaded yet" for "no history". Source of truth
   * for any calendar-day-windowed query.
   */
  private readonly _allTimeLogs = signal<DailyLog[]>([]);
  /**
   * True once `_loadAllTimeLogs()` has completed at least once this
   * session — whether or not it found any rows. Distinct from
   * `_allTimeLogs().length > 0`: a brand-new user with zero logs is
   * still fully *loaded*, just empty. This is the real hydration gate.
   */
  private readonly _historyLoaded = signal(false);
  /** Surfaced once per day when the user first crosses their daily
      calorie budget. Cleared on ack or on day rollover. */
  private readonly _budgetCrossed = signal(false);
  private readonly _undoEntry = signal<DailyLog | null>(null);
  private _undoTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Public read-only state ─────────────────────────────────
  readonly logs: Signal<DailyLog[]> = this._logs.asReadonly();
  readonly presets: Signal<MealPreset[]> = this._presets.asReadonly();
  readonly profile: Signal<Profile | null> = this.fb.profile;
  readonly status: Signal<StoreStatus> = this._status.asReadonly();
  readonly undoEntry: Signal<DailyLog | null> = this._undoEntry.asReadonly();
  readonly budgetCrossed: Signal<boolean> = this._budgetCrossed.asReadonly();
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
    // Hidden-label set from the profile — users explicitly suppressed
    // these via the recents "Manage" affordance. We honor the
    // suppression here (chip-row only); the underlying log entries
    // remain visible in history.
    const hidden = new Set<string>(
      ((this.fb.profile() as { hiddenRecentLabels?: string[] } | null)?.hiddenRecentLabels) ?? [],
    );
    // `_logs()` is oldest-first (the adapter reverses
    // the desc-ordered query before returning). Iterate end-to-start so
    // the user sees their newest meals first.
    for (let i = list.length - 1; i >= 0 && out.length < 5; i--) {
      const log = list[i];
      const label = log.mealLabel?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      if (hidden.has(key)) continue;
      seen.add(key);
      out.push(log);
    }
    return out;
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

  /** Public projection of the extracted profile-fields object — read by
   *  WeeklyReportStore when assembling the Gemini prompt. */
  profileFields(): ProfileFields | null {
    return this._profileFields();
  }

  /** Raw uncapped lifetime log cache (no tier-gating). Used by
   *  WeeklyReportStore for milestone math — paid status shouldn't
   *  change a milestone's truth. UI consumers should still read the
   *  tier-gated `allTimeLogs` signal. */
  rawAllTimeLogs(): DailyLog[] {
    return this._allTimeLogs();
  }

  /** True when the user has travel mode enabled (target = maintenance). */
  readonly travelMode: Signal<boolean> = computed(() =>
    this.fb.profile()?.travelMode === true,
  );

  // ─── Pre-computed derivations ───────────────────────────────

  /** Overlays the dailyWeights map into each log's `weight` field. Current
   *  weight writes go to the dailyWeights subcollection (not log.weight),
   *  so any weight-driven calc — weekly delta, measured TDEE, monthly
   *  trend — must merge before reading `l.weight`, or it sees nothing for
   *  daily-weight-only users. Returns the original array when there are
   *  no daily weights to overlay. */
  private mergeDailyWeights(logs: DailyLog[]): DailyLog[] {
    const dw = this.body.dailyWeights();
    if (Object.keys(dw).length === 0) return logs;
    return logs.map((l) => {
      const w = dw[localDateKey(l.date)];
      return w != null ? { ...l, weight: w } : l;
    });
  }

  readonly tdee: Signal<TdeeResult> = computed(() => {
    const fields = this._profileFields();
    // In travel mode, override pace to 0 (maintenance — no deficit).
    const adjusted = fields?.travelMode
      ? { ...fields, targetPaceLbsPerWeek: 0 as any }
      : fields;
    // Measured mode needs ≥14 *distinct logged days*. The `_logs` cache is
    // capped at 14 *rows* (getRecentLogs(14)), which for a multi-entry-per-
    // day user aggregates to far fewer than 14 days — so it can never reach
    // measured mode. Use the full-history cache once it has settled; fall
    // back to the rolling cache only during the initial load.
    const source = this._historyLoaded() ? this._allTimeLogs() : this._logs();
    return this.calc.calculate(this.mergeDailyWeights(source), adjusted);
  });

  readonly targetCalories: Signal<number> = computed(() => {
    const tdee = this.tdee();
    // Once the user has enough real history (≥14 logged days) for a
    // *reliable* measured TDEE, the empirically-derived target (true TDEE
    // minus the chosen deficit) beats the static onboarding formula
    // estimate — even if the user never ran the Day-3 "Refine targets"
    // sheet that would otherwise clear the manual override. Reliability
    // (≥70% logging completeness + ≥10 intake days) guards against a thin
    // dataset whipping the target around.
    if (tdee.source === 'measured' && tdee.reliable) return tdee.newDailyTarget;

    // Pre-data: the v2 onboarding heuristic (weight × {11/14/17}) takes
    // precedence over the Mifflin-St Jeor chain so the 2-question
    // onboarding produces usable numbers without the full profile.
    const manual = this.fb.profile()?.manualCaloriesTarget;
    if (manual != null && manual > 0) return manual;
    return tdee.newDailyTarget;
  });

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
    const dw = this.body.dailyWeights();
    const keys = Object.keys(dw).sort();
    if (keys.length > 0) return dw[keys[keys.length - 1]];
    const list = this._logs();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].weight != null) return list[i].weight!;
    }
    return null;
  });

  /** Protein target on the evidence-based g/kg standard. Precedence:
   *   1. proteinPerKg — a personal g/kg basis (1.6–2.2) the user has dialed
   *      in; recomputed LIVE off current weight so it tracks a cut.
   *   2. manualProteinTarget — the frozen grams snapshot from onboarding.
   *   3. computeProtein(weight) — the 1.6 g/kg default (muscle-retention
   *      floor), used once the onboarding snapshot is cleared (e.g. refine). */
  readonly proteinTarget: Signal<number> = computed(() => {
    const perKg = this.fb.profile()?.proteinPerKg;
    const w = this.currentWeight();
    if (perKg != null && perKg > 0 && w) return computeProtein(w, perKg);
    const manual = this.fb.profile()?.manualProteinTarget;
    if (manual != null && manual > 0) return manual;
    return w ? computeProtein(w) : 0;
  });

  /** Minimum adequate protein: the 1.6 g/kg muscle-retention floor. */
  readonly proteinMinTarget: Signal<number> = computed(() => {
    const w = this.currentWeight();
    return w ? computeProtein(w) : 0;
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

  /** Streak + freeze state. Pro users get up to STREAK_FREEZE_MAX_GAP_PRO
      consecutive missed days tolerated mid-streak; free users break on
      any miss. `freezeUsed` is true when the active streak only spans
      because a gap was forgiven — surface this in UI as a Pro indicator. */
  private readonly streakResult = computed(() =>
    this.calc.computeStreakWithFreeze(this._logs(), {
      freezeMaxGap: this.subs.isPaid() ? STREAK_FREEZE_MAX_GAP_PRO : 0,
    }),
  );
  readonly streak: Signal<number> = computed(() => this.streakResult().streak);
  readonly streakFreezeUsed: Signal<boolean> = computed(() => this.streakResult().freezeUsed);

  readonly weekly: Signal<WeeklySummary | null> = computed(() =>
    this.calc.weeklySummary(this.mergeDailyWeights(this._logs()), this.targetCalories()),
  );

  readonly envelope: Signal<WeeklyEnvelope | null> = computed(() =>
    this.calc.weeklyEnvelope(this._logs(), this.targetCalories()),
  );

  readonly ema: Signal<number[]> = computed(() => {
    const weights = this.mergeDailyWeights(this._logs())
      .map((l) => l.weight)
      .filter((w): w is number => w != null);
    return this.calc.ema(weights, 7);
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
    const dw = this.body.dailyWeights();
    const dwKeys = Object.keys(dw).sort();
    let start: number | null = dwKeys.length > 0 ? dw[dwKeys[0]] : null;
    if (start == null) {
      const history = this.allHistoryState();
      // Don't guess the start weight from `current` before history loads —
      // that pins the bar near 0% then jumps once the oldest log arrives.
      // Hide the bar until we actually know the starting point.
      if (!history.loaded) return null;
      // logs are oldest-first; walk forward for the first weighted entry.
      for (const l of history.logs) {
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
      totalCarbs: Math.round(todayLogs.reduce((s, l) => s + (l.carbs ?? 0), 0)),
      totalFat: Math.round(todayLogs.reduce((s, l) => s + (l.fat ?? 0), 0)),
    };
  });

  readonly hasLoggedToday: Signal<boolean> = computed(() =>
    this.todaySummary() !== null,
  );

  /**
   * Per-day totals for an arbitrary date key. Searches the rolling 14-day
   * window first; falls back to `allTimeLogs` (which is itself tier-gated:
   * paid users see uncapped, free users see ≤90 days). Returns null when
   * the day has no logged entries in either source.
   *
   * Plain method (not signal) — callers wrap in `computed()` and the
   * signal graph re-runs them when `_logs` / `_allTimeLogs` change.
   */
  summaryFor(dateKey: string): {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    exercised: boolean;
    count: number;
  } | null {
    // Try the rolling 14-day window first (hot signal); fall back to
    // the tier-gated all-time list. Both passes delegate aggregation to
    // the shared `summarizeDay` utility so this method and the weekly-
    // report prompt builder agree on totals byte-for-byte.
    const weights = this.body.dailyWeights();
    let s = summarizeDay(dateKey, this._logs(), weights);
    if (s.mealCount === 0) {
      s = summarizeDay(dateKey, this.allTimeLogs(), weights);
    }
    if (s.mealCount === 0) return null;
    // `count` is the established public field name on this store method;
    // expose `mealCount` under that alias to keep existing consumers
    // (history component, day-summary card, etc.) unchanged.
    return {
      totalCalories: s.totalCalories,
      totalProtein: s.totalProtein,
      totalCarbs: s.totalCarbs,
      totalFat: s.totalFat,
      exercised: s.exercised,
      count: s.mealCount,
    };
  }

  /**
   * Per-day kcal + protein totals for the last 7 calendar days
   * (today inclusive, oldest first). Used by the v2 trends bar chart.
   * Days with no entries return zeros so the bar chart can render
   * empty bars rather than gaps in the x-axis.
   */
  last7Days(): { key: string; label: string; kcal: number; protein: number }[] {
    const out: { key: string; label: string; kcal: number; protein: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = localDateKey(d);
      const s = this.summaryFor(key);
      out.push({
        key,
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        kcal: s?.totalCalories ?? 0,
        protein: s?.totalProtein ?? 0,
      });
    }
    return out;
  }

  /** Logs for an arbitrary date key, sorted newest-first. Same fallback strategy as `summaryFor`. */
  logsForDay(dateKey: string): DailyLog[] {
    let list = this._logs().filter((l) => localDateKey(l.date) === dateKey);
    if (list.length === 0) {
      list = this.allTimeLogs().filter((l) => localDateKey(l.date) === dateKey);
    }
    return [...list].sort((a, b) => +b.date - +a.date);
  }

  /** Long-term summary computed from all-time logs (loaded on demand).
   *  Weight series is read from the dailyWeights map directly — it's the
   *  canonical source, and a user who logs weight on days without meals
   *  would otherwise be invisible to this stat. Calorie metrics still
   *  derive from logs. The window spans whichever source reaches further. */
  readonly monthlySummary: Signal<MonthlySummary | null> = computed(() => {
    // Gate on the typed history state — before hydration `_allTimeLogs` is
    // empty, which would zero out avgCalories / adherence and then correct
    // itself with a visible jump once the cache loads.
    const history = this.allHistoryState();
    if (!history.loaded) return null;
    const logs = history.logs;
    const dw = this.body.dailyWeights();
    const dwKeys = Object.keys(dw).sort();
    if (logs.length < 7 && dwKeys.length < 7) return null;

    const daily = this.calc.aggregateByDay(logs);
    if (dwKeys.length < 2) return null;

    const firstWeight = dw[dwKeys[0]];
    const lastWeight = dw[dwKeys[dwKeys.length - 1]];
    const totalChange = +(lastWeight - firstWeight).toFixed(1);

    // Window covers whichever source reaches further in either direction.
    const dwFirstDate = this.dateFromKey(dwKeys[0]);
    const dwLastDate = this.dateFromKey(dwKeys[dwKeys.length - 1]);
    const firstDate = daily.length > 0 && daily[0].date < dwFirstDate ? daily[0].date : dwFirstDate;
    const lastDate = daily.length > 0 && daily[daily.length - 1].date > dwLastDate ? daily[daily.length - 1].date : dwLastDate;
    const daysTracked = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));
    const weeksTracked = +(daysTracked / 7).toFixed(1);
    const avgWeeklyChange = +(totalChange / Math.max(1, weeksTracked)).toFixed(2);

    const allCals = daily.map((d) => d.calories);
    const avgCalories = allCals.length > 0
      ? Math.round(allCals.reduce((s, c) => s + c, 0) / allCals.length)
      : 0;

    const target = this.targetCalories();
    const adherentDays = allCals.filter((c) => Math.abs(c - target) <= 100).length;
    const adherencePct = allCals.length > 0
      ? Math.round((adherentDays / allCals.length) * 100)
      : 0;

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

  /** dateKey ("YYYY-MM-DD") → local-midnight Date. Mirrors `localDateKey`. */
  private dateFromKey(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // ─── Lifecycle ──────────────────────────────────────────────
  /**
   * Hook invoked from `_load()` after the staleness check has run.
   * WeeklyReportStore sets this to its `checkWeeklyReport` bound method
   * during its own construction to break the circular DI between the
   * two stores (WeeklyReportStore depends on FitnessStore for logs and
   * derivations; FitnessStore needs to kick it after a load).
   */
  private weeklyReportRefreshHook: (() => Promise<void>) | null = null;
  private weeklyReportClearHook: (() => void) | null = null;

  /** Wire the WeeklyReportStore's callbacks into the FitnessStore
   *  lifecycle. Called once by WeeklyReportStore in its constructor. */
  _registerWeeklyReportHooks(refresh: () => Promise<void>, clear: () => void): void {
    this.weeklyReportRefreshHook = refresh;
    this.weeklyReportClearHook = clear;
  }

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

  // ─── Mutations (fire-and-forget, auto-refresh) ──────────────
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

  async addLog(entry: LogEntry): Promise<void> {
    // Snapshot pre-state so we can fire `first_meal_logged` exactly
    // once per account. Both signals must be empty: `_logs` covers the
    // 14-day rolling window, `_allTimeLogs` (loaded after _load) covers
    // the rest. If either has any rows the user has logged before.
    // MilestoneTracker also persists a localStorage latch as belt-and-
    // suspenders against double-fire from a concurrent reload before
    // `_allTimeLogs` hydrates.
    const recentLogsEmpty = this._logs().length === 0;
    const allTimeLogsEmpty = this._allTimeLogs().length === 0;
    const id = await this.fb.addLog(entry);
    this._applyLocalAdd(id, entry);
    this.milestones.checkFirstMeal({ recentLogsEmpty, allTimeLogsEmpty });
  }

  /**
   * Stamp `date` as an exercise day by upserting a 0-cal training-marker
   * `DailyLog` with `exerciseCompleted=true` — but only if no
   * exercise-marked log already exists for that local date (a workout
   * shouldn't double-mark a day the user already flagged). Reuses the
   * existing exercise plumbing so the day counts toward the streak and
   * shows the History exercise dot for free. Writes the marker directly
   * (not via {@link addLog}) so it never fires the first-meal milestone —
   * a workout is not a meal.
   */
  async markExercised(date: Date): Promise<void> {
    const key = localDateKey(date);
    const already =
      this._logs().some((l) => localDateKey(l.date) === key && l.exerciseCompleted) ||
      this._allTimeLogs().some((l) => localDateKey(l.date) === key && l.exerciseCompleted);
    if (already) return;
    await this.fb.addLog({ calories: 0, exerciseCompleted: true, timestamp: date });
    await this._refreshLogs();
  }

  /**
   * Finish an in-progress workout. Hub-level orchestration of the
   * cross-cutting concerns the WorkoutStore deliberately doesn't own:
   *   1. flip the session to `completed` (WorkoutStore),
   *   2. mirror the logged bodyweight into `dailyWeights` (BodyMetricStore)
   *      so Body/TDEE see one source of truth,
   *   3. stamp the day's exercise marker ({@link markExercised}).
   * The UI calls this single method on "Finish" rather than wiring the
   * three stores itself.
   */
  async finishWorkout(sessionId: string, patch: Partial<SessionDraft> = {}): Promise<void> {
    const session = this.workout.activeSession();
    await this.workout.completeSession(sessionId, patch);
    const date = patch.date ?? session?.date ?? new Date();
    const bodyweight = patch.bodyweight ?? session?.bodyweight;
    if (bodyweight != null && bodyweight > 0) {
      await this.body.setDailyWeight(localDateKey(date), bodyweight);
    }
    const sleepHours = patch.sleepHours ?? session?.sleepHours;
    if (sleepHours != null && sleepHours > 0) {
      await this.body.setDailySleep(localDateKey(date), sleepHours);
    }
    await this.markExercised(date);
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
        if (src.carbs != null) entry.carbs = src.carbs;
        if (src.fat != null) entry.fat = src.fat;
        if (src.mealLabel) entry.mealLabel = src.mealLabel;
        if (src.mealType) entry.mealType = src.mealType;
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
        if (src.carbs != null) entry.carbs = src.carbs;
        if (src.fat != null) entry.fat = src.fat;
        if (src.mealLabel) entry.mealLabel = src.mealLabel;
        if (src.mealType) entry.mealType = src.mealType;
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
    this._applyLocalUpdate(id, entry);
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
      if (target.carbs != null) patch.carbs = target.carbs;
      if (target.fat != null) patch.fat = target.fat;
      if (target.mealLabel) patch.mealLabel = target.mealLabel;
      if (target.mealType) patch.mealType = target.mealType;
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
    if (entry.carbs != null) logEntry.carbs = entry.carbs;
    if (entry.fat != null) logEntry.fat = entry.fat;
    // Collapse legacy lift/cardio flags into the unified exercise flag.
    if (entry.exerciseCompleted || entry.liftCompleted || entry.cardioCompleted) {
      logEntry.exerciseCompleted = true;
    }
    if (entry.mealLabel) logEntry.mealLabel = entry.mealLabel;
    if (entry.mealType) logEntry.mealType = entry.mealType;

    await this.addLog(logEntry);
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<void> {
    if (!this.subs.isPaid() && this._presets().length >= PRESET_LIMIT_FREE) {
      throw new PresetLimitError(PRESET_LIMIT_FREE);
    }
    const id = await this.fb.addPreset(preset);
    this._presets.set([...this._presets(), { ...preset, id }]);
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

      const [
        logs,
        presets,
        measurements,
        dailyWeights,
        dailyWater,
        dailySleep,
        exercises,
        templates,
        recentSessions,
        activeSession,
      ] = await Promise.all([
        this.fb.getRecentLogs(14),
        this.fb.getPresets(),
        this.fb.getRecentMeasurements(100),
        this.fb.getDailyWeights(),
        this.fb.getDailyWater(),
        this.fb.getDailySleep(),
        this.fb.getExercises(),
        this.fb.getTemplates(),
        this.fb.getRecentSessions(),
        this.fb.getActiveSession(),
      ]);
      this._logs.set(logs);
      this._presets.set(presets);
      this.body.hydrate({ measurements, dailyWeights, dailyWater, dailySleep });
      this.workout.hydrate({ exercises, templates, recentSessions, activeSession });
      this._status.set('ready');

      // Fire-and-forget background tasks.
      void this.weeklyReportRefreshHook?.();
      this._loadAllTimeLogs();
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Load failed.');
      this._status.set('error');
    }
  }

  /** The `_logs` rolling cache mirrors `getRecentLogs(14)` — latest 14
   *  rows, oldest-first. Local cache maintenance after single-log
   *  mutations keeps that contract without refetching. */
  private static readonly LOG_CACHE_ROWS = 14;

  /** Reconcile caches after a successful `addLog` using the server-
   *  assigned id (issue #6 phase 5) — zero reads instead of the
   *  refetch-per-mutation `_refreshLogs` path. Field semantics mirror
   *  the core's write exactly: weight/protein only when non-null,
   *  exerciseCompleted only when truthy, mealLabel only when non-empty. */
  private _applyLocalAdd(id: string, entry: LogEntry): void {
    const log: DailyLog = {
      id,
      calories: entry.calories,
      date: entry.timestamp ?? new Date(),
    };
    if (entry.weight != null) log.weight = entry.weight;
    if (entry.protein != null) log.protein = entry.protein;
    if (entry.carbs != null) log.carbs = entry.carbs;
    if (entry.fat != null) log.fat = entry.fat;
    if (entry.exerciseCompleted) log.exerciseCompleted = true;
    if (entry.mealLabel) log.mealLabel = entry.mealLabel;
    if (entry.mealType) log.mealType = entry.mealType;

    const byDate = (a: DailyLog, b: DailyLog) => a.date.getTime() - b.date.getTime();
    const recent = [...this._logs(), log].sort(byDate);
    this._logs.set(recent.slice(-FitnessStore.LOG_CACHE_ROWS));
    if (this._historyLoaded()) {
      this._allTimeLogs.set([...this._allTimeLogs(), log].sort(byDate));
    } else {
      // Hydration hasn't settled — a fresh fetch will include this row.
      void this._loadAllTimeLogs();
    }
    void this.weeklyReportRefreshHook?.();
  }

  /** Reconcile caches after a successful `updateLog`. Mirrors the
   *  core's deleteField semantics: omitted protein/mealLabel and a
   *  falsy exercise flag CLEAR the stored field, legacy lift/cardio
   *  flags are always cleared, weight/timestamp persist when omitted. */
  private _applyLocalUpdate(id: string, entry: LogEntry): void {
    const apply = (l: DailyLog): DailyLog => {
      if (l.id !== id) return l;
      const next: DailyLog = {
        ...l,
        calories: entry.calories,
        date: entry.timestamp ?? l.date,
        protein: entry.protein != null ? entry.protein : undefined,
        carbs: entry.carbs != null ? entry.carbs : undefined,
        fat: entry.fat != null ? entry.fat : undefined,
        exerciseCompleted: entry.exerciseCompleted ? true : undefined,
        liftCompleted: undefined,
        cardioCompleted: undefined,
        mealLabel: entry.mealLabel ? entry.mealLabel : undefined,
        mealType: entry.mealType ?? undefined,
      };
      if (entry.weight != null) next.weight = entry.weight;
      return next;
    };
    const byDate = (a: DailyLog, b: DailyLog) => a.date.getTime() - b.date.getTime();
    this._logs.set(this._logs().map(apply).sort(byDate));
    if (this._historyLoaded()) {
      this._allTimeLogs.set(this._allTimeLogs().map(apply).sort(byDate));
    }
    void this.weeklyReportRefreshHook?.();
  }

  /** Reload just the log window after a bulk log mutation
   *  (repeatYesterday/copyDayToToday/markExercised) or a delete — a
   *  delete must refetch so older rows can re-enter the 14-row window.
   *  Single add/update paths use the local reconcilers above instead.
   *  All-time logs + the weekly-report staleness check stay
   *  fire-and-forget so derived signals (monthly summary, goal
   *  progress, report autogenerate) keep their behavior.
   *
   *  On failure, surface via `_error` but keep `_status='ready'` — the
   *  previously-loaded cache is still valid, and flipping to 'error'
   *  would unmount the dashboard after a successful write. */
  private async _refreshLogs(): Promise<void> {
    try {
      // `_logs.set` must precede the weekly-report hook — the latter
      // reads `this._logs()` when deciding whether to autogenerate.
      this._logs.set(await this.fb.getRecentLogs(14));
      this._loadAllTimeLogs();
      void this.weeklyReportRefreshHook?.();
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Refresh failed.');
      throw err;
    }
  }

  private async _loadAllTimeLogs(): Promise<void> {
    try {
      const all = await this.fb.getRecentLogs(9999);
      this._allTimeLogs.set(all);
    } catch { /* non-critical */ } finally {
      // Mark loaded even on failure/empty: the gate is "did we try and
      // settle", not "did we find rows". Leaving it false on a genuinely
      // log-less account would hide goalProgress / monthlySummary forever.
      this._historyLoaded.set(true);
    }
  }

  /**
   * Returns the last `n` local-calendar-day date keys, oldest first
   * (inclusive of today). Used to filter `_allTimeLogs` by membership
   * in a fixed calendar window rather than millisecond arithmetic
   * (which drifts across DST transitions).
   */
  private windowCalendarKeys(n: number): string[] {
    const out: string[] = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      out.push(localDateKey(addDays(today, -i)));
    }
    return out;
  }

  /**
   * Logs falling on the last `n` calendar days ending today, in the
   * user's local timezone. Awaits `_loadAllTimeLogs()` once if
   * `_allTimeLogs` hasn't hydrated yet. Does NOT touch the rolling
   * `_logs` signal (which is a 14-ROW cap, not a 14-day window).
   *
   * Use this for any "last N days" query — weekly reports, n-day
   * adherence, calendar-windowed averages.
   */
  async logsForLastDays(n: number): Promise<DailyLog[]> {
    if (this._allTimeLogs().length === 0) {
      await this._loadAllTimeLogs();
    }
    const keys = new Set(this.windowCalendarKeys(n));
    return this._allTimeLogs().filter((l) => keys.has(localDateKey(l.date)));
  }

  /**
   * Sync variant of {@link logsForLastDays} for use inside `computed()`
   * blocks where awaiting is not possible. Returns `[]` until
   * `_allTimeLogs` has hydrated — callers MUST check
   * `isHistoryHydrated()` first to distinguish "no logs in window"
   * from "history not loaded yet".
   */
  /**
   * Lifetime history with its load state folded in (see
   * {@link HistoryWindow}). `{ loaded: false }` until the background
   * hydration settles, then `{ loaded: true, logs }` (uncapped,
   * oldest-first). The typed gate for derivations that read all-time
   * history — `goalProgress`, `monthlySummary`.
   */
  allHistoryState(): HistoryWindow {
    if (!this._historyLoaded()) return { loaded: false };
    return { loaded: true, logs: this._allTimeLogs() };
  }

  /**
   * The last `n` calendar days ending today, in the user's local tz, with
   * load state folded in. Computed-safe replacement for the old bare-array
   * sync accessor: returns `{ loaded: false }` until history hydrates, so a
   * caller cannot mistake "no logs in window" for "history not loaded yet".
   * For the awaiting variant use {@link logsForLastDays}.
   */
  logsForLastDaysState(n: number): HistoryWindow {
    if (!this._historyLoaded()) return { loaded: false };
    const keys = new Set(this.windowCalendarKeys(n));
    return {
      loaded: true,
      logs: this._allTimeLogs().filter((l) => keys.has(localDateKey(l.date))),
    };
  }

  /**
   * True once `_loadAllTimeLogs()` has settled at least once this session
   * (regardless of row count). Prefer {@link allHistoryState} /
   * {@link logsForLastDaysState}, which carry this in their return type;
   * this boolean remains for callers that only need the flag.
   */
  isHistoryHydrated(): boolean {
    return this._historyLoaded();
  }

  private _clear(): void {
    this._logs.set([]);
    this._presets.set([]);
    this._status.set('idle');
    this._error.set(null);
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this._undoEntry.set(null);
    this.weeklyReportClearHook?.();
    this.body.clear();
    this.workout.clear();
    this._allTimeLogs.set([]);
    // Clear the first-meal latch so a different user signing in on the
    // same browser gets correctly tracked on their first entry.
    this.milestones.clearFirstMealLatch();
  }
}
