/**
 * Layer 6 of the progression engine: the sentences a lifter reads.
 *
 * Core decides; this pins the rendering — that every action, reason and
 * stall line has a string in all three locales, that the numbers on the
 * `Recommendation` reach the sentence unchanged, and that the spec's example
 * strings come out of the real pipeline on the real 2026-09-15 numbers.
 */
import { recommend, type Recommendation } from '@macrolog/core';
import type { SessionExercise, WorkoutSet } from '@/lib/workout';
import { recommendationText } from '@/components/train/recommendation-text';
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
const cluster = (g: number, w: number, act: number, rir: number, m1: number, m2: number): Row[] => [
  [g, 'activation', act, rir, w], [g, 'mini', m1, 0, w], [g, 'mini', m2, 0, w],
];

const tFor = (dict: Record<string, string>): TFn => (key, params) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''));
const t = tFor(en as Record<string, string>);

const ENGINE_KEYS = (Object.keys(en) as I18nKey[]).filter((k) => k.startsWith('train.rec.') || k.startsWith('train.audit.') || k.startsWith('train.muscle.'));

describe('recommendation text — the spec examples on the real numbers', () => {
  it('Smith squat, C2 blocked: "20 lb · HOLD AND BUILD" + the cluster reason', () => {
    const rec = recommend(
      [ex([...cluster(1, 20, 11, 1, 5, 3), ...cluster(2, 20, 10, 1, 4, 2)])],
      { expectsCluster: true, progression: { targetReps: 12, incrementLb: 5, holdSessions: 2 } },
    );
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('20 lb · HOLD AND BUILD');
    expect(text.reason).toBe('C2 gave 10 reps last session; both clusters need 11-12.');
    expect(text.last).toBe('Last: C1 11 @ RIR 1 · C2 10 @ RIR 1');
    expect(text.tappable).toBe(false);
  });

  it('Leg curl, first mini 10: "70 lb · REPEAT — read invalid" + the mini reason', () => {
    const rec = recommend([ex(cluster(1, 70, 12, 2, 10, 9))], { expectsCluster: true });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('70 lb · REPEAT — read invalid');
    expect(text.reason).toBe('First mini was 10 reps; above 5 means the activation was not close enough to failure.');
    expect(text.last).toBe('Last: 12 reps @ RIR 2');
  });

  it('Standing calf raise over the band: "50 lb · ADD LOAD. 20 reps — over the 14-15 band"', () => {
    const rec = recommend([ex(cluster(1, 40, 20, 2, 5, 3))], {
      expectsCluster: true, progression: { targetReps: 15, incrementLb: 10 },
    });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('50 lb · ADD LOAD');
    expect(text.reason).toBe('20 reps — over the 14-15 band, under-loaded.');
    expect(text.tappable).toBe(true);
  });

  it('a too-large step asks for reps first, with the next load and the percentage', () => {
    const rec = recommend([ex(cluster(1, 10, 12, 2, 5, 3))], { expectsCluster: true, availableLoads: [10, 20] });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('10 lb · BUILD REPS');
    expect(text.reason).toBe('Next available load is 20 lb (+100%). Build to 14 reps at 10 lb first.');
  });

  it('an assisted lift says REDUCE ASSISTANCE, and a metric lifter reads kilograms', () => {
    const rec = recommend([ex(cluster(1, 30, 12, 2, 4, 2))], { expectsCluster: true, assisted: true, progression: { incrementLb: 2.5 } });
    expect(recommendationText(rec, 'us', t)!.headline).toBe('27.5 lb · REDUCE ASSISTANCE');
    expect(recommendationText(rec, 'metric', t)!.headline).toMatch(/kg · REDUCE ASSISTANCE$/);
  });

  it('a stall renders its diagnosis and ranked interventions', () => {
    const row = (a1: number, a2: number, m1 = 5) => ex([...cluster(1, 80, a1, 2, m1, 3), ...cluster(2, 80, a2, 2, 4, 3)]);
    const rec = recommend([row(10, 10, 8), row(12, 10), row(10, 10), row(10, 9), row(11, 10)], { expectsCluster: true });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.stall).toEqual([
      'STALLED — 5 sessions at 80 lb.',
      '1 of 5 reads were invalid — that is the cause.',
      'First mini above 5 in 1 of 5 — the activation was too easy.',
      'C2 blocked every time.',
      '1. Shorten mini rest to 5-10 s.',
      '2. Drop C2 by one increment.',
      '3. Reduce load 10% and rebuild.',
    ]);
  });

  it('a straight-set lift renders nothing — the engine has no call', () => {
    const rec: Recommendation = recommend([{ exerciseId: 'x', name: 'X', cues: [], sets: [{ kind: 'working', reps: 8, weight: 100 }] }], {});
    expect(recommendationText(rec, 'us', t)).toBeNull();
  });
});

describe('every engine string exists in all three locales', () => {
  it('es-PR and pt-BR carry every train.rec / train.audit / train.muscle key', () => {
    for (const key of ENGINE_KEYS) {
      expect((esPR as Record<string, string>)[key]).toBeTruthy();
      expect((ptBR as Record<string, string>)[key]).toBeTruthy();
    }
    expect(ENGINE_KEYS.length).toBeGreaterThan(40);
  });

  it('placeholders match across locales, so no number is dropped in translation', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of ENGINE_KEYS) {
      expect(holes((esPR as Record<string, string>)[key])).toEqual(holes((en as Record<string, string>)[key]));
      expect(holes((ptBR as Record<string, string>)[key])).toEqual(holes((en as Record<string, string>)[key]));
    }
  });
});
