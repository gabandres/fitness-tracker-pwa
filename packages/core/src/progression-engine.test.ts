/**
 * The progression engine, pinned against the owner's real sessions.
 *
 * Every fixture below is a set sequence read out of Firestore on 2026-09-15
 * (`users/…/workoutSessions`), not invented — the spec lists these dates as
 * the validation cases, and a rule that passes on synthetic clusters and
 * fails on the ones that were actually logged is the failure mode to avoid.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILD_REPS_EXTRA,
  DEFAULT_TARGET_REPS,
  FIRST_MINI_MAX,
  FIRST_MINI_MIN,
  INTERVENTION_SESSIONS,
  MAX_JUMP_PCT,
  STALL_SESSIONS,
  detectStall,
  followedRecommendation,
  nextLoad,
  readExercise,
  recommend,
  recommendOptionsFor,
  toRecommendationSnapshot,
} from './progression-engine';
import type { SessionExercise, WorkoutSet } from './workout';

type Row = [group: number, kind: 'activation' | 'mini', reps: number, rir?: number, weight?: number];

const ex = (rows: Row[], extra: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: 'x',
  name: 'X',
  cues: [],
  logStyle: 'weight-reps',
  sets: rows.map(([group, kind, reps, rir, weight]): WorkoutSet => ({
    kind, group, reps,
    ...(rir != null ? { rir } : {}),
    ...(weight != null ? { weight } : {}),
  })),
  ...extra,
});

/** One cluster at `w`: activation + two minis. */
const cluster = (g: number, w: number, act: number, rir: number, m1: number, m2: number): Row[] => [
  [g, 'activation', act, rir, w], [g, 'mini', m1, 0, w], [g, 'mini', m2, 0, w],
];

const clustered = { expectsCluster: true };

// ─── Layer 1 — the historical cases the spec names ──────────────

