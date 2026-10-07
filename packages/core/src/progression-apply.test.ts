import { describe, expect, it } from 'vitest';
import {
  applyTemplateChanges,
  finishProgression,
  loadChangesFor,
  logUserLoadEdits,
  proposeTemplateChanges,
} from './progression-apply';
import { recommend, resolveEngineConfig, type Recommendation } from './progression-engine';
import type { SessionExercise, TemplateExercise } from './workout';

const AT = new Date('2026-10-07T13:00:00Z');
const reasonFor = (r: Recommendation) => `${r.action} ${r.load ?? ''}`.trim();

const cluster = (w: number, act: number, rir = 0, m1 = 4, m2 = 3) => [
  { kind: 'activation' as const, group: 1, weight: w, reps: act, rir },
  { kind: 'mini' as const, group: 1, weight: w, reps: m1, rir: 0 },
  { kind: 'mini' as const, group: 1, weight: w, reps: m2, rir: 0 },
];
const logged = (id: string, sets: SessionExercise['sets']): SessionExercise => ({ exerciseId: id, name: id, cues: [], sets });
const row = (id: string, targetLoad: number | undefined, extra: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId: id, name: id, targetLoad, cues: [],
  plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }],
  ...extra,
});
const rec = (name: string, sets: SessionExercise['sets'], catalog = {}) =>
  recommend([logged(name, sets)], { expectsCluster: true, structure: 'myoreps', config: resolveEngineConfig({ name, ...catalog }) });

// The 10/6 Leg Day as logged, read the way the finish sheet reads it.
const LEG = new Map<string, Recommendation>([
  ['Leg Extensions', rec('Leg Extensions', cluster(80, 14), { availableLoads: [70, 80, 90] })],
  ['Single-leg DB calf raise', rec('Single-leg DB calf raise', cluster(25, 14, 0, 5, 4))],
  ['Weighted Floor Crunch', rec('Weighted Floor Crunch', cluster(25, 15, 0, 6, 4))], // invalid: first mini 6
  ['Smith squat', rec('Smith squat', [...cluster(25, 13, 1, 5, 4), ...cluster(25, 13, 1, 4, 3).map((s) => ({ ...s, group: 2 }))], { effortStandard: 'rir1' })],
]);
const LEG_ROWS = [
  row('Smith squat', 15),
  row('Leg Extensions', 80),
  row('Single-leg DB calf raise', 25),
  row('Weighted Floor Crunch', 30),
];

describe('proposeTemplateChanges', () => {
  it('increases move the load; a hold at the template load proposes nothing; an invalid read never moves it', () => {
    const changes = proposeTemplateChanges(LEG_ROWS, LEG, reasonFor);
    expect(changes.map((c) => [c.exerciseId, c.from, c.to, c.call])).toEqual([
      ['Smith squat', 15, 30, 'increase'],
      ['Leg Extensions', 80, 90, 'increase'],
    ]);
    // The crunch's invalid read (repeat 25) must not drag the template's 30 back.
    expect(changes.find((c) => c.exerciseId === 'Weighted Floor Crunch')).toBeUndefined();
  });

  it('a hold proposes the lifted load when the template drifted from it (Incline curl: template 20, lifted 15)', () => {
    const recs = new Map([['curl', rec('Incline DB Curl 45°', cluster(15, 13))]]);
    expect(proposeTemplateChanges([row('curl', 20)], recs, reasonFor)).toMatchObject([{ from: 20, to: 15, call: 'hold' }]);
  });
});

describe('applyTemplateChanges', () => {
  it('moves targetLoad, logs the move with date, source and reason, and leaves a drop set\'s own weight alone', () => {
    const rows = [row('curl', 15, { plannedSets: [{ kind: 'activation', group: 1, weight: 15 }, { kind: 'mini', group: 1 }, { kind: 'drop', weight: 10 }] })];
    const [out] = applyTemplateChanges(rows, [{ exerciseId: 'curl', name: 'curl', from: 15, to: 20, call: 'increase', reason: 'Increase to 20' }], { at: AT, by: 'engine' });
    expect(out.targetLoad).toBe(20);
    expect(out.plannedSets.map((p) => p.weight)).toEqual([20, undefined, 10]);
    expect(out.loadLog).toEqual([{ at: '2026-10-07T13:00:00.000Z', from: 15, to: 20, by: 'engine', reason: 'Increase to 20' }]);
  });

  it('appends to an existing log rather than replacing it', () => {
    const prior = { at: '2026-10-01T00:00:00.000Z', from: 10, to: 15, by: 'user' as const, reason: 'edit' };
    const [out] = applyTemplateChanges([row('curl', 15, { loadLog: [prior] })], [{ exerciseId: 'curl', name: 'curl', from: 15, to: 20, call: 'increase', reason: 'r' }], { at: AT, by: 'engine' });
    expect(out.loadLog).toHaveLength(2);
    expect(out.loadLog?.[0]).toEqual(prior);
  });
});

describe('finishProgression — the auto-apply setting', () => {
  it('Auto-apply OFF → the template is unchanged until the user taps Apply', () => {
    const { proposed, applied } = finishProgression({ rows: LEG_ROWS, recs: LEG, autoApply: false, at: AT, reasonFor });
    expect(applied).toBeNull();
    expect(proposed).toHaveLength(2);
    expect(LEG_ROWS.map((r) => r.targetLoad)).toEqual([15, 80, 25, 30]);
    // The tap: only the change the lifter left switched on is applied, as the engine's.
    const tapped = applyTemplateChanges(LEG_ROWS, proposed.filter((c) => c.exerciseId === 'Leg Extensions'), { at: AT, by: 'engine' });
    expect(tapped.map((r) => r.targetLoad)).toEqual([15, 90, 25, 30]);
  });

  it('Auto-apply ON → every proposed change is applied and logged as the engine\'s', () => {
    const { applied } = finishProgression({ rows: LEG_ROWS, recs: LEG, autoApply: true, at: AT, reasonFor });
    expect(applied?.map((r) => r.targetLoad)).toEqual([30, 90, 25, 30]);
    expect(applied?.[0].loadLog?.[0]).toMatchObject({ from: 15, to: 30, by: 'engine' });
  });
});

describe('logUserLoadEdits — the lifter\'s own moves are logged too', () => {
  it('logs a changed load as by: user and carries an existing log across an editor rebuild', () => {
    const prior = { at: '2026-10-01T00:00:00.000Z', from: 80, to: 90, by: 'engine' as const, reason: 'r' };
    const before = [row('pulldown', 80, { loadLog: [prior] }), row('row', 100)];
    const after = [row('pulldown', 90), row('row', 100), row('new', 20)];
    const out = logUserLoadEdits(before, after, { at: AT, reason: 'Edited in the template' });
    expect(out[0].loadLog).toEqual([prior, { at: '2026-10-07T13:00:00.000Z', from: 80, to: 90, by: 'user', reason: 'Edited in the template' }]);
    expect(out[1].loadLog).toBeUndefined();
    expect(out[2].loadLog).toBeUndefined();
  });
});

describe('loadChangesFor', () => {
  it('merges an exercise\'s moves across templates, oldest first', () => {
    const t = (name: string, at: string) => ({ name, exercises: [{ exerciseId: 'x', loadLog: [{ at, to: 1, by: 'user' as const, reason: '' }] }] });
    expect(loadChangesFor([t('B', '2026-10-05T00:00:00Z'), t('A', '2026-10-01T00:00:00Z')], 'x').map((c) => c.template)).toEqual(['A', 'B']);
  });
});
