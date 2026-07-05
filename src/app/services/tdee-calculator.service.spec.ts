import { TdeeCalculatorService } from './tdee-calculator.service';
import { DailyLog, ProfileFields } from './firebase.service';

/**
 * The service is a thin Angular seam that delegates `calculate` /
 * `aggregateByDay` to `@macrolog/core/tdee`. These tests exercise the
 * delegation end-to-end (the exhaustive algorithm cases live in the core
 * `tdee.test.ts`; the moved-out derivations are covered in core
 * `weekly-summary.test.ts` / `streak.test.ts`).
 */
describe('TdeeCalculatorService', () => {
  let service: TdeeCalculatorService;

  beforeEach(() => {
    service = new TdeeCalculatorService();
  });

  // ── Helper: generate N days of log data ending today ──────────
  function makeLogs(
    entries: { weight: number; calories: number; protein?: number }[],
    startDaysAgo?: number,
  ): DailyLog[] {
    const start = startDaysAgo ?? entries.length - 1;
    return entries.map((e, i) => {
      // Use local noon — production code uses localDateKey() which relies on local time.
      const d = new Date();
      d.setDate(d.getDate() - (start - i));
      d.setHours(12, 0, 0, 0);
      return { weight: e.weight, calories: e.calories, date: d, protein: e.protein };
    });
  }

  const defaultProfile: ProfileFields = {
    heightIn: 70,            // 5'10"
    age: 30,
    sex: 'male',
    activityLevel: 'moderate',
    targetPaceLbsPerWeek: 1.5,
  };

  describe('calculate() measured mode (>=14 days)', () => {
    it('should compute TDEE from weight trend + average intake', () => {
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

    it('should clamp target at 1500 safety floor', () => {
      const logs = makeLogs(
        Array.from({ length: 14 }, (_, i) => ({
          weight: 150 + i * 0.3, // gaining weight
          calories: 1200,        // eating very little
        })),
      );
      const result = service.calculate(logs, defaultProfile);
      expect(result.newDailyTarget).toBe(1500);
    });
  });

  describe('calculate() formula mode (<14 days with profile)', () => {
    it('should use Mifflin-St Jeor when fewer than 14 days', () => {
      const logs = makeLogs([
        { weight: 185, calories: 1850 },
        { weight: 184.5, calories: 1800 },
      ]);
      const result = service.calculate(logs, defaultProfile);
      expect(result.source).toBe('formula');
      expect(result.trueTdee).toBeGreaterThan(2000);
      expect(result.weightChangeTrend).toBe(0);
    });

    it('should scale TDEE with activity level', () => {
      const logs = makeLogs([{ weight: 180, calories: 2000 }]);
      const sedentary = service.calculate(logs, { ...defaultProfile, activityLevel: 'sedentary' });
      const active = service.calculate(logs, { ...defaultProfile, activityLevel: 'very_active' });
      expect(active.trueTdee).toBeGreaterThan(sedentary.trueTdee);
    });
  });

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
  });

  describe('aggregateByDay()', () => {
    it('sums multiple entries on the same day into one row', () => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      const rows: DailyLog[] = [
        { calories: 300, protein: 20, date: d },
        { calories: 200, protein: 10, date: d },
      ];
      const daily = service.aggregateByDay(rows);
      expect(daily).toHaveLength(1);
      expect(daily[0].calories).toBe(500);
      expect(daily[0].protein).toBe(30);
    });
  });
});
