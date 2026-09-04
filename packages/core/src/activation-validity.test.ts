import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_RIR_MAX,
  ACTIVATION_RIR_MIN,
  activationIssue,
  blocksProgression,
  sessionActivationIssues,
} from './activation-validity';
import type { LogStyle, SessionExercise, WorkoutSet } from './workout';

const ex = (sets: WorkoutSet[], logStyle: LogStyle = 'weight-reps', id = 'x'): SessionExercise => ({
  exerciseId: id,
  name: id.toUpperCase(),
  cues: [],
  logStyle,
  sets,
});

const cluster = (rir?: number, reps = 11): WorkoutSet[] => [
  { kind: 'activation', group: 1, weight: 50, reps, ...(rir != null ? { rir } : {}) },
  { kind: 'mini', group: 1, weight: 50, reps: 6 },
  { kind: 'mini', group: 1, weight: 50, reps: 4 },
];

describe('activationIssue — the RIR band on activation sets', () => {
  it('accepts the whole prescribed band and nothing outside it', () => {
    for (let r = ACTIVATION_RIR_MIN; r <= ACTIVATION_RIR_MAX; r++) {
      expect(activationIssue(ex(cluster(r)))).toBeNull();
    }
    expect(activationIssue(ex(cluster(0)))).toBe('rir-to-failure');
    expect(activationIssue(ex(cluster(4)))).toBe('rir-too-easy');
    expect(activationIssue(ex(cluster(5)))).toBe('rir-too-easy');
  });

  it('reports a missing RIR without calling the set bad', () => {
    expect(activationIssue(ex(cluster(undefined)))).toBe('rir-missing');
    expect(blocksProgression('rir-missing')).toBe(false);
    expect(blocksProgression('rir-to-failure')).toBe(true);
    expect(blocksProgression('rir-too-easy')).toBe(true);
    expect(blocksProgression(null)).toBe(false);
  });

  it('does NOT apply the band to plain working sets', () => {
    // A straight set to failure is ordinary training, and a straight set with
    // reps to spare is exactly when double progression should add load.
    expect(activationIssue(ex([{ kind: 'working', weight: 50, reps: 12, rir: 0 }]))).toBeNull();
    expect(activationIssue(ex([{ kind: 'working', weight: 50, reps: 12, rir: 5 }]))).toBeNull();
  });

  it('inspects EVERY activation, so a clean C1 cannot mask a collapsed C2', () => {
    // The 2026-08-26 shoulder press: C1 11 @ RIR 1, C2 6 @ RIR 0.
    const twoCluster = ex([
      { kind: 'activation', group: 1, weight: 50, reps: 11, rir: 1 },
      { kind: 'mini', group: 1, weight: 50, reps: 7 },
      { kind: 'activation', group: 2, weight: 50, reps: 6, rir: 0 },
      { kind: 'mini', group: 2, weight: 50, reps: 2 },
    ]);
    expect(activationIssue(twoCluster)).toBe('rir-to-failure');
  });

  it('prefers a hard issue over a missing one', () => {
    const mixed = ex([
      { kind: 'activation', group: 1, weight: 50, reps: 11 }, // no rir
      { kind: 'activation', group: 2, weight: 50, reps: 6, rir: 5 },
    ]);
    expect(activationIssue(mixed)).toBe('rir-too-easy');
  });

  it('ignores activation rows that were never performed', () => {
    // An in-progress session's untouched scaffold is not a bad set.
    expect(activationIssue(ex([{ kind: 'activation', group: 1 }]))).toBeNull();
    expect(activationIssue(ex([{ kind: 'activation', group: 1, weight: 50 }]))).toBeNull();
  });

  it('judges a time exercise on its duration, not on reps', () => {
    const hold = ex([{ kind: 'activation', durationSec: 90, rir: 5 }], 'time');
    expect(activationIssue(hold)).toBe('rir-too-easy');
    // Unperformed: no duration recorded.
    expect(activationIssue(ex([{ kind: 'activation', rir: 5 }], 'time'))).toBeNull();
  });

  it('flags straight sets only when the template prescribed a cluster', () => {
    const straight = ex([{ kind: 'working', weight: 0, reps: 5 }]);
    expect(activationIssue(straight, { expectsCluster: true })).toBe('not-clustered');
    expect(activationIssue(straight, { expectsCluster: false })).toBeNull();
    expect(activationIssue(straight)).toBeNull();
    // Nothing logged yet is not a defect either.
    expect(activationIssue(ex([{ kind: 'working' }]), { expectsCluster: true })).toBeNull();
  });
});

describe('sessionActivationIssues — the session summary roll-up', () => {
  const template = {
    exercises: [
      { exerciseId: 'pullup', plannedSets: [{ kind: 'activation' }, { kind: 'mini' }] },
      { exerciseId: 'row', plannedSets: [{ kind: 'activation' }, { kind: 'mini' }] },
      { exerciseId: 'plank', plannedSets: [{ kind: 'working' }] },
    ],
  };

  it('lists every unreadable activation in performed order and nothing else', () => {
    const found = sessionActivationIssues(
      [
        ex(cluster(2), 'weight-reps', 'row'), // clean
        ex([{ kind: 'working', weight: 0, reps: 5 }], 'weight-reps', 'pullup'), // straight sets
        ex([{ kind: 'working', durationSec: 90 }], 'time', 'plank'), // by design
      ],
      template,
    );
    expect(found).toEqual([{ exerciseId: 'pullup', name: 'PULLUP', issue: 'not-clustered' }]);
  });

  it('works with no template, skipping only the not-clustered check', () => {
    const found = sessionActivationIssues([ex(cluster(5), 'weight-reps', 'row')], null);
    expect(found).toEqual([{ exerciseId: 'row', name: 'ROW', issue: 'rir-too-easy' }]);
  });

  it('returns an empty list for a clean session', () => {
    expect(sessionActivationIssues([ex(cluster(2), 'weight-reps', 'row')], template)).toEqual([]);
  });
});
