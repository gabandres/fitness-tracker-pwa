/**
 * The progression engine, pinned against the owner's real sessions.
 *
 * Every historical fixture below is a set sequence read out of Firestore on
 * 2026-09-15 (`users/…/workoutSessions`), not invented — the spec lists these
 * dates as the validation cases, and a rule that passes on synthetic clusters
 * and fails on the ones that were actually logged is the failure mode to
 * avoid. ADR-0039 amended the standard: RIR 0 is in band, the rep band is
 * derived per exercise after three valid sessions at one load, and sets
 * flagged legacy are excluded from that derivation.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILD_REPS_EXTRA,
  CALIBRATION_SESSIONS,
  FIRST_MINI_MAX,
  FIRST_MINI_MIN,
  INTERVENTION_SESSIONS,
  MAX_JUMP_PCT,
  STALL_SESSIONS,
  calibrationFor,
  detectStall,
  followedRecommendation,
  nextLoad,
  readExercise,
  recommend,
  recommendOptionsFor,
  repBandFrom,
  toRecommendationSnapshot,
} from './progression-engine';
import type { RepBand, SessionExercise, WorkoutSet } from './workout';

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

/** The same exercise with every set flagged as logged under the old standard. */
const legacy = (e: SessionExercise): SessionExercise => ({
  ...e,
  sets: e.sets.map((s) => ({ ...s, legacyEffortStandard: true })),
});

/** One cluster at `w`: activation + two minis. */
const cluster = (g: number, w: number, act: number, rir: number, m1: number, m2: number): Row[] => [
  [g, 'activation', act, rir, w], [g, 'mini', m1, 0, w], [g, 'mini', m2, 0, w],
];

const clustered = { expectsCluster: true };
/** The band the pre-amendment engine hardcoded, as an explicit override:
 *  12 adds load, 10-11 holds, under 10 builds. */
const BAND_12: RepBand = { addLoadAt: 12, holdLo: 10, holdHi: 11 };
const banded = { ...clustered, targetRepBand: BAND_12 };

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

  it('2026-09-11 Dips: activation 4 @ RIR 0, minis 2 and 2 → VALID (RIR 0 is the standard, ADR-0039)', () => {
    // Bodyweight: no weight on any set. Under ADR-0038 this read was
    // `rir-to-failure`; that reason no longer exists. The minis decide.
    const r = readExercise(ex([[1, 'activation', 4, 0], [1, 'mini', 2, 0], [1, 'mini', 2, 0]]), clustered);
    expect(r.valid).toBe(true);
    expect(r.issue).toBeNull();
  });

  it('2026-09-02 Rear delt flye: RIR 5, minis 10 and 10 → INVALID (too easy); RIR 4 is the edge', () => {
    const r = readExercise(ex(cluster(1, 10, 14, 5, 10, 10)), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('rir-too-easy');
    expect(readExercise(ex(cluster(1, 10, 14, 4, 4, 3)), clustered).issue).toBe('rir-too-easy');
    expect(readExercise(ex(cluster(1, 10, 14, 3, 4, 3)), clustered).valid).toBe(true);
  });

  it('2026-09-15 Standing calf raise: C1 at 40, C2 at 35 → INVALID (load changed mid-exercise)', () => {
    const r = readExercise(ex([...cluster(1, 40, 15, 2, 9, 4), ...cluster(2, 35, 12, 2, 9, 8)]), clustered);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe('load-changed');
    expect(r.load).toBeUndefined();
  });

  it('the first-mini rule is unchanged: under 2 is too hard, over 5 too easy, 2-5 inclusive is valid', () => {
    expect(readExercise(ex(cluster(1, 50, 8, 0, 1, 1)), clustered).issue).toBe('first-mini-too-few');
    expect(readExercise(ex(cluster(1, 50, 8, 0, 4, 9)), clustered).issue).toBe('mini-exceeds-activation');
    expect(readExercise(ex(cluster(1, 50, 10, 0, FIRST_MINI_MIN, 2)), clustered).valid).toBe(true);
    expect(readExercise(ex(cluster(1, 50, 10, 0, FIRST_MINI_MAX, 2)), clustered).valid).toBe(true);
    expect(readExercise(ex(cluster(1, 50, 10, 0, FIRST_MINI_MAX + 1, 2)), clustered).issue).toBe('first-mini-too-many');
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
    expect(readExercise(straight, {}).issue).toBeNull();
    expect(readExercise(straight, {}).clustered).toBe(false);
    const plank: SessionExercise = { exerciseId: 'p', name: 'Plank', cues: [], logStyle: 'time', sets: [{ kind: 'working', durationSec: 92 }] };
    expect(readExercise(plank, clustered)).toMatchObject({ clustered: false, issue: null, valid: false });
  });

  it('an untouched scaffold cluster is skipped, not judged', () => {
    const r = readExercise(ex([...cluster(1, 20, 11, 1, 6, 3), [2, 'activation', undefined as unknown as number, undefined, 20]]), clustered);
    expect(r.clusters).toHaveLength(1);
  });

  it('a legacy activation marks the read as legacy without changing its validity', () => {
    const r = readExercise(legacy(ex(cluster(1, 20, 11, 1, 5, 3))), clustered);
    expect(r.valid).toBe(true);
    expect(r.legacy).toBe(true);
    expect(readExercise(ex(cluster(1, 20, 11, 1, 5, 3)), clustered).legacy).toBe(false);
  });
});

