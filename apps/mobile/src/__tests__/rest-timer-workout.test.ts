/**
 * S23-8 — the whole workout on the Lock Screen (Hevy parity): the next planned
 * set on the rest Live Activity / Android notification, and "Done set" ticking
 * it without unlocking.
 *
 * Native cannot run here; what can is everything that decides WHAT the face
 * offers and WHAT a tap does in the app:
 * - `planUpcomingSets` — which sets come next, with the numbers a tick in the
 *   app would log, and the rest that follows each;
 * - the seam's workout mode — one JSON picture to native, sent only on change,
 *   never on a binary without the function, never before reconcile has read
 *   native;
 * - `applySetInboxAction` — the exact tick, and every stale entry ignored;
 * - `parseTrainInbox` — the `set` entry's shape.
 */

const mockActivity = {
  start: jest.fn(async (..._a: unknown[]) => null),
  update: jest.fn(async (..._a: unknown[]) => null),
  end: jest.fn(async () => null),
  status: jest.fn(async () => 'stopped'),
  workout: jest.fn(async (_json: string) => null),
};
let mockWorkoutAvailable = true;

jest.mock('../../modules/rest-timer-activity', () => ({
  startRestActivity: (...a: unknown[]) => mockActivity.start(...a),
  updateRestActivity: (...a: unknown[]) => mockActivity.update(...a),
  endRestActivity: () => mockActivity.end(),
  getRestActivityStatus: () => mockActivity.status(),
  endAllRestActivities: () => mockActivity.end(),
  get isRestActivityWorkoutAvailable() {
    return mockWorkoutAvailable;
  },
  syncRestActivityWorkout: (json: string) => mockActivity.workout(json),
}));
jest.mock('../../modules/rest-timer-notification', () => ({
  startRestNotification: jest.fn(async () => null),
  updateRestNotification: jest.fn(async () => null),
  endRestNotification: jest.fn(async () => null),
  getRestNotificationStatus: jest.fn(async () => 'unavailable'),
  isRestNotificationWorkoutAvailable: false,
  syncRestNotificationWorkout: jest.fn(async () => null),
}));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import type { SessionExercise, WorkoutSession } from '@/lib/workout';
import { parseTrainInbox, type SetDoneAction } from '../../modules/intent-inbox';
import {
  MAX_PLANNED_SETS,
  SWEEP_IDLE_GRACE_MS,
  __currentRestActivity,
  __resetRestActivity,
  applyRestInboxAction,
  applySetInboxAction,
  armWorkout,
  end,
  endWorkout,
  planUpcomingSets,
  reconcileWithNative,
  resyncNative,
  start,
  sweepOrphans,
  workoutCopy,
} from '@/lib/rest-timer-activity';
import { noteLockScreenAccepted, takeLockScreenAccepted } from '@/lib/lock-screen-ticks';

const T0 = 1_759_600_000_000;
// Straight sets rest on `mini` (core `restAfterSet`); `cluster` is the rest after the lift.
const restFor = () => ({ mini: 90, cluster: 150 });

function ex(id: string, name: string, sets: SessionExercise['sets'], extra: Partial<SessionExercise> = {}): SessionExercise {
  return { exerciseId: id, name, cues: [], sets, ...extra };
}
const working = (o: Partial<SessionExercise['sets'][number]> = {}) => ({ kind: 'working' as const, ...o });

/** 80 kg bench (176.37 lb stored), 4 × 8 prescribed; squat 3 × 5 at 100 lb. */
function session(): SessionExercise[] {
  return [
    ex('bench', 'Bench', [
      working({ weight: 176.37, targetReps: 8, done: true, reps: 8 }),
      working({ weight: 176.37, targetReps: 8, done: true, reps: 8 }),
      working({ weight: 176.37, targetReps: 8 }),
      working({ weight: 176.37, targetReps: 8 }),
    ]),
    ex('squat', 'Squat', [working({ weight: 100, targetReps: 5 }), working({ weight: 100, targetReps: 5 })]),
  ];
}

