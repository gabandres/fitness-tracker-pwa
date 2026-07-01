import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { vi } from 'vitest';
import { FitnessStore, PresetLimitError, PRESET_LIMIT_FREE } from './fitness-store.service';
import { AuthService } from './auth.service';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import { DailyLog, LogEntry, MealPreset, Profile } from './firebase.service';
import { TdeeCalculatorService } from './tdee-calculator.service';
import { GeminiService } from './gemini.service';
import { SubscriptionService } from './subscription.service';
import { TranslationService } from './translation.service';

describe('FitnessStore', () => {
  let store: FitnessStore;
  let mockIsSignedIn: WritableSignal<boolean>;
  let mockProfile: WritableSignal<Profile | null>;
  let mockIsPaid: WritableSignal<boolean>;

  // Properly typed mock so TS doesn't force bracket access.
  let mockFb: {
    profile: WritableSignal<Profile | null>;
    profileCompleted: WritableSignal<boolean>;
    ensureUserProfile: ReturnType<typeof vi.fn>;
    getRecentLogs: ReturnType<typeof vi.fn>;
    addLog: ReturnType<typeof vi.fn>;
    updateLog: ReturnType<typeof vi.fn>;
    deleteLog: ReturnType<typeof vi.fn>;
    getPresets: ReturnType<typeof vi.fn>;
    addPreset: ReturnType<typeof vi.fn>;
    deletePreset: ReturnType<typeof vi.fn>;
    getCustomFoods: ReturnType<typeof vi.fn>;
    addCustomFood: ReturnType<typeof vi.fn>;
    deleteCustomFood: ReturnType<typeof vi.fn>;
    clearProfile: ReturnType<typeof vi.fn>;
    saveProfile: ReturnType<typeof vi.fn>;
    getRecentMeasurements: ReturnType<typeof vi.fn>;
    addMeasurement: ReturnType<typeof vi.fn>;
    deleteMeasurement: ReturnType<typeof vi.fn>;
    getLatestReport: ReturnType<typeof vi.fn>;
    getDailyWeights: ReturnType<typeof vi.fn>;
    setDailyWeight: ReturnType<typeof vi.fn>;
    getDailyWater: ReturnType<typeof vi.fn>;
    setDailyWater: ReturnType<typeof vi.fn>;
    getDailySleep: ReturnType<typeof vi.fn>;
    setDailySleep: ReturnType<typeof vi.fn>;
    getExercises: ReturnType<typeof vi.fn>;
    getTemplates: ReturnType<typeof vi.fn>;
    getRecentSessions: ReturnType<typeof vi.fn>;
    getActiveSession: ReturnType<typeof vi.fn>;
  };

  const completedProfile: Profile = {
    email: 'test@gmail.com',
    createdAt: new Date(),
    lastSeenAt: new Date(),
    profileCompleted: true,
    heightIn: 70,
    age: 30,
    sex: 'male',
    activityLevel: 'moderate',
    targetPaceLbsPerWeek: 1.5,
  };

  function makeLogs(count: number, baseWeight = 180): DailyLog[] {
    return Array.from({ length: count }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (count - 1 - i));
      d.setHours(12, 0, 0, 0);
      return {
        id: `log-${i}`,
        weight: baseWeight - i * 0.1,
        calories: 1900 + (i % 2 === 0 ? 50 : -50),
        date: d,
        protein: 150,
      };
    });
  }

  beforeEach(() => {
    mockIsSignedIn = signal(false);
    mockProfile = signal<Profile | null>(null);
    mockIsPaid = signal(true);

    mockFb = {
      profile: mockProfile,
      profileCompleted: signal(false),
      ensureUserProfile: vi.fn().mockResolvedValue(undefined),
      getRecentLogs: vi.fn().mockResolvedValue([]),
      addLog: vi.fn().mockResolvedValue('new-log-id'),
      updateLog: vi.fn().mockResolvedValue(undefined),
      deleteLog: vi.fn().mockResolvedValue(undefined),
      getPresets: vi.fn().mockResolvedValue([]),
      addPreset: vi.fn().mockResolvedValue('new-preset-id'),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      getCustomFoods: vi.fn().mockResolvedValue([]),
      addCustomFood: vi.fn().mockResolvedValue('new-food-id'),
      deleteCustomFood: vi.fn().mockResolvedValue(undefined),
      clearProfile: vi.fn(),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      getRecentMeasurements: vi.fn().mockResolvedValue([]),
      addMeasurement: vi.fn().mockResolvedValue('new-measurement-id'),
      deleteMeasurement: vi.fn().mockResolvedValue(undefined),
      getLatestReport: vi.fn().mockResolvedValue(null),
      getDailyWeights: vi.fn().mockResolvedValue({}),
      setDailyWeight: vi.fn().mockResolvedValue(undefined),
      getDailyWater: vi.fn().mockResolvedValue({}),
      setDailyWater: vi.fn().mockResolvedValue(undefined),
      getDailySleep: vi.fn().mockResolvedValue({}),
      setDailySleep: vi.fn().mockResolvedValue(undefined),
      getExercises: vi.fn().mockResolvedValue([]),
      getTemplates: vi.fn().mockResolvedValue([]),
      getRecentSessions: vi.fn().mockResolvedValue([]),
      getActiveSession: vi.fn().mockResolvedValue(null),
    };

    TestBed.configureTestingModule({
      providers: [
        FitnessStore,
        TdeeCalculatorService,
        {
          provide: GeminiService,
          useValue: {
            generateWeeklyReport: vi.fn().mockResolvedValue({
              id: 'r1', markdown: 'test report', generatedAt: Date.now(),
            }),
          },
        },
        { provide: SubscriptionService, useValue: { isPaid: mockIsPaid } },
        {
          provide: AuthService,
          useValue: {
            isSignedIn: mockIsSignedIn,
            ready: signal(true),
            user: signal(null),
            // fitness-store gates its init effect on emailVerified(); the
            // production service exposes this as a signal.
            emailVerified: signal(true),
          },
        },
        { provide: LEDGER_PORT, useValue: mockFb },
        {
          // Stub TranslationService so the test bed doesn't have to pull in
          // the full Transloco provider chain (TRANSLOCO_TRANSPILER etc).
          // FitnessStore only calls tError() for report error surfacing.
          provide: TranslationService,
          useValue: {
            t: (key: string) => key,
            tError: (code: string | undefined | null) => code ?? 'errors.unknown',
            language: signal('en'),
          },
        },
      ],
    });

    store = TestBed.inject(FitnessStore);
  });

  // ── Lifecycle ─────────────────────────────────────────────────
  describe('lifecycle', () => {
    it('should start with idle status and empty data', () => {
      expect(store.status()).toBe('idle');
      expect(store.logs()).toEqual([]);
      expect(store.presets()).toEqual([]);
    });

    it('should load when signed in', async () => {
      const logs = makeLogs(5);
      mockFb.getRecentLogs.mockResolvedValue(logs);
      mockProfile.set(completedProfile);
      mockIsSignedIn.set(true);
      TestBed.flushEffects();
      await store.refresh();

      expect(mockFb.ensureUserProfile).toHaveBeenCalled();
      expect(mockFb.getRecentLogs).toHaveBeenCalledWith(14);
      expect(store.logs()).toEqual(logs);
      expect(store.status()).toBe('ready');
    });

    it('should clear on sign-out', async () => {
      mockFb.getRecentLogs.mockResolvedValue(makeLogs(3));
      mockIsSignedIn.set(true);
      TestBed.flushEffects();
      await store.refresh();
      expect(store.logs().length).toBe(3);

      mockIsSignedIn.set(false);
      TestBed.flushEffects();
      await Promise.resolve();

      expect(store.logs()).toEqual([]);
      expect(store.status()).toBe('idle');
    });
  });

  // ── Derived signals ───────────────────────────────────────────
  describe('derived signals', () => {
    async function loadWith(logs: DailyLog[], profile = completedProfile) {
      mockFb.getRecentLogs.mockResolvedValue(logs);
      mockProfile.set(profile);
      mockIsSignedIn.set(true);
      TestBed.flushEffects();
      await store.refresh();
    }

    it('should compute TDEE in formula mode with <14 days', async () => {
      await loadWith(makeLogs(5));
      expect(store.tdee().source).toBe('formula');
      expect(store.tdee().trueTdee).toBeGreaterThan(2000);
      expect(store.targetCalories()).toBeGreaterThan(1500);
    });

    it('should compute TDEE in measured mode with >=14 days', async () => {
      await loadWith(makeLogs(14));
      expect(store.tdee().source).toBe('measured');
    });

    it('should compute streak', async () => {
      await loadWith(makeLogs(5));
      expect(store.streak()).toBe(5);
    });

    it('should compute currentWeight from most recent log', async () => {
      await loadWith(makeLogs(3, 185));
      expect(store.currentWeight()).toBeCloseTo(184.8, 1);
    });

    it('should compute todaySummary from today entries only', async () => {
      // Use local noon — production code uses localDateKey() (local time).
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      await loadWith([
        { id: '1', weight: 180, calories: 800, protein: 60, date: yesterday },
        { id: '2', weight: 180, calories: 1000, protein: 80, date: today },
      ]);

      const s = store.todaySummary();
      expect(s).not.toBeNull();
      expect(s!.totalCalories).toBe(1000);
      expect(s!.totalProtein).toBe(80);
    });

    it('should format trendLabel for weight loss', async () => {
      await loadWith(makeLogs(14, 185));
      expect(store.trendLabel()).toMatch(/↓\s[\d.]+\slbs/);
    });

    it('should return null goalProgress when no goal', async () => {
      const noGoal = { ...completedProfile, goalWeightLbs: undefined };
      await loadWith(makeLogs(3), noGoal);
      expect(store.goalProgress()).toBeNull();
    });

    it('should compute goalProgress when goal is set', async () => {
      const withGoal = { ...completedProfile, goalWeightLbs: 170 };
      await loadWith(makeLogs(5, 185), withGoal);

      const gp = store.goalProgress();
      expect(gp).not.toBeNull();
      expect(gp!.goalWeight).toBe(170);
      expect(gp!.pct).toBeGreaterThanOrEqual(0);
      expect(gp!.remaining).toBeGreaterThan(0);
    });

    it('reports history as not-loaded before hydration, loaded after', async () => {
      // Fresh store, before any sign-in / hydration.
      expect(store.allHistoryState().loaded).toBe(false);
      expect(store.logsForLastDaysState(7).loaded).toBe(false);
      expect(store.isHistoryHydrated()).toBe(false);

      await loadWith(makeLogs(5));

      const h = store.allHistoryState();
      expect(h.loaded).toBe(true);
      if (h.loaded) expect(h.logs.length).toBe(5);
      expect(store.isHistoryHydrated()).toBe(true);
    });

    it('marks history hydrated after load even with zero logs', async () => {
      await loadWith([]);
      expect(store.isHistoryHydrated()).toBe(true);
      const h = store.allHistoryState();
      expect(h.loaded).toBe(true);
      if (h.loaded) expect(h.logs).toEqual([]);
    });

    it('logsForLastDaysState windows the loaded history', async () => {
      await loadWith(makeLogs(5)); // 5 consecutive days ending today
      const h = store.logsForLastDaysState(3);
      expect(h.loaded).toBe(true);
      if (h.loaded) expect(h.logs.length).toBe(3);
    });

    it('should compute weekly summary', async () => {
      await loadWith(makeLogs(7));
      const w = store.weekly();
      expect(w).not.toBeNull();
      expect(w!.days).toBe(7);
      expect(w!.avgWeight).toBeGreaterThan(0);
    });

    it('should compute EMA weights', async () => {
      await loadWith(makeLogs(7));
      const ema = store.ema();
      expect(ema).toHaveLength(7);
      expect(ema[0]).toBe(store.logs()[0].weight);
    });
  });

  // ── Mutations ─────────────────────────────────────────────────
  describe('mutations', () => {
    beforeEach(async () => {
      mockFb.getRecentLogs.mockResolvedValue(makeLogs(3));
      mockProfile.set(completedProfile);
      mockIsSignedIn.set(true);
      TestBed.flushEffects();
      await store.refresh();
    });

    it('should addLog and append the server-id row locally (no refetch)', async () => {
      const entry: LogEntry = { weight: 179, calories: 1850 };
      mockFb.getRecentLogs.mockClear();

      await store.addLog(entry);

      expect(mockFb.addLog).toHaveBeenCalledWith(entry);
      // Find by server id, not position: the new row is stamped at the
      // real current time, while makeLogs stamps "today" at 12:00, so the
      // row sorts before the noon logs when CI runs before noon (the old
      // logs[length-1] assertion was wall-clock-of-day dependent).
      const added = store.logs().find((l) => l.id === 'new-log-id');
      expect(added).toBeDefined();
      expect(added!.calories).toBe(1850);
      expect(added!.weight).toBe(179);
      // Zero recent-window refetches — the cache reconciles locally.
      // (_loadAllTimeLogs may fire once if history wasn't hydrated.)
      expect(mockFb.getRecentLogs.mock.calls.filter((c) => c[0] === 14)).toHaveLength(0);
    });

    it('should updateLog and apply core field semantics locally', async () => {
      const entry: LogEntry = { weight: 179, calories: 1800 };
      mockFb.getRecentLogs.mockClear();

      await store.updateLog('log-0', entry);

      expect(mockFb.updateLog).toHaveBeenCalledWith('log-0', entry);
      const updated = store.logs().find((l) => l.id === 'log-0')!;
      expect(updated.calories).toBe(1800);
      expect(updated.weight).toBe(179);
      // Omitted protein clears (deleteField semantics in the adapter).
      expect(updated.protein).toBeUndefined();
      expect(mockFb.getRecentLogs.mock.calls.filter((c) => c[0] === 14)).toHaveLength(0);
    });

    it('should deleteLog and reload', async () => {
      await store.deleteLog('log-1');
      expect(mockFb.deleteLog).toHaveBeenCalledWith('log-1');
    });

    it('log mutations refresh only logs, not unrelated collections', async () => {
      // After the initial refresh() in beforeEach, subsequent log mutations
      // should skip ensureUserProfile/getPresets/getRecentMeasurements/
      // getDailyWeights/getDailyWater — those are only needed on sign-in
      // or explicit refresh().
      mockFb.ensureUserProfile.mockClear();
      mockFb.getPresets.mockClear();
      mockFb.getRecentMeasurements.mockClear();
      mockFb.getDailyWeights.mockClear();
      mockFb.getDailyWater.mockClear();
      mockFb.getRecentLogs.mockClear();

      await store.addLog({ calories: 200 });
      await store.updateLog('log-0', { calories: 210 });
      await store.deleteLog('log-0');

      expect(mockFb.ensureUserProfile).not.toHaveBeenCalled();
      expect(mockFb.getPresets).not.toHaveBeenCalled();
      expect(mockFb.getRecentMeasurements).not.toHaveBeenCalled();
      expect(mockFb.getDailyWeights).not.toHaveBeenCalled();
      expect(mockFb.getDailyWater).not.toHaveBeenCalled();
      // addLog/updateLog reconcile caches locally (phase 5) — zero
      // reads. Only deleteLog refetches (the awaited 14-row window plus
      // the fire-and-forget all-time window = exactly 2 calls), so older
      // rows can re-enter the rolling window. Tighter than >=1 catches a
      // regression to refetch-per-mutation or full _load().
      expect(mockFb.getRecentLogs).toHaveBeenCalledTimes(2);
    });

    it('bulk-copy paths (repeatYesterday/copyDayToToday) also skip unrelated collections', async () => {
      mockFb.ensureUserProfile.mockClear();
      mockFb.getPresets.mockClear();
      mockFb.getRecentMeasurements.mockClear();
      mockFb.getDailyWeights.mockClear();
      mockFb.getDailyWater.mockClear();

      const cloned = await store.repeatYesterday();
      // Source day may have 0 rows depending on makeLogs — that's fine.
      // Even with 0 clones repeatYesterday exits before refresh, and with
      // clones it only touches _refreshLogs in the finally. Either way,
      // no unrelated collection should have been hit.
      expect(cloned).toBeGreaterThanOrEqual(0);
      expect(mockFb.ensureUserProfile).not.toHaveBeenCalled();
      expect(mockFb.getPresets).not.toHaveBeenCalled();
      expect(mockFb.getRecentMeasurements).not.toHaveBeenCalled();
      expect(mockFb.getDailyWeights).not.toHaveBeenCalled();
      expect(mockFb.getDailyWater).not.toHaveBeenCalled();
    });

    it('should addPreset and append the server-id preset locally (no refetch)', async () => {
      mockFb.getPresets.mockClear();

      await store.addPreset({ name: 'Lunch', calories: 650 });

      expect(mockFb.addPreset).toHaveBeenCalledWith({ name: 'Lunch', calories: 650 });
      expect(store.presets()).toEqual([
        { name: 'Lunch', calories: 650, id: 'new-preset-id' },
      ] as MealPreset[]);
      expect(mockFb.getPresets).not.toHaveBeenCalled();
    });

    it('should deletePreset and reload presets', async () => {
      mockFb.getPresets.mockResolvedValue([]);
      await store.deletePreset('p1');
      expect(mockFb.deletePreset).toHaveBeenCalledWith('p1');
      expect(store.presets()).toEqual([]);
    });

    it('should throw PresetLimitError when free user is at PRESET_LIMIT_FREE', async () => {
      const fullPresets: MealPreset[] = Array.from({ length: PRESET_LIMIT_FREE }, (_, i) => ({
        id: `p${i}`, name: `Preset ${i}`, calories: 500,
      }));
      mockFb.getPresets.mockResolvedValue(fullPresets);
      mockProfile.set(completedProfile);
      mockIsSignedIn.set(true);
      TestBed.flushEffects();
      // Explicit refresh so the presets signal is guaranteed populated
      // regardless of init-effect microtask timing.
      await store.refresh();

      mockIsPaid.set(false);
      mockFb.addPreset.mockClear();

      await expect(store.addPreset({ name: 'eleventh', calories: 400 }))
        .rejects.toBeInstanceOf(PresetLimitError);
      expect(mockFb.addPreset).not.toHaveBeenCalled();
    });
  });

  // ── Error handling ────────────────────────────────────────────
  describe('error handling', () => {
    it('should set error status when load fails', async () => {
      mockFb.ensureUserProfile.mockRejectedValue(new Error('Network error'));
      mockIsSignedIn.set(true);
      TestBed.flushEffects();

      await new Promise((r) => setTimeout(r, 10));

      expect(store.status()).toBe('error');
      expect(store.error()).toBe('Network error');
    });
  });
});
