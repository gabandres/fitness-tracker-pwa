import { describe, expect, it } from 'vitest';
import {
  RIR_MAX,
  clampRir,
  exerciseNameKey,
  fillMissingClusterLoads,
  findDuplicateExercise,
  type SessionExercise,
} from './workout';

const ex = (over: Partial<SessionExercise>): SessionExercise => ({
  exerciseId: 'x',
  name: 'Ex',
  cues: [],
  logStyle: 'weight-reps',
  sets: [],
  ...over,
});

describe('fillMissingClusterLoads', () => {
  it('heals a logged set with blank weight from its heaviest sibling', () => {
    const [out] = fillMissingClusterLoads([
      ex({
        sets: [
          { kind: 'activation', group: 1, reps: 4, rir: 0, weight: 0, done: true },
          { kind: 'mini', group: 1, reps: 4, weight: 20, done: true },
          { kind: 'mini', group: 1, reps: 4, weight: 20, done: true },
        ],
      }),
    ]);
    expect(out.sets[0].weight).toBe(20);
    expect(out.sets.map((s) => s.weight)).toEqual([20, 20, 20]);
  });

  it('treats missing (undefined) weight the same as 0', () => {
    const [out] = fillMissingClusterLoads([
      ex({ sets: [{ kind: 'working', reps: 8 }, { kind: 'working', reps: 8, weight: 45 }] }),
    ]);
    expect(out.sets[0].weight).toBe(45);
  });

  it('leaves an all-bodyweight exercise untouched (0 is correct)', () => {
    const input = [
      ex({ name: 'Plank', sets: [{ kind: 'working', reps: 60, weight: 0 }, { kind: 'working', reps: 40, weight: 0 }] }),
    ];
    const [out] = fillMissingClusterLoads(input);
    expect(out.sets.every((s) => (s.weight ?? 0) === 0)).toBe(true);
    expect(out).toBe(input[0]); // unchanged reference — no needless copy
  });

  it('fills a blank logged set with an explicit sibling 0 (bodyweight: 0 = no added load)', () => {
    // 2026-09-23 pull-up as stored: 0, 0, then a set whose load cell showed the
    // grey "0" placeholder and was never typed.
    const [out] = fillMissingClusterLoads([
      ex({
        sets: [
          { kind: 'activation', group: 1, reps: 10, rir: 0, weight: 0 },
          { kind: 'mini', group: 1, reps: 3, rir: 0, weight: 0 },
          { kind: 'mini', group: 1, reps: 2, rir: 0 },
        ],
      }),
    ]);
    expect(out.sets.map((s) => s.weight)).toEqual([0, 0, 0]);
  });

  it('never raises a lighter logged load to the heaviest (a drop set stays a drop set)', () => {
    const [out] = fillMissingClusterLoads([
      ex({ sets: [{ kind: 'activation', reps: 8, weight: 20 }, { kind: 'mini', reps: 3, weight: 15 }] }),
    ]);
    expect(out.sets.map((s) => s.weight)).toEqual([20, 15]);
  });

  it('leaves an exercise with no weight on any set unknown, not 0', () => {
    // 2026-09-24 Skull Crusher: a load was lifted, nobody recorded which.
    const input = [ex({ sets: [{ kind: 'activation', reps: 11, rir: 0 }, { kind: 'mini', reps: 4, rir: 0 }] })];
    const [out] = fillMissingClusterLoads(input);
    expect(out).toBe(input[0]);
    expect(out.sets.every((s) => s.weight === undefined)).toBe(true);
  });

  it('skips time and bodyweight log styles', () => {
    const timeEx = ex({ logStyle: 'time', sets: [{ kind: 'working', durationSec: 45 }, { kind: 'working', durationSec: 30, weight: 10 }] });
    const [out] = fillMissingClusterLoads([timeEx]);
    expect(out.sets[0].weight).toBeUndefined();
  });

  it('does not fill an unlogged scaffold set (no reps yet)', () => {
    const [out] = fillMissingClusterLoads([
      ex({ sets: [{ kind: 'working', weight: 0 }, { kind: 'working', reps: 5, weight: 30 }] }),
    ]);
    expect(out.sets[0].weight ?? 0).toBe(0); // untouched — nothing logged there
  });

  it('leaves fully-loaded exercises as the same reference', () => {
    const input = [ex({ sets: [{ kind: 'working', reps: 5, weight: 100 }] })];
    expect(fillMissingClusterLoads(input)[0]).toBe(input[0]);
  });
});

describe('clampRir', () => {
  it('rejects the reported rir=8 by clamping to the 0–5 ceiling', () => {
    expect(clampRir(8)).toBe(RIR_MAX);
    expect(clampRir(99)).toBe(RIR_MAX);
  });

  it('passes ordinary in-range values through untouched', () => {
    for (const v of [0, 1, 2, 3, 4, 5]) expect(clampRir(v)).toBe(v);
  });

  it('drops negatives, non-integers and junk rather than guessing', () => {
    for (const v of [-1, 2.5, Number.NaN, Infinity, '', 'hard', null, undefined, {}]) {
      expect(clampRir(v)).toBeUndefined();
    }
  });

  it('accepts numeric strings from a text input', () => {
    expect(clampRir('3')).toBe(3);
    expect(clampRir('7')).toBe(RIR_MAX);
  });
});

describe('exerciseNameKey / findDuplicateExercise', () => {
  it('collapses case and whitespace so trivial duplicates cannot be created', () => {
    expect(exerciseNameKey('Bench Press')).toBe(exerciseNameKey('bench press'));
    expect(exerciseNameKey('Bench  Press ')).toBe(exerciseNameKey('Bench Press'));
    expect(exerciseNameKey('Bench Press.')).toBe(exerciseNameKey('Bench Press'));
  });

  it('does NOT equate different movements', () => {
    expect(exerciseNameKey('Incline Dumbbell Press')).not.toBe(
      exerciseNameKey('Decline Dumbbell Press'),
    );
  });

  it('deliberately leaves the abbreviation case unmerged', () => {
    // "DB Incline Chest Press" vs "Incline Dumbbell Press" is the reported
    // fragmentation. Merging it needs fuzzy matching, and a false positive
    // destroys two exercises' history — so this stays a SUGGESTION problem.
    expect(exerciseNameKey('DB Incline Chest Press')).not.toBe(
      exerciseNameKey('Incline Dumbbell Press'),
    );
  });

  it('finds an existing catalog entry regardless of casing', () => {
    const catalog = [{ id: 'a', name: 'Bench Press' }, { id: 'b', name: 'Squat' }];
    expect(findDuplicateExercise('  bench   press ', catalog)?.id).toBe('a');
    expect(findDuplicateExercise('Overhead Press', catalog)).toBeUndefined();
    expect(findDuplicateExercise('   ', catalog)).toBeUndefined();
  });
});