const plan = (exercises: SessionExercise[], extra: Partial<Parameters<typeof planUpcomingSets>[0]> = {}) =>
  planUpcomingSets({ exercises, restFor, recentSessions: [], unitSystem: 'metric', locale: 'en', ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkoutAvailable = true;
  __resetRestActivity();
});

describe('planUpcomingSets — what the Lock Screen offers next', () => {
  it('names the next set with the numbers a tick would log, and the rest after it', () => {
    const [first, second] = plan(session());
    expect(first).toEqual({
      exerciseId: 'bench',
      exerciseIndex: 0,
      setIndex: 2,
      name: 'Bench',
      label: 'Bench · Set 3 of 4 · 80 kg × 8',
      restSec: 90,
      weight: 176.37,
      reps: 8,
      setKind: 'working',
      setCount: 4,
    });
    // Then set 4 — the queue runs in performing order — and the rest after
    // the lift's last set is the after-exercise one.
    expect(second).toMatchObject({ exerciseIndex: 0, setIndex: 3, label: 'Bench · Set 4 of 4 · 80 kg × 8', restSec: 150 });
  });

  it('crosses into the next exercise and stops at MAX_PLANNED_SETS', () => {
    const out = plan(session());
    expect(out).toHaveLength(MAX_PLANNED_SETS);
    expect(out.map((p) => `${p.exerciseIndex}:${p.setIndex}`)).toEqual(['0:2', '0:3', '1:0', '1:1']);
    expect(out[2].label).toBe('Squat · Set 1 of 2 · 45.4 kg × 5');
  });

  it('follows a lifter who skipped ahead, then wraps to what was left open', () => {
    const s = session();
    s[1].sets[0] = { ...s[1].sets[0], done: true, reps: 5 };
    const out = plan(s);
    expect(out.map((p) => `${p.exerciseIndex}:${p.setIndex}`)).toEqual(['1:1', '0:2', '0:3']);
  });

  it("takes last time's numbers for an empty row, as the tick does", () => {
    const s = [ex('row', 'Row', [working(), working()])];
    const last: WorkoutSession = {
      status: 'completed',
      date: new Date(T0 - 86_400_000),
      exercises: [ex('row', 'Row', [working({ weight: 135, reps: 10, done: true }), working({ weight: 135, reps: 9, done: true })])],
    } as WorkoutSession;
    const out = plan(s, { recentSessions: [last], unitSystem: 'us' });
    expect(out[0]).toMatchObject({ weight: 135, reps: 10, label: 'Row · Set 1 of 2 · 135 lb × 10' });
    expect(out[1]).toMatchObject({ weight: 135, reps: 9 });
  });

  it('stops at a set a tick could not log without asking (no load, no count)', () => {
    const s = [ex('ohp', 'Press', [working({ targetReps: 8 })])];
    expect(plan(s)).toEqual([]);
    const counted = [ex('dip', 'Dip', [working(), working({ targetReps: 10 })], { logStyle: 'bodyweight' })];
    expect(plan(counted)).toEqual([]);
  });

  it('formats bodyweight and timed lifts in the profile locale', () => {
    const s = [
      ex('pull', 'Dominada', [working({ targetReps: 1 }), working({ targetReps: 6 })], { logStyle: 'bodyweight' }),
      ex('plank', 'Plancha', [working({ targetDurationSec: 45 })], { logStyle: 'time' }),
    ];
    const out = plan(s, { locale: 'es-PR' });
    expect(out.map((p) => p.label)).toEqual([
      'Dominada · Serie 1 de 2 · 1 repetición',
      'Dominada · Serie 2 de 2 · 6 repeticiones',
      'Plancha · Serie 1 de 1 · 45 s',
    ]);
    expect(out[2]).toMatchObject({ durationSec: 45 });
    expect(out[2].weight).toBeUndefined();
  });

  it('drops "of N" on cluster rows, where the row label is no count', () => {
    const s = [ex('lat', 'Lateral raise', [
      { kind: 'activation', group: 1, weight: 20, targetReps: 12 },
      { kind: 'mini', group: 1, weight: 20, targetReps: 4 },
    ])];
    expect(plan(s, { unitSystem: 'us' })[0].label).toBe('Lateral raise · Set 1a · 20 lb × 12');
  });

  it('is empty for a finished workout', () => {
    const s = [ex('bench', 'Bench', [working({ weight: 100, reps: 5, done: true })])];
    expect(plan(s)).toEqual([]);
  });
});

