import { describe, expect, it } from 'vitest';
import { exerciseSupersetReport, isSupersetSession, sessionSupersetReport } from './superset-report';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';

const cluster = (g: number, w: number, act: number, m1: number, m2: number): WorkoutSet[] => [
  { kind: 'activation', group: g, weight: w, reps: act, rir: 0 },
  { kind: 'mini', group: g, weight: w, reps: m1, rir: 0 },
  { kind: 'mini', group: g, weight: w, reps: m2, rir: 0 },
];
const ext = (sets: WorkoutSet[], paired: boolean): SessionExercise => ({
  exerciseId: 'ext', name: 'Leg Extensions', cues: [], logStyle: 'weight-reps', sets,
  ...(paired ? { supersetGroup: 'A', pairPosition: 1 as const } : {}),
});
const curl = (paired: boolean): SessionExercise => ({
  exerciseId: 'curl', name: 'Leg Curls', cues: [], logStyle: 'weight-reps', sets: cluster(1, 90, 10, 4, 3),
  ...(paired ? { supersetGroup: 'A', pairPosition: 2 as const } : {}),
});
let n = 0;
const session = (day: string, durationMin: number, e: SessionExercise, paired = e.supersetGroup != null): WorkoutSession => ({
  id: `s${++n}`, status: 'completed', templateId: 'leg', templateName: 'Leg Day',
  date: new Date(`${day}T12:00:00Z`), createdAt: new Date(), updatedAt: new Date(),
  durationMin, exercises: [e, curl(paired)],
});

// Straight baseline: the last three straight sessions are at 90 lb — 12, 11, 10
// activation reps (avg 11.0), first minis 4, 4, 3 (avg 3.7), 60/62/58 min. An
// older straight session at 80 lb is the fourth and is NOT in the baseline.
const straight = [
  session('2026-09-15', 70, ext(cluster(1, 80, 14, 5, 4), false)),
  session('2026-09-22', 60, ext(cluster(1, 90, 10, 3, 3), false)),
  session('2026-09-29', 62, ext(cluster(1, 90, 11, 4, 3), false)),
  session('2026-10-06', 58, ext(cluster(1, 90, 12, 4, 3), false)),
];
// Superset sessions: 9 and 8 at 90 lb (2 and 3 under the 11.0 baseline at that
// load), and an INVALID read at 85 lb (first mini 7 > 5) that no straight
// session matches on load.
const sup = [
  session('2026-10-13', 48, ext(cluster(1, 90, 9, 3, 2), true)),
  session('2026-10-20', 50, ext(cluster(1, 90, 8, 3, 2), true)),
  session('2026-10-27', 52, ext(cluster(1, 85, 7, 7, 2), true)),
];

describe('exercise superset report', () => {
  const r = exerciseSupersetReport([...sup, ...straight], 'ext')!;

  it('compares the last three straight sessions with the superset sessions', () => {
    expect(r.straight).toEqual({ sessions: 3, activationRepsAvg: 11, firstMiniRepsAvg: 3.7, validityRate: 1, durationMinAvg: 60 });
    expect(r.superset).toEqual({ sessions: 3, activationRepsAvg: 8, firstMiniRepsAvg: 4.3, validityRate: 2 / 3, durationMinAvg: 50 });
    expect(r.delta).toEqual({ activationReps: -3, firstMiniReps: 0.6, validityRate: 2 / 3 - 1, durationMin: -10 });
  });

  it('flags 2+ superset sessions down 2+ reps at the same load — and ignores the one at a new load', () => {
    expect(r.costlySessions.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-20', '2026-10-13']);
    expect(r.flag).toBe(true);
  });

  it('one costly session is not a flag', () => {
    const one = exerciseSupersetReport([sup[0], sup[2], ...straight], 'ext')!;
    expect(one.costlySessions).toHaveLength(1);
    expect(one.flag).toBe(false);
  });

  it('a drop of exactly 1 rep is not a cost', () => {
    const mild = exerciseSupersetReport([session('2026-10-13', 50, ext(cluster(1, 90, 10, 3, 2), true)), ...straight], 'ext')!;
    expect(mild.costlySessions).toEqual([]);
  });

  it('null for an exercise never supersetted — nothing to compare', () => {
    expect(exerciseSupersetReport(straight, 'ext')).toBeNull();
  });
});

describe('session superset report', () => {
  it('compares the session\'s duration with the last three straight sessions of its template, and each paired lift at the same load', () => {
    const r = sessionSupersetReport([...straight, ...sup], sup[0])!;
    expect(r.durationMin).toBe(48);
    expect(r.straightSessions).toBe(3);
    expect(r.straightDurationMinAvg).toBe(60);
    expect(r.durationDeltaMin).toBe(-12);
    expect(r.exercises[0]).toEqual({ exerciseId: 'ext', name: 'Leg Extensions', label: 'A1', activationRepsAvg: 9, straightActivationRepsAvg: 11, deltaAtLoad: -2 });
    expect(r.exercises[1]).toMatchObject({ label: 'A2', activationRepsAvg: 10, straightActivationRepsAvg: 10, deltaAtLoad: 0 });
  });

  it('at a load no straight session used, the per-lift delta is unknown, not zero', () => {
    const r = sessionSupersetReport([...straight, ...sup], sup[2])!;
    expect(r.exercises[0].deltaAtLoad).toBeUndefined();
  });

  it('null for a straight session', () => {
    expect(isSupersetSession(straight[0])).toBe(false);
    expect(sessionSupersetReport(straight, straight[0])).toBeNull();
  });
});
