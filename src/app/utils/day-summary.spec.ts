import { summarizeDay, summarizeDays } from './day-summary';
import { localDateKey } from './date';
import type { DailyLog } from '../services/firebase.service';

/**
 * Pure-function tests — no TestBed, no Angular DI. Mirrors the style of
 * tdee-calculator.service.spec.ts.
 */
describe('summarizeDay / summarizeDays', () => {
  // ── Helpers ─────────────────────────────────────────────────
  function dayAt(yearMonthDay: [number, number, number], hour = 12): Date {
    const [y, m, d] = yearMonthDay;
    return new Date(y, m - 1, d, hour, 0, 0, 0);
  }

  function log(overrides: Partial<DailyLog> & { date: Date; calories: number }): DailyLog {
    return { ...overrides };
  }

  describe('summarizeDay', () => {
    it('returns zero totals + exercised=false + mealCount=0 on empty logs', () => {
      const s = summarizeDay('2026-05-22', []);
      expect(s.dateKey).toBe('2026-05-22');
      expect(s.totalCalories).toBe(0);
      expect(s.totalProtein).toBe(0);
      expect(s.mealCount).toBe(0);
      expect(s.exercised).toBe(false);
      expect(s.weightLb).toBeNull();
    });

    it('returns zeros when logs exist but none match the dateKey', () => {
      const date = dayAt([2026, 5, 21]);
      const s = summarizeDay('2026-05-22', [log({ date, calories: 500, protein: 30 })]);
      expect(s.totalCalories).toBe(0);
      expect(s.mealCount).toBe(0);
    });

    it('aggregates a multi-meal day with mixed exercise flags', () => {
      const date = dayAt([2026, 5, 22]);
      const key = localDateKey(date);
      const otherDay = dayAt([2026, 5, 21]);
      const logs: DailyLog[] = [
        log({ date, calories: 500, protein: 30 }),
        log({ date, calories: 700, protein: 45.4, exerciseCompleted: true }),
        log({ date, calories: 300 }), // no protein -> ignored in sum
        log({ date: otherDay, calories: 9999, protein: 999 }), // wrong day -> ignored
      ];
      const s = summarizeDay(key, logs);
      expect(s.totalCalories).toBe(1500);
      expect(s.totalProtein).toBe(75); // round(30 + 45.4) = round(75.4) = 75
      expect(s.mealCount).toBe(3);
      expect(s.exercised).toBe(true);
    });

    it('sums optional carbs/fat, zero when no entry carries them', () => {
      const date = dayAt([2026, 5, 22]);
      const key = localDateKey(date);
      const logs: DailyLog[] = [
        log({ date, calories: 500, carbs: 40.2, fat: 15 }),
        log({ date, calories: 300, carbs: 20 }), // no fat -> ignored in fat sum
        log({ date, calories: 200 }),            // legacy row, no macros
      ];
      const s = summarizeDay(key, logs);
      expect(s.totalCarbs).toBe(60); // round(40.2 + 20)
      expect(s.totalFat).toBe(15);

      const empty = summarizeDay(key, [log({ date, calories: 100 })]);
      expect(empty.totalCarbs).toBe(0);
      expect(empty.totalFat).toBe(0);
    });

    it('detects exercise via legacy lift/cardio flags', () => {
      const date = dayAt([2026, 5, 22]);
      const key = localDateKey(date);
      const sLift = summarizeDay(key, [log({ date, calories: 0, liftCompleted: true })]);
      const sCardio = summarizeDay(key, [log({ date, calories: 0, cardioCompleted: true })]);
      expect(sLift.exercised).toBe(true);
      expect(sCardio.exercised).toBe(true);
    });

    it('looks up weight by dateKey (hit)', () => {
      const s = summarizeDay('2026-05-22', [], { '2026-05-22': 180.4, '2026-05-21': 181 });
      expect(s.weightLb).toBe(180.4);
    });

    it('returns null weight when dateKey not present (miss)', () => {
      const s = summarizeDay('2026-05-22', [], { '2026-05-21': 181 });
      expect(s.weightLb).toBeNull();
    });

    it('returns null weight when dailyWeights omitted', () => {
      const s = summarizeDay('2026-05-22', []);
      expect(s.weightLb).toBeNull();
    });
  });

  describe('summarizeDays', () => {
    it('returns summaries in the given dateKey order, with zeros for empty days', () => {
      const k1 = '2026-05-20';
      const k2 = '2026-05-21';
      const k3 = '2026-05-22';
      const logs: DailyLog[] = [
        log({ date: dayAt([2026, 5, 20]), calories: 100, protein: 10 }),
        log({ date: dayAt([2026, 5, 22]), calories: 800, protein: 50, exerciseCompleted: true }),
        log({ date: dayAt([2026, 5, 22]), calories: 200, protein: 5 }),
      ];
      const out = summarizeDays([k1, k2, k3], logs, { '2026-05-21': 175 });
      expect(out.map((s) => s.dateKey)).toEqual([k1, k2, k3]);
      expect(out[0].totalCalories).toBe(100);
      expect(out[0].mealCount).toBe(1);
      expect(out[0].exercised).toBe(false);
      expect(out[0].weightLb).toBeNull();
      expect(out[1].totalCalories).toBe(0);
      expect(out[1].mealCount).toBe(0);
      expect(out[1].weightLb).toBe(175);
      expect(out[2].totalCalories).toBe(1000);
      expect(out[2].totalProtein).toBe(55);
      expect(out[2].mealCount).toBe(2);
      expect(out[2].exercised).toBe(true);
    });

    it('ignores logs that fall outside the requested window', () => {
      const logs: DailyLog[] = [
        log({ date: dayAt([2026, 5, 19]), calories: 9999 }),
        log({ date: dayAt([2026, 5, 23]), calories: 9999 }),
      ];
      const out = summarizeDays(['2026-05-20', '2026-05-22'], logs);
      expect(out.every((s) => s.totalCalories === 0)).toBe(true);
    });
  });
});