describe('workout mode — one picture to native', () => {
  const upcoming = () => plan(session());
  const sent = () => JSON.parse(mockActivity.workout.mock.calls.at(-1)![0]);

  it('arms with the queue and the copy, and re-sends only on change', () => {
    armWorkout('s1', upcoming(), 'en');
    expect(mockActivity.workout).toHaveBeenCalledTimes(1);
    expect(sent()).toMatchObject({ sessionId: 's1', locale: 'en', rest: null, copy: { doneSet: 'Done set', upNext: 'Up next' } });
    expect(sent().upcoming[0].label).toBe('Bench · Set 3 of 4 · 80 kg × 8');
    armWorkout('s1', upcoming(), 'en');
    expect(mockActivity.workout).toHaveBeenCalledTimes(1);
  });

  it('routes start / end through the picture instead of the rest-only calls', () => {
    armWorkout('s1', upcoming(), 'en');
    start(T0 + 90_000, 'Bench', 'en', T0);
    expect(mockActivity.start).not.toHaveBeenCalled();
    expect(sent().rest).toEqual({ startedAtMs: T0, endsAtMs: T0 + 90_000, title: 'Bench' });
    end();
    // The face stays, on the next set: no native end.
    expect(mockActivity.end).not.toHaveBeenCalled();
    expect(sent().rest).toBeNull();
  });

  it('endWorkout removes the face entirely', () => {
    armWorkout('s1', upcoming(), 'en');
    endWorkout();
    expect(mockActivity.end).toHaveBeenCalled();
    start(T0 + 60_000, 'Bench', 'en', T0);
    // Disarmed: back to the rest-only call.
    expect(mockActivity.start).toHaveBeenCalled();
  });

  it('stays on the rest-only calls on a binary without the function (an OTA on an old build)', () => {
    mockWorkoutAvailable = false;
    armWorkout('s1', upcoming(), 'en');
    start(T0 + 90_000, 'Bench', 'en', T0);
    end();
    expect(mockActivity.workout).not.toHaveBeenCalled();
    expect(mockActivity.start).toHaveBeenCalledWith(T0 + 90_000, 'Bench', 'en');
    expect(mockActivity.end).toHaveBeenCalled();
  });

  it('holds the first picture until reconcile has read native, then adopts the running rest', async () => {
    let answer!: (s: string) => void;
    mockActivity.status.mockImplementationOnce(() => new Promise<string>((r) => { answer = r; }));
    const now = Date.now();
    const pending = reconcileWithNative('Bench', 'en', now);
    armWorkout('s1', upcoming(), 'en');
    // A "no rest" picture now would end the countdown about to be adopted.
    expect(mockActivity.workout).not.toHaveBeenCalled();
    answer(`running:${now + 40_000}`);
    await pending;
    expect(mockActivity.workout).toHaveBeenCalledTimes(1);
    expect(sent().rest.endsAtMs).toBe(now + 40_000);
  });

  it('the orphan sweep leaves an armed workout alone', async () => {
    armWorkout('s1', upcoming(), 'en');
    mockActivity.status.mockResolvedValueOnce('idle');
    await sweepOrphans(T0);
    expect(mockActivity.end).not.toHaveBeenCalled();
  });

  it('carries the Android words in every locale', () => {
    expect(workoutCopy('pt-BR')).toMatchObject({ doneSet: 'Série feita', skip: 'Pular', restTitle: 'Descanso · {name}' });
    expect(workoutCopy('xx')).toMatchObject({ sub30: '−30 s', add30: '+30 s', nextLine: 'Next: {label}' });
  });
});

