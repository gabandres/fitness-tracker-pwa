import { describe, expect, it } from 'vitest';
import { computeStreak } from './streak';
import { summarizeDays } from './day-summary';
import { setsMissingRir, trainedDayRows } from './train-view';
import { latestRotation, rotationVolume, volumeBetween } from './volume-credits';
import type { DailyLog } from './types';
import type { WorkoutSession } from './workout';

/** The owner's 2026-10-15 status check: bugs C, item 4, and the volume window. */

const d = (day: number, h = 7) => new Date(2026, 9, day, h);
const cluster = (reps: number, rir?: number) => [
  { kind: 'activation', group: 1, weight: 20, reps, done: true, ...(rir != null ? { rir } : {}) },
  { kind: 'mini', group: 1, weight: 20, reps: 4, done: true, ...(rir != null ? { rir } : {}) },
  { kind: 'mini', group: 1, weight: 20, reps: 3, done: true, ...(rir != null ? { rir } : {}) },
];
const session = (id: string, templateId: string | undefined, day: number, exercises: object[] = [], status = 'completed'): WorkoutSession =>
  ({ id, status, templateId, date: d(day), exercises, cardio: undefined } as unknown as WorkoutSession);

describe('bug C — a finished workout is a trained day without a stored marker', () => {
  const lift = [{ exerciseId: 'x', name: 'Press', sets: cluster(10, 0) }];

  it('completed sessions with logged work become 0-kcal exercise rows; empty or unfinished ones do not', () => {
    const rows = trainedDayRows([
      session('a', 't', 13, lift),
      session('b', 't', 14, [{ exerciseId: 'x', name: 'Press', sets: [{ kind: 'working' }] }]),
      session('c', 't', 15, lift, 'active'),
    ]);
    expect(rows).toEqual([{ date: d(13), calories: 0, exerciseCompleted: true }]);
  });

  it('a workout-only day keeps the streak alive, exactly as the marker did', () => {
    const food: DailyLog[] = [{ date: d(13, 12), calories: 1800 }, { date: d(15, 12), calories: 1900 }];
    const today = d(15, 20);
    expect(computeStreak(food, { today }).streak).toBe(1);
    const withWorkout = [...food, ...trainedDayRows([session('p', 't', 14, lift)])];
    expect(computeStreak(withWorkout, { today }).streak).toBe(3);
  });

  it("History marks the day trained and adds no calories", () => {
    const rows = trainedDayRows([session('p', 't', 14, lift)]);
    const [day] = summarizeDays(['2026-10-14'], rows as DailyLog[], {});
    expect(day.exercised).toBe(true);
    expect(day.totalCalories).toBe(0);
  });
});

describe('item 4 — ticked sets saved with no RIR are found, per lift', () => {
  it('the 10/14 curl: all three rows, and nothing else', () => {
    const missing = setsMissingRir([
      { exerciseId: 'flye', name: 'Rear delt DB flye', sets: cluster(16, 0) },
      { exerciseId: 'curl', name: 'Incline DB Curl 45°', sets: cluster(17) },
    ] as never);
    expect(missing).toEqual([{ exerciseIndex: 1, exerciseId: 'curl', name: 'Incline DB Curl 45°', setIndexes: [0, 1, 2] }]);
  });

  it('a plain straight-set lift with no RIR history is not asked about (no RIR column there)', () => {
    const bench = [{ exerciseId: 'b', name: 'Bench', sets: [{ kind: 'working', weight: 135, reps: 8, done: true }] }] as never;
    expect(setsMissingRir(bench)).toEqual([]);
    // ...unless the lifter logged RIR on it last time.
    expect(setsMissingRir(bench, (id) => id === 'b')).toHaveLength(1);
  });

  it('unticked rows, warm-ups and drops are not effort sets the picker asks about', () => {
    const missing = setsMissingRir([{
      exerciseId: 'lat', name: 'DB Lateral Raise', sets: [
        { kind: 'warmup', weight: 5, reps: 10, done: true },
        { kind: 'activation', group: 1, weight: 15, reps: 14, rir: 0, done: true },
        { kind: 'mini', group: 1, weight: 15, reps: 4 },
        { kind: 'drop', weight: 10, reps: 7, done: true },
        { kind: 'working', weight: 15, reps: 8, done: true },
      ],
    }] as never);
    expect(missing).toEqual([{ exerciseIndex: 0, exerciseId: 'lat', name: 'DB Lateral Raise', setIndexes: [4] }]);
  });
});

describe('weekly volume — one full rotation, not a rolling 7 days', () => {
  const press = [{ exerciseId: 'press', name: 'DB Flat Press', sets: cluster(12, 0) }];
  const sessions = [
    session('push1', 'push', 9, press),
    session('leg', 'leg', 13),
    session('pull', 'pull', 14),
    session('push2', 'push', 15, press),
    session('walk', undefined, 15),
  ];

  it('the latest completed session of each planned template, oldest first', () => {
    expect(latestRotation(sessions, ['push', 'pull', 'leg']).map((s) => s.id)).toEqual(['leg', 'pull', 'push2']);
  });

  it('Push counts ONCE — a rolling 7 days ending 10/15 held it twice', () => {
    const catalog = [{ id: 'press', muscles: ['chest'] }] as never;
    const rolling = volumeBetween(sessions, catalog, d(9, 0).getTime(), d(15, 23).getTime());
    const rotation = rotationVolume(sessions, catalog, ['push', 'pull', 'leg']);
    const chest = (r: typeof rotation) => r.week.find((m) => m.muscle === 'chest')!.direct;
    expect(chest(rolling)).toBe(2);
    expect(chest(rotation)).toBe(1);
  });

  it('a template not yet performed is simply absent', () => {
    expect(latestRotation(sessions, ['push', 'arms']).map((s) => s.id)).toEqual(['push2']);
  });
});

describe('a removed imported cardio block stays removed', () => {
  // The owner's 10/14 Pull Day: a manual 20-min Zone 2 run and an Apple Watch
  // walk (1,048 s) the Health import attached to the same session.
  const zone2 = { modality: 'run', label: 'Zone 2', durationSec: 1200, source: 'manual' } as const;
  const watch = { modality: 'walk', durationSec: 1048, source: 'health', sourceId: '24D8F0AB' } as const;

  it("removing it in the logger records its sourceId", async () => {
    const { applySessionAction } = await import('./workout-session');
    const s = { id: 's', status: 'completed', date: d(14), exercises: [], cardio: [zone2, watch] } as unknown as WorkoutSession;
    const out = applySessionAction(s, { type: 'removeCardio', blockIndex: 1 });
    expect(out.cardio).toEqual([zone2]);
    expect(out.dismissedSourceIds).toEqual(['24D8F0AB']);
  });

  it('the next import skips a dismissed block, and still updates the rest', async () => {
    const { mergeImportedBlocks } = await import('./health-workouts');
    const kept = mergeImportedBlocks([zone2] as never, [watch] as never, ['24D8F0AB']);
    expect(kept).toEqual({ blocks: [zone2], changed: false });
    const fresh = mergeImportedBlocks([zone2] as never, [watch] as never);
    expect(fresh.blocks).toHaveLength(2);
  });
});
