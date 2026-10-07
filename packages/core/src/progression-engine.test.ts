/**
 * The progression engine, pinned against the owner's real sessions.
 *
 * Every historical fixture below is a set sequence read out of Firestore on
 * 2026-09-15 (`users/…/workoutSessions`), not invented — the spec lists these
 * dates as the validation cases, and a rule that passes on synthetic clusters
 * and fails on the ones that were actually logged is the failure mode to
 * avoid. ADR-0039 amended the standard (RIR 0 is in band, legacy sets are
 * excluded), and the 2026-10-07 rules replaced its derived band with a rep
 * range per lift; the cases named in that spec are pinned below by date.
 */
import { describe, expect, it } from 'vitest';
import {
  FIRST_MINI_MAX,
  FIRST_MINI_MIN,
  MAX_JUMP_PCT,
  REP_CAP_EXTRA,
  STALL_SESSIONS,
  SWAP_SESSIONS,
  type EngineCatalogFields,
  detectStall,
  effectiveReps,
  epleyE1rm,
  followedRecommendation,
  inferCategory,
  inferEquipment,
  nextLoad,
  predictedRepsAt,
  progressionCall,
  readExercise,
  recommend,
  recommendOptionsFor,
  resolveEngineConfig,
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

/** Engine options for a named lift, resolved the way the app resolves them. */
const lift = (name: string, catalog: EngineCatalogFields = {}, incrementLb?: number) =>
  ({
    ...clustered,
    structure: 'myoreps' as const,
    config: resolveEngineConfig({ name, ...catalog }, incrementLb != null ? { progression: { incrementLb } } : null),
  });

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

  it('a load change INSIDE a cluster is a load change too (9/30 hammer curl 20 → 15 → 20); a drop set is not', () => {
    const hammer = ex([[1, 'activation', 8, 0, 20], [1, 'mini', 3, 0, 15], [1, 'mini', 2, 0, 20]]);
    expect(readExercise(hammer, clustered)).toMatchObject({ valid: false, issue: 'load-changed' });
    const withDrop = ex(cluster(1, 15, 11, 0, 4, 3));
    withDrop.sets.push({ kind: 'drop', weight: 10, reps: 8 });
    expect(readExercise(withDrop, clustered)).toMatchObject({ valid: true, load: 15 });
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

// ─── Configuration ──────────────────────────────────────────────

describe('per-lift configuration — category, rep range, steps', () => {
  it('infers the spec\'s categories from the owner\'s lift names', () => {
    const cat = (n: string) => inferCategory(n);
    expect(['Smith squat', 'DB Romanian deadlift', 'Seated DB Shoulder Press', 'DB Flat Press', 'Seated Machine Row',
      'Wide-grip lat pulldown', 'Chest-supported DB row', 'Leg Extensions', 'Leg Curls'].map(cat))
      .toEqual(Array(9).fill('compound'));
    expect(['DB Lateral Raise', 'Rear delt DB flye', 'Incline DB Curl 45°', 'DB hammer curl', 'Overhead DB Extension',
      'Skull Crusher', 'Single-leg DB calf raise'].map(cat))
      .toEqual(Array(7).fill('isolation'));
    expect(cat('Weighted Floor Crunch')).toBe('core');
    expect(['Neutral-grip pull-up', 'Deficit Push-up', 'Hanging Knee Raise', 'Chest Dip (forward lean)'].map(cat))
      .toEqual(Array(4).fill('bodyweight'));
  });

  it('category defaults: compound 6-12, isolation and core 8-15, bodyweight 6-15; an override wins', () => {
    expect(resolveEngineConfig({ name: 'Leg Extensions' }).repRange).toEqual({ min: 6, max: 12 });
    expect(resolveEngineConfig({ name: 'DB Lateral Raise' }).repRange).toEqual({ min: 8, max: 15 });
    expect(resolveEngineConfig({ name: 'Weighted Floor Crunch' }).repRange).toEqual({ min: 8, max: 15 });
    expect(resolveEngineConfig({ name: 'Neutral-grip pull-up' }).repRange).toEqual({ min: 6, max: 15 });
    expect(resolveEngineConfig({ name: 'Leg Extensions', repRange: { min: 8, max: 10 } }))
      .toMatchObject({ repRange: { min: 8, max: 10 }, repRangeSource: 'set' });
    // A nonsense override is ignored rather than trusted.
    expect(resolveEngineConfig({ name: 'Leg Extensions', repRange: { min: 12, max: 6 } }).repRange).toEqual({ min: 6, max: 12 });
  });

  it('steps: dumbbells and Smith in 5 lb; a stack uses the entered steps, else guesses from the template', () => {
    expect(inferEquipment('Incline DB Curl 45°')).toBe('dumbbell');
    expect(inferEquipment('Smith squat')).toBe('smith');
    expect(inferEquipment('Leg Extensions')).toBe('stack');
    expect(resolveEngineConfig({ name: 'DB hammer curl' })).toMatchObject({ stepLb: 5, stepsUnknown: false });
    expect(resolveEngineConfig({ name: 'Wide-grip lat pulldown' }, { progression: { incrementLb: 5 } }))
      .toMatchObject({ equipment: 'stack', stepsUnknown: true, stepLb: 5 });
    expect(resolveEngineConfig({ name: 'Leg Extensions', availableLoads: [90, 70, 80] }))
      .toMatchObject({ loadSteps: [70, 80, 90], stepsUnknown: false });
  });

  it('a Smith lift is approximate until its bar weight is entered; effort standard defaults to failure', () => {
    expect(resolveEngineConfig({ name: 'Smith squat' })).toMatchObject({ approximate: true, effortStandard: 'failure' });
    expect(resolveEngineConfig({ name: 'Smith squat', smithBarEffectiveLb: 15, effortStandard: 'rir1' }))
      .toMatchObject({ approximate: false, smithBarEffectiveLb: 15, effortStandard: 'rir1' });
    expect(resolveEngineConfig({ name: 'Neutral-grip pull-up' }).loadable).toBe(false);
  });
});

// ─── Rule 2 + Epley ─────────────────────────────────────────────

describe('rule 2 — effective reps, and the Epley prediction', () => {
  it('effective reps = activation reps + logged RIR (Smith 13 @ RIR 1 = 14)', () => {
    expect(effectiveReps({ reps: 13, rir: 1 })).toBe(14);
    expect(effectiveReps({ reps: 13, rir: 0 })).toBe(13);
    expect(effectiveReps({ reps: 13 })).toBe(13);
  });

  it('e1RM = w × (1 + reps/30); predicted = ⌊30 × (e1RM/w2 − 1)⌋', () => {
    expect(epleyE1rm(80, 14)).toBeCloseTo(117.333, 3);
    expect(predictedRepsAt(epleyE1rm(80, 14), 90)).toBe(9);
    expect(predictedRepsAt(epleyE1rm(15, 15), 20)).toBe(3);
    expect(predictedRepsAt(epleyE1rm(80, 12), 90)).toBe(7);
    // Exact boundaries floor to the integer, not one under it.
    expect(predictedRepsAt(epleyE1rm(25, 18), 30)).toBe(10);
    expect(predictedRepsAt(100, 200)).toBe(0);
  });
});

// ─── The spec's real cases (2.6) ────────────────────────────────

describe('the 2026-10-07 cases, one per rule', () => {
  it('Leg extension 80 × 14 → increase to 90, predicting 9', () => {
    const rec = recommend([ex(cluster(1, 80, 14, 0, 4, 3))], lift('Leg Extensions', { availableLoads: [70, 80, 90] }));
    expect(rec).toMatchObject({ action: 'add-load', load: 90, predictedReps: 9, targetReps: 9 });
    expect(rec.reason).toMatchObject({ kind: 'increase', reps: 14, max: 12, nextLoad: 90, predictedReps: 9 });
    expect(progressionCall(rec)).toBe('increase');
  });

  it('Incline curl 15 × 15 → hold; 20 predicts 3 reps, below 8', () => {
    const rec = recommend([ex(cluster(1, 15, 15, 0, 4, 2))], lift('Incline DB Curl 45°'));
    expect(rec).toMatchObject({ action: 'build-reps', load: 15, targetReps: 16 });
    expect(rec.reason).toMatchObject({ kind: 'step-too-big', nextLoad: 20, predictedReps: 3, min: 8, cap: 15 + REP_CAP_EXTRA });
    expect(progressionCall(rec)).toBe('hold');
  });

  it('Single-leg calf raise 25 × 14 → hold; below the max of 15', () => {
    const rec = recommend([ex(cluster(1, 25, 14, 0, 5, 4))], lift('Single-leg DB calf raise'));
    expect(rec).toMatchObject({ action: 'hold', load: 25, targetReps: 15 });
    expect(rec.reason).toEqual({ kind: 'below-max', reps: 14, max: 15, clusters: 1 });
  });

  it('Pulldown 80 × 12 → increase to 90, predicting 7 (on a stack that steps 80 → 90)', () => {
    const rec = recommend([ex(cluster(1, 80, 12, 0, 5, 3))], lift('Wide-grip lat pulldown', { availableLoads: [70, 80, 90, 100] }));
    expect(rec).toMatchObject({ action: 'add-load', load: 90, predictedReps: 7 });
    // With no steps entered the engine guesses the template's 5 lb and says so.
    const guess = recommend([ex(cluster(1, 80, 12, 0, 5, 3))], lift('Wide-grip lat pulldown', {}, 5));
    expect(guess).toMatchObject({ action: 'add-load', load: 85, predictedReps: 9 });
    expect(guess.config?.stepsUnknown).toBe(true);
  });

  it('Machine row 100 × 11/11 → hold, target 12', () => {
    const rec = recommend(
      [ex([...cluster(1, 100, 11, 0, 4, 2), ...cluster(2, 100, 11, 0, 3, 2)])],
      lift('Seated Machine Row', { effortStandard: 'rir1' }),
    );
    expect(rec).toMatchObject({ action: 'hold', load: 100, targetReps: 12 });
    expect(rec.reason).toMatchObject({ kind: 'below-max', reps: 11, max: 12, clusters: 2 });
    // The row is a 1-in-reserve lift logged at RIR 0: warned, not invalidated.
    expect(rec.warnings).toEqual(['failure-on-rir1']);
  });

  it('Smith squat 25 × 13/13 @ RIR 1 → effective 14 → increase (approximate until the bar is entered)', () => {
    const sets = [...cluster(1, 25, 13, 1, 5, 4), ...cluster(2, 25, 13, 1, 4, 3)];
    const rec = recommend([ex(sets)], lift('Smith squat', { effortStandard: 'rir1' }));
    expect(rec).toMatchObject({ action: 'add-load', load: 30, predictedReps: 6, approximate: true });
    expect(rec.reason).toMatchObject({ kind: 'increase', reps: 14 });
    // A rir1 lift's target is stated in LOGGED reps: one under the prediction.
    expect(rec.targetReps).toBe(5);
    expect(rec.warnings).toEqual([]);
    // With a 15 lb bar the total load moves the prediction, and it is no longer approximate.
    const withBar = recommend([ex(sets)], lift('Smith squat', { effortStandard: 'rir1', smithBarEffectiveLb: 15 }));
    expect(withBar).toMatchObject({ action: 'add-load', load: 30, predictedReps: 9, approximate: false });
  });

  it('an invalid first mini-set of 6 → repeat', () => {
    const rec = recommend([ex(cluster(1, 25, 15, 0, 6, 4))], lift('Weighted Floor Crunch'));
    expect(rec).toMatchObject({ action: 'repeat-invalid', load: 25 });
    expect(rec.reason).toMatchObject({ kind: 'invalid', reason: 'first-mini-too-many', firstMini: 6 });
    expect(rec.targetReps).toBeUndefined();
    expect(progressionCall(rec)).toBe('repeat-invalid');
  });

  it('a load change mid-exercise → repeat', () => {
    const rec = recommend([ex([...cluster(1, 25, 9, 0, 4, 3), [2, 'activation', 9, 0, 25], [2, 'mini', 4, 0, 25], [2, 'mini', 3, 0, 28]])], lift('Smith squat'));
    expect(rec).toMatchObject({ action: 'repeat-invalid', reason: { kind: 'invalid', reason: 'load-changed' } });
  });

  it('bodyweight pull-up at 12 → build reps', () => {
    const rec = recommend([ex([[1, 'activation', 12, 0, 0], [1, 'mini', 4, 0, 0], [1, 'mini', 2, 0, 0]])], lift('Neutral-grip pull-up'));
    expect(rec).toMatchObject({ action: 'build-reps', targetReps: 13 });
    expect(rec.reason).toEqual({ kind: 'bodyweight-build', reps: 12, max: 15 });
  });
});

// ─── Rule 3 — the cap and what comes after it ───────────────────

describe('rule 3 — build to max + 5, then a technique, never a guess', () => {
  it('2026-10-02 DB flat press 20 × 15/13: 25 predicts 4, under 6 → hold at 20, build to 15', () => {
    const rec = recommend(
      [ex([...cluster(1, 20, 15, 0, 5, 4), ...cluster(2, 20, 13, 0, 4, 4)])],
      lift('DB Flat Press'),
    );
    expect(rec).toMatchObject({ action: 'build-reps', load: 20, targetReps: 14 });
    expect(rec.reason).toMatchObject({ kind: 'step-too-big', reps: 13, nextLoad: 25, predictedReps: 4, min: 6, cap: 17, repsForStep: 15 });
  });

  it('at the cap the step is still too big: tempo first, microplates if owned, a cluster only if volume allows', () => {
    const capped = [ex(cluster(1, 15, 20, 0, 5, 3))];
    expect(recommend(capped, lift('Incline DB Curl 45°')).reason)
      .toMatchObject({ kind: 'at-rep-cap', cap: 20, nextLoad: 20, techniques: ['tempo'] });
    expect(recommend(capped, lift('Incline DB Curl 45°', { microplates: true })).reason)
      .toMatchObject({ techniques: ['tempo', 'microplates'] });
    expect(recommend(capped, { ...lift('Incline DB Curl 45°', { microplates: true }), volumeAllowsCluster: true }).reason)
      .toMatchObject({ techniques: ['tempo', 'microplates', 'add-cluster'] });
  });

  it('the entered steps run out: build to the cap, then a technique', () => {
    const top = lift('Leg Extensions', { availableLoads: [70, 80, 90] });
    expect(recommend([ex(cluster(1, 90, 14, 0, 4, 3))], top))
      .toMatchObject({ action: 'build-reps', load: 90, targetReps: 15, reason: { kind: 'no-next-step', cap: 17 } });
    expect(recommend([ex(cluster(1, 90, 17, 0, 4, 3))], top).reason)
      .toMatchObject({ kind: 'at-rep-cap', techniques: ['tempo'] });
  });

  it('every cluster must reach the top; the lowest one binds and is named', () => {
    const rec = recommend([ex([...cluster(1, 80, 13, 0, 4, 3), ...cluster(2, 80, 10, 0, 3, 2)])], lift('Leg Curls', { availableLoads: [70, 80, 90] }));
    expect(rec).toMatchObject({ action: 'hold', targetReps: 11, reason: { kind: 'below-max', reps: 10, group: 2, clusters: 2 } });
  });

  it('the e1RM comes from the LOWEST cluster', () => {
    // 20/14 at 80: binding 14 → 90 predicts 9, not the 16 a 20 would claim.
    const rec = recommend([ex([...cluster(1, 80, 20, 0, 4, 3), ...cluster(2, 80, 14, 0, 3, 2)])], lift('Leg Curls', { availableLoads: [70, 80, 90] }));
    expect(rec.predictedReps).toBe(9);
  });

  it('an assisted lift moves to LESS assistance on the rep rule, floored at zero', () => {
    expect(nextLoad(40, { assisted: true, availableLoads: [20, 30, 40, 50] })).toEqual({ load: 30, jumpPct: 0.25 });
    expect(nextLoad(3, { assisted: true, incrementLb: 5 })).toEqual({ load: 0, jumpPct: 1 });
    const rec = recommend([ex(cluster(1, 30, 15, 0, 4, 2))], lift('Chest Dip (forward lean)', { assisted: true }));
    expect(rec).toMatchObject({ action: 'add-load', load: 25, assisted: true });
  });
});

// ─── Rule 5 — drop back ─────────────────────────────────────────

describe('rule 5 — the first session after an increase, under the range, drops back', () => {
  const press = (w: number, act: number, m1 = 2, m2 = 2) => ex(cluster(1, w, act, 0, m1, m2));

  it('20 → 25 and the activation comes in at 5 (< 6) → back to 20 and build', () => {
    const rec = recommend([press(25, 5), press(20, 15, 5, 4)], lift('DB Flat Press'));
    expect(rec).toMatchObject({ action: 'drop-back', load: 20, reason: { kind: 'drop-back', reps: 5, min: 6, previousLoad: 20 } });
    expect(progressionCall(rec)).toBe('drop');
  });

  it('at or above min after the increase it is an ordinary hold; and not on a second session at the new load', () => {
    expect(recommend([press(25, 6), press(20, 15, 5, 4)], lift('DB Flat Press')).action).toBe('hold');
    expect(recommend([press(25, 5), press(25, 5), press(20, 15, 5, 4)], lift('DB Flat Press')).action).toBe('hold');
  });
});

// ─── Rule 6 — stalls ────────────────────────────────────────────

describe('rule 6 — stall detection with a checklist', () => {
  const s = (reps: number, w = 20, m1 = 4) => ex(cluster(1, w, reps, 0, m1, 3));
  const hammer = lift('DB hammer curl');

  it('three valid sessions with no new best → stalled, with the three checks', () => {
    const rec = recommend([s(10), s(10), s(10)], { ...hammer, stallContext: { sleepHours: 6.5, intakeBelowTarget: false, restMiniSec: 10 } });
    expect(rec.action).toBe('hold');
    expect(progressionCall(rec)).toBe('stalled');
    expect(rec.stall).toEqual({
      sessions: 3, load: 20, reps: [10, 10, 10], suggestSwap: false,
      checks: [
        { check: 'sleep', status: 'flag', value: 6.5 },
        { check: 'intake', status: 'ok' },
        { check: 'mini-rest', status: 'ok', value: 10 },
      ],
    });
    expect(STALL_SESSIONS).toBe(3);
  });

  it('a missing fact is "unknown", never "fine"; over 10 s of mini rest is flagged', () => {
    const rec = recommend([s(10), s(10), s(10)], { ...hammer, stallContext: { restMiniSec: 15 } });
    expect(rec.stall?.checks).toEqual([
      { check: 'sleep', status: 'unknown' },
      { check: 'intake', status: 'unknown' },
      { check: 'mini-rest', status: 'flag', value: 15 },
    ]);
  });

  it('five sessions → suggest swapping the exercise for a variation', () => {
    expect(detectStall([s(10), s(9), s(10), s(10), s(10)], hammer)).toMatchObject({ sessions: 5, suggestSwap: true });
    expect(SWAP_SESSIONS).toBe(5);
  });

  it('a new best restarts the count; an invalid session is skipped, not counted; a load change ends the run', () => {
    expect(detectStall([s(11), s(10), s(10)], hammer)).toBeNull();
    expect(detectStall([s(10), s(11), s(10), s(10)], hammer)).toBeNull(); // 11 was the best two sessions ago
    expect(detectStall([s(10), s(10, 20, 8), s(10)], hammer)).toBeNull(); // the middle one is invalid
    expect(detectStall([s(10), s(10, 20, 8), s(10), s(10)], hammer)?.sessions).toBe(3);
    expect(detectStall([s(10), s(10), s(10, 15)], hammer)).toBeNull();
  });

  it('no stall rides on a call that moves the load', () => {
    const rec = recommend([s(12, 80), s(12, 80), s(12, 80)], lift('Leg Curls', { availableLoads: [70, 80, 90] }));
    expect(rec.action).toBe('add-load');
    expect(rec.stall).toBeUndefined();
  });
});

// ─── Rule 7 — bodyweight ────────────────────────────────────────

describe('rule 7 — bodyweight lifts', () => {
  const bw = (reps: number) => ex([[1, 'activation', reps, 0, 0], [1, 'mini', 4, 0, 0], [1, 'mini', 3, 0, 0]]);

  it('Hanging knee raise at 8 → build toward 15', () => {
    expect(recommend([bw(8)], lift('Hanging Knee Raise'))).toMatchObject({ action: 'build-reps', targetReps: 9 });
  });

  it('at the top of the range: add 5-10 lb if loadable, else a harder variation or slower tempo', () => {
    expect(recommend([bw(15)], lift('Neutral-grip pull-up', { loadable: true })))
      .toMatchObject({ action: 'add-load', load: 5, reason: { kind: 'bodyweight-add-load', startLb: [5, 10] } });
    expect(recommend([bw(15)], lift('Neutral-grip pull-up')))
      .toMatchObject({ action: 'build-reps', reason: { kind: 'bodyweight-variation', reps: 15, max: 15 } });
  });

  it('once loaded, the added load moves on the rep rule alone — no Epley off a load that excludes the body', () => {
    const loaded = ex(cluster(1, 10, 15, 0, 4, 3));
    const rec = recommend([loaded], lift('Neutral-grip pull-up', { loadable: true }));
    expect(rec).toMatchObject({ action: 'add-load', load: 15 });
    expect(rec.predictedReps).toBeUndefined();
    expect(recommend([ex(cluster(1, 10, 12, 0, 4, 3))], lift('Neutral-grip pull-up', { loadable: true })))
      .toMatchObject({ action: 'hold', targetReps: 13 });
  });
});

// ─── Rule 8 + effort standard ───────────────────────────────────

describe('rule 8 — a rir1 lift runs the same rules on effective reps', () => {
  it('Smith 25 × 11/11 @ RIR 1 is 12/12 effective: a candidate — but 30 predicts 5, under 6, so build', () => {
    const rec = recommend([ex([...cluster(1, 25, 11, 1, 4, 3), ...cluster(2, 25, 11, 1, 4, 3)])], lift('Smith squat', { effortStandard: 'rir1' }));
    expect(rec.reason).toMatchObject({ kind: 'step-too-big', reps: 12, nextLoad: 30, predictedReps: 5, repsForStep: 14 });
    expect(rec).toMatchObject({ action: 'build-reps', load: 25 });
  });

  it('the same log at RIR 0 is 11 effective: hold, and the RIR 0 is warned on', () => {
    const rec = recommend([ex([...cluster(1, 25, 11, 0, 4, 3), ...cluster(2, 25, 11, 0, 4, 3)])], lift('Smith squat', { effortStandard: 'rir1' }));
    expect(rec).toMatchObject({ action: 'hold', warnings: ['failure-on-rir1'], targetReps: 12 });
  });
});

// ─── History handling ───────────────────────────────────────────

describe('history — legacy sets, no history, straight sets', () => {
  it('legacy sessions are skipped entirely: the call reads the newest standard-conforming one', () => {
    const rec = recommend([legacy(ex(cluster(1, 80, 15, 2, 4, 3)))], lift('Leg Curls'));
    expect(rec).toMatchObject({ action: 'calibrate', reason: { kind: 'no-history' } });
    const mixed = recommend([ex(cluster(1, 80, 11, 0, 4, 3)), legacy(ex(cluster(1, 70, 12, 2, 4, 3)))], lift('Leg Curls'));
    expect(mixed).toMatchObject({ action: 'hold', targetReps: 12 });
  });

  it('a legacy session before an increase is not "the previous load" for drop-back', () => {
    const rec = recommend([ex(cluster(1, 25, 5, 0, 2, 2)), legacy(ex(cluster(1, 20, 15, 2, 5, 4)))], lift('DB Flat Press'));
    expect(rec.action).toBe('hold');
  });

  it('no history → start; straight sets → none (double progression is untouched)', () => {
    expect(recommend([], lift('Leg Curls'))).toMatchObject({ action: 'calibrate', reason: { kind: 'no-history' } });
    expect(progressionCall(recommend([], lift('Leg Curls')))).toBe('start');
    expect(recommend([ex([], { sets: [{ kind: 'working', reps: 8, weight: 100 }] })], {}).action).toBe('none');
    expect(MAX_JUMP_PCT).toBe(0.15);
  });
});

// ─── Wiring ─────────────────────────────────────────────────────

describe('wiring helpers', () => {
  it('builds options from the template row and the catalog exercise, config included', () => {
    const opts = recommendOptionsFor(
      { name: 'Smith squat', plannedSets: [{ kind: 'activation' }, { kind: 'mini' }], progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 } },
      { name: 'Smith squat', availableLoads: [10, 20], assisted: true, effortStandard: 'rir1' },
    );
    expect(opts).toMatchObject({
      expectsCluster: true,
      // ADR-0040: resolved from the template's plannedSets when neither the
      // template nor the catalog declares one.
      structure: 'myoreps',
      progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 },
      availableLoads: [10, 20],
      assisted: true,
      effortStandard: 'rir1',
    });
    expect(opts.config).toMatchObject({ category: 'compound', equipment: 'smith', loadSteps: [10, 20], effortStandard: 'rir1', approximate: true });
    expect(recommendOptionsFor({ plannedSets: [{ kind: 'working' }] }, null))
      .toMatchObject({ expectsCluster: false, structure: 'straight' });
    // A declared structure beats the set list it contradicts.
    expect(recommendOptionsFor({ plannedSets: [{ kind: 'working' }], setStructure: 'myoreps' }, null))
      .toMatchObject({ structure: 'myoreps' });
    // Catalog default, used when the template states nothing.
    expect(recommendOptionsFor({ plannedSets: [{ kind: 'working' }] }, { setStructure: 'hit' }))
      .toMatchObject({ structure: 'hit' });
  });

  it('freezes the storable subset — target and prediction included — and audits whether it was followed', () => {
    const rec = recommend([ex(cluster(1, 80, 14, 0, 4, 3))], lift('Leg Extensions', { availableLoads: [70, 80, 90] }));
    const snap = toRecommendationSnapshot(rec, new Date('2026-10-06T12:00:00Z'));
    expect(snap).toEqual({ action: 'add-load', load: 90, basedOn: '2026-10-06T12:00:00.000Z', targetReps: 9, predictedReps: 9 });
    expect(followedRecommendation(ex(cluster(1, 90, 10, 0, 4, 3), { recommendation: snap }))).toBe(true);
    expect(followedRecommendation(ex(cluster(1, 80, 10, 0, 4, 3), { recommendation: snap }))).toBe(false);
    expect(followedRecommendation(ex(cluster(1, 80, 10, 0, 4, 3)))).toBeNull();
  });
});
