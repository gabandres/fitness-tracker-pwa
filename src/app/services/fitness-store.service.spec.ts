import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { vi } from 'vitest';
import { FitnessStore } from './fitness-store.service';
import { AuthService } from './auth.service';
import { FirebaseService, DailyLog, LogEntry, MealPreset, UserProfile } from './firebase.service';
import { TdeeCalculatorService } from './tdee-calculator.service';
import { GeminiService } from './gemini.service';

describe('FitnessStore', () => {
  let store: FitnessStore;
  let mockIsSignedIn: WritableSignal<boolean>;
  let mockProfile: WritableSignal<UserProfile | null>;

  // Properly typed mock so TS doesn't force bracket access.
  let mockFb: {
    profile: WritableSignal<UserProfile | null>;
    profileCompleted: WritableSignal<boolean>;
    ensureUserProfile: ReturnType<typeof vi.fn>;
    getRecentLogs: ReturnType<typeof vi.fn>;
    addLog: ReturnType<typeof vi.fn>;
    updateLog: ReturnType<typeof vi.fn>;
    deleteLog: ReturnType<typeof vi.fn>;
    getPresets: ReturnType<typeof vi.fn>;
    addPreset: ReturnType<typeof vi.fn>;
    deletePreset: ReturnType<typeof vi.fn>;
    clearProfile: ReturnType<typeof vi.fn>;
    saveProfile: ReturnType<typeof vi.fn>;
    getRecentMeasurements: ReturnType<typeof vi.fn>;
    addMeasurement: ReturnType<typeof vi.fn>;
    deleteMeasurement: ReturnType<typeof vi.fn>;
    getLatestReport: ReturnType<typeof vi.fn>;
    saveReport: ReturnType<typeof vi.fn>;
  };

  const completedProfile: UserProfile = {
    email: 'test@gmail.com',
    createdAt: {} as any,
    lastSeenAt: {} as any,
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
      d.setUTCDate(d.getUTCDate() - (count - 1 - i));
      d.setUTCHours(12, 0, 0, 0);
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
    mockProfile = signal<UserProfile | null>(null);

    mockFb = {
      profile: mockProfile,
      profileCompleted: signal(false),
      ensureUserProfile: vi.fn().mockResolvedValue(undefined),
      getRecentLogs: vi.fn().mockResolvedValue([]),
      addLog: vi.fn().mockResolvedValue(undefined),
      updateLog: vi.fn().mockResolvedValue(undefined),
      deleteLog: vi.fn().mockResolvedValue(undefined),
      getPresets: vi.fn().mockResolvedValue([]),
      addPreset: vi.fn().mockResolvedValue(undefined),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      clearProfile: vi.fn(),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      getRecentMeasurements: vi.fn().mockResolvedValue([]),
      addMeasurement: vi.fn().mockResolvedValue(undefined),
      deleteMeasurement: vi.fn().mockResolvedValue(undefined),
      getLatestReport: vi.fn().mockResolvedValue(null),
      saveReport: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        FitnessStore,
        TdeeCalculatorService,
        { provide: GeminiService, useValue: { generateWeeklyReport: vi.fn().mockResolvedValue('test report') } },
        {
          provide: AuthService,
          useValue: {
            isSignedIn: mockIsSignedIn,
            ready: signal(true),
            user: signal(null),
          },
        },
        { provide: FirebaseService, useValue: mockFb },
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
      // Use UTC noon to avoid timezone drift in toISOString().
      const today = new Date();
      today.setUTCHours(12, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

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

    it('should addLog and reload', async () => {
      const entry: LogEntry = { weight: 179, calories: 1850 };
      const updated = makeLogs(4);
      mockFb.getRecentLogs.mockResolvedValue(updated);

      await store.addLog(entry);

      expect(mockFb.addLog).toHaveBeenCalledWith(entry);
      expect(store.logs()).toEqual(updated);
    });

    it('should updateLog and reload', async () => {
      const entry: LogEntry = { weight: 179, calories: 1800 };
      await store.updateLog('log-0', entry);

      expect(mockFb.updateLog).toHaveBeenCalledWith('log-0', entry);
      expect(mockFb.getRecentLogs).toHaveBeenCalled();
    });

    it('should deleteLog and reload', async () => {
      await store.deleteLog('log-1');
      expect(mockFb.deleteLog).toHaveBeenCalledWith('log-1');
    });

    it('should addPreset and reload presets', async () => {
      const presets: MealPreset[] = [{ id: 'p1', name: 'Lunch', calories: 650 }];
      mockFb.getPresets.mockResolvedValue(presets);

      await store.addPreset({ name: 'Lunch', calories: 650 });

      expect(mockFb.addPreset).toHaveBeenCalledWith({ name: 'Lunch', calories: 650 });
      expect(store.presets()).toEqual(presets);
    });

    it('should deletePreset and reload presets', async () => {
      mockFb.getPresets.mockResolvedValue([]);
      await store.deletePreset('p1');
      expect(mockFb.deletePreset).toHaveBeenCalledWith('p1');
      expect(store.presets()).toEqual([]);
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
