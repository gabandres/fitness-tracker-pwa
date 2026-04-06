import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import {
  FirebaseService,
  DailyLog,
  LogEntry,
  MealPreset,
  ProfileFields,
  UserProfile,
} from './firebase.service';
import { TdeeCalculatorService, TdeeResult, WeeklySummary, WeeklyEnvelope } from './tdee-calculator.service';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface GoalProgress {
  startWeight: number;
  currentWeight: number;
  goalWeight: number;
  pct: number;
  remaining: number;
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
 * call FirebaseService or TdeeCalculatorService directly.
 *
 * Lifecycle: loads on sign-in, clears on sign-out — driven by an
 * effect watching AuthService.isSignedIn().
 */
@Injectable({ providedIn: 'root' })
export class FitnessStore {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FirebaseService);
  private readonly calc = inject(TdeeCalculatorService);

  // ─── Private mutable state ──────────────────────────────────
  private readonly _logs = signal<DailyLog[]>([]);
  private readonly _presets = signal<MealPreset[]>([]);
  private readonly _status = signal<StoreStatus>('idle');
  private readonly _error = signal<string | null>(null);

  // ─── Public read-only state ─────────────────────────────────
  readonly logs: Signal<DailyLog[]> = this._logs.asReadonly();
  readonly presets: Signal<MealPreset[]> = this._presets.asReadonly();
  readonly profile: Signal<UserProfile | null> = this.fb.profile;
  readonly status: Signal<StoreStatus> = this._status.asReadonly();
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

  /** Most recent non-null weight across all entries. */
  readonly currentWeight: Signal<number | null> = computed(() => {
    const list = this._logs();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].weight != null) return list[i].weight!;
    }
    return null;
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

  readonly ema: Signal<number[]> = computed(() =>
    this.calc.ema(this._logs().map((l) => l.weight).filter((w): w is number => w != null), 7),
  );

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
    const list = this._logs();
    // Find the earliest non-null weight as the starting point.
    let start: number = current;
    for (const l of list) {
      if (l.weight != null) { start = l.weight; break; }
    }
    const totalToLose = start - goal;
    if (totalToLose <= 0) return null;
    const pct = Math.min(100, Math.max(0, Math.round(((start - current) / totalToLose) * 100)));
    const remaining = Math.max(0, +(current - goal).toFixed(1));
    return { startWeight: start, currentWeight: current, goalWeight: goal, pct, remaining };
  });

  readonly todaySummary: Signal<TodaySummary | null> = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayLogs = this._logs().filter(
      (l) => l.date.toISOString().slice(0, 10) === today,
    );
    if (todayLogs.length === 0) return null;
    return {
      totalCalories: todayLogs.reduce((s, l) => s + l.calories, 0),
      totalProtein: todayLogs.reduce((s, l) => s + (l.protein ?? 0), 0),
    };
  });

  // ─── Lifecycle ──────────────────────────────────────────────
  constructor() {
    effect(() => {
      if (this.auth.isSignedIn()) {
        this._load();
      } else {
        this._clear();
      }
    });
  }

  /** The user's webhook API key, or null if not generated. */
  readonly webhookApiKey: Signal<string | null> = computed(() =>
    (this.fb.profile() as any)?.webhookApiKey ?? null,
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
  async startFast(): Promise<void> {
    await this.fb.startFast();
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

  async addLog(entry: LogEntry): Promise<void> {
    await this.fb.addLog(entry);
    await this._load();
  }

  async updateLog(id: string, entry: LogEntry): Promise<void> {
    await this.fb.updateLog(id, entry);
    await this._load();
  }

  async deleteLog(id: string): Promise<void> {
    await this.fb.deleteLog(id);
    await this._load();
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<void> {
    await this.fb.addPreset(preset);
    this._presets.set(await this.fb.getPresets());
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

      const [logs, presets] = await Promise.all([
        this.fb.getRecentLogs(14),
        this.fb.getPresets(),
      ]);
      this._logs.set(logs);
      this._presets.set(presets);
      this._status.set('ready');
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Load failed.');
      this._status.set('error');
    }
  }

  private _clear(): void {
    this._logs.set([]);
    this._presets.set([]);
    this._status.set('idle');
    this._error.set(null);
  }
}