describe('applySetInboxAction — "Done set" becomes exactly one tick', () => {
  const action = (o: Partial<SetDoneAction> = {}): SetDoneAction => ({
    kind: 'set',
    atMs: T0,
    sessionId: 's1',
    exerciseId: 'bench',
    exerciseIndex: 0,
    setIndex: 2,
    weight: 176.37,
    reps: 8,
    endsAtMs: T0 + 90_000,
    ...o,
  });

  it('ticks the named set with the face values and adopts the rest native started', () => {
    const out = applySetInboxAction(action(), session(), 's1', T0 + 10_000);
    expect(out).toEqual({
      type: 'tick',
      exerciseIndex: 0,
      setIndex: 2,
      patch: { done: true, weight: 176.37, reps: 8 },
      // The reps went into an empty field; the load was already stored.
      accepted: { count: 8 },
      rest: { endsAt: T0 + 90_000, seconds: 80, total: 90 },
    });
    expect(__currentRestActivity()).toMatchObject({ endsAt: T0 + 90_000, exerciseName: 'Bench', startedAt: T0 });
    // Adopted without echoing it back to native.
    expect(mockActivity.start).not.toHaveBeenCalled();
  });

  it('ticks but runs no bar when the rest is already over by the time the app sees it', () => {
    const out = applySetInboxAction(action(), session(), 's1', T0 + 120_000);
    expect(out?.rest).toBeNull();
    expect(__currentRestActivity()).toBeNull();
  });

  it('follows the exercise by id when it moved, and logs a timed set as a duration', () => {
    const s = session().reverse();
    expect(applySetInboxAction(action(), s, 's1', T0)?.exerciseIndex).toBe(1);
    const timed = [ex('plank', 'Plank', [working()], { logStyle: 'time' })];
    const out = applySetInboxAction(
      action({ atMs: T0 + 1, exerciseId: 'plank', exerciseIndex: 0, setIndex: 0, weight: undefined, reps: undefined, durationSec: 45, endsAtMs: 0 }),
      timed, 's1', T0,
    );
    expect(out).toMatchObject({ patch: { done: true, durationSec: 45 }, accepted: { count: 45 }, rest: null });
  });

  it.each([
    ['a different session', action({ sessionId: 'other' }), 's1'],
    ['a set already ticked in the app', action({ setIndex: 0 }), 's1'],
    ['a set index out of range', action({ setIndex: 9 }), 's1'],
    ['an exercise no longer in the session', action({ exerciseId: 'deadlift' }), 's1'],
    ['an entry from hours ago', action({ atMs: T0 - 7 * 3600_000 }), 's1'],
  ])('ignores %s — and re-sends the app truth to native', (_why, a, sid) => {
    armWorkout('s1', plan(session()), 'en');
    mockActivity.workout.mockClear();
    expect(applySetInboxAction(a, session(), sid, T0)).toBeNull();
    expect(mockActivity.workout).toHaveBeenCalledTimes(1);
    expect(__currentRestActivity()).toBeNull();
  });

  it('does not guess between two copies of the same lift', () => {
    const s = [...session(), ex('bench', 'Bench', [working({ weight: 100, targetReps: 5 })])];
    s.unshift(ex('warm', 'Bike', []));
    expect(applySetInboxAction(action(), s, 's1', T0)).toBeNull();
  });

  it('accepts an entry from before the session had an id', () => {
    expect(applySetInboxAction(action({ sessionId: '' }), session(), 's1', T0)).not.toBeNull();
  });
});

