/**
 * Layer 6 of the progression engine: the sentences a lifter reads.
 *
 * Core decides; this pins the rendering — that every action, reason, warning
 * and stall line has a string in all three locales, that the numbers on the
 * `Recommendation` reach the sentence unchanged, and that the rep-range rules
 * (2026-10-07) come out of the real pipeline as the spec words them: the call
 * label, "Target: ≥ N reps", one line of reason, and "expected" — never
 * "guaranteed" — on an increase.
 */
import {
  type EngineCatalogFields,
  type Recommendation,
  type RecommendOptions,
  type RecommendReason,
  recommend,
  resolveEngineConfig,
} from '@macrolog/core';
import type { SessionExercise, WorkoutSet } from '@/lib/workout';
import { recommendationText, reasonText } from '@/components/train/recommendation-text';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';
import type { I18nKey, TFn } from '@/i18n';

type Row = [group: number, kind: 'activation' | 'mini', reps: number, rir?: number, weight?: number];
const ex = (rows: Row[]): SessionExercise => ({
  exerciseId: 'x', name: 'X', cues: [], logStyle: 'weight-reps',
  sets: rows.map(([group, kind, reps, rir, weight]): WorkoutSet => ({
    kind, group, reps, ...(rir != null ? { rir } : {}), ...(weight != null ? { weight } : {}),
  })),
});
/** One valid cluster: activation, then minis of 3 and 2. */
const cluster = (g: number, w: number | undefined, act: number, rir = 0, m1 = 3, m2 = 2): Row[] => [
  [g, 'activation', act, rir, w], [g, 'mini', m1, 0, w], [g, 'mini', m2, 0, w],
];
/** The engine on one lift: catalog fields resolve the rep range and steps. */
const rec = (history: SessionExercise[], catalog: EngineCatalogFields, extra: RecommendOptions = {}) =>
  recommend(history, { config: resolveEngineConfig(catalog), ...extra });
// A compound lift (6-12) loaded on "other" equipment: the default 5 lb step.
const PRESS: EngineCatalogFields = { name: 'Press', category: 'compound' };

const tFor = (dict: Record<string, string>): TFn => (key, params) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''));
const t = tFor(en as Record<string, string>);
const text = (r: Recommendation) => recommendationText(r, 'us', t)!;

const ENGINE_KEYS = (Object.keys(en) as I18nKey[]).filter((k) =>
  k.startsWith('train.rec.') || k.startsWith('train.audit.') || k.startsWith('train.muscle.') || k.startsWith('train.lift.'));

