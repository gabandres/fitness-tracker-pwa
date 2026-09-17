/**
 * The shipped exercise library, and the two functions that finally make it
 * reachable.
 *
 * Until these existed, `EXERCISE_LIBRARY` — 70-odd movements carrying muscle
 * groups and coaching cues in three locales — could only enter a user's
 * catalog as a side effect of cloning a starter template. Both exercise
 * pickers searched the user's own catalog and nothing else, so a free-typed
 * movement was written with `muscles: []` and stayed permanently unattributed,
 * which is what the weekly cluster audit's `unattributed` line was reporting.
 */
import { describe, it, expect } from 'vitest';
import {
  EXERCISE_LIBRARY,
  findSeedExerciseByName,
  searchExerciseLibrary,
  seedExerciseName,
} from './workout-seed';

describe('the library itself', () => {
  it('has a stable unique key per movement', () => {
    const keys = EXERCISE_LIBRARY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('attributes every non-mobility movement to at least one muscle', () => {
    // This is the whole point of routing creation through the library: a
    // movement with no muscles can never be counted by `weeklyClusterAudit`.
    const unattributed = EXERCISE_LIBRARY.filter(
      (e) => e.logStyle !== 'time' && e.muscles.length === 0,
    );
    expect(unattributed.map((e) => e.key)).toEqual([]);
  });
});

describe('searchExerciseLibrary', () => {
  it('ranks a word prefix first — nothing in the library is called just "Bench"', () => {
    // The entries are "Barbell Bench Press" and "Dumbbell Bench Press", so a
    // whole-string prefix alone would leave the most obvious three-letter
    // query in the app ranked by nothing at all.
    const hits = searchExerciseLibrary('bench', 'en');
    expect(hits.length).toBeGreaterThan(0);
    expect(/(^|[\s-])bench/.test(hits[0].name.toLowerCase())).toBe(true);
  });

  it('ranks a whole-name prefix above a word-prefix match', () => {
    const hits = searchExerciseLibrary('barbell', 'en');
    expect(hits[0].name.toLowerCase().startsWith('barbell')).toBe(true);
  });

  it('finds the English name even under another locale', () => {
    // Someone with a Spanish UI still types the name they learned in the gym.
    const hits = searchExerciseLibrary('Barbell Bench Press', 'es-PR');
    expect(hits.map((e) => e.key)).toContain('barbell-bench-press');
  });

  it('finds the localized name', () => {
    const ex = EXERCISE_LIBRARY.find((e) => e.key === 'barbell-bench-press')!;
    const localized = seedExerciseName(ex, 'es-PR');
    const hits = searchExerciseLibrary(localized, 'es-PR');
    expect(hits.map((e) => e.key)).toContain('barbell-bench-press');
  });

  it('hides entries the catalog already holds', () => {
    const exclude = new Set(['barbell-bench-press']);
    const hits = searchExerciseLibrary('bench', 'en', { exclude });
    expect(hits.map((e) => e.key)).not.toContain('barbell-bench-press');
  });

  it('browses with an empty query and honours the limit', () => {
    expect(searchExerciseLibrary('', 'en', { limit: 5 })).toHaveLength(5);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchExerciseLibrary('zzzzz', 'en')).toEqual([]);
  });
});

describe('findSeedExerciseByName', () => {
  it('matches an exact name, ignoring case and surrounding space', () => {
    expect(findSeedExerciseByName('  barbell bench press ', 'en')?.key)
      .toBe('barbell-bench-press');
  });

  it('matches the localized name too', () => {
    const ex = EXERCISE_LIBRARY.find((e) => e.key === 'barbell-bench-press')!;
    expect(findSeedExerciseByName(seedExerciseName(ex, 'es-PR'), 'es-PR')?.key)
      .toBe('barbell-bench-press');
  });

  it('refuses a partial match', () => {
    // A fuzzy match here would attach the wrong muscle group to a movement the
    // user named deliberately, and do it silently.
    expect(findSeedExerciseByName('bench', 'en')).toBeUndefined();
    expect(findSeedExerciseByName('', 'en')).toBeUndefined();
  });
});
