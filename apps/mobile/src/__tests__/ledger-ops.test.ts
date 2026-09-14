/**
 * The three multi-step domain operations that used to live inside screen hooks.
 *
 * That is the whole point of `lib/ledger-ops.ts`: finishing a workout is six
 * ledger/health calls, a day-boundary derivation and a value-range backstop,
 * and while it sat in `useTrain` the only way to reach any of it was to render
 * the hook — so nothing pinned the ORDER, nothing pinned the 11 lb rejection,
 * and nothing pinned which half is allowed to fail silently. Same for Today's
 * repeat-yesterday loop and for the write-then-mirror pair that had three
 * hand-written copies.
 *
 * Mocked at the module seam the way `log-writes.test.tsx` does: the real
 * `ledger`/`pending-logs` reach `firebase.ts`, whose untranspiled ESM cannot
 * load here. `lib/workout` and `@macrolog/core` are REAL — the pruning and the
 * weight bounds are the behaviour under test, not scaffolding.
 */
const calls: string[] = [];

const mockUpdateSession = jest.fn(async () => undefined);
const mockSetDailyWeight = jest.fn(async () => undefined);
const mockSetDailyWater = jest.fn(async () => undefined);
const mockSetDailySleep = jest.fn(async () => undefined);
const mockMarkExercised = jest.fn(async () => undefined);
const mockExportDaily = jest.fn(async () => undefined);
const mockExportWorkout = jest.fn(async () => undefined);
const mockAddLogDurably = jest.fn(async () => 'logged' as const);
const mockTrack = jest.fn();

// Every mock below pushes its name onto `calls` as well as recording on its
// spy, so a test can assert the SEQUENCE across four modules rather than four
// independent call counts — the ordering IS the operation.
jest.mock('@/lib/ledger', () => ({
  updateSession: (...a: unknown[]) => {
    calls.push('updateSession');
    return mockUpdateSession(...(a as []));
  },
  setDailyWeight: (...a: unknown[]) => {
    calls.push('setDailyWeight');
    return mockSetDailyWeight(...(a as []));
  },
  setDailyWater: (...a: unknown[]) => {
    calls.push('setDailyWater');
    return mockSetDailyWater(...(a as []));
  },
  setDailySleep: (...a: unknown[]) => {
    calls.push('setDailySleep');
    return mockSetDailySleep(...(a as []));
  },
  markExercised: (...a: unknown[]) => {
    calls.push('markExercised');
    return mockMarkExercised(...(a as []));
  },
}));

jest.mock('@/lib/health-sync', () => ({
  exportDaily: (...a: unknown[]) => {
    calls.push(`exportDaily:${String(a[0])}`);
    return mockExportDaily(...(a as []));
  },
  exportWorkout: (...a: unknown[]) => {
    calls.push('exportWorkout');
    return mockExportWorkout(...(a as []));
  },
}));

jest.mock('@/lib/pending-logs', () => ({
  addLogDurably: (...a: unknown[]) => {
    calls.push('addLogDurably');
    return mockAddLogDurably(...(a as []));
  },
}));

jest.mock('@/lib/analytics', () => ({
  track: (...a: unknown[]) => {
    calls.push(`track:${String(a[0])}`);
    return mockTrack(...(a as []));
  },
}));

import { finishWorkout, repeatYesterday, writeDailyMetric } from '@/lib/ledger-ops';
import { MIDNIGHT, dayKeyAt, type DailyLog, type DateKey } from '@macrolog/core';
import type { WorkoutSession } from '@/lib/workout';

const UID = 'u1';
// September 2026 — month index 8. Local time throughout, because the day
// boundary is a local-calendar question (ADR-0030) and so is `dayKeyAt`.
const SESSION_AT = new Date(2026, 8, 14, 17, 30);

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 's1',
    status: 'active',
    date: SESSION_AT,
    exercises: [
      {
        exerciseId: 'e1',
        name: 'Bench Press',
        cues: [],
        logStyle: 'weight-reps',
        sets: [{ kind: 'working', weight: 135, reps: 8 }],
      },
    ],
    createdAt: SESSION_AT,
    updatedAt: SESSION_AT,
    ...over,
  } as WorkoutSession;
}

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
  mockUpdateSession.mockResolvedValue(undefined);
  mockSetDailyWeight.mockResolvedValue(undefined);
  mockSetDailyWater.mockResolvedValue(undefined);
  mockSetDailySleep.mockResolvedValue(undefined);
  mockMarkExercised.mockResolvedValue(undefined);
});