describe('parseTrainInbox — rest and set entries, in tap order', () => {
  it('keeps both kinds in order and drops anything malformed', () => {
    const raw = JSON.stringify([
      { kind: 'set', atMs: T0, sessionId: 's1', exerciseId: 'bench', exerciseIndex: 0, setIndex: 2, weight: 176.37, reps: 8, endsAtMs: T0 + 90_000 },
      { kind: 'rest', atMs: T0 + 5_000, endsAtMs: T0 + 120_000 },
      { kind: 'set', atMs: T0, exerciseId: 'bench', exerciseIndex: -1, setIndex: 2 },
      { kind: 'set', atMs: T0, exerciseId: '', exerciseIndex: 0, setIndex: 2 },
      { kind: 'fastEnd', atMs: T0, startedAtMs: 1, endedAtMs: 2 },
      { kind: 'set', atMs: T0, exerciseId: 'squat', exerciseIndex: 1, setIndex: 0, durationSec: 'x', endsAtMs: 0 },
    ]);
    expect(parseTrainInbox(raw)).toEqual([
      { kind: 'set', atMs: T0, sessionId: 's1', exerciseId: 'bench', exerciseIndex: 0, setIndex: 2, weight: 176.37, reps: 8, endsAtMs: T0 + 90_000 },
      { kind: 'rest', atMs: T0 + 5_000, endsAtMs: T0 + 120_000 },
      { kind: 'set', atMs: T0, sessionId: '', exerciseId: 'squat', exerciseIndex: 1, setIndex: 0, endsAtMs: 0 },
    ]);
  });

  it('reads garbage as nothing pending', () => {
    expect(parseTrainInbox('nope')).toEqual([]);
    expect(parseTrainInbox('{}')).toEqual([]);
  });
});

// ─── Round 2b (REVIEW-R2-NATIVE / REVIEW-R2-JS) ───────────────────────────

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('round 2b — the plan carries what the app would do', () => {
  it('stretches a superset round rest to the Program v2 minimum, as startRest does (P2-6)', () => {
    const a1 = ex('a', 'Row', [working({ weight: 100, targetReps: 8 }), working({ weight: 100, targetReps: 8 })], {
      supersetGroup: 'A', pairPosition: 1, transitionRestSec: 10, roundRestSec: 20, minClusterRestSec: 120,
    });
    const a2 = ex('b', 'Press', [working({ weight: 50, targetReps: 8 }), working({ weight: 50, targetReps: 8 })], {
      supersetGroup: 'A', pairPosition: 2, transitionRestSec: 10, roundRestSec: 20,
    });
    // Row set 1 → (switch) → Press set 1 → (round, back to Row) …
    const out = plan([a1, a2], { lastSetAt: {}, now: T0 });
    expect(out.map((p) => `${p.exerciseIndex}:${p.setIndex}`).slice(0, 2)).toEqual(['0:0', '1:0']);
    expect(out[0].restSec).toBe(10);
    // Unknown tick time → the app's estimate: transition 10 + one 70 s cluster = 80 s since Row; floor 120 → 40.
    expect(out[1].restSec).toBe(40);
  });

  it('names each planned set by kind, group and the lift set count (JS-P2-6)', () => {
    const s = [ex('lat', 'Raise', [
      { kind: 'activation', group: 1, weight: 20, targetReps: 12 },
      { kind: 'mini', group: 1, weight: 20, targetReps: 4 },
    ])];
    expect(plan(s)[1]).toMatchObject({ setKind: 'mini', group: 1, setCount: 2 });
  });
});

describe('round 2b — applySetInboxAction guards', () => {
  const base = (o: Partial<SetDoneAction> = {}): SetDoneAction => ({
    kind: 'set', atMs: T0, sessionId: 's1', exerciseId: 'bench', exerciseIndex: 0, setIndex: 2,
    weight: 176.37, reps: 8, endsAtMs: T0 + 90_000, setKind: 'working', setCount: 4, ...o,
  });

  it('ignores a slot that now holds a different set — added or removed rows, another kind (JS-P2-6)', () => {
    const removed = session();
    removed[0].sets.splice(0, 1);
    expect(applySetInboxAction(base({ atMs: T0 + 1 }), removed, 's1', T0)).toBeNull();
    expect(applySetInboxAction(base({ atMs: T0 + 2, setKind: 'warmup' }), session(), 's1', T0)).toBeNull();
    expect(applySetInboxAction(base({ atMs: T0 + 3 }), session(), 's1', T0)).not.toBeNull();
  });

  it('acts once per entry, however many drains see it (P2-11)', () => {
    expect(applySetInboxAction(base(), session(), 's1', T0)).not.toBeNull();
    armWorkout('s1', plan(session()), 'en');
    mockActivity.workout.mockClear();
    expect(applySetInboxAction(base(), session(), 's1', T0)).toBeNull();
    // A repeat is not a rejection: nothing is re-sent for it.
    expect(mockActivity.workout).not.toHaveBeenCalled();
  });

  it('a rejected Done set mutes the rest buttons tapped on ITS rest, not later ones (P2-7)', () => {
    start(T0 + 60_000, 'Squat', 'en', T0 - 30_000);
    const ticked = session();
    ticked[0].sets[2] = { ...ticked[0].sets[2], done: true };
    expect(applySetInboxAction(base({ atMs: T0 }), ticked, 's1', T0 + 20_000)).toBeNull();
    // +30 s tapped on the rejected set's rest, before the app re-sent its picture.
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 + 10_000, endsAtMs: T0 + 150_000 }, T0 + 20_000)).toBeNull();
    expect(__currentRestActivity()?.endsAt).toBe(T0 + 60_000);
    // Tapped after the app put its own picture back: an ordinary +30 s.
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 + 25_000, endsAtMs: T0 + 90_000 }, T0 + 26_000))
      .toEqual({ type: 'retarget', endsAt: T0 + 90_000, seconds: 64 });
  });
});