describe('Layer 1 — validity gate on the logged sessions', () => {
  it('2026-09-09 Seated cable row C1: activation 10, first mini 8 → INVALID (too easy)', () => {
    const r = readExercise(ex([...cluster(1, 80, 10, 2, 8, 5), ...cluster(2, 80, 10, 2, 4, 3)]), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('first-mini-too-many');
    expect(r.issueGroup).toBe(1);
  });

  it('2026-09-09 Wide-grip lat pulldown: activation 11, mini 7 → INVALID', () => {
    const r = readExercise(ex(cluster(1, 80, 11, 2, 7, 4)), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('first-mini-too-many');
  });

  it('2026-09-15 Leg curl: activation 12, minis 10 and 9 → INVALID', () => {
    const r = readExercise(ex(cluster(1, 70, 12, 2, 10, 9)), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('first-mini-too-many');
  });

  it('2026-09-15 DB RDL: activation 10 @ RIR 1, first mini 5 → VALID', () => {
    const r = readExercise(ex(cluster(1, 25, 10, 1, 5, 3)), clustered);
    expect(r.valid).toBe(true);
    expect(r.issue).toBeNull();
    expect(r.load).toBe(25);
  });

  it('2026-09-11 Dips: activation 4 @ RIR 0, minis 2 and 2 → INVALID (to failure)', () => {
    // Bodyweight: no weight on any set. The RIR rule fires before the mini rule.
    const r = readExercise(ex([[1, 'activation', 4, 0], [1, 'mini', 2, 0], [1, 'mini', 2, 0]]), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('rir-to-failure');
  });

  it('2026-09-02 Rear delt flye: RIR 5, minis 10 and 10 → INVALID (too easy)', () => {
    const r = readExercise(ex(cluster(1, 10, 14, 5, 10, 10)), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('rir-too-easy');
  });

  it('2026-09-15 Standing calf raise: C1 at 40, C2 at 35 → INVALID (load changed mid-exercise)', () => {
    const r = readExercise(ex([...cluster(1, 40, 15, 2, 9, 4), ...cluster(2, 35, 12, 2, 9, 8)]), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('load-changed');
    expect(r.load).toBeUndefined();
  });

  it('first mini below 2 reads as too hard, and a mini out-repping the activation is caught', () => {
    expect(readExercise(ex(cluster(1, 50, 8, 1, 1, 1)), clustered).issue).toBe('first-mini-too-few');
    expect(readExercise(ex(cluster(1, 50, 8, 1, 4, 9)), clustered).issue).toBe('mini-exceeds-activation');
    // The band itself, inclusive at both ends.
    expect(readExercise(ex(cluster(1, 50, 10, 2, FIRST_MINI_MIN, 2)), clustered).valid).toBe(true);
    expect(readExercise(ex(cluster(1, 50, 10, 2, FIRST_MINI_MAX, 2)), clustered).valid).toBe(true);
  });

  it('a missing RIR blocks on a clustered lift and only there', () => {
    const rows: Row[] = [[1, 'activation', 11, undefined, 50], [1, 'mini', 4, 0, 50]];
    expect(readExercise(ex(rows), clustered).issue).toBe('rir-missing');
    expect(readExercise(ex(rows), { expectsCluster: false }).valid).toBe(true);
    expect(readExercise(ex(rows), { expectsCluster: true, strictRir: false }).valid).toBe(true);
  });

  it('2026-09-02 pull-up logged as straight sets where a cluster was prescribed → not-clustered', () => {
    const straight = ex([], { sets: [{ kind: 'working', reps: 5, weight: 0 }, { kind: 'working', reps: 2, weight: 0 }] });
    expect(readExercise(straight, clustered).issue).toBe('not-clustered');
    // A straight-set exercise by design is not a defect, and a timed hold is
    // not a rep read at all (the plank is untouched by this engine).
    expect(readExercise(straight, {}).issue).toBeNull();
    expect(readExercise(straight, {}).clustered).toBe(false);
    const plank: SessionExercise = { exerciseId: 'p', name: 'Plank', cues: [], logStyle: 'time', sets: [{ kind: 'working', durationSec: 92 }] };
    expect(readExercise(plank, clustered)).toMatchObject({ clustered: false, issue: null, valid: false });
  });

  it('an untouched scaffold cluster is skipped, not judged', () => {
    const r = readExercise(ex([...cluster(1, 20, 11, 1, 6, 3), [2, 'activation', undefined as unknown as number, undefined, 20]]), clustered);
    // The second activation has no reps → not performed → one cluster read.
    expect(r.clusters).toHaveLength(1);
  });
});

// ─── Layer 2 — progression on valid reads only ──────────────────

describe('Layer 2 — activation reps drive the call, minis never do', () => {
  it('2026-09-15 Smith squat C1 11 @ RIR 1, C2 10 @ RIR 1 → HOLD 20, C2 blocked', () => {
    // The spec states this case on the activations alone. With readable
    // minis it is the split-cluster rule exactly as written.
    const rec = recommend(
      [ex([...cluster(1, 20, 11, 1, 5, 3), ...cluster(2, 20, 10, 1, 4, 2)])],
      { ...clustered, progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 } },
    );
    expect(rec.action).toBe('hold');
    expect(rec.load).toBe(20);
    expect(rec.reason).toEqual({ kind: 'below-band', reps: 10, group: 2, clusters: 2 });
    expect(rec.last).toEqual([
      { group: 1, reps: 11, rir: 1, firstMini: 5 },
      { group: 2, reps: 10, rir: 1, firstMini: 4 },
    ]);
  });

  it('…but the squat AS LOGGED had a first mini of 6, and layer 1 wins over layer 2', () => {
    // Firestore, 2026-09-15: C1 minis 6 and 3. The published rule reads a
    // first mini above 5 as an activation that was too easy, and the spec makes
    // that gate block everything after it. So the real read is REPEAT, not
    // HOLD — the load is the same either way, the claim about C2 is not made.
    const rec = recommend(
      [ex([...cluster(1, 20, 11, 1, 6, 3), ...cluster(2, 20, 10, 1, 4, 2)])],
      { ...clustered, progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 } },
    );
    expect(rec.action).toBe('repeat-invalid');
    expect(rec.load).toBe(20);
    expect(rec.reason).toMatchObject({ kind: 'invalid', reason: 'first-mini-too-many', group: 1, firstMini: 6 });
  });

  it('never advances load off an invalid read — the 9/15 leg curl repeats 70', () => {
    const rec = recommend([ex(cluster(1, 70, 12, 2, 10, 9))], clustered);
    expect(rec.action).toBe('repeat-invalid');
    expect(rec.load).toBe(70);
    expect(rec.reason).toMatchObject({ kind: 'invalid', reason: 'first-mini-too-many', firstMini: 10 });
  });

  it('in band on every cluster → ADD LOAD by the increment', () => {
    const rec = recommend(
      [ex([...cluster(1, 20, 12, 2, 5, 3), ...cluster(2, 20, 11, 1, 4, 2)])],
      { ...clustered, progression: { targetReps: 12, incrementLb: 2.5 } },
    );
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(22.5);
    expect(rec.reason).toEqual({ kind: 'in-band', reps: 11, rir: 2 });
  });

  it('the band comes from the template target, defaulting to 11-12', () => {
    expect(recommend([], {}).band).toEqual({ lo: DEFAULT_TARGET_REPS - 1, hi: DEFAULT_TARGET_REPS });
    expect(recommend([], { progression: { targetReps: 15 } }).band).toEqual({ lo: 14, hi: 15 });
    // 10 @ RIR 1 is below a 12 band and in a 10 band (the RDL's own rule).
    const rdl = [ex(cluster(1, 25, 10, 1, 5, 3))];
    expect(recommend(rdl, { ...clustered, progression: { targetReps: 12 } }).action).toBe('hold');
    // 2.5 on 25 is a 10% step; 5 would be 20% and layer 3 would ask for reps first.
    expect(recommend(rdl, { ...clustered, progression: { targetReps: 10, incrementLb: 2.5 } }).action).toBe('add-load');
    expect(recommend(rdl, { ...clustered, progression: { targetReps: 10, incrementLb: 5 } }).action).toBe('build-reps');
  });

  it('over the band is ADD LOAD (under-loaded), below is HOLD', () => {
    expect(recommend([ex(cluster(1, 30, 20, 2, 5, 3))], { ...clustered, progression: { targetReps: 15 } }).reason)
      .toMatchObject({ kind: 'over-band', reps: 20 });
    expect(recommend([ex(cluster(1, 30, 8, 2, 3, 2))], clustered).action).toBe('hold');
  });

  it('no history → calibrate; straight sets → none; a bodyweight cluster in band → add load with no number', () => {
    expect(recommend([], clustered).action).toBe('calibrate');
    expect(recommend([ex([], { sets: [{ kind: 'working', reps: 8, weight: 100 }] })], {}).action).toBe('none');
    const bw = recommend([ex([[1, 'activation', 12, 2], [1, 'mini', 4, 0], [1, 'mini', 3, 0]])], clustered);
    expect(bw.action).toBe('add-load');
    expect(bw.load).toBeUndefined();
  });
});

// ─── Layer 3 — increments ───────────────────────────────────────

describe('Layer 3 — the next load must exist and be a step, not a leap', () => {
  it('Smith squat with 10/15/20 on the rack: 10 → 20 is +100%, so build reps instead', () => {
    const rec = recommend([ex(cluster(1, 10, 12, 2, 5, 3))], {
      ...clustered, progression: { targetReps: 12 }, availableLoads: [10, 20],
    });
    expect(rec.action).toBe('build-reps');
    expect(rec.load).toBe(10);
    expect(rec.reason).toEqual({ kind: 'jump-too-big', nextLoad: 20, jumpPct: 1, repsGoal: 12 + BUILD_REPS_EXTRA });
  });

  it('a DB rack with only 20 and 25: +25% is flagged, not silently jumped', () => {
    const rec = recommend([ex(cluster(1, 20, 11, 2, 4, 3))], { ...clustered, availableLoads: [15, 20, 25, 30] });
    expect(rec.action).toBe('build-reps');
    expect(rec.reason).toMatchObject({ kind: 'jump-too-big', nextLoad: 25, jumpPct: 0.25 });
  });

  it('a step at or under the cap goes through; a plainly under-loaded lift is never capped', () => {
    expect(nextLoad(80, { incrementLb: 5 })).toEqual({ load: 85, jumpPct: 0.0625 });
    expect(MAX_JUMP_PCT).toBe(0.15);
    // Calf raise: 20 @ RIR 2 against a 15 target, +50% to 30. Over the band → add load anyway.
    const rec = recommend([ex(cluster(1, 20, 20, 2, 5, 3))], {
      ...clustered, progression: { targetReps: 15 }, availableLoads: [20, 30, 40],
    });
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(30);
  });

  it('an assisted lift progresses by REDUCING assistance, floored at zero', () => {
    expect(nextLoad(40, { assisted: true, availableLoads: [20, 30, 40, 50] })).toEqual({ load: 30, jumpPct: 0.25 });
    expect(nextLoad(3, { assisted: true, incrementLb: 5 })).toEqual({ load: 0, jumpPct: 1 });
    const rec = recommend([ex(cluster(1, 30, 12, 2, 4, 2))], { ...clustered, assisted: true, progression: { incrementLb: 2.5 } });
    expect(rec.action).toBe('add-load');
    expect(rec.assisted).toBe(true);
    expect(rec.load).toBe(27.5);
  });
});

// ─── Layer 4 — stalls ───────────────────────────────────────────

describe('Layer 4 — stall detection with a diagnosis', () => {
  const row = (act1: number, act2: number, m1 = 5, w = 80) => ex([...cluster(1, w, act1, 2, m1, 3), ...cluster(2, w, act2, 2, 4, 3)]);

  it('Seated cable row at 80: five sessions, C2 never cleared 11-12 → stalled, C2 blocks, interventions ranked', () => {
    // Most-recent-first; C1 cleared once (9/02 gave 12), C2 sat at 9-10 throughout.
    const history = [row(10, 10, 8), row(12, 10), row(10, 10), row(10, 9), row(11, 10)];
    const stall = detectStall(history, { ...clustered, progression: { targetReps: 12 } });
    expect(stall).toMatchObject({ sessions: 5, load: 80, reps: [10, 10, 10, 9, 10], blockingGroup: 2 });
    expect(stall?.easyActivations).toBe(1);
    expect(stall?.invalidSessions).toBe(1);
    expect(stall?.interventions).toEqual(['shorten-mini-rest', 'reduce-blocking-cluster', 'reduce-load-10pct']);
    expect(INTERVENTION_SESSIONS).toBe(5);
  });

  it('DB hammer curl at 20: activation exactly 9 four times → stalled', () => {
    const h = [9, 9, 9, 8].map((r) => ex(cluster(1, 20, r, 1, 5, 4)));
    const stall = detectStall(h, clustered);
    expect(stall).toMatchObject({ sessions: 4, load: 20, reps: [9, 9, 9, 8] });
    expect(stall?.interventions).toEqual([]);
  });

  it('Wide-grip lat pulldown at 80: 11, 11, 10 → stalled on the latest step', () => {
    const h = [ex(cluster(1, 80, 11, 2, 7, 4)), ex(cluster(1, 80, 11, 1, 5, 3)), ex(cluster(1, 80, 10, 2, 4, 3))];
    expect(detectStall(h, clustered)?.sessions).toBe(3);
    expect(STALL_SESSIONS).toBe(3);
  });

  it('DB Flat Press at 20: three sessions, C2 blocks every time', () => {
    const h = [row(11, 10, 8, 20), row(12, 10, 8, 20), row(11, 10, 5, 20)];
    expect(detectStall(h, clustered)).toMatchObject({ sessions: 3, blockingGroup: 2 });
  });

  it('a load change ends the run, and rising reps are not a stall', () => {
    const h = [ex(cluster(1, 40, 15, 2, 5, 3)), ex(cluster(1, 30, 20, 2, 5, 3)), ex(cluster(1, 20, 20, 1, 5, 3))];
    expect(detectStall(h, clustered)).toBeNull();
    const rising = [ex(cluster(1, 20, 11, 2, 5, 3)), ex(cluster(1, 20, 10, 2, 5, 3)), ex(cluster(1, 20, 9, 2, 5, 3))];
    expect(detectStall(rising, clustered)).toBeNull();
  });

  it('the stall rides on the recommendation', () => {
    const h = [9, 9, 9].map((r) => ex(cluster(1, 20, r, 1, 5, 4)));
    expect(recommend(h, clustered).stall?.sessions).toBe(3);
  });
});

// ─── Wiring ─────────────────────────────────────────────────────

describe('wiring helpers', () => {
  it('builds options from the template row and the catalog exercise', () => {
    const opts = recommendOptionsFor(
      { plannedSets: [{ kind: 'activation' }, { kind: 'mini' }], progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 } },
      { availableLoads: [10, 20], assisted: true },
    );
    expect(opts).toEqual({
      expectsCluster: true,
      progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 },
      availableLoads: [10, 20],
      assisted: true,
    });
    expect(recommendOptionsFor({ plannedSets: [{ kind: 'working' }] }, null)).toEqual({ expectsCluster: false });
  });

  it('freezes the storable subset and audits whether it was followed', () => {
    const rec = recommend([ex(cluster(1, 20, 12, 2, 5, 3))], { ...clustered, progression: { incrementLb: 2.5 } });
    const snap = toRecommendationSnapshot(rec, new Date('2026-09-15T12:00:00Z'));
    expect(snap).toEqual({ action: 'add-load', load: 22.5, basedOn: '2026-09-15T12:00:00.000Z' });
    expect(followedRecommendation(ex(cluster(1, 22.5, 10, 2, 4, 3), { recommendation: snap }))).toBe(true);
    expect(followedRecommendation(ex(cluster(1, 20, 10, 2, 4, 3), { recommendation: snap }))).toBe(false);
    expect(followedRecommendation(ex(cluster(1, 20, 10, 2, 4, 3)))).toBeNull();
  });
});
