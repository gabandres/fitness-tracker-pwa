/**
 * ADR-0040 readers for the two structures built on `continuation`:
 * rest-pause (total reps across the set) and cluster sets (completion against
 * a prescription). Both deliberately ignore the myo-reps first-mini rule — a
 * rest-pause continuation is SUPPOSED to be short, and a cluster block is not
 * autoregulated at all.
 */
import { describe, it, expect } from 'vitest';
import { recommend } from './progression-engine';
import type { SessionExercise, WorkoutSet } from './workout';

/** activation + continuations at one load. `reps` are what was performed. */
const block = (load: number, ...reps: number[]): SessionExercise => ({
  exerciseId: 'rp', name: 'Rest-pause lift', cues: [],
  sets: reps.map((r, i) => ({
    kind: i === 0 ? 'activation' : 'continuation', group: 1, weight: load, reps: r,
  }) as WorkoutSet),
});

/** A cluster block: each set carries the PRESCRIBED `targetReps`. */
const prescribed = (
  load: number,
  pairs: [performed: number, target: number][],
): SessionExercise => ({
  exerciseId: 'cs', name: 'Cluster lift', cues: [],
  sets: pairs.map(([reps, targetReps], i) => ({
    kind: i === 0 ? 'activation' : 'continuation', group: 1, weight: load, reps, targetReps,
  }) as WorkoutSet),
});

const RULE = { targetReps: 20, holdSessions: 2, incrementLb: 5 };

describe('rest-pause', () => {
  it('reads TOTAL reps across the activation and its continuations', () => {
    // 12 + 5 + 3 = 20, which is the target.
    const rec = recommend([block(100, 12, 5, 3), block(100, 12, 5, 3)], {
      structure: 'rest-pause', progression: RULE,
    });
    expect(rec.reason).toMatchObject({
      kind: 'rest-pause', total: 20, targetReps: 20, sessionsAtTarget: 2, holdSessions: 2,
    });
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(105);
  });

  it('builds while the total is short of target', () => {
    const rec = recommend([block(100, 10, 4, 2)], { structure: 'rest-pause', progression: RULE });
    expect(rec.reason).toMatchObject({ total: 16, sessionsAtTarget: 0 });
    expect(rec.action).toBe('build-reps');
  });

  it('does NOT apply the myo-reps first-mini rule', () => {
    // A first continuation of 6 is `first-mini-too-many` under myo-reps. Here
    // it is just part of the total, and a correct rest-pause set.
    const rec = recommend([block(100, 14, 6, 2), block(100, 14, 6, 2)], {
      structure: 'rest-pause', progression: RULE,
    });
    expect(rec.reason.kind).toBe('rest-pause');
    expect(rec.action).toBe('add-load');
  });

  it('restarts the run when the load changes', () => {
    const rec = recommend([block(100, 12, 5, 3), block(95, 12, 5, 3)], {
      structure: 'rest-pause', progression: RULE,
    });
    expect(rec.reason).toMatchObject({ sessionsAtTarget: 1 });
    expect(rec.action).toBe('build-reps');
  });

  it('says so when no total target is prescribed', () => {
    expect(recommend([block(100, 12, 5, 3)], { structure: 'rest-pause' }).reason)
      .toEqual({ kind: 'no-rule' });
  });

  it('refuses a log with no activation or continuation sets', () => {
    const straightLog: SessionExercise = {
      exerciseId: 'rp', name: 'X', cues: [],
      sets: [{ kind: 'working', weight: 100, reps: 8 }],
    };
    expect(recommend([straightLog], { structure: 'rest-pause', progression: RULE }).reason)
      .toEqual({ kind: 'nothing-to-read' });
  });

  it('never counts a mini set — that kind belongs to myo-reps', () => {
    const withMini: SessionExercise = {
      exerciseId: 'rp', name: 'X', cues: [],
      sets: [
        { kind: 'activation', group: 1, weight: 100, reps: 12 },
        { kind: 'mini', group: 1, weight: 100, reps: 99 },
      ],
    };
    // The 99-rep mini must not reach the total, or a myo-reps log would
    // silently satisfy a rest-pause target.
    expect(recommend([withMini], { structure: 'rest-pause', progression: RULE }).reason)
      .toMatchObject({ total: 12 });
  });
});

