import { addDays, calendarDateKey, parseYmd, type DateKey } from './date';
import type { DailyLog, ProfileFields } from './types';

/**
 * Fixtures for `complete-day.test.ts`. Not a `*.test.ts` file, so vitest does
 * not collect it as a suite. Deterministic — no `Math.random` — so the pinned
 * numbers in the test are reproducible on any machine.
 */

export const PROFILE: ProfileFields = {
  heightIn: 70,
  age: 35,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1 as ProfileFields['targetPaceLbsPerWeek'],
};

/** A day key `i` days after `start`. */
export function keyAt(start: string, i: number): DateKey {
  return calendarDateKey(addDays(parseYmd(start as DateKey), i));
}

/** One noon row per day. */
export function row(key: string, calories: number, weight?: number): DailyLog {
  return { date: new Date(`${key}T12:00:00`), calories, ...(weight == null ? {} : { weight }) };
}

/**
 * A NORMAL, fully-logged user: 60 consecutive days from 2026-08-01, every day
 * 1,800–2,200 kcal, weighing in daily on a slow downward trend with a little
 * day-to-day scatter. Every day clears the 1,000 kcal bar, so the complete-day
 * rule must leave this account's estimate byte-identical.
 */
export function normalUser(): { logs: DailyLog[]; now: Date } {
  const logs: DailyLog[] = [];
  for (let i = 0; i < 60; i++) {
    const kcal = 1800 + ((i * 137) % 400);
    const weight = Math.round((182 - i * 0.06 + (((i * 7) % 5) - 2) * 0.3) * 10) / 10;
    logs.push(row(keyAt('2026-08-01', i), kcal, weight));
  }
  // The morning after the last row: nothing in progress.
  return { logs, now: new Date('2026-09-30T08:00:00') };
}

/**
 * The account that prompted the rule (2026-10-24), reshaped as a fixture: 42
 * consecutive days, weight flat 150–153 lb, and intake logged INCOMPLETELY —
 * most days 262–950 kcal, only 9 days at or above 1,000. Measured on the old
 * rule this came out at a maintenance of ~931 kcal, which no 151 lb adult
 * maintains on.
 */
export function incompleteLogger(): { logs: DailyLog[]; now: Date; fullDays: string[] } {
  const logs: DailyLog[] = [];
  const fullDays: string[] = [];
  for (let i = 0; i < 42; i++) {
    const key = keyAt('2026-09-01', i);
    // Every fifth day (0, 5, …, 40) is a real day of eating: 9 of them.
    const full = i % 5 === 0;
    const kcal = full ? 1650 + ((i * 53) % 400) : 262 + ((i * 97) % 690);
    if (full) fullDays.push(key);
    const weight = 150 + ((i * 7) % 31) / 10; // 150.0–153.0, no trend
    logs.push(row(key, kcal, weight));
  }
  return { logs, now: new Date('2026-10-13T08:00:00'), fullDays };
}
