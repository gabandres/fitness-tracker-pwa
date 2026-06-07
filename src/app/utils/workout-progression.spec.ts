import { describe, it, expect } from 'vitest';
import {
  keySet,
  computeExercisePRs,
  suggestProgression,
} from './workout-progression';
import type { LogStyle, ProgressionRule, SessionExercise, WorkoutSet } from '../models/workout';

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