describe('cluster sets', () => {
  it('reads completion against the prescription, not a rep band', () => {
    const done = prescribed(100, [[5, 5], [5, 5], [5, 5]]);
    const rec = recommend([done, done], {
      structure: 'cluster', progression: { holdSessions: 2, incrementLb: 5, targetReps: 5 },
    });
    expect(rec.reason).toMatchObject({
      kind: 'cluster-sets', completed: 3, blocks: 3, sessionsAtTarget: 2,
    });
    expect(rec.action).toBe('add-load');
  });

  it('is not satisfied when one block fell short', () => {
    const partial = prescribed(100, [[5, 5], [5, 5], [3, 5]]);
    const rec = recommend([partial, partial], {
      structure: 'cluster', progression: { holdSessions: 2, incrementLb: 5, targetReps: 5 },
    });
    expect(rec.reason).toMatchObject({ completed: 2, blocks: 3, sessionsAtTarget: 0 });
    expect(rec.action).toBe('build-reps');
  });

  it('counts overshoot as completed — the prescription is a floor', () => {
    const over = prescribed(100, [[7, 5], [6, 5], [5, 5]]);
    const rec = recommend([over, over], {
      structure: 'cluster', progression: { holdSessions: 2, incrementLb: 5, targetReps: 5 },
    });
    expect(rec.reason).toMatchObject({ completed: 3, blocks: 3 });
    expect(rec.action).toBe('add-load');
  });

  it('says no-rule when the blocks carry no prescribed reps', () => {
    // Logged, but nothing prescribed: a cluster set is DEFINED by its
    // prescription, so there is no completion to judge.
    expect(recommend([block(100, 5, 5, 5)], { structure: 'cluster' }).reason)
      .toEqual({ kind: 'no-rule' });
  });

  it('says nothing-to-read when no block was logged at all', () => {
    const straightLog: SessionExercise = {
      exerciseId: 'cs', name: 'X', cues: [], sets: [{ kind: 'working', weight: 100, reps: 8 }],
    };
    expect(recommend([straightLog], { structure: 'cluster' }).reason)
      .toEqual({ kind: 'nothing-to-read' });
  });

  it('restarts the run when the load changes', () => {
    const rec = recommend([
      prescribed(100, [[5, 5], [5, 5]]),
      prescribed(95, [[5, 5], [5, 5]]),
    ], { structure: 'cluster', progression: { holdSessions: 2, incrementLb: 5, targetReps: 5 } });
    expect(rec.reason).toMatchObject({ sessionsAtTarget: 1 });
    expect(rec.action).toBe('build-reps');
  });
});

describe('the two readers stay out of each other', () => {
  it('the same log reads differently under each structure, by design', () => {
    const log = [prescribed(100, [[5, 5], [5, 5], [5, 5]]), prescribed(100, [[5, 5], [5, 5], [5, 5]])];
    const asCluster = recommend(log, {
      structure: 'cluster', progression: { holdSessions: 2, incrementLb: 5, targetReps: 5 },
    });
    const asRestPause = recommend(log, {
      structure: 'rest-pause', progression: { targetReps: 20, holdSessions: 2, incrementLb: 5 },
    });
    expect(asCluster.reason.kind).toBe('cluster-sets');
    expect(asCluster.action).toBe('add-load');
    // Same sets, total 15 against a 20 target: not held.
    expect(asRestPause.reason).toMatchObject({ kind: 'rest-pause', total: 15 });
    expect(asRestPause.action).toBe('build-reps');
  });
});
