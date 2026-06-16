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
      // Use local noon — production code uses localDateKey() which relies on local time.
      const d = new Date();
      d.setDate(d.getDate() - (start - i));
      d.setHours(12, 0, 0, 0);
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
      // Two plateaus ~185 then ~183 over 14 days. The least-squares slope
      // through all points is ≈ -0.218 lb/day → deficit ≈ 0.218 * 3500 ≈ 765
      // kcal/day. Avg intake ≈ 1850 → true TDEE ≈ 2615.
      // Target (1.5 lb/wk): 2615 - 750 ≈ 1865.
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
  // regressionSlope() — least-squares slope
  // ────────────────────────────────────────────────────────────────
  describe('regressionSlope()', () => {
    it('should return null for fewer than 2 points', () => {
      expect(service.regressionSlope([])).toBeNull();
      expect(service.regressionSlope([{ x: 1, y: 1 }])).toBeNull();
    });

    it('should return null when all x are identical (no spread to fit)', () => {
      expect(service.regressionSlope([{ x: 5, y: 1 }, { x: 5, y: 9 }])).toBeNull();
    });

    it('should recover the slope of a perfect line', () => {
      const pts = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }];
      expect(service.regressionSlope(pts)).toBeCloseTo(2, 6);
    });

    it('should fit the best-fit slope through noisy points', () => {
      // y = -0.2x + noise; slope should land near -0.2
      const pts = [
        { x: 0, y: 10.1 }, { x: 1, y: 9.7 }, { x: 2, y: 9.6 },
        { x: 3, y: 9.5 }, { x: 4, y: 9.0 }, { x: 5, y: 9.1 },
      ];
      expect(service.regressionSlope(pts)).toBeCloseTo(-0.2, 1);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // weightTrendLbsPerDay() — robust trend (the highest-priority fix)
  // ────────────────────────────────────────────────────────────────
  describe('weightTrendLbsPerDay()', () => {
    it('should return null with fewer than 2 weigh-ins', () => {
      expect(service.weightTrendLbsPerDay([])).toBeNull();
      expect(service.weightTrendLbsPerDay(makeLogs([{ weight: 180, calories: 2000 }]))).toBeNull();
    });

    it('should recover a steady loss rate (lbs/day, negative = losing)', () => {
      const logs = makeLogs(
        Array.from({ length: 15 }, (_, i) => ({ weight: 185 - i * 0.2, calories: 1900 })),
      );
      expect(service.weightTrendLbsPerDay(logs)).toBeCloseTo(-0.2, 2);
    });

    it('should resist a water-weight spike on the boundary day', () => {
      const clean = Array.from({ length: 21 }, (_, i) => ({ weight: 185 - i * 0.15, calories: 1900 }));
      const spiked = clean.map((e, i) => (i === clean.length - 1 ? { ...e, weight: e.weight + 3 } : e));

      const slopeClean = service.weightTrendLbsPerDay(makeLogs(clean))!;
      const slopeSpiked = service.weightTrendLbsPerDay(makeLogs(spiked))!;

      // A single +3 lb boundary spike must barely move the fitted slope.
      // Endpoint subtraction (last - first)/days would lurch by ~0.14/day.
      expect(Math.abs(slopeSpiked - slopeClean)).toBeLessThan(0.05);
      expect(slopeSpiked).toBeLessThan(0); // still reads as losing
    });

    it('should use real dates so logging gaps do not inflate the rate', () => {
      // Two weigh-ins 10 calendar days apart, 2 lb apart → -0.2 lb/day,
      // NOT -2 lb/"step". makeLogs spaces by startDaysAgo offsets.
      const a = new Date(); a.setDate(a.getDate() - 10); a.setHours(12, 0, 0, 0);
      const b = new Date(); b.setHours(12, 0, 0, 0);
      const logs: DailyLog[] = [
        { weight: 185, calories: 2000, date: a },
        { weight: 183, calories: 2000, date: b },
      ];
      expect(service.weightTrendLbsPerDay(logs)).toBeCloseTo(-0.2, 6);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // calculate() measured — missing-data & completeness handling
  // ────────────────────────────────────────────────────────────────
  describe('calculate() measured mode — missing / zero-intake days', () => {
    it('should exclude logged-but-zero-kcal days from the intake average', () => {
      // 15 flat-weight days (slope ~0 → deficit ~0, so TDEE ≈ avg intake).
      // 13 days at 2000 kcal, 2 weigh-in-only days at 0 kcal. If the zeros
      // were averaged in, intake would crater to ~1733; excluded, it stays
      // ~2000. (trimmedMean alone only absorbs ONE outlier, not two.)
      const entries = Array.from({ length: 15 }, (_, i) => ({
        weight: 180,
        calories: i < 2 ? 0 : 2000,
      }));
      const result = service.calculate(makeLogs(entries), defaultProfile);
      expect(result.source).toBe('measured');
      expect(result.trueTdee).toBeGreaterThan(1950); // not dragged toward ~1733
    });

    it('should fall back to seed when every intake day is zero', () => {
      const entries = Array.from({ length: 15 }, () => ({ weight: 180, calories: 0 }));
      const result = service.calculate(makeLogs(entries), defaultProfile);
      expect(result.source).toBe('seed');
    });

    it('should report 100% completeness for a fully-logged contiguous window', () => {
      const entries = Array.from({ length: 20 }, (_, i) => ({ weight: 185 - i * 0.1, calories: 2000 }));
      const result = service.calculate(makeLogs(entries), defaultProfile);
      expect(result.loggingCompletenessPct).toBe(100);
      expect(result.reliable).toBe(true);
    });

    it('should flag low completeness (and not reliable) when the window is gappy', () => {
      // 14 weigh-ins spread every OTHER day → spans 27 calendar days.
      // Completeness ≈ 14/28 = 50%.
      const logs: DailyLog[] = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (27 - i * 2)); // -27, -25, … , -1
        d.setHours(12, 0, 0, 0);
        return { weight: 185 - i * 0.1, calories: 2000, date: d };
      });
      const result = service.calculate(logs, defaultProfile);
      expect(result.source).toBe('measured');
      expect(result.loggingCompletenessPct).toBeLessThanOrEqual(55);
      expect(result.loggingCompletenessPct).toBeGreaterThanOrEqual(45);
      expect(result.reliable).toBe(false);
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
        date.setDate(date.getDate() + d);
        date.setHours(12, 0, 0, 0);
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