describe('round 2b — native confirms before a picture counts as sent (P2-5, P2-10)', () => {
  const sentPayloads = () => mockActivity.workout.mock.calls.map((c) => JSON.parse(c[0]));

  it('re-sends a refused picture on the next arm, and on foreground', async () => {
    mockActivity.workout.mockResolvedValueOnce('disabled' as never);
    armWorkout('s1', plan(session()), 'en');
    await flush();
    armWorkout('s1', plan(session()), 'en');
    expect(mockActivity.workout).toHaveBeenCalledTimes(2);
    await flush();
    armWorkout('s1', plan(session()), 'en');
    expect(mockActivity.workout).toHaveBeenCalledTimes(2);
    resyncNative();
    expect(mockActivity.workout).toHaveBeenCalledTimes(3);
  });

  it('stamps every picture with an increasing sequence number', async () => {
    armWorkout('s1', plan(session()), 'en');
    start(T0 + 90_000, 'Bench', 'en', T0, 'Next: A2 · Curl');
    const [a, b] = sentPayloads();
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(b.rest.alertBody).toBe('Next: A2 · Curl');
  });
});

describe('round 2b — the orphan sweep keeps an idle workout face (P2-4)', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps it, and ends it only if no workout claimed it within the grace', async () => {
    jest.useFakeTimers();
    mockActivity.status.mockResolvedValue('idle');
    await sweepOrphans(T0);
    expect(mockActivity.end).not.toHaveBeenCalled();
    jest.advanceTimersByTime(SWEEP_IDLE_GRACE_MS + 1);
    await flush();
    expect(mockActivity.end).toHaveBeenCalled();
    mockActivity.status.mockReset();
  });

  it('leaves it alone when a session armed meanwhile', async () => {
    jest.useFakeTimers();
    mockActivity.status.mockResolvedValue('idle');
    await sweepOrphans(T0);
    armWorkout('s1', plan(session()), 'en');
    jest.advanceTimersByTime(SWEEP_IDLE_GRACE_MS + 1);
    await flush();
    expect(mockActivity.end).not.toHaveBeenCalled();
    mockActivity.status.mockReset();
  });
});

describe('lock-screen-ticks — an untick takes back what a Lock Screen tick accepted (JS-P2-3)', () => {
  it('hands the note back once, only for the same kind and group', () => {
    noteLockScreenAccepted(0, 2, { kind: 'working' }, { count: 8 });
    expect(takeLockScreenAccepted(0, 2, { kind: 'mini', group: 1 })).toBeNull();
    noteLockScreenAccepted(0, 2, { kind: 'working' }, { count: 8, weight: 100 });
    expect(takeLockScreenAccepted(0, 2, { kind: 'working' })).toEqual({ count: 8, weight: 100 });
    expect(takeLockScreenAccepted(0, 2, { kind: 'working' })).toBeNull();
  });

  it('is forgotten when the workout closes', () => {
    noteLockScreenAccepted(1, 0, { kind: 'working' }, { count: 5 });
    endWorkout();
    expect(takeLockScreenAccepted(1, 0, { kind: 'working' })).toBeNull();
  });
});
