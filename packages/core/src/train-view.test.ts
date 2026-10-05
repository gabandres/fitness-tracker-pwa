import { describe, expect, it } from 'vitest';
import type { SessionExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';
import {
  bestE1RMByExercise,
  dropEmptyExercises,
  exerciseHistory,
  exerciseIsFullyDone,
  exerciseSeries,
  finishSummary,
  improvedExercises,
  lastPerformed,
  moveExercise,
  sessionCounts,
  sessionHasLoggedWork,
  sessionVolume,
  setBeatsBest,
  templateCounts,
  trainHeroStats,
  workingSetCells,
} from './train-view';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 7, 9, 12, 0).getTime();

function set(s: Partial<WorkoutSet> = {}): WorkoutSet {
  return { kind: 'working', ...s };
}

function ex(exerciseId: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise {
  return { exerciseId, name: exerciseId, cues: [], sets, ...extra };
}

function session(daysAgo: number, exercises: SessionExercise[]): WorkoutSession {
  const date = new Date(NOW - daysAgo * DAY);
  return { status: 'completed', date, exercises, createdAt: date, updatedAt: date };
}

describe('sessionVolume', () => {
  it('sums weight×reps and rounds', () => {
    expect(
      sessionVolume({
        exercises: [ex('bench', [set({ weight: 135, reps: 8 }), set({ weight: 145, reps: 5 })])],
      }),
    ).toBe(135 * 8 + 145 * 5);
  });

  it('ignores sets missing either number', () => {
    expect(
      sessionVolume({
        exercises: [ex('bench', [set({ weight: 135 }), set({ reps: 8 }), set({})])],
      }),
    ).toBe(0);
  });
});

describe('trainHeroStats', () => {
  it('counts only the trailing seven days, but takes the top set from all time', () => {
    const stats = trainHeroStats(
      [
        session(1, [ex('bench', [set({ weight: 135, reps: 8 })])]),
        session(6, [ex('bench', [set({ weight: 145, reps: 5 })])]),
        session(40, [ex('bench', [set({ weight: 225, reps: 1 })])]), // outside the week
      ],
      NOW,
    );
    expect(stats.count).toBe(2);
    expect(stats.volume).toBe(135 * 8 + 145 * 5);
    expect(stats.topSet).toBe(225);
  });

  it('excludes warm-ups from the top set — a heavy warm-up is not a PR', () => {
    const stats = trainHeroStats(
      [session(1, [ex('squat', [set({ kind: 'warmup', weight: 315, reps: 1 }), set({ weight: 185, reps: 5 })])])],
      NOW,
    );
    expect(stats.topSet).toBe(185);
  });

  it('is all zeros with no sessions', () => {
    expect(trainHeroStats([], NOW)).toEqual({ count: 0, volume: 0, topSet: 0 });
  });

  it('includes a session exactly on the seven-day edge', () => {
    const stats = trainHeroStats([session(7, [ex('row', [set({ weight: 100, reps: 10 })])])], NOW);
    expect(stats.count).toBe(1);
  });
});

describe('bestE1RMByExercise / improvedExercises', () => {
  const before = [session(2, [ex('bench', [set({ weight: 135, reps: 8 })])])];
  const after = [...before, session(0, [ex('bench', [set({ weight: 155, reps: 8 })])])];

  it('keys best estimated-1RM by exercise id across sessions', () => {
    const map = bestE1RMByExercise(after);
    expect(Object.keys(map)).toEqual(['bench']);
    expect(map.bench).toBeGreaterThan(bestE1RMByExercise(before).bench);
  });

  it('names the exercise that improved', () => {
    expect(improvedExercises(bestE1RMByExercise(before), bestE1RMByExercise(after))).toEqual([
      'bench',
    ]);
  });

  it('reports nothing when the best is unchanged or worse', () => {
    expect(improvedExercises(bestE1RMByExercise(after), bestE1RMByExercise(after))).toEqual([]);
    expect(improvedExercises(bestE1RMByExercise(after), bestE1RMByExercise(before))).toEqual([]);
  });

  it('treats a first-ever exercise as an improvement — callers must skip the first snapshot', () => {
    expect(improvedExercises({}, { bench: 170 })).toEqual(['bench']);
  });
});

describe('exerciseHistory + exerciseSeries', () => {
  const sessions = [
    session(0, [ex('bench', [set({ weight: 155, reps: 5 })]), ex('row', [set({ weight: 100, reps: 10 })])]),
    session(3, [ex('row', [set({ weight: 95, reps: 10 })])]),
    session(7, [ex('bench', [set({ weight: 135, reps: 5 })])]),
  ];

  it('pulls one exercise out of the sessions that contain it, keeping their order', () => {
    const rows = exerciseHistory(sessions, 'bench');
    expect(rows.length).toBe(2);
    expect(rows[0].sets[0].weight).toBe(155);
  });

  it('returns the series oldest-first for the chart', () => {
    const pts = exerciseSeries(exerciseHistory(sessions, 'bench'), 'weight-reps');
    expect(pts.length).toBe(2);
    expect(pts[0]).toBeLessThan(pts[1]); // 135×5 then 155×5
  });

  it('drops a session with no working set rather than plotting a zero', () => {
    const pts = exerciseSeries(
      [
        ex('bench', [set({ kind: 'warmup', weight: 95, reps: 5 })]),
        ex('bench', [set({ weight: 135, reps: 5 })]),
      ],
      'weight-reps',
    );
    expect(pts.length).toBe(1);
  });

  it('plots reps for bodyweight and seconds for time', () => {
    expect(exerciseSeries([ex('pullup', [set({ reps: 12 })])], 'bodyweight')).toEqual([12]);
    expect(exerciseSeries([ex('plank', [set({ durationSec: 90 })])], 'time')).toEqual([90]);
  });
});

describe('workingSetCells', () => {
  it('formats by log style and skips warm-ups', () => {
    const rows = ex('bench', [
      set({ kind: 'warmup', weight: 95, reps: 5 }),
      set({ weight: 135, reps: 8 }),
      set({ weight: 145, reps: 5 }),
    ]);
    expect(workingSetCells(rows, 'weight-reps')).toEqual(['135×8', '145×5']);
  });

  it('drops sets missing the numbers their style needs', () => {
    const rows = ex('bench', [set({ weight: 135 }), set({ reps: 8 })]);
    expect(workingSetCells(rows, 'weight-reps')).toEqual([]);
    expect(workingSetCells(rows, 'bodyweight')).toEqual(['8']);
  });

  it('formats seconds for time', () => {
    expect(workingSetCells(ex('plank', [set({ durationSec: 45 })]), 'time')).toEqual(['45s']);
  });
});

describe('lastPerformed', () => {
  it('shapes by log style', () => {
    expect(lastPerformed({ lastWeight: 135, lastReps: 8, lastDurationSec: undefined }, 'weight-reps')).toEqual({
      style: 'weight-reps',
      weight: 135,
      reps: 8,
    });
    expect(lastPerformed({ lastWeight: undefined, lastReps: 12, lastDurationSec: undefined }, 'bodyweight')).toEqual({
      style: 'bodyweight',
      reps: 12,
    });
    expect(lastPerformed({ lastWeight: undefined, lastReps: undefined, lastDurationSec: 60 }, 'time')).toEqual({
      style: 'time',
      durationSec: 60,
    });
  });

  it('is null when the record is incomplete', () => {
    expect(lastPerformed({ lastWeight: 135, lastReps: undefined, lastDurationSec: undefined }, 'weight-reps')).toBeNull();
    expect(lastPerformed({ lastWeight: undefined, lastReps: undefined, lastDurationSec: undefined }, 'time')).toBeNull();
  });
});

describe('exerciseIsFullyDone', () => {
  it('is true only when every set carries its style’s count', () => {
    expect(exerciseIsFullyDone(ex('bench', [set({ reps: 8 }), set({ reps: 5 })]))).toBe(true);
    expect(exerciseIsFullyDone(ex('bench', [set({ reps: 8 }), set({})]))).toBe(false);
  });

  it('is false for an exercise with no sets', () => {
    expect(exerciseIsFullyDone(ex('bench', []))).toBe(false);
  });

  it('uses duration for a time exercise', () => {
    const plank = ex('plank', [set({ durationSec: 60 })], { logStyle: 'time' });
    expect(exerciseIsFullyDone(plank)).toBe(true);
    expect(exerciseIsFullyDone(ex('plank', [set({ reps: 5 })], { logStyle: 'time' }))).toBe(false);
  });
});

describe('sessionCounts / templateCounts', () => {
  it('counts logged sets only', () => {
    expect(
      sessionCounts({
        exercises: [
          ex('bench', [set({ reps: 8 }), set({ reps: 5 }), set({})]),
          ex('row', [set({ reps: 10 })]),
        ],
      }),
    ).toEqual({ exercises: 2, sets: 3 });
  });

  it('counts a template’s planned scaffold', () => {
    const tpl = {
      exercises: [
        { exerciseId: 'bench', plannedSets: [{ kind: 'working' }, { kind: 'working' }] },
        { exerciseId: 'row', plannedSets: [{ kind: 'working' }] },
      ],
    } as unknown as WorkoutTemplate;
    expect(templateCounts(tpl)).toEqual({ exercises: 2, sets: 3 });
  });
});

describe('sessionHasLoggedWork', () => {
  it('is false for a template started and never touched', () => {
    expect(sessionHasLoggedWork({ exercises: [ex('bench', [set({ weight: 135 }), set({})])] })).toBe(false);
  });

  it('is true once one set carries its count', () => {
    expect(sessionHasLoggedWork({ exercises: [ex('bench', [set({}), set({ reps: 5 })])] })).toBe(true);
  });

  it('reads a timed lift by duration, not reps', () => {
    const hold = ex('plank', [set({ durationSec: 45 })], { logStyle: 'time' });
    expect(sessionHasLoggedWork({ exercises: [hold] })).toBe(true);
  });

  it('counts a performed cardio block, and not a prescribed one', () => {
    const run = { modality: 'run' as const, durationSec: 1800, source: 'manual' as const };
    const planned = { modality: 'run' as const, durationSec: 0, targetDurationSec: 1800, source: 'manual' as const };
    expect(sessionHasLoggedWork({ exercises: [], cardio: [run] })).toBe(true);
    expect(sessionHasLoggedWork({ exercises: [], cardio: [planned] })).toBe(false);
  });
});

describe('dropEmptyExercises', () => {
  it('drops exercises with no sets and keeps the order of the rest', () => {
    const out = dropEmptyExercises([ex('a', [set({ reps: 5 })]), ex('b', []), ex('c', [set({ reps: 3 })])]);
    expect(out.map((e) => e.exerciseId)).toEqual(['a', 'c']);
  });

  it('returns the same array when nothing is empty', () => {
    const list = [ex('a', [set({ reps: 5 })])];
    expect(dropEmptyExercises(list)).toBe(list);
  });
});

describe('moveExercise', () => {
  const list = ['a', 'b', 'c'];
  it('moves rather than swaps', () => {
    expect(moveExercise(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveExercise(list, 2, 1)).toEqual(['a', 'c', 'b']);
  });

  it('returns the input for a no-op or an out-of-range index', () => {
    expect(moveExercise(list, 1, 1)).toBe(list);
    expect(moveExercise(list, 0, -1)).toBe(list);
    expect(moveExercise(list, 2, 3)).toBe(list);
  });
});

describe('setBeatsBest', () => {
  it('is true only for a working set strictly over the best', () => {
    // Epley: 100 x 5 = 116.7; 100 x 6 = 120.
    expect(setBeatsBest(set({ weight: 100, reps: 6 }), 'weight-reps', 117)).toBe(true);
    expect(setBeatsBest(set({ weight: 100, reps: 5 }), 'weight-reps', 120)).toBe(false);
  });

  it('never calls a first record, a warm-up, or a non-load style a PR', () => {
    expect(setBeatsBest(set({ weight: 300, reps: 5 }), 'weight-reps', undefined)).toBe(false);
    expect(setBeatsBest(set({ weight: 300, reps: 5 }), 'weight-reps', 0)).toBe(false);
    expect(setBeatsBest(set({ kind: 'warmup', weight: 300, reps: 5 }), 'weight-reps', 100)).toBe(false);
    expect(setBeatsBest(set({ reps: 30 }), 'bodyweight', 10)).toBe(false);
  });
});

describe('finishSummary', () => {
  const start = new Date(NOW - 47 * 60 * 1000);

  function live(exercises: SessionExercise[], extra: Partial<WorkoutSession> = {}): WorkoutSession {
    return { id: 'live', status: 'active', date: start, exercises, createdAt: start, updatedAt: start, ...extra };
  }

  it('reports duration, volume and logged sets', () => {
    const out = finishSummary(live([ex('bench', [set({ weight: 100, reps: 5 }), set({ weight: 100 })])]), [], NOW);
    expect(out.durationMin).toBe(47);
    expect(out.volume).toBe(500);
    expect(out.sets).toBe(1);
    expect(out.prs).toEqual([]);
    expect(out.previousVolume).toBeNull();
  });

  it('names the best set that beats every prior session', () => {
    const history = [session(3, [ex('bench', [set({ weight: 100, reps: 5 })])])];
    const out = finishSummary(
      live([ex('bench', [set({ weight: 100, reps: 6 }), set({ weight: 105, reps: 6 })], { name: 'Bench' })]),
      history,
      NOW,
    );
    expect(out.prs).toEqual([{ exerciseId: 'bench', name: 'Bench', weight: 105, reps: 6 }]);
  });

  it('compares volume with the last session of the same template only', () => {
    const other = { ...session(1, [ex('squat', [set({ weight: 200, reps: 5 })])]), templateId: 'legs' };
    const same = { ...session(4, [ex('bench', [set({ weight: 100, reps: 4 })])]), templateId: 'push' };
    const out = finishSummary(
      live([ex('bench', [set({ weight: 100, reps: 5 })])], { templateId: 'push' }),
      [other, same],
      NOW,
    );
    expect(out.previousVolume).toBe(400);
  });

  it('does not compare a reopened session with its own earlier copy', () => {
    const own = { ...session(0, [ex('bench', [set({ weight: 100, reps: 5 })])]), id: 'live', templateId: 'push' };
    const out = finishSummary(
      live([ex('bench', [set({ weight: 100, reps: 6 })])], { templateId: 'push' }),
      [own],
      NOW,
    );
    expect(out.previousVolume).toBeNull();
    expect(out.prs).toEqual([]);
  });
});