describe('writeDailyMetric — write, then mirror', () => {
  it('writes to Firestore BEFORE mirroring to Health', async () => {
    await writeDailyMetric(UID, 'water', '2026-09-14', 64);
    expect(calls).toEqual(['setDailyWater', 'exportDaily:water']);
    expect(mockSetDailyWater).toHaveBeenCalledWith(UID, '2026-09-14', 64);
    expect(mockExportDaily).toHaveBeenCalledWith('water', '2026-09-14', 64);
  });

  it('does NOT mirror when the Firestore write throws', async () => {
    mockSetDailySleep.mockRejectedValueOnce(new Error('offline'));
    await expect(writeDailyMetric(UID, 'sleep', '2026-09-14', 7.5)).rejects.toThrow('offline');
    // The rejection is the caller's to surface; what must not happen is a
    // Health store that records a night Firestore never accepted.
    expect(calls).toEqual(['setDailySleep']);
    expect(mockExportDaily).not.toHaveBeenCalled();
  });

  it('counts an event only when one is asked for, after the write and before the mirror', async () => {
    await writeDailyMetric(UID, 'weight', '2026-09-14', 182, 'weight_logged');
    expect(calls).toEqual(['setDailyWeight', 'track:weight_logged', 'exportDaily:weight']);

    calls.length = 0;
    await writeDailyMetric(UID, 'weight', '2026-09-14', 182);
    expect(calls).toEqual(['setDailyWeight', 'exportDaily:weight']);
  });

  it('counts nothing when the write throws, even with an event', async () => {
    mockSetDailyWeight.mockRejectedValueOnce(new Error('denied'));
    await expect(
      writeDailyMetric(UID, 'weight', '2026-09-14', 182, 'weight_logged'),
    ).rejects.toThrow('denied');
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe('finishWorkout', () => {
  it('runs the whole sequence in order', async () => {
    await finishWorkout(UID, session(), MIDNIGHT, { bodyweight: 182, sleepHours: 7.5 });
    expect(calls).toEqual([
      'updateSession',
      'setDailyWeight',
      'exportDaily:weight',
      'setDailySleep',
      'exportDaily:sleep',
      'markExercised',
      'track:workout_finished',
      'exportWorkout',
    ]);
  });

  it('files the extras under the session date, through the boundary it is given', async () => {
    await finishWorkout(UID, session(), MIDNIGHT, { bodyweight: 182, sleepHours: 7.5 });
    const key = dayKeyAt(SESSION_AT, MIDNIGHT);
    expect(mockSetDailyWeight).toHaveBeenCalledWith(UID, key, 182);
    expect(mockSetDailySleep).toHaveBeenCalledWith(UID, key, 7.5);
    // The streak marker is stamped from the session's own instant, not from
    // "now", and carries the same boundary (ADR-0030).
    expect(mockMarkExercised).toHaveBeenCalledWith(UID, SESSION_AT, MIDNIGHT);
  });

  it('rejects an implausible bodyweight without touching dailyWeights', async () => {
    // The 11 lb entry `isStorableWeight` exists for. It still rides on the
    // session document — the user typed it and the session is a record of what
    // they typed — but it must never become a weigh-in, because the measured
    // TDEE regression reads those.
    await finishWorkout(UID, session(), MIDNIGHT, { bodyweight: 11 });
    expect(mockSetDailyWeight).not.toHaveBeenCalled();
    expect(mockExportDaily).not.toHaveBeenCalled();
    expect(calls).toEqual(['updateSession', 'markExercised', 'track:workout_finished', 'exportWorkout']);
  });

  it('stores a plausible bodyweight at the store floor', async () => {
    await finishWorkout(UID, session(), MIDNIGHT, { bodyweight: 30 });
    expect(mockSetDailyWeight).toHaveBeenCalledWith(UID, dayKeyAt(SESSION_AT, MIDNIGHT), 30);
  });

  it('skips sleep when it is absent or zero', async () => {
    await finishWorkout(UID, session(), MIDNIGHT, {});
    expect(mockSetDailySleep).not.toHaveBeenCalled();
    await finishWorkout(UID, session(), MIDNIGHT, { sleepHours: 0 });
    expect(mockSetDailySleep).not.toHaveBeenCalled();
  });

  it('prunes unlogged sets and leaves `cardio` absent when the session had none', async () => {
    await finishWorkout(
      UID,
      session({
        exercises: [
          {
            exerciseId: 'e1',
            name: 'Bench Press',
            cues: [],
            logStyle: 'weight-reps',
            sets: [
              { kind: 'working', weight: 135, reps: 8 },
              // Never performed — must not enter history.
              { kind: 'working' },
            ],
          },
        ],
      } as Partial<WorkoutSession>),
      MIDNIGHT,
      {},
    );
    const patch = (
      mockUpdateSession.mock.calls[0] as unknown as [
        string,
        string,
        { status: string; exercises: { sets: unknown[] }[]; cardio?: unknown },
      ]
    )[2];
    expect(patch.status).toBe('completed');
    expect(patch.exercises[0].sets).toHaveLength(1);
    // Absent stays ABSENT: a strength-only session must not gain an empty array.
    expect('cardio' in patch).toBe(false);
  });

  it('stops at a failed session write — no marker, no count, no mirror', async () => {
    mockUpdateSession.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(
      finishWorkout(UID, session(), MIDNIGHT, { bodyweight: 182 }),
    ).rejects.toThrow('permission-denied');
    expect(calls).toEqual(['updateSession']);
    expect(mockMarkExercised).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockExportWorkout).not.toHaveBeenCalled();
  });

  it('does nothing for a session that was never persisted', async () => {
    await finishWorkout(UID, session({ id: undefined }), MIDNIGHT, { bodyweight: 182 });
    expect(calls).toEqual([]);
  });
});

describe('repeatYesterday', () => {
  // Fixed clock: "now" is 2026-09-14 12:00 local, so yesterday is the 13th.
  const NOW = new Date(2026, 8, 14, 12, 0);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const log = (over: Partial<DailyLog> & { date: Date; calories: number }): DailyLog => ({
    protein: 30,
    carbs: 40,
    fat: 10,
    mealLabel: 'Oatmeal',
    mealType: 'breakfast',
    ...over,
  });

  it("copies yesterday's rows onto today, keeping each row's time of day", async () => {
    const rows = [
      log({ id: 'a', date: new Date(2026, 8, 13, 8, 30), calories: 400 }),
      log({ id: 'b', date: new Date(2026, 8, 13, 19, 5), calories: 700, mealLabel: 'Dinner' }),
    ];
    const n = await repeatYesterday(UID, rows, MIDNIGHT);
    expect(n).toBe(2);
    expect(mockAddLogDurably).toHaveBeenCalledTimes(2);

    const stamps = mockAddLogDurably.mock.calls.map(
      (c) => (c as unknown as [string, { timestamp: Date }])[1].timestamp,
    );
    // Today's DATE, yesterday's hour and minute, seconds zeroed — reusing the
    // original `date` would file the copy back onto yesterday.
    expect(stamps.map((d) => dayKeyAt(d, MIDNIGHT))).toEqual([
      dayKeyAt(NOW, MIDNIGHT),
      dayKeyAt(NOW, MIDNIGHT),
    ]);
    expect(stamps.map((d) => [d.getHours(), d.getMinutes(), d.getSeconds()])).toEqual([
      [8, 30, 0],
      [19, 5, 0],
    ]);

    const first = (mockAddLogDurably.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(first).toMatchObject({
      calories: 400,
      protein: 30,
      carbs: 40,
      fat: 10,
      mealLabel: 'Oatmeal',
      mealType: 'breakfast',
    });
    // Counted once per USE, not once per row.
    expect(calls.filter((c) => c === 'track:repeat_yesterday')).toHaveLength(1);
  });

  it("ignores today's rows and yesterday's 0-kcal markers", async () => {
    const rows = [
      log({ id: 'today', date: new Date(2026, 8, 14, 9, 0), calories: 500 }),
      // A workout marker: yesterday, but no calories.
      log({ id: 'marker', date: new Date(2026, 8, 13, 18, 0), calories: 0 }),
      log({ id: 'keep', date: new Date(2026, 8, 13, 12, 15), calories: 650 }),
    ];
    expect(await repeatYesterday(UID, rows, MIDNIGHT)).toBe(1);
    const entry = (mockAddLogDurably.mock.calls[0] as unknown as [string, { calories: number }])[1];
    expect(entry.calories).toBe(650);
  });

  it('counts nothing when there is nothing to copy', async () => {
    const rows = [log({ id: 'today', date: new Date(2026, 8, 14, 9, 0), calories: 500 })];
    expect(await repeatYesterday(UID, rows, MIDNIGHT)).toBe(0);
    expect(mockAddLogDurably).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('asks the BOUNDARY which day yesterday was, not the calendar', async () => {
    // A 3am day start: a row logged at 01:00 on the 14th belongs to the 13th,
    // so it IS yesterday's and must be copied — and one at 04:00 on the 14th
    // is today's and must not be.
    const threeAm = [{ from: '2026-01-01' as DateKey, hour: 3 }];
    const rows = [
      log({ id: 'late-night', date: new Date(2026, 8, 14, 1, 0), calories: 300 }),
      log({ id: 'this-morning', date: new Date(2026, 8, 14, 4, 0), calories: 300 }),
    ];
    expect(await repeatYesterday(UID, rows, threeAm)).toBe(1);
    const entry = (
      mockAddLogDurably.mock.calls[0] as unknown as [string, { timestamp: Date }]
    )[1];
    expect([entry.timestamp.getHours(), entry.timestamp.getMinutes()]).toEqual([1, 0]);
  });
});
