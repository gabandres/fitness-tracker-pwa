/**
 * Layer 6 of the progression engine: the sentences a lifter reads.
 *
 * Core decides; this pins the rendering — that every action, reason, warning
 * and stall line has a string in all three locales, that the numbers on the
 * `Recommendation` reach the sentence unchanged, and that the spec's example
 * strings come out of the real pipeline on the real 2026-09-15 numbers.
 * ADR-0039: the band is derived (or overridden), never hardcoded, so the
 * fixtures either supply `targetRepBand` or log three valid sessions.
 */
import { recommend, type Recommendation } from '@macrolog/core';
import type { RepBand, SessionExercise, WorkoutSet } from '@/lib/workout';
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
const BAND_12: RepBand = { addLoadAt: 12, holdLo: 10, holdHi: 11 };
const banded = { expectsCluster: true, targetRepBand: BAND_12 };

const tFor = (dict: Record<string, string>): TFn => (key, params) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''));
const t = tFor(en as Record<string, string>);

const ENGINE_KEYS = (Object.keys(en) as I18nKey[]).filter((k) =>
  k.startsWith('train.rec.') || k.startsWith('train.audit.') || k.startsWith('train.muscle.') || k.startsWith('train.lift.'));

describe('recommendation text — the spec examples on the real numbers', () => {
  it('Smith squat, C2 blocked: "20 lb · HOLD AND BUILD" + the cluster reason', () => {
    const rec = recommend(
      [ex([...cluster(1, 20, 11, 1, 5, 3), ...cluster(2, 20, 10, 1, 4, 2)])],
      { ...banded, progression: { incrementLb: 5 } },
    );
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('20 lb · HOLD AND BUILD');
    expect(text.reason).toBe('C2 gave 10 reps last session; both clusters need 12 to add load.');
    expect(text.last).toBe('Last: C1 11 @ RIR 1 · C2 10 @ RIR 1');
    expect(text.tappable).toBe(false);
    expect(text.calibration).toBeNull();
    expect(text.warnings).toEqual([]);
  });

  it('Leg curl, first mini 10: "70 lb · REPEAT — read invalid" + the mini reason + the calibration count', () => {
    const rec = recommend([ex(cluster(1, 70, 12, 2, 10, 9))], { expectsCluster: true });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('70 lb · REPEAT — read invalid');
    expect(text.reason).toBe('First mini was 10 reps; above 5 means the activation was not close enough to failure.');
    expect(text.last).toBe('Last: 12 reps @ RIR 2');
    // No band yet, and the reason line is about the read: the count goes under it.
    expect(text.calibration).toBe('Calibrating — 0 of 3 valid sessions logged.');
  });

  it('a lift with no band yet reads CALIBRATING with the spec sentence, and no load change', () => {
    const s = (reps: number) => ex(cluster(1, 20, reps, 0, 4, 3));
    const text = recommendationText(recommend([s(11), s(10)], { expectsCluster: true }), 'us', t)!;
    expect(text.headline).toBe('20 lb · CALIBRATING');
    expect(text.reason).toBe('Calibrating — 2 of 3 valid sessions logged.');
    expect(text.calibration).toBeNull();
    expect(text.tappable).toBe(false);
  });

  it('three valid sessions derive the band and the sentence cites the mark', () => {
    const s = (reps: number) => ex(cluster(1, 20, reps, 0, 4, 3));
    const text = recommendationText(
      recommend([s(12), s(11), s(10)], { expectsCluster: true, progression: { incrementLb: 2.5 } }), 'us', t,
    )!;
    expect(text.headline).toBe('22.5 lb · ADD LOAD');
    expect(text.reason).toBe('12 reps @ RIR 0 at 20 lb — the add-load mark is 12.');
    expect(text.tappable).toBe(true);
  });

  it('under the hold band: "BUILD REPS" with the floor to build back to', () => {
    const text = recommendationText(recommend([ex(cluster(1, 30, 8, 0, 3, 2))], banded), 'us', t)!;
    expect(text.headline).toBe('30 lb · BUILD REPS');
    expect(text.reason).toBe('8 reps last session — under the 10-11 hold band. Build back to 10 at 30 lb.');
  });

  it('a rir1 lift taken to failure carries the soft warning verbatim from the spec', () => {
    const rec = recommend([ex(cluster(1, 80, 10, 0, 4, 3))], { ...banded, effortStandard: 'rir1' });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('80 lb · HOLD AND BUILD');
    expect(text.warnings).toEqual(['Logged at failure. This lift is set to leave 1 rep in reserve.']);
  });

  it('Standing calf raise over the mark: "50 lb · ADD LOAD. 20 reps — over the add-load mark"', () => {
    const rec = recommend([ex(cluster(1, 40, 20, 2, 5, 3))], {
      expectsCluster: true, targetRepBand: { addLoadAt: 15, holdLo: 13, holdHi: 14 }, progression: { incrementLb: 10 },
    });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('50 lb · ADD LOAD');
    expect(text.reason).toBe('20 reps — over the add-load mark of 15, under-loaded.');
    expect(text.tappable).toBe(true);
  });

  it('a too-large step asks for reps first, with the next load and the percentage', () => {
    const rec = recommend([ex(cluster(1, 10, 12, 0, 5, 3))], { ...banded, availableLoads: [10, 20] });
    const text = recommendationText(rec, 'us', t)!;
    expect(text.headline).toBe('10 lb · BUILD REPS');
    expect(text.reason).toBe('Next available load is 20 lb (+100%). Build to 14 reps at 10 lb first.');
  });

  it('an assisted lift says REDUCE ASSISTANCE, and a metric lifter reads kilograms', () => {
    const rec = recommend([ex(cluster(1, 30, 12, 0, 4, 2))], { ...banded, assisted: true, progression: { incrementLb: 2.5 } });
    expect(recommendationText(rec, 'us', t)!.headline).toBe('27.5 lb · REDUCE ASSISTANCE');
    expect(recommendationText(rec, 'metric', t)!.headline).toMatch(/kg · REDUCE ASSISTANCE$/);
  });

  it('a stall renders its diagnosis and ranked interventions', () => {
    const row = (a1: number, a2: number, m1 = 5) => ex([...cluster(1, 80, a1, 2, m1, 3), ...cluster(2, 80, a2, 2, 4, 3)]);
    const rec = recommend([row(10, 10, 8), row(12, 10), row(10, 10), row(10, 9), row(11, 10)], banded);
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

  // ADR-0040 REPLACES the old contract here. This used to assert
  // `toBeNull()` — a straight-set lift rendered nothing at all, which is the
  // silence ADR-0040 exists to end: the user could not tell an engine with no
  // call from an engine that was broken.
  it('a straight-set lift now reports its read instead of rendering nothing', () => {
    const rec: Recommendation = recommend(
      [{ exerciseId: 'x', name: 'X', cues: [], sets: [{ kind: 'working', reps: 8, weight: 100 }] }],
      { progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 } },
    );
    const text = recommendationText(rec, 'us', t);
    expect(text).not.toBeNull();
    expect(text!.reason).not.toBe('');
    expect(text!.reason).toContain('8');
  });

  it('a straight-set lift with no rep target says so rather than going quiet', () => {
    const rec: Recommendation = recommend(
      [{ exerciseId: 'x', name: 'X', cues: [], sets: [{ kind: 'working', reps: 8, weight: 100 }] }],
      {},
    );
    const text = recommendationText(rec, 'us', t);
    expect(text).not.toBeNull();
    expect(text!.reason).toBe(en['train.rec.reason.noRule']);
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

  it('the retired RIR-0 reason has no string left behind in any locale', () => {
    for (const dict of [en, esPR, ptBR] as Record<string, string>[]) {
      expect(dict['train.rec.invalid.rirToFailure']).toBeUndefined();
      expect(dict['train.invalidRirFailure']).toBeUndefined();
    }
  });
});
