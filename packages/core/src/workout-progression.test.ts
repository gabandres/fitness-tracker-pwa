import { describe, expect, it } from 'vitest';
import {
  computeExercisePRs,
  estimateOneRepMax,
  keySet,
  keySets,
  metricForSet,
  prMetricFor,
  suggestProgression,
} from './workout-progression';
import type { LogStyle, ProgressionRule, SessionExercise, WorkoutSet } from './workout';

/** Build a one-exercise history row for a given logStyle. */
function ex(logStyle: LogStyle, sets: WorkoutSet[]): SessionExercise {
  return { exerciseId: 'x', name: 'X', cues: [], logStyle, sets };
}

describe('workout-progression — logStyle', () => {
  it('keySet picks the first working set carrying the style metric', () => {
    expect(
      keySet(ex('weight-reps', [
        { kind: 'warmup', weight: 100, reps: 5 },
        { kind: 'working', weight: 50, reps: 8 },
      ]))?.weight,
    ).toBe(50);
    expect(keySet(ex('bodyweight', [{ kind: 'working', reps: 9 }]))?.reps).toBe(9);
    expect(keySet(ex('time', [{ kind: 'working', durationSec: 60 }]))?.durationSec).toBe(60);
    // A reps-only set is NOT a key set under weight-reps (needs both).
    expect(keySet(ex('weight-reps', [{ kind: 'working', reps: 9 }]))).toBeNull();
  });

  it('computeExercisePRs reports weight, e1RM, reps, and duration', () => {
    const prs = computeExercisePRs([
      ex('weight-reps', [
        { kind: 'working', weight: 100, reps: 5 },
        { kind: 'working', reps: 12 },
        { kind: 'working', durationSec: 75 },
        { kind: 'warmup', weight: 500, reps: 1 }, // ignored
      ]),
    ]);
    expect(prs.maxWeight).toBe(100);
    expect(prs.maxReps).toBe(12);
    expect(prs.maxDurationSec).toBe(75);
    expect(prs.bestE1RM).toBeGreaterThan(100);
  });

  it('metricForSet selects the comparable metric per logStyle', () => {
    expect(metricForSet({ kind: 'working', durationSec: 45 }, 'time')).toBe(45);
    expect(metricForSet({ kind: 'working', reps: 12 }, 'bodyweight')).toBe(12);
    expect(metricForSet({ kind: 'working', weight: 100, reps: 5 }, 'weight-reps')).toBe(
      estimateOneRepMax(100, 5),
    );
    // Missing metric → 0 (callers gate on > 0), for every style.
    expect(metricForSet({ kind: 'working' }, 'time')).toBe(0);
    expect(metricForSet({ kind: 'working' }, 'bodyweight')).toBe(0);
    expect(metricForSet({ kind: 'working', weight: 100 }, 'weight-reps')).toBe(0);
  });

  it('prMetricFor picks the maximum comparable to metricForSet', () => {
    const prs = computeExercisePRs([
      ex('weight-reps', [
        { kind: 'working', weight: 100, reps: 5 },
        { kind: 'working', reps: 12 },
        { kind: 'working', durationSec: 75 },
      ]),
    ]);
    expect(prMetricFor(prs, 'time')).toBe(prs.maxDurationSec);
    expect(prMetricFor(prs, 'bodyweight')).toBe(prs.maxReps);
    expect(prMetricFor(prs, 'weight-reps')).toBe(prs.bestE1RM);
    // A set beating the best e1RM is a PR under the shared comparison.
    const better = { kind: 'working' as const, weight: 120, reps: 6 };
    expect(metricForSet(better, 'weight-reps') > prMetricFor(prs, 'weight-reps')).toBe(true);
  });

  it('weight-reps bumps the load when the threshold holds', () => {
    const rule: ProgressionRule = { targetReps: 8, holdSessions: 2, incrementLb: 5 };
    const hist = [
      ex('weight-reps', [{ kind: 'working', weight: 100, reps: 8 }]),
      ex('weight-reps', [{ kind: 'working', weight: 100, reps: 8 }]),
    ];
    const s = suggestProgression(hist, rule, 'weight-reps');
    expect(s.bumped).toBe(true);
    expect(s.suggestedWeight).toBe(105);
  });

  it('bodyweight and time never auto-bump but surface the last metric', () => {
    const rule: ProgressionRule = { targetReps: 8, holdSessions: 1, incrementLb: 5 };
    const bw = suggestProgression([ex('bodyweight', [{ kind: 'working', reps: 12 }])], rule, 'bodyweight');
    expect(bw.bumped).toBe(false);
    expect(bw.lastReps).toBe(12);

    const tm = suggestProgression([ex('time', [{ kind: 'working', durationSec: 90 }])], rule, 'time');
    expect(tm.bumped).toBe(false);
    expect(tm.lastDurationSec).toBe(90);
  });

  it('defaults a missing logStyle to weight-reps', () => {
    const row: SessionExercise = { exerciseId: 'x', name: 'X', cues: [], sets: [{ kind: 'working', weight: 60, reps: 10 }] };
    expect(keySet(row)?.weight).toBe(60);
  });
});