// ─── Layer 2a — the band is derived, not hardcoded ──────────────

describe('Layer 2a — calibration derives the band from three valid sessions at one load', () => {
  it('repBandFrom: add at max, hold max-2..max-1', () => {
    expect(repBandFrom(12)).toEqual({ addLoadAt: 12, holdLo: 10, holdHi: 11 });
    expect(repBandFrom(8)).toEqual({ addLoadAt: 8, holdLo: 6, holdHi: 7 });
    expect(repBandFrom(1)).toEqual({ addLoadAt: 1, holdLo: 1, holdHi: 1 });
    expect(CALIBRATION_SESSIONS).toBe(3);
  });

  it('no band until three VALID sessions at the load; each valid one moves the count', () => {
    const s = (reps: number, m1 = 4) => ex(cluster(1, 20, reps, 0, m1, 3));
    expect(calibrationFor([], clustered)).toMatchObject({ validSessions: 0, band: null, source: null });
    expect(calibrationFor([s(10)], clustered)).toMatchObject({ load: 20, validSessions: 1, band: null });
    expect(calibrationFor([s(11), s(10)], clustered)).toMatchObject({ validSessions: 2, band: null });
    // An invalid session in the run does not count, and does not break the run.
    expect(calibrationFor([s(11, 8), s(11), s(10)], clustered)).toMatchObject({ validSessions: 2, band: null });
    const cal = calibrationFor([s(12), s(11), s(10)], clustered);
    expect(cal).toEqual({ load: 20, validSessions: 3, needed: 3, maxReps: 12, band: repBandFrom(12), source: 'derived' });
  });

  it('the max is across every activation of every valid session in the run', () => {
    const two = (a1: number, a2: number) => ex([...cluster(1, 80, a1, 0, 4, 3), ...cluster(2, 80, a2, 0, 4, 3)]);
    expect(calibrationFor([two(10, 9), two(12, 10), two(11, 10)], clustered).maxReps).toBe(12);
  });

  it('a load change restarts calibration — the run is the sessions at the CURRENT load', () => {
    const at = (w: number, reps: number) => ex(cluster(1, w, reps, 0, 4, 3));
    const calibrated = [at(20, 12), at(20, 11), at(20, 10)];
    expect(calibrationFor(calibrated, clustered).band).toEqual(repBandFrom(12));
    // Moved to 25: the three at 20 are behind the load change and do not count.
    const moved = [at(25, 9), ...calibrated];
    expect(calibrationFor(moved, clustered)).toMatchObject({ load: 25, validSessions: 1, band: null });
    expect(recommend(moved, clustered)).toMatchObject({ action: 'calibrate', reason: { kind: 'calibrating', valid: 1, needed: 3 } });
  });

  it('legacy sessions are EXCLUDED from the derivation and do not break the run', () => {
    const s = (reps: number) => ex(cluster(1, 20, reps, 0, 4, 3));
    // Three legacy sessions at the same load: nothing to calibrate from.
    expect(calibrationFor([s(12), s(11), s(10)].map(legacy), clustered)).toMatchObject({ validSessions: 0, band: null });
    // Two new + one legacy between them: the legacy one is skipped, the new ones both count.
    expect(calibrationFor([s(11), legacy(s(14)), s(10)], clustered)).toMatchObject({ validSessions: 2, maxReps: 11, band: null });
    // Three new + a legacy 14: the max is 11, not 14.
    expect(calibrationFor([s(11), s(10), legacy(s(14)), s(9)], clustered).band).toEqual(repBandFrom(11));
  });

  it('a legacy LATEST read is history, not evidence: calibrate, but still shown as last', () => {
    const s = (reps: number) => ex(cluster(1, 20, reps, 0, 4, 3));
    const rec = recommend([legacy(s(12)), s(12), s(11), s(10)], clustered);
    expect(rec.action).toBe('calibrate');
    expect(rec.load).toBe(20);
    expect(rec.last).toEqual([{ group: 1, reps: 12, rir: 0, firstMini: 4 }]);
    // Even with a manual band: the read predates the standard the band assumes.
    expect(recommend([legacy(s(12))], banded).action).toBe('calibrate');
  });

  it('a bodyweight cluster calibrates like any other — "no load" is one load', () => {
    const bw = (reps: number) => ex([[1, 'activation', reps, 0], [1, 'mini', 3, 0], [1, 'mini', 2, 0]]);
    expect(calibrationFor([bw(6), bw(5), bw(5)], clustered)).toMatchObject({ validSessions: 3, band: repBandFrom(6) });
    expect(calibrationFor([bw(6), bw(5), bw(5)], clustered).load).toBeUndefined();
  });

  it('a manual targetRepBand overrides the derivation at any count', () => {
    const cal = calibrationFor([ex(cluster(1, 20, 10, 0, 4, 3))], banded);
    expect(cal).toMatchObject({ validSessions: 1, band: BAND_12, source: 'override' });
    expect(recommend([ex(cluster(1, 20, 10, 0, 4, 3))], banded).action).toBe('hold');
  });

  it('while calibrating the recommendation carries NO load change and says how far along it is', () => {
    const s = (reps: number) => ex(cluster(1, 20, reps, 0, 4, 3));
    const rec = recommend([s(11), s(10)], clustered);
    expect(rec.action).toBe('calibrate');
    expect(rec.load).toBe(20);
    expect(rec.band).toBeNull();
    expect(rec.reason).toEqual({ kind: 'calibrating', valid: 2, needed: 3 });
    expect(rec.calibration).toMatchObject({ validSessions: 2, needed: 3, maxReps: 11 });
  });

  it('an invalid latest read during calibration is still REPEAT with the reason, and the count is on it', () => {
    const s = (reps: number, m1 = 4) => ex(cluster(1, 70, reps, 0, m1, 3));
    const rec = recommend([s(12, 10), s(11)], clustered);
    expect(rec.action).toBe('repeat-invalid');
    expect(rec.reason).toMatchObject({ kind: 'invalid', reason: 'first-mini-too-many', firstMini: 10 });
    expect(rec.calibration.validSessions).toBe(1);
  });
});

