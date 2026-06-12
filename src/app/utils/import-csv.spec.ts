import { describe, expect, it } from 'vitest';
import { parseImportCsv } from './import-csv';

function ok(text: string) {
  const r = parseImportCsv(text);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.result;
}

describe('parseImportCsv', () => {
  describe('vendor header shapes', () => {
    it('parses a MyFitnessPal nutrition export (YYYY-MM-DD, full macros)', () => {
      const csv = [
        'Date,Meal,Calories,Fat (g),Saturated Fat,Carbohydrates (g),Sugar,Protein (g),Sodium',
        '2026-05-01,Breakfast,420,12,4,55,9,22,300',
        '2026-05-01,Lunch,650,20,6,70,12,38,800',
        '2026-05-02,Dinner,"1,020",30,10,95,15,55,1200',
      ].join('\n');
      const r = ok(csv);
      expect(r.entries.length).toBe(3);
      expect(r.firstDate).toBe('2026-05-01');
      expect(r.lastDate).toBe('2026-05-02');
      const [b] = r.entries;
      expect(b.calories).toBe(420);
      expect(b.fat).toBe(12);
      expect(b.carbs).toBe(55);
      expect(b.protein).toBe(22);
      expect(b.mealLabel).toBe('Breakfast');
      // Quoted thousands separator survives.
      expect(r.entries[2].calories).toBe(1020);
      expect(r.totalCalories).toBe(420 + 650 + 1020);
    });

    it('parses a Lose It! export (M/D/YYYY, Name column)', () => {
      const csv = [
        'Date,Name,Type,Quantity,Units,Calories,Fat (g),Protein (g),Carbohydrates (g)',
        '5/1/2026,Greek Yogurt,Breakfast,1,Cup,150,4,15,8',
        '5/3/2026,Chicken Bowl,Lunch,1,Serving,580,18,42,52',
      ].join('\n');
      const r = ok(csv);
      expect(r.entries.length).toBe(2);
      expect(r.firstDate).toBe('2026-05-01');
      expect(r.entries[0].mealLabel).toBe('Greek Yogurt');
      expect(r.entries[1].protein).toBe(42);
    });

    it('parses a Cronometer food entries export (Day + Energy (kcal) + time)', () => {
      const csv = [
        'Day,Time,Group,Food Name,Amount,Energy (kcal),Carbs (g),Fat (g),Protein (g)',
        '2026-05-01,08:30,Breakfast,Oatmeal,100 g,389,66.3,6.9,16.9',
        '2026-05-01,19:05,Dinner,Salmon,150 g,312,0,18.5,33.7',
      ].join('\n');
      const r = ok(csv);
      expect(r.entries.length).toBe(2);
      // Cronometer time column is honored; macros round to integers.
      expect(r.entries[0].timestamp!.getHours()).toBe(8);
      expect(r.entries[0].timestamp!.getMinutes()).toBe(30);
      expect(r.entries[0].carbs).toBe(66);
      expect(r.entries[1].timestamp!.getHours()).toBe(19);
    });
  });

  describe('row handling', () => {
    it('defaults missing time to local noon and sorts oldest-first', () => {
      const csv = [
        'Date,Calories',
        '2026-05-03,300',
        '2026-05-01,100',
      ].join('\n');
      const r = ok(csv);
      expect(r.entries[0].timestamp!.getDate()).toBe(1);
      expect(r.entries[0].timestamp!.getHours()).toBe(12);
    });

    it('skips rows with missing/invalid date or calories without failing', () => {
      const csv = [
        'Date,Calories,Protein (g)',
        '2026-05-01,500,30',
        'not-a-date,400,20',
        '2026-05-02,,25',
        '2026-05-03,999999,10', // over the rules cap
      ].join('\n');
      const r = ok(csv);
      expect(r.entries.length).toBe(1);
      expect(r.skipped).toBe(3);
    });

    it('drops out-of-range macros but keeps the row', () => {
      const csv = [
        'Date,Calories,Protein (g),Carbs (g),Fat (g)',
        '2026-05-01,500,5000,-3,18',
      ].join('\n');
      const [e] = ok(csv).entries;
      expect(e.calories).toBe(500);
      expect(e.protein).toBeUndefined();
      expect(e.carbs).toBeUndefined();
      expect(e.fat).toBe(18);
    });

    it('handles quoted fields with embedded commas and quotes', () => {
      const csv = [
        'Date,Name,Calories',
        '2026-05-01,"Chicken, rice ""bowl""",640',
      ].join('\n');
      const [e] = ok(csv).entries;
      expect(e.mealLabel).toBe('Chicken, rice "bowl"');
      expect(e.calories).toBe(640);
    });

    it('caps the label at 100 chars (rules limit)', () => {
      const long = 'x'.repeat(150);
      const csv = `Date,Name,Calories\n2026-05-01,${long},100`;
      expect(ok(csv).entries[0].mealLabel!.length).toBe(100);
    });
  });

  describe('errors', () => {
    it('empty-file on blank input', () => {
      expect(parseImportCsv('')).toEqual({ ok: false, error: 'empty-file' });
    });

    it('no-header-match when date or calories columns are absent', () => {
      expect(parseImportCsv('Foo,Bar\n1,2')).toEqual({ ok: false, error: 'no-header-match' });
      expect(parseImportCsv('Date,Steps\n2026-05-01,9000')).toEqual({ ok: false, error: 'no-header-match' });
    });

    it('no-rows when the header matches but nothing parses', () => {
      expect(parseImportCsv('Date,Calories\nnope,abc')).toEqual({ ok: false, error: 'no-rows' });
    });
  });
});