describe('workout-progression — every activation must hold, not just the first', () => {
  const rule: ProgressionRule = { targetReps: 11, holdSessions: 2, incrementLb: 5 };

  /** A clustered session: one activation per cluster, minis between. */
  const clustered = (...activations: { reps: number; rir?: number }[]): SessionExercise =>
    ex(
      'weight-reps',
      activations.flatMap((a, i) => [
        { kind: 'activation' as const, group: i + 1, weight: 50, reps: a.reps, ...(a.rir != null ? { rir: a.rir } : {}) },
        { kind: 'mini' as const, group: i + 1, weight: 50, reps: 5 },
      ]),
    );

  it('keySets returns one set for straight sets and single clusters', () => {
    expect(keySets(ex('weight-reps', [{ kind: 'working', weight: 50, reps: 8 }]))).toHaveLength(1);
    expect(keySets(clustered({ reps: 11, rir: 1 }))).toHaveLength(1);
    // …and keySet stays the first of them, so existing callers are unchanged.
    expect(keySet(clustered({ reps: 11, rir: 1 }))?.reps).toBe(11);
  });

  it('returns every activation for a multi-cluster lift', () => {
    const two = clustered({ reps: 11, rir: 1 }, { reps: 6, rir: 2 });
    expect(keySets(two).map((s) => s.reps)).toEqual([11, 6]);
    expect(keySet(two)?.reps).toBe(11);
  });

  it('does not bump when a later cluster failed the threshold', () => {
    // The 2026-08-26 shoulder press shape: C1 clears, C2 collapses.
    const hist = [
      clustered({ reps: 11, rir: 1 }, { reps: 6, rir: 2 }),
      clustered({ reps: 11, rir: 1 }, { reps: 6, rir: 2 }),
    ];
    expect(suggestProgression(hist, rule, 'weight-reps').bumped).toBe(false);
  });

  it('still bumps when BOTH clusters clear', () => {
    const hist = [
      clustered({ reps: 11, rir: 1 }, { reps: 12, rir: 1 }),
      clustered({ reps: 12, rir: 2 }, { reps: 11, rir: 1 }),
    ];
    const s = suggestProgression(hist, rule, 'weight-reps');
    expect(s.bumped).toBe(true);
    expect(s.suggestedWeight).toBe(55);
  });
});

describe('workout-progression — an unreadable activation blocks the recommendation', () => {
  const rule: ProgressionRule = { targetReps: 11, holdSessions: 2, incrementLb: 5 };
  const act = (reps: number, rir?: number): SessionExercise =>
    ex('weight-reps', [
      { kind: 'activation', group: 1, weight: 50, reps, ...(rir != null ? { rir } : {}) },
      { kind: 'mini', group: 1, weight: 50, reps: 5 },
    ]);

  it('refuses to recommend a load off an activation above the RIR band', () => {
    const s = suggestProgression([act(12, 5), act(12, 5)], rule, 'weight-reps');
    expect(s.bumped).toBe(false);
    expect(s.blockedBy).toBe('rir-too-easy');
    // The load is still surfaced as the ghost — we withhold the claim, not the fact.
    expect(s.suggestedWeight).toBe(50);
    expect(s.lastReps).toBe(12);
  });

  it('refuses when the activation was taken to failure', () => {
    const s = suggestProgression([act(12, 0), act(12, 0)], rule, 'weight-reps');
    expect(s.bumped).toBe(false);
    expect(s.blockedBy).toBe('rir-to-failure');
  });

  it('still bumps inside the band', () => {
    const s = suggestProgression([act(12, 1), act(12, 3)], rule, 'weight-reps');
    expect(s.bumped).toBe(true);
    expect(s.blockedBy).toBeUndefined();
  });

  it('does NOT block when RIR was simply never logged', () => {
    // Most users log no RIR at all. Absence of a measurement is not a
    // measurement, and blocking here would switch progression off for them.
    const s = suggestProgression([act(12), act(12)], rule, 'weight-reps');
    expect(s.bumped).toBe(true);
    expect(s.blockedBy).toBeUndefined();
  });

  it('leaves straight-set users entirely alone', () => {
    const straight = (rir: number) =>
      ex('weight-reps', [{ kind: 'working', weight: 100, reps: 12, rir }]);
    expect(suggestProgression([straight(0), straight(0)], rule, 'weight-reps').bumped).toBe(true);
    expect(suggestProgression([straight(5), straight(5)], rule, 'weight-reps').bumped).toBe(true);
  });
});