describe('recommendation text — the rep-range rules on real engine output', () => {
  it('under the top of the range: HOLD, target one more rep, the numbers in the reason', () => {
    const out = text(rec([ex(cluster(1, 100, 10))], PRESS));
    expect(out.headline).toBe('100 lb · HOLD');
    expect(out.call).toBe('hold');
    expect(out.target).toBe('Target: ≥ 11 reps');
    expect(out.reason).toBe('10 reps — under the top of the range (12). Same load, one more rep.');
    expect(out.expect).toBeNull();
  });

  it('two clusters, one short: names the cluster that holds the load', () => {
    const out = text(rec([ex([...cluster(1, 100, 12), ...cluster(2, 100, 10)])], PRESS));
    expect(out.reason).toBe('C2 gave 10 — all 2 clusters need 12 to add load. Same load, one more rep.');
    expect(out.last).toBe('Last: C1 12 @ RIR 0 · C2 10 @ RIR 0');
  });

  it('every cluster at the top: INCREASE, the next step, and what to EXPECT there', () => {
    const out = text(rec([ex(cluster(1, 100, 12))], PRESS));
    expect(out.headline).toBe('105 lb · INCREASE');
    expect(out.call).toBe('increase');
    expect(out.reason).toBe('Every cluster at the top of the range (12; lowest 12). Next step 105 lb, +5%.');
    expect(out.target).toBe('Target: ≥ 10 reps');
    expect(out.expect).toBe('Expected: about 10 reps at the new load — an estimate, not a guarantee.');
    expect(out.expect).not.toMatch(/guaranteed/i);
  });

  it('a rir1 lift: the expectation is to failure, and the target is where to stop', () => {
    const out = text(rec([ex(cluster(1, 100, 11, 1))], { ...PRESS, effortStandard: 'rir1' }));
    expect(out.headline).toBe('105 lb · INCREASE');
    expect(out.expect).toBe('Expected: about 10 to failure (9 at RIR 1) — an estimate, not a guarantee.');
    expect(out.target).toBe('Target: ≥ 9 reps @ RIR 1');
  });

  it('a step too big for the reps: build first, with the reps that would earn it', () => {
    const out = text(rec([ex(cluster(1, 100, 12))], { ...PRESS, availableLoads: [100, 120] }));
    expect(out.headline).toBe('100 lb · HOLD');
    expect(out.reason).toBe('12 reps, but 120 lb (+20%) predicts only 5 — under 6. Build reps first. 14 reps here earns 120 lb.');
    expect(out.target).toBe('Target: ≥ 13 reps');
  });

  it('no heavier step entered: build reps up to the cap', () => {
    const out = text(rec([ex(cluster(1, 100, 12))], { ...PRESS, availableLoads: [100] }));
    expect(out.reason).toBe('12 reps and no heavier step entered — build reps, up to 17.');
  });

  it('at the rep cap with the step still too big: the techniques, in order', () => {
    const r = rec([ex(cluster(1, 100, 17))], { ...PRESS, availableLoads: [100, 150], microplates: true }, { volumeAllowsCluster: true });
    const out = text(r);
    expect(out.reason).toBe('17 reps — at the 17-rep cap, and 150 lb (+50%) still predicts only 1.');
    expect(out.target).toBeNull();
    expect(out.notes).toContain('Try instead: a 3 s eccentric or a pause rep · microplates · one more cluster.');
  });

  it('at the rep cap with no heavier step at all', () => {
    const out = text(rec([ex(cluster(1, 100, 17))], { ...PRESS, availableLoads: [100] }));
    expect(out.reason).toBe('17 reps — at the 17-rep cap with no heavier step.');
    expect(out.notes).toEqual(['Try instead: a 3 s eccentric or a pause rep.']);
  });

  it('under the range after an increase: DROP BACK to the previous load and build', () => {
    const out = text(rec([ex(cluster(1, 105, 5)), ex(cluster(1, 100, 12))], PRESS));
    expect(out.headline).toBe('100 lb · DROP BACK');
    expect(out.call).toBe('drop');
    expect(out.reason).toBe('5 reps after the increase — under 6. Drop back to 100 lb and build.');
  });

  it('bodyweight: build to the top, then add 5-10 lb, else a harder variation', () => {
    const BW: EngineCatalogFields = { name: 'Pull-up', logStyle: 'bodyweight' };
    const build = text(rec([ex(cluster(1, undefined, 10))], BW));
    expect(build.headline).toBe('HOLD');
    expect(build.reason).toBe('10 reps at bodyweight — build to 15.');
    expect(build.target).toBe('Target: ≥ 11 reps');

    const add = text(rec([ex(cluster(1, undefined, 15))], { ...BW, loadable: true }));
    expect(add.headline).toBe('5 lb · INCREASE');
    expect(add.reason).toBe('15 reps at bodyweight — the top of the range (15). Add 5–10 lb.');

    const vary = text(rec([ex(cluster(1, undefined, 15))], BW));
    expect(vary.headline).toBe('HOLD');
    expect(vary.reason).toBe('15 reps at bodyweight — the top of the range (15). Move to a harder variation or a slower tempo.');
  });

  it('an invalid read: REPEAT — invalid read, and the mini reason', () => {
    const out = text(rec([ex(cluster(1, 70, 12, 2, 10, 9))], PRESS));
    expect(out.headline).toBe('70 lb · REPEAT — invalid read');
    expect(out.call).toBe('repeat-invalid');
    expect(out.reason).toBe('First mini was 10 reps; above 5 means the activation was not close enough to failure.');
    expect(out.target).toBeNull();
  });

  it('no history: FIRST SESSION', () => {
    const out = text(rec([], PRESS));
    expect(out.headline).toBe('FIRST SESSION');
    expect(out.call).toBe('start');
  });

  it('an assisted lift says REDUCE ASSISTANCE, and a metric lifter reads kilograms', () => {
    const r = rec([ex(cluster(1, 30, 12))], { ...PRESS, assisted: true });
    expect(text(r).headline).toBe('25 lb · REDUCE ASSISTANCE');
    expect(recommendationText(r, 'metric', t)!.headline).toMatch(/kg · REDUCE ASSISTANCE$/);
  });

  it('a Smith lift without the bar weight says the prediction is approximate', () => {
    const out = text(rec([ex(cluster(1, 100, 12))], { name: 'Smith Squat', category: 'compound' }));
    expect(out.notes).toContain('Approximate — the Smith bar weight is not entered, so this uses the plates alone.');
    // On a hold nothing is predicted, so nothing is approximate.
    expect(text(rec([ex(cluster(1, 100, 10))], { name: 'Smith Squat', category: 'compound' })).notes).toEqual([]);
  });

  it('a stack with no entered steps says the step is a guess', () => {
    const out = text(rec([ex(cluster(1, 100, 12))], { name: 'Chest Press Machine', category: 'compound' }));
    expect(out.notes).toContain('Stack steps not entered — assuming +5 lb.');
  });

  it('a rir1 lift taken to failure carries the soft warning', () => {
    const out = text(rec([ex(cluster(1, 80, 10, 0))], { ...PRESS, effortStandard: 'rir1' }));
    expect(out.warnings).toEqual(['Logged at failure. This lift is set to leave 1 rep in reserve.']);
  });

  it('a stall: STALLED, the three checks as flagged / ok / no data, and the swap at five', () => {
    const s = () => ex(cluster(1, 100, 10));
    const three = rec([s(), s(), s()], PRESS, { stallContext: { sleepHours: 6.46, restMiniSec: 8 } });
    const out = text(three);
    expect(out.headline).toBe('100 lb · STALLED');
    expect(out.call).toBe('stalled');
    expect(out.stall).toEqual([
      'Stalled — 3 sessions at 100 lb with no new best.',
      'Sleep under 7 h: flagged (6.5 h)',
      'Intake under target: no data',
      'Mini-set rest over 10 s: ok (8 s)',
    ]);
    const five = text(rec([s(), s(), s(), s(), s()], PRESS));
    expect(five.stall).toContain('Consider swapping for a variation.');
    expect(five.stall).toContain('Sleep under 7 h: no data');
  });

  it('straight sets: a too-big jump holds and says why (ADR-0040 path unchanged)', () => {
    const r = recommend(
      [{ exerciseId: 'x', name: 'X', cues: [], sets: [{ kind: 'working', reps: 8, weight: 10 }] }],
      { progression: { targetReps: 8, holdSessions: 1 }, availableLoads: [10, 20] },
    );
    const out = text(r);
    expect(out.headline).toBe('10 lb · HOLD');
    expect(out.reason).toBe('Next available load is 20 lb (+100%). Build to 8 reps at 10 lb first.');
  });

  it('a straight-set lift with no rep target says so rather than going quiet', () => {
    const r = recommend([{ exerciseId: 'x', name: 'X', cues: [], sets: [{ kind: 'working', reps: 8, weight: 100 }] }], {});
    expect(recommendationText(r, 'us', t)!.reason).toBe(en['train.rec.reason.noRule']);
  });
});