// ─── Layer 2 — progression on valid reads only ──────────────────

describe('Layer 2 — activation reps drive the call, minis never do', () => {
  it('2026-09-15 Smith squat C1 11 @ RIR 1, C2 10 @ RIR 1 against a 12 band → HOLD 20, C2 blocked', () => {
    const rec = recommend(
      [ex([...cluster(1, 20, 11, 1, 5, 3), ...cluster(2, 20, 10, 1, 4, 2)])],
      { ...banded, progression: { incrementLb: 5 } },
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
    const rec = recommend(
      [ex([...cluster(1, 20, 11, 1, 6, 3), ...cluster(2, 20, 10, 1, 4, 2)])],
      { ...banded, progression: { incrementLb: 5 } },
    );
    expect(rec.action).toBe('repeat-invalid');
    expect(rec.load).toBe(20);
    expect(rec.reason).toMatchObject({ kind: 'invalid', reason: 'first-mini-too-many', group: 1, firstMini: 6 });
  });

  it('never advances load off an invalid read — the 9/15 leg curl repeats 70', () => {
    const rec = recommend([ex(cluster(1, 70, 12, 2, 10, 9))], banded);
    expect(rec.action).toBe('repeat-invalid');
    expect(rec.load).toBe(70);
    expect(rec.reason).toMatchObject({ kind: 'invalid', reason: 'first-mini-too-many', firstMini: 10 });
  });

  it('at the mark on every cluster → ADD LOAD by the increment', () => {
    const rec = recommend(
      [ex([...cluster(1, 20, 12, 0, 5, 3), ...cluster(2, 20, 12, 0, 4, 2)])],
      { ...banded, progression: { incrementLb: 2.5 } },
    );
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(22.5);
    expect(rec.reason).toEqual({ kind: 'at-target', reps: 12, rir: 0 });
  });

  it('the derived band drives the call end to end: hit your own max again and the load moves', () => {
    const s = (reps: number) => ex(cluster(1, 20, reps, 0, 4, 3));
    // 10, 11, 12: band 12 / 10-11. Latest IS the max → add load.
    expect(recommend([s(12), s(11), s(10)], { ...clustered, progression: { incrementLb: 2.5 } }))
      .toMatchObject({ action: 'add-load', load: 22.5, band: repBandFrom(12) });
    // A fourth at 11: in the hold band.
    expect(recommend([s(11), s(12), s(11), s(10)], clustered)).toMatchObject({ action: 'hold', reason: { kind: 'below-band', reps: 11 } });
    // A fourth at 9: under the hold band → build back to 10.
    expect(recommend([s(9), s(12), s(11), s(10)], clustered))
      .toMatchObject({ action: 'build-reps', load: 20, reason: { kind: 'under-band', reps: 9, goal: 10, clusters: 1 } });
    // A fourth at 13: a new max raises the mark to 13 and the latest read is at it.
    expect(recommend([s(13), s(12), s(11), s(10)], { ...clustered, progression: { incrementLb: 2.5 } }))
      .toMatchObject({ action: 'add-load', band: repBandFrom(13) });
  });

  it('over the mark is ADD LOAD (under-loaded); the hold band holds; under it builds, naming the cluster', () => {
    expect(recommend([ex(cluster(1, 30, 20, 0, 5, 3))], banded).reason).toMatchObject({ kind: 'over-band', reps: 20 });
    expect(recommend([ex(cluster(1, 30, 10, 0, 3, 2))], banded).action).toBe('hold');
    expect(recommend([ex(cluster(1, 30, 11, 0, 3, 2))], banded).action).toBe('hold');
    const two = recommend([ex([...cluster(1, 30, 12, 0, 4, 3), ...cluster(2, 30, 8, 0, 3, 2)])], banded);
    expect(two.action).toBe('build-reps');
    expect(two.reason).toEqual({ kind: 'under-band', reps: 8, group: 2, clusters: 2, goal: 10 });
  });

  it('no history → calibrate; straight sets → none; a bodyweight cluster at the mark → add load with no number', () => {
    expect(recommend([], clustered)).toMatchObject({ action: 'calibrate', reason: { kind: 'no-history' } });
    expect(recommend([ex([], { sets: [{ kind: 'working', reps: 8, weight: 100 }] })], {}).action).toBe('none');
    const bw = recommend([ex([[1, 'activation', 12, 0], [1, 'mini', 4, 0], [1, 'mini', 3, 0]])], banded);
    expect(bw.action).toBe('add-load');
    expect(bw.load).toBeUndefined();
  });
});

// ─── Effort standard per lift ───────────────────────────────────

describe('effort standard — failure by default, rir1 warns on a failure activation', () => {
  it('a rir1 lift logged at RIR 0 gets a soft warning and the read still stands', () => {
    const rec = recommend([ex(cluster(1, 80, 10, 0, 4, 3))], { ...banded, effortStandard: 'rir1' });
    expect(rec.warnings).toEqual(['failure-on-rir1']);
    expect(rec.action).toBe('hold');
    // The warning rides on an invalid read too — it is about the effort, not the read.
    expect(recommend([ex(cluster(1, 80, 10, 0, 8, 3))], { ...banded, effortStandard: 'rir1' }).warnings).toEqual(['failure-on-rir1']);
  });

  it('a rir1 lift at RIR 1, and a failure lift at RIR 0, carry no warning', () => {
    expect(recommend([ex(cluster(1, 80, 10, 1, 4, 3))], { ...banded, effortStandard: 'rir1' }).warnings).toEqual([]);
    expect(recommend([ex(cluster(1, 80, 10, 0, 4, 3))], { ...banded, effortStandard: 'failure' }).warnings).toEqual([]);
    expect(recommend([ex(cluster(1, 80, 10, 0, 4, 3))], banded).warnings).toEqual([]);
  });
});

// ─── Layer 3 — increments ───────────────────────────────────────

describe('Layer 3 — the next load must exist and be a step, not a leap', () => {
  it('Smith squat with 10/15/20 on the rack: 10 → 20 is +100%, so build reps instead', () => {
    const rec = recommend([ex(cluster(1, 10, 12, 0, 5, 3))], { ...banded, availableLoads: [10, 20] });
    expect(rec.action).toBe('build-reps');
    expect(rec.load).toBe(10);
    expect(rec.reason).toEqual({ kind: 'jump-too-big', nextLoad: 20, jumpPct: 1, repsGoal: 12 + BUILD_REPS_EXTRA });
  });

  it('a DB rack with only 20 and 25: +25% is flagged, not silently jumped', () => {
    const rec = recommend([ex(cluster(1, 20, 12, 0, 4, 3))], { ...banded, availableLoads: [15, 20, 25, 30] });
    expect(rec.action).toBe('build-reps');
    expect(rec.reason).toMatchObject({ kind: 'jump-too-big', nextLoad: 25, jumpPct: 0.25 });
  });

  it('a step at or under the cap goes through; a plainly under-loaded lift is never capped', () => {
    expect(nextLoad(80, { incrementLb: 5 })).toEqual({ load: 85, jumpPct: 0.0625 });
    expect(MAX_JUMP_PCT).toBe(0.15);
    // Calf raise: 20 reps against a 15 mark, +50% to 30. Over the mark → add load anyway.
    const rec = recommend([ex(cluster(1, 20, 20, 0, 5, 3))], {
      ...clustered, targetRepBand: repBandFrom(15), availableLoads: [20, 30, 40],
    });
    expect(rec.action).toBe('add-load');
    expect(rec.load).toBe(30);
  });

  it('an assisted lift progresses by REDUCING assistance, floored at zero', () => {
    expect(nextLoad(40, { assisted: true, availableLoads: [20, 30, 40, 50] })).toEqual({ load: 30, jumpPct: 0.25 });
    expect(nextLoad(3, { assisted: true, incrementLb: 5 })).toEqual({ load: 0, jumpPct: 1 });
    const rec = recommend([ex(cluster(1, 30, 12, 0, 4, 2))], { ...banded, assisted: true, progression: { incrementLb: 2.5 } });
    expect(rec.action).toBe('add-load');
    expect(rec.assisted).toBe(true);
    expect(rec.load).toBe(27.5);
  });
});

// ─── Layer 4 — stalls ───────────────────────────────────────────

describe('Layer 4 — stall detection with a diagnosis', () => {
  const row = (act1: number, act2: number, m1 = 5, w = 80) => ex([...cluster(1, w, act1, 2, m1, 3), ...cluster(2, w, act2, 2, 4, 3)]);

  it('Seated cable row at 80: five sessions, C2 never reached the mark → stalled, C2 blocks, interventions ranked', () => {
    // Most-recent-first; C1 reached 12 once (9/02), C2 sat at 9-10 throughout.
    const history = [row(10, 10, 8), row(12, 10), row(10, 10), row(10, 9), row(11, 10)];
    const stall = detectStall(history, banded);
    expect(stall).toMatchObject({ sessions: 5, load: 80, reps: [10, 10, 10, 9, 10], blockingGroup: 2 });
    expect(stall?.easyActivations).toBe(1);
    expect(stall?.invalidSessions).toBe(1);
    expect(stall?.interventions).toEqual(['shorten-mini-rest', 'reduce-blocking-cluster', 'reduce-load-10pct']);
    expect(INTERVENTION_SESSIONS).toBe(5);
  });

  it('the same run with a DERIVED band: the mark is the observed max (12), C2 still blocks', () => {
    const history = [row(10, 10, 8), row(12, 10), row(10, 10), row(10, 9), row(11, 10)];
    expect(detectStall(history, clustered)).toMatchObject({ sessions: 5, blockingGroup: 2 });
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

  it('DB Flat Press at 20: three sessions, C2 blocks every time (given a band)', () => {
    const h = [row(11, 10, 8, 20), row(12, 10, 8, 20), row(11, 10, 5, 20)];
    expect(detectStall(h, banded)).toMatchObject({ sessions: 3, blockingGroup: 2 });
    // Without a band (only one valid session in that run) there is no mark to
    // block against, so the stall is reported without a blocking cluster.
    expect(detectStall(h, clustered)).toMatchObject({ sessions: 3 });
    expect(detectStall(h, clustered)?.blockingGroup).toBeUndefined();
  });

  it('a load change ends the run, and rising reps are not a stall', () => {
    const h = [ex(cluster(1, 40, 15, 2, 5, 3)), ex(cluster(1, 30, 20, 2, 5, 3)), ex(cluster(1, 20, 20, 1, 5, 3))];
    expect(detectStall(h, clustered)).toBeNull();
    const rising = [ex(cluster(1, 20, 11, 2, 5, 3)), ex(cluster(1, 20, 10, 2, 5, 3)), ex(cluster(1, 20, 9, 2, 5, 3))];
    expect(detectStall(rising, clustered)).toBeNull();
  });

  it('the stall rides on the recommendation, calibrating or not', () => {
    const h = [9, 9, 9].map((r) => ex(cluster(1, 20, r, 1, 5, 4)));
    const rec = recommend(h, { ...clustered, progression: { incrementLb: 2.5 } });
    expect(rec.stall?.sessions).toBe(3);
    // 9, 9, 9: three valid sessions → band 9 / 7-8, latest at the mark.
    expect(rec.action).toBe('add-load');
  });
});

// ─── Wiring ─────────────────────────────────────────────────────

describe('wiring helpers', () => {
  it('builds options from the template row and the catalog exercise', () => {
    const opts = recommendOptionsFor(
      { plannedSets: [{ kind: 'activation' }, { kind: 'mini' }], progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 } },
      { availableLoads: [10, 20], assisted: true, effortStandard: 'rir1', targetRepBand: BAND_12 },
    );
    expect(opts).toEqual({
      expectsCluster: true,
      progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 },
      availableLoads: [10, 20],
      assisted: true,
      effortStandard: 'rir1',
      targetRepBand: BAND_12,
    });
    expect(recommendOptionsFor({ plannedSets: [{ kind: 'working' }] }, null)).toEqual({ expectsCluster: false });
    expect(recommendOptionsFor(null, { effortStandard: 'failure' })).toEqual({ expectsCluster: false, effortStandard: 'failure' });
  });

  it('freezes the storable subset and audits whether it was followed', () => {
    const rec = recommend([ex(cluster(1, 20, 12, 0, 5, 3))], { ...banded, progression: { incrementLb: 2.5 } });
    const snap = toRecommendationSnapshot(rec, new Date('2026-09-15T12:00:00Z'));
    expect(snap).toEqual({ action: 'add-load', load: 22.5, basedOn: '2026-09-15T12:00:00.000Z' });
    expect(followedRecommendation(ex(cluster(1, 22.5, 10, 2, 4, 3), { recommendation: snap }))).toBe(true);
    expect(followedRecommendation(ex(cluster(1, 20, 10, 2, 4, 3), { recommendation: snap }))).toBe(false);
    expect(followedRecommendation(ex(cluster(1, 20, 10, 2, 4, 3)))).toBeNull();
  });
});
