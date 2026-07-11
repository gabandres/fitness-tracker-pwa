import { describe, expect, it } from 'vitest';
import { toWorkoutExercise, toWorkoutTemplate, toWorkoutSession } from './workout-mappers';

/** Minimal Firestore-Timestamp stand-in (structural TimestampLike). */
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('toWorkoutExercise', () => {
  it('copies fields and converts createdAt', () => {
    const ex = toWorkoutExercise('e1', {
      name: 'Bench',
      muscles: ['chest'],
      defaultCues: ['brace'],
      logStyle: 'weight-reps',
      seedKey: 'bench',
      createdAt: ts('2026-06-01T00:00:00Z'),
    });
    expect(ex).toEqual({
      id: 'e1',
      name: 'Bench',
      muscles: ['chest'],
      defaultCues: ['brace'],
      logStyle: 'weight-reps',
      seedKey: 'bench',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });
  });

  it('falls back to epoch for a missing createdAt rather than throwing', () => {
    expect(toWorkoutExercise('e2', { name: 'Row' }).createdAt).toEqual(new Date(0));
  });
});

describe('toWorkoutTemplate', () => {
  it('maps timestamps and leaves plannedSets un-normalized (web normalizes, mobile does not)', () => {
    const t = toWorkoutTemplate('t1', {
      name: 'Push',
      exercises: [
        // Deliberately messy group numbering — the shared mapper must NOT touch it.
        { exerciseId: 'e1', name: 'Bench', plannedSets: [{ kind: 'working', group: 5 }] },
      ],
      createdAt: ts('2026-06-02T00:00:00Z'),
      updatedAt: ts('2026-06-03T00:00:00Z'),
    });
    expect(t.createdAt).toEqual(new Date('2026-06-02T00:00:00Z'));
    expect(t.updatedAt).toEqual(new Date('2026-06-03T00:00:00Z'));
    expect(t.exercises[0].plannedSets).toEqual([{ kind: 'working', group: 5 }]);
  });
});

describe('toWorkoutSession', () => {
  it('reads date from the `timestamp` field and passes sets through unchanged', () => {
    const s = toWorkoutSession('s1', {
      status: 'completed',
      templateName: 'Push',
      timestamp: ts('2026-06-04T12:00:00Z'),
      exercises: [{ exerciseId: 'e1', name: 'Bench', cues: [], sets: [{ kind: 'working', group: 9 }] }],
      createdAt: ts('2026-06-04T12:00:00Z'),
      updatedAt: ts('2026-06-04T13:00:00Z'),
    });
    expect(s.status).toBe('completed');
    expect(s.date).toEqual(new Date('2026-06-04T12:00:00Z'));
    expect(s.exercises[0].sets).toEqual([{ kind: 'working', group: 9 }]);
  });
});
