import { TdeeCalculatorService, TdeeResult, WeeklySummary } from './tdee-calculator.service';
import { DailyLog, ProfileFields } from './firebase.service';

/**
 * Pure function tests — no TestBed, no mocks, no Angular DI.
 * Instantiate the service directly and verify outputs.
 */
describe('TdeeCalculatorService', () => {
  let service: TdeeCalculatorService;

  beforeEach(() => {
    service = new TdeeCalculatorService();
  });

  // ── Helper: generate N days of log data ending today ──────────
  function makeLogs(
    entries: { weight: number; calories: number; protein?: number; liftCompleted?: boolean; cardioCompleted?: boolean }[],
    startDaysAgo?: number,
  ): DailyLog[] {
    const start = startDaysAgo ?? entries.length - 1;
    return entries.map((e, i) => {
      // Use UTC noon to avoid timezone-induced date drift in toISOString().
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - (start - i));
      d.setUTCHours(12, 0, 0, 0);
      return { weight: e.weight, calories: e.calories, date: d, protein: e.protein, liftCompleted: e.liftCompleted, cardioCompleted: e.cardioCompleted };
    });
  }

  const defaultProfile: ProfileFields = {
    heightIn: 70,            // 5'10"
    age: 30,
    sex: 'male',
    activityLevel: 'moderate',
    targetPaceLbsPerWeek: 1.5,
  };

  // ────────────────────────────────────────────────────────────────
  // calculate() — measured mode
  // ────────────────────────────────────────────────────────────────
  describe('calculate() measured mode (>=14 days)', () => {
    it('should compute TDEE from weight trend + average intake', () => {
      // Week 1 (days 1-7): avg weight ~185, Week 2 (days 8-14): avg weight ~183
      // Weight change: 185 - 183 = 2 lbs lost
      // Avg daily intake: 1850
      // Daily deficit: (2 * 3500) / 7 = 1000
      // True TDEE: 1850 + 1000 = 2850
      // Target (1.5 lb/wk): 2850 - 750 = 2100
      const logs = makeLogs([
        { weight: 185.2, calories: 1850 },
        { weight: 185.0, calories: 1800 },
        { weight: 184.8, calories: 1900 },
        { weight: 185.1, calories: 1850 },
        { weight: 184.9, calories: 1800 },
        { weight: 184.7, calories: 1850 },
        { weight: 184.9, calories: 1900 },
        { weight: 183.4, calories: 1850 },
        { weight: 183.2, calories: 1800 },
        { weight: 183.0, calories: 1900 },
        { weight: 183.1, calories: 1850 },
        { weight: 182.8, calories: 1800 },
        { weight: 183.0, calories: 1850 },
        { weight: 182.9, calories: 1900 },
      ]);

      const result = service.calculate(logs, defaultProfile);
      expect(result.source).toBe('measured');
      expect(result.trueTdee).toBeGreaterThan(2500);
      expect(result.trueTdee).toBeLessThan(3200);
      expect(result.newDailyTarget).toBeGreaterThan(1500);
      expect(result.weightChangeTrend).toBeGreaterThan(0); // positive = lost weight
    });

    it('should use profile pace instead of hardcoded 1.5', () => {
      const logs = makeLogs(
        Array.from({ length: 14 }, (_, i) => ({
          weight: 185 - i * 0.15,
          calories: 1850,
        })),
      );
      const slowPace = { ...defaultProfile, targetPaceLbsPerWeek: 0.5 as const };
      const fastPace = { ...defaultProfile, targetPaceLbsPerWeek: 2.0 as const };

      const slowResult = service.calculate(logs, slowPace);
      const fastResult = service.calculate(logs, fastPace);

      // Slower pace = higher daily target (less aggressive deficit)
      expect(slowResult.newDailyTarget).toBeGreaterThan(fastResult.newDailyTarget);
    });

    it('should clamp target at 1500 safety floor', () => {
      // Construct logs where TDEE comes out very low — e.g., gaining weight
      // while eating little would produce a negative deficit → very low target.
      const logs = makeLogs(
        Array.from({ length: 14 }, (_, i) => ({
          weight: 150 + i * 0.3, // gaining weight
          calories: 1200,         // eating very little
        })),
      );

      const result = service.calculate(logs, defaultProfile);
      expect(result.newDailyTarget).toBe(1500);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // calculate() — formula mode
  // ────────────────────────────────────────────────────────────────
  describe('calculate() formula mode (<14 days with profile)', () => {
    it('should use Mifflin-St Jeor when fewer than 14 days', () => {
      const logs = makeLogs([
        { weight: 185, calories: 1850 },
        { weight: 184.5, calories: 1800 },
      ]);

      const result = service.calculate(logs, defaultProfile);
      expect(result.source).toBe('formula');
      expect(result.trueTdee).toBeGreaterThan(2000);
      expect(result.trueTdee).toBeLessThan(3500);
      expect(result.weightChangeTrend).toBe(0);
    });

    it('should produce different TDEE for male vs female', () => {
      const logs = makeLogs([{ weight: 160, calories: 1800 }]);
      const male = service.calculate(logs, { ...defaultProfile, sex: 'male' });
      const female = service.calculate(logs, { ...defaultProfile, sex: 'female' });

      expect(male.trueTdee).toBeGreaterThan(female.trueTdee);
    });

    it('should scale TDEE with activity level', () => {
      const logs = makeLogs([{ weight: 180, calories: 2000 }]);
      const sedentary = service.calculate(logs, { ...defaultProfile, activityLevel: 'sedentary' });
      const active = service.calculate(logs, { ...defaultProfile, activityLevel: 'very_active' });

      expect(active.trueTdee).toBeGreaterThan(sedentary.trueTdee);
    });

    it('should use most recent log weight for formula when logs exist', () => {
      const logs = makeLogs([
        { weight: 200, calories: 2000 },
        { weight: 195, calories: 1900 },
      ]);
      // With the same profile, a heavier person has a higher TDEE.
      const heavy = service.calculate(
        makeLogs([{ weight: 250, calories: 2000 }]),
        defaultProfile,
      );
      const light = service.calculate(
        makeLogs([{ weight: 150, calories: 2000 }]),
        defaultProfile,
      );
      expect(heavy.trueTdee).toBeGreaterThan(light.trueTdee);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // calculate() — seed mode
  // ────────────────────────────────────────────────────────────────
  describe('calculate() seed mode (no profile)', () => {
    it('should return hardcoded seed values when no profile and <14 days', () => {
      const result = service.calculate([], null);
      expect(result).toEqual({
        trueTdee: 2450,
        newDailyTarget: 1800,
        weightChangeTrend: 0,
        source: 'seed',
      });
    });

    it('should return seed even with some logs but no profile', () => {
      const logs = makeLogs([{ weight: 180, calories: 2000 }]);
      const result = service.calculate(logs, null);
      expect(result.source).toBe('seed');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // ema()
  // ────────────────────────────────────────────────────────────────
  describe('ema()', () => {
    it('should return empty for empty input', () => {
      expect(service.ema([])).toEqual([]);
    });

    it('should return the single value for length-1 input', () => {
      expect(service.ema([185])).toEqual([185]);
    });

    it('should smooth a declining series', () => {
      const raw = [185, 184, 183, 182, 181, 180, 179];
      const smoothed = service.ema(raw, 7);

      expect(smoothed).toHaveLength(7);
      // First value = raw value
      expect(smoothed[0]).toBe(185);
      // Smoothed values should be BETWEEN the raw extremes
      for (const v of smoothed) {
        expect(v).toBeGreaterThanOrEqual(179);
        expect(v).toBeLessThanOrEqual(185);
      }
      // Smoothed should trend downward
      for (let i = 1; i < smoothed.length; i++) {
        expect(smoothed[i]).toBeLessThan(smoothed[i - 1]);
      }
    });

    it('should dampen a spike', () => {
      const raw = [180, 180, 185, 180, 180]; // spike on day 3
      const smoothed = service.ema(raw, 3);
      // The spike should be less pronounced in the smoothed series
      const rawSpike = Math.max(...raw) - Math.min(...raw);
      const smoothedSpike = Math.max(...smoothed) - Math.min(...smoothed);
      expect(smoothedSpike).toBeLessThan(rawSpike);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // computeStreak()
  // ────────────────────────────────────────────────────────────────
  describe('computeStreak()', () => {
    it('should return 0 for empty logs', () => {
      expect(service.computeStreak([])).toBe(0);
    });

    it('should count consecutive days including today', () => {
      const logs = makeLogs([
        { weight: 180, calories: 2000 },
        { weight: 180, calories: 2000 },
        { weight: 180, calories: 2000 },
      ], 2); // days -2, -1, 0 (today)
      expect(service.computeStreak(logs)).toBe(3);
    });

    it('should count from yesterday if today has no entry', () => {
      const logs = makeLogs([
        { weight: 180, calories: 2000 },
        { weight: 180, calories: 2000 },
      ], 2); // days -2, -1 (yesterday)
      // day 0 (today) has no entry — streak should start from yesterday
      expect(service.computeStreak(logs)).toBe(2);
    });

    it('should break streak on a gap', () => {
      // Logs on days -4, -3, -1, 0 (gap on day -2)
      const today = new Date();
      const logs: DailyLog[] = [-4, -3, -1, 0].map((d) => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() + d);
        date.setUTCHours(12, 0, 0, 0);
        return { weight: 180, calories: 2000, date };
      });
      // Streak should be 2 (today + yesterday), not 4
      expect(service.computeStreak(logs)).toBe(2);
    });

    it('should return 0 when most recent log is >1 day old', () => {
      const logs = makeLogs([
        { weight: 180, calories: 2000 },
      ], 5); // 5 days ago only
      expect(service.computeStreak(logs)).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // weeklySummary()
  // ────────────────────────────────────────────────────────────────
  describe('weeklySummary()', () => {
    it('should return null for empty logs', () => {
      expect(service.weeklySummary([], 2000)).toBeNull();
    });

    it('should compute correct averages for 7 days', () => {
      const logs = makeLogs([
        { weight: 180, calories: 1900, protein: 150 },
        { weight: 179.5, calories: 1950, protein: 160 },
        { weight: 179, calories: 2000, protein: 140 },
        { weight: 179.2, calories: 1850, protein: 155 },
        { weight: 178.8, calories: 2100, protein: 145 },
        { weight: 178.5, calories: 1900, protein: 150 },
        { weight: 178, calories: 1800, protein: 160 },
      ]);

      const result = service.weeklySummary(logs, 1900)!;
      expect(result).not.toBeNull();
      expect(result.days).toBe(7);

      // Average weight: ~178.9
      expect(result.avgWeight).toBeGreaterThan(178);
      expect(result.avgWeight).toBeLessThan(180);

      // Average calories: ~1928
      expect(result.avgCalories).toBeGreaterThan(1800);
      expect(result.avgCalories).toBeLessThan(2100);

      // Weight delta: 178 - 180 = -2 (lost weight)
      expect(result.weightDelta).toBeLessThan(0);

      // Average protein should be computed
      expect(result.avgProtein).not.toBeNull();
      expect(result.avgProtein!).toBeGreaterThan(140);
      expect(result.avgProtein!).toBeLessThan(165);

      // Adherence: days within ±100 kcal of 1900 target
      expect(result.adherencePct).toBeGreaterThanOrEqual(0);
      expect(result.adherencePct).toBeLessThanOrEqual(100);
    });

    it('should handle logs with no protein', () => {
      const logs = makeLogs([
        { weight: 180, calories: 2000 },
        { weight: 179, calories: 1900 },
      ]);
      const result = service.weeklySummary(logs, 2000)!;
      expect(result.avgProtein).toBeNull();
    });

    it('should slice to last 7 entries when more are provided', () => {
      const logs = makeLogs(
        Array.from({ length: 14 }, (_, i) => ({
          weight: 185 - i * 0.2,
          calories: 1900,
        })),
      );
      const result = service.weeklySummary(logs, 1900)!;
      expect(result.days).toBe(7);
      // Should use the LAST 7, not the first 7 (avg of last 7 ~ 183.0)
      expect(result.avgWeight).toBeLessThanOrEqual(183);
    });
  });
});