describe('every reason kind has a sentence', () => {
  // A Record over the union: a new reason kind without an entry here is a
  // compile error, and its sentence is then asserted to exist in every locale.
  const REASONS: { [K in RecommendReason['kind']]: Extract<RecommendReason, { kind: K }> } = {
    'no-history': { kind: 'no-history' },
    'straight-sets': { kind: 'straight-sets', reps: 6, targetReps: 8, sessionsAtTarget: 0, holdSessions: 2 },
    'rest-pause': { kind: 'rest-pause', total: 16, targetReps: 20, sessionsAtTarget: 0, holdSessions: 2 },
    'cluster-sets': { kind: 'cluster-sets', completed: 2, blocks: 3, sessionsAtTarget: 0, holdSessions: 2 },
    hit: { kind: 'hit', reps: 6, targetReps: 8, sessionsAtTarget: 0, holdSessions: 2 },
    'no-rule': { kind: 'no-rule' },
    'nothing-to-read': { kind: 'nothing-to-read' },
    'unsupported-structure': { kind: 'unsupported-structure', structure: 'drop' },
    invalid: { kind: 'invalid', reason: 'first-mini-too-many', firstMini: 9 },
    'jump-too-big': { kind: 'jump-too-big', nextLoad: 20, jumpPct: 1, repsGoal: 8 },
    increase: { kind: 'increase', reps: 12, max: 12, nextLoad: 105, jumpPct: 0.05, predictedReps: 10 },
    'below-max': { kind: 'below-max', reps: 10, max: 12, clusters: 1 },
    'step-too-big': { kind: 'step-too-big', reps: 12, nextLoad: 120, jumpPct: 0.2, predictedReps: 5, min: 6, cap: 17, repsForStep: 14 },
    'no-next-step': { kind: 'no-next-step', reps: 12, cap: 17 },
    'at-rep-cap': { kind: 'at-rep-cap', reps: 17, cap: 17, techniques: ['tempo'] },
    'drop-back': { kind: 'drop-back', reps: 5, min: 6, previousLoad: 100 },
    'bodyweight-build': { kind: 'bodyweight-build', reps: 10, max: 15 },
    'bodyweight-add-load': { kind: 'bodyweight-add-load', reps: 15, max: 15, startLb: [5, 10] },
    'bodyweight-variation': { kind: 'bodyweight-variation', reps: 15, max: 15 },
    'baseline-pending': { kind: 'baseline-pending', since: '2026-10-09', note: 'position changed 10/9' },
    'baseline-set': { kind: 'baseline-set', reps: 9, note: 'position changed 10/9' },
    'baseline-drop-back': { kind: 'baseline-drop-back', reps: 4, below: 5, to: 60, note: 'position changed 10/9' },
    'lifter-load': { kind: 'lifter-load', load: 90, engineLoad: 85 },
  };
  const base: Recommendation = {
    action: 'hold', load: 100, currentLoad: 100, last: [], assisted: false, approximate: false, warnings: [],
    reason: { kind: 'no-history' },
  };

  it.each(Object.keys(REASONS))('%s renders, with every placeholder filled, in all three locales', (kind) => {
    const r = { ...base, reason: REASONS[kind as RecommendReason['kind']] } as Recommendation;
    for (const dict of [en, esPR, ptBR] as Record<string, string>[]) {
      const line = reasonText(r, 'us', tFor(dict));
      expect(line).not.toBe('');
      expect(line).not.toMatch(/\{\w+\}/);
      // An unknown key renders as itself — never as a sentence.
      expect(line).not.toMatch(/^train\./);
    }
  });
});

describe('every engine string exists in all three locales', () => {
  it('es-PR and pt-BR carry every train.rec / train.audit / train.muscle / train.lift key', () => {
    for (const key of ENGINE_KEYS) {
      expect((esPR as Record<string, string>)[key]).toBeTruthy();
      expect((ptBR as Record<string, string>)[key]).toBeTruthy();
    }
    expect(ENGINE_KEYS.length).toBeGreaterThan(50);
  });

  it('placeholders match across locales, so no number is dropped in translation', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of ENGINE_KEYS) {
      expect(holes((esPR as Record<string, string>)[key])).toEqual(holes((en as Record<string, string>)[key]));
      expect(holes((ptBR as Record<string, string>)[key])).toEqual(holes((en as Record<string, string>)[key]));
    }
  });

  it('the retired band and calibration strings have nothing left behind in any locale', () => {
    for (const dict of [en, esPR, ptBR] as Record<string, string>[]) {
      expect(dict['train.rec.invalid.rirToFailure']).toBeUndefined();
      expect(dict['train.invalidRirFailure']).toBeUndefined();
      expect(dict['train.rec.calibrating']).toBeUndefined();
      expect(dict['train.rec.reason.belowBand']).toBeUndefined();
    }
  });
});
