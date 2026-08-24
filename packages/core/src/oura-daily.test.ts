import { describe, expect, it } from 'vitest';
import { parseOuraDaily, sleepSecondsToHours } from './oura-daily';

describe('sleepSecondsToHours', () => {
  it('converts seconds to hours at quarter-hour resolution', () => {
    expect(sleepSecondsToHours(27000)).toBe(7.5); // 7h30m
    expect(sleepSecondsToHours(28800)).toBe(8);
  });

  it('rounds to the quarter the ledger actually stores', () => {
    // 7h37m → 7.6167h → 7.5, not 7.62. `setDailySleep` stores quarters and the
    // Health importer's tolerance is 0.25, so an Oura night and a Health night
    // for the same date must land on the same number.
    expect(sleepSecondsToHours(27420)).toBe(7.5);
    expect(sleepSecondsToHours(28000)).toBe(7.75);
  });

  it('treats null, zero and nonsense as no value rather than as zero', () => {
    // Oura uses null for "not measured". Number(null) is 0, and writing a real
    // zero over a real night is the failure this guard exists for.
    expect(sleepSecondsToHours(null)).toBeUndefined();
    expect(sleepSecondsToHours(0)).toBeUndefined();
    expect(sleepSecondsToHours(-100)).toBeUndefined();
    expect(sleepSecondsToHours('27000')).toBeUndefined();
    expect(sleepSecondsToHours(undefined)).toBeUndefined();
  });
});

describe('parseOuraDaily', () => {
  const activity = (day: string, over: Record<string, unknown> = {}) => ({
    day,
    steps: 8200,
    active_calories: 430,
    ...over,
  });
  const sleep = (day: string, seconds: number | null = 27000) => ({
    day,
    total_sleep_duration: seconds,
  });

  it('maps activity to steps and active kcal', () => {
    const { rows } = parseOuraDaily([activity('2026-08-24')], []);
    expect(rows).toEqual([{ dateKey: '2026-08-24', steps: 8200, activeKcal: 430 }]);
  });

  it('maps sleep duration to hours', () => {
    const { rows } = parseOuraDaily([], [sleep('2026-08-24')]);
    expect(rows).toEqual([{ dateKey: '2026-08-24', sleepHours: 7.5 }]);
  });

  it('folds both collections into ONE row per day', () => {
    const { rows } = parseOuraDaily([activity('2026-08-24')], [sleep('2026-08-24')]);
    expect(rows).toEqual([
      { dateKey: '2026-08-24', steps: 8200, activeKcal: 430, sleepHours: 7.5 },
    ]);
  });

  it('SUMS multiple sleep periods on one day — a nap plus a night', () => {
    const { rows } = parseOuraDaily([], [sleep('2026-08-24', 27000), sleep('2026-08-24', 3600)]);
    expect(rows[0].sleepHours).toBe(8.5);
  });

  it('keeps a partial day rather than discarding it', () => {
    const { rows } = parseOuraDaily([activity('2026-08-24', { active_calories: null })], []);
    expect(rows).toEqual([{ dateKey: '2026-08-24', steps: 8200 }]);
  });

  it('uses Oura’s own day field and never recomputes it', () => {
    // The ring decides which day a night belongs to. Re-deriving it from a
    // timestamp in another timezone would move the night by one day.
    const { rows } = parseOuraDaily([], [{ day: '2026-08-23', total_sleep_duration: 27000 }]);
    expect(rows[0].dateKey).toBe('2026-08-23');
  });

  it('counts records it cannot read instead of silently dropping them', () => {
    const { rows, skipped } = parseOuraDaily(
      [activity('nope'), activity('2026-08-24', { steps: null, active_calories: null })],
      [{ day: '2026-08-24' }, null],
    );
    expect(rows).toEqual([]);
    expect(skipped).toBe(4);
  });

  it('returns an empty result for empty input, not a crash', () => {
    expect(parseOuraDaily()).toEqual({ rows: [], skipped: 0 });
    expect(parseOuraDaily([], [])).toEqual({ rows: [], skipped: 0 });
  });

  it('sorts by date so a caller writes days in order', () => {
    const { rows } = parseOuraDaily(
      [activity('2026-08-25'), activity('2026-08-23'), activity('2026-08-24')],
      [],
    );
    expect(rows.map((r) => r.dateKey)).toEqual(['2026-08-23', '2026-08-24', '2026-08-25']);
  });
});
