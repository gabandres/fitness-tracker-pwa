import { describe, it, expect } from 'vitest';
import { recommend } from './progression-engine';
import type { SessionExercise, SetStructure, WorkoutSet } from './workout';

/** A straight-sets session: N working sets at one load. */
const straight = (load: number, ...reps: number[]): SessionExercise => ({
  exerciseId: 'x', name: 'Barbell Bench Press', cues: [],
  sets: reps.map((r) => ({ kind: 'working', weight: load, reps: r }) as WorkoutSet),
});

/** A myo-reps session, for the "unchanged" guarantee. */
const myo = (load: number, activation: number, ...minis: number[]): SessionExercise => ({
  exerciseId: 'y', name: 'Seated cable row', cues: [],
  sets: [
    { kind: 'activation', group: 1, weight: load, reps: activation, rir: 0 },
    ...minis.map((r) => ({ kind: 'mini', group: 1, weight: load, reps: r, rir: 0 }) as WorkoutSet),
  ],
});

const RULE = { targetReps: 8, holdSessions: 2, incrementLb: 5 };

describe('ADR-0040 dispatch', () => {
  it('routes a declared myo-reps lift to the myo-reps reader, not the straight one', () => {
    const rec = recommend([myo(80, 12, 4, 3)], { structure: 'myoreps', progression: RULE });
    // The myo-reps path calibrates against a derived band; it never reports a
    // straight-sets reason, whatever the template's targetReps says.
    expect(rec.reason.kind).not.toBe('straight-sets');
    expect(['calibrating', 'invalid', 'at-target', 'below-band', 'under-band', 'over-band', 'jump-too-big'])
      .toContain(rec.reason.kind);
  });

  it('refuses every structure with no reader, and never falls through', () => {
    const unreadable: SetStructure[] = ['rest-pause', 'cluster', 'drop', 'superset', 'hit'];
    for (const structure of unreadable) {
      const rec = recommend([straight(135, 8, 8, 8)], { structure, progression: RULE });
      expect(rec.reason).toEqual({ kind: 'unsupported-structure', structure });
      expect(rec.action).toBe('none');
      // The refusal must not smuggle a number in through another field.
      expect(rec.load).toBeUndefined();
      expect(rec.band).toBeNull();
    }
  });

  it('infers when no structure is declared, exactly as the app did before', () => {
    expect(recommend([straight(135, 8, 8, 8)], { progression: RULE }).reason.kind).toBe('straight-sets');
    expect(recommend([myo(80, 12, 4, 3)], { progression: RULE }).reason.kind).not.toBe('straight-sets');
  });
});

describe('straight sets — double progression', () => {
  it('adds load once the target is held for holdSessions at a steady load', () => {
    const rec = recommend([straight(135, 8, 8, 8), straight(135, 8, 8, 8)], {
      structure: 'straight', progression: RULE,
    });
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(140);
    expect(rec.currentLoad).toBe(135);
    expect(rec.reason).toMatchObject({ kind: 'straight-sets', sessionsAtTarget: 2, holdSessions: 2, targetReps: 8 });
  });

  it('builds reps while the run is short of holdSessions', () => {
    const rec = recommend([straight(135, 8, 8, 8)], { structure: 'straight', progression: RULE });
    expect(rec.action).toBe('build-reps');
    expect(rec.load).toBe(135);
    expect(rec.reason).toMatchObject({ sessionsAtTarget: 1, holdSessions: 2 });
  });

  it('is bound by the WORST set, not the first or the best', () => {
    // 8, 8, 5 is not "the threshold was held" — the third set fell short.
    const rec = recommend([straight(135, 8, 8, 5), straight(135, 8, 8, 8)], {
      structure: 'straight', progression: RULE,
    });
    expect(rec.action).toBe('build-reps');
    expect(rec.reason).toMatchObject({ reps: 5, sessionsAtTarget: 0 });
  });

  it('breaks the run when the load was increased mid-history', () => {
    // Most-recent-first: 135 now, 130 before. The 130 sessions are a
    // different lift as far as double progression is concerned.
    const rec = recommend([straight(135, 8, 8, 8), straight(130, 8, 8, 8)], {
      structure: 'straight', progression: RULE,
    });
    expect(rec.reason).toMatchObject({ sessionsAtTarget: 1 });
    expect(rec.action).toBe('build-reps');
  });

  it('says so when the template states no rep target', () => {
    const rec = recommend([straight(135, 8, 8, 8)], { structure: 'straight' });
    expect(rec.reason).toEqual({ kind: 'no-rule' });
    expect(rec.action).toBe('none');
    expect(rec.currentLoad).toBe(135);
  });

  it('refuses to read a myo-reps-shaped log that was re-declared as straight', () => {
    const myoShaped: SessionExercise = {
      exerciseId: 'z', name: 'Switched lift', cues: [],
      sets: [
        { kind: 'activation', group: 1, weight: 80, reps: 12, rir: 0 },
        { kind: 'mini', group: 1, weight: 80, reps: 4, rir: 0 },
      ],
    };
    const rec = recommend([myoShaped], { structure: 'straight', progression: RULE });
    expect(rec.reason).toEqual({ kind: 'nothing-to-read' });
    expect(rec.action).toBe('none');
  });

  it('reports no-history on an empty history', () => {
    expect(recommend([], { structure: 'straight', progression: RULE }).reason).toEqual({ kind: 'no-history' });
  });

  it('refuses a load jump over the ceiling and builds reps instead', () => {
    // 20 lb with a 5 lb step is a 25% jump — over MAX_JUMP_PCT.
    const rec = recommend([straight(20, 8, 8), straight(20, 8, 8)], {
      structure: 'straight', progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 },
    });
    expect(rec.action).toBe('build-reps');
    expect(rec.reason.kind).toBe('jump-too-big');
  });

  it('steps through availableLoads when the equipment states them', () => {
    const rec = recommend([straight(135, 8, 8), straight(135, 8, 8)], {
      structure: 'straight', progression: RULE, availableLoads: [135, 155, 175],
    });
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(155);
  });

  it('never runs the mini rule: a 6-rep "first mini" is irrelevant here', () => {
    // Under myo-reps a first mini of 6 is `first-mini-too-many`. On straight
    // sets there is no mini, and this must read as three plain working sets.
    const rec = recommend([straight(135, 8, 8, 8), straight(135, 8, 8, 8)], {
      structure: 'straight', progression: RULE,
    });
    expect(rec.reason.kind).toBe('straight-sets');
    expect(rec.action).toBe('add-load');
  });
});
