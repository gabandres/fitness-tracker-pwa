import { describe, expect, it } from 'vitest';
import { FAT_KCAL_PER_KG, KG_PER_LB, LEAN_KCAL_PER_KG } from './body-composition';
import {
  compositionMaintenance,
  confidenceFromHalfWidth,
  forbesEnergyDensityKcalPerKg,
  forbesLeanFraction,
  forbesMaintenance,
  logsCompleteFrom,
  maintenanceFromComposition,
  type CompositionMaintenanceOk,
} from './composition-maintenance';
import { KCAL_PER_POUND, calculateTdee } from './tdee';
import { dailyTargets, mergeDailyWeights } from './targets';
import type { DailyLog, Measurement, Profile } from './types';

// 2026-10-04, 08:00 local — the window's days are 2026-07-27 + i.
const NOW = new Date(2026, 9, 4, 8, 0);
const START = new Date(2026, 6, 27);
const keyOf = (i: number) => {
  const d = new Date(START.getFullYear(), START.getMonth(), START.getDate() + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateOf = (i: number, h: number) => new Date(START.getFullYear(), START.getMonth(), START.getDate() + i, h);
const LAST = 69; // 2026-10-04 is START + 69

interface Fixture {
  /** First day index with logs and weights (default 0); negative reaches back past START. */
  first?: number;
  intake?: (i: number) => number | null; // null = unlogged day
  weight?: (i: number) => number;
  tapes?: { i: number; waist: number; neck?: number; hip?: number }[];
  dxa?: { i: number; pct: number }[];
  other?: { i: number; pct: number }[];
  sex?: 'male' | 'female';
}
function build(f: Fixture) {
  const logs: DailyLog[] = [];
  const dailyWeights: Record<string, number> = {};
  for (let i = f.first ?? 0; i <= LAST; i++) {
    const kcal = (f.intake ?? (() => 2000))(i);
    if (kcal != null) logs.push({ id: `l${i}`, calories: kcal, protein: 150, date: dateOf(i, 12), mealType: 'lunch' });
    dailyWeights[keyOf(i)] = (f.weight ?? (() => 156))(i);
  }
  const measurements: Measurement[] = [
    ...(f.tapes ?? []).map((t) => ({
      date: dateOf(t.i, 7), waist: t.waist, neck: t.neck ?? 14.5, ...(t.hip != null ? { hip: t.hip } : {}),
    })),
    ...(f.dxa ?? []).map((t) => ({ date: dateOf(t.i, 7), bodyFatPct: t.pct, bodyFatMethod: 'dxa' as const })),
    ...(f.other ?? []).map((t) => ({ date: dateOf(t.i, 7), bodyFatPct: t.pct, bodyFatMethod: 'other' as const })),
  ];
  return { logs, dailyWeights, measurements, profile: { sex: f.sex ?? ('male' as const), heightIn: 68 }, now: NOW };
}
const ok = (r: ReturnType<typeof compositionMaintenance>) => {
  if (r.status !== 'ok') throw new Error(`status ${r.status}`);
  return r as CompositionMaintenanceOk;
};
/** Weekly tapes from day 13 to day 69 (8 weeks), waist moving linearly. */
const weekly = (from: number, to: number) =>
  Array.from({ length: 9 }, (_, k) => ({ i: 13 + 7 * k, waist: from + ((to - from) * k) / 8 }));

describe('composition-adjusted maintenance — direction', () => {
  it('weight flat and body fat falling → maintenance_comp ABOVE the scale-based number', () => {
    const r = ok(compositionMaintenance(build({ tapes: weekly(33, 32) })));
    const scale = 2000; // flat weight: intake − 0 × 3,500
    expect(r.deltaFmKg).toBeLessThan(0);
    expect(r.deltaFfmKg).toBeGreaterThan(0); // flat scale, fat down ⇒ lean (incl. water) up
    expect(r.pointEstimate).toBeGreaterThan(scale);
    expect(r.median).toBeGreaterThan(scale);
  });

  it('body fat constant → agrees with the scale method up to the density difference', () => {
    const slopeLbPerDay = -0.1;
    const r = ok(compositionMaintenance(build({ weight: (i) => 160 + slopeLbPerDay * i, tapes: weekly(32, 32) })));
    const bf = r.bodyFatStartPct / 100;
    const rhoMix = bf * FAT_KCAL_PER_KG + (1 - bf) * LEAN_KCAL_PER_KG;
    const scale = 2000 - slopeLbPerDay * KCAL_PER_POUND;
    const expectedComp = 2000 - slopeLbPerDay * KG_PER_LB * rhoMix;
    expect(r.bodyFatEndPct).toBeCloseTo(r.bodyFatStartPct, 9);
    expect(r.pointEstimate).toBeCloseTo(expectedComp, 0);
    // The whole gap is the density: 3,500 kcal/lb vs this composition's mix.
    expect(scale - r.pointEstimate).toBeCloseTo(-slopeLbPerDay * (KCAL_PER_POUND - KG_PER_LB * rhoMix), 0);
  });

  it('maintenanceFromComposition — the arithmetic, by hand', () => {
    const m = maintenanceFromComposition({
      meanIntake: 2000, spanDays: 28, weightStartKg: 70, weightEndKg: 70, bodyFatStartPct: 16, bodyFatEndPct: 15,
    });
    expect(m.deltaFmKg).toBeCloseTo(-0.7, 9);
    expect(m.deltaFfmKg).toBeCloseTo(0.7, 9);
    expect(m.storedKcal).toBeCloseTo(-0.7 * 9440 + 0.7 * 1816, 6);
    expect(m.maintenance).toBeCloseTo(2000 + (0.7 * (9440 - 1816)) / 28, 6);
  });
});

describe('gates', () => {
  it('< 3 composition points → insufficient_tapes', () => {
    const r = compositionMaintenance(build({ tapes: [{ i: 13, waist: 33 }, { i: 69, waist: 32 }] }));
    expect(r).toMatchObject({ status: 'insufficient_tapes', points: 2 });
  });

  it('< 28 days between first and last point → insufficient_tapes', () => {
    const r = compositionMaintenance(build({ tapes: [48, 55, 62, 69].map((i) => ({ i, waist: 32 })) }));
    expect(r).toMatchObject({ status: 'insufficient_tapes', points: 4, spanDays: 21 });
  });

  it('a point older than 84 days does not count', () => {
    const r = compositionMaintenance({
      ...build({ tapes: [{ i: 55, waist: 32 }, { i: 69, waist: 32 }] }),
      measurements: [
        { date: new Date(2026, 6, 1, 7), waist: 33, neck: 14.5 }, // 95 days back
        ...build({ tapes: [{ i: 55, waist: 32 }, { i: 69, waist: 32 }] }).measurements,
      ],
    });
    expect(r).toMatchObject({ status: 'insufficient_tapes', points: 2 });
  });

  it('no sex/height → tapes are not points; says why', () => {
    const r = compositionMaintenance({ ...build({ tapes: weekly(33, 32) }), profile: {} });
    expect(r).toMatchObject({ status: 'insufficient_tapes', profileMissing: true });
  });

  it('unlogged days are excluded, not imputed as zero', () => {
    const r = ok(compositionMaintenance(build({ intake: (i) => (i % 2 ? null : 2000), tapes: weekly(32, 32) })));
    expect(r.meanIntake).toBe(2000);
    expect(r.loggedDays).toBe(28);
  });

  it('too few logged days → insufficient_logging', () => {
    const r = compositionMaintenance(build({ intake: (i) => (i % 5 ? null : 2000), tapes: weekly(32, 32) }));
    expect(r).toMatchObject({ status: 'insufficient_logging' });
  });

  // Guaranteed by construction, not by a filter: points are never after today
  // and intake is [first, last), so neither the last point's day nor today can
  // add intake. This pins the window, which is what keeps the rule.
  it('intake stops the day before the last point — the day in progress never counts', () => {
    const base = build({ tapes: weekly(33, 32) });
    const withToday = { ...base, logs: [...base.logs, { calories: 9000, date: new Date(2026, 9, 4, 7, 30) }] };
    expect(ok(compositionMaintenance(withToday)).meanIntake).toBe(ok(compositionMaintenance(base)).meanIntake);
  });

  it('no trend weight at an end → insufficient_weight', () => {
    const f = build({ tapes: weekly(33, 32) });
    const weights = Object.fromEntries(Object.entries(f.dailyWeights).filter(([k]) => k > keyOf(30)));
    expect(compositionMaintenance({ ...f, dailyWeights: weights })).toMatchObject({ status: 'insufficient_weight' });
  });
});

describe('mixed mode reads change within a method, never across two', () => {
  const flat = weekly(32, 32); // Navy 15.32% every week, weight flat
  const tapeOnly = () => ok(compositionMaintenance(build({ tapes: flat })));

  it('one DXA on the last tape day — 7 points above the tapes — moves nothing', () => {
    // Review repro (2026-10-04): a single fit through both methods read the
    // method gap as +2.7 kg of fat and printed 1,640 instead of ~2,000.
    const r = ok(compositionMaintenance(build({ tapes: flat, dxa: [{ i: 69, pct: 22.4 }] })));
    expect(r.mode).toBe('mixed');
    expect(r.sources).toEqual({ dxa: 0, other: 0, navy: 8 });
    expect(Math.abs(r.median - tapeOnly().median)).toBeLessThan(40);
    expect(Math.abs(r.deltaFmKg)).toBeLessThan(0.05);
  });

  it('one DXA on the FIRST tape day moves nothing either (it read 2,365)', () => {
    const r = ok(compositionMaintenance(build({ tapes: flat, dxa: [{ i: 13, pct: 22.4 }] })));
    expect(Math.abs(r.median - tapeOnly().median)).toBeLessThan(40);
  });

  it('two methods with a level gap: the gap goes to the intercepts, the shared slope to the change', () => {
    // Tapes fall 33 → 32 in; two "other" readings sit 6 points above the tapes
    // and fall in step. A single line through both would have read a rise.
    const tapes = ok(compositionMaintenance(build({ tapes: weekly(33, 32) })));
    const navyAt = (i: number) => tapes.bodyFatStartPct + ((tapes.bodyFatEndPct - tapes.bodyFatStartPct) * (i - 13)) / 56;
    const r = ok(compositionMaintenance(build({
      tapes: weekly(33, 32).filter((t) => t.i !== 20 && t.i !== 62),
      other: [20, 62].map((i) => ({ i, pct: navyAt(i) + 6 })),
    })));
    expect(r.sources).toEqual({ dxa: 0, other: 2, navy: 7 });
    // Priced at the "other" level (the more accurate method present)…
    expect(r.bodyFatStartPct).toBeCloseTo(tapes.bodyFatStartPct + 6, 1);
    // …but the change is the tapes' change.
    expect(r.bodyFatEndPct - r.bodyFatStartPct).toBeCloseTo(tapes.bodyFatEndPct - tapes.bodyFatStartPct, 1);
  });

  it('no single method spanning 28 days → insufficient_tapes, however far apart the methods sit', () => {
    const r = compositionMaintenance(build({
      tapes: [13, 20, 27].map((i) => ({ i, waist: 32 })),
      other: [{ i: 55, pct: 20 }, { i: 69, pct: 20 }],
    }));
    expect(r).toMatchObject({ status: 'insufficient_tapes', points: 5 });
  });
});

describe('women — the hip is a Navy input', () => {
  it('hips on their own rows complete the set; the Monte Carlo perturbs them without NaN', () => {
    const waist = weekly(31, 30);
    const f = build({ sex: 'female', tapes: waist });
    // Each week's hip on a separate row the same morning.
    f.measurements.push(...waist.map((t) => ({ date: dateOf(t.i, 8), hip: 39 })));
    const r = ok(compositionMaintenance(f));
    expect(r.sources.navy).toBe(9);
    expect(r.deltaFmKg).toBeLessThan(0);
    for (const v of [r.median, r.p10, r.p90]) expect(Number.isFinite(v)).toBe(true);
    expect(r.p10).toBeLessThan(r.median);
    expect(r.median).toBeLessThan(r.p90);
  });

  it('a woman with no hip anywhere has no points', () => {
    expect(compositionMaintenance(build({ sex: 'female', tapes: weekly(31, 30) }))).toMatchObject({
      status: 'insufficient_tapes', points: 0, profileMissing: false,
    });
  });
});

describe('Monte Carlo', () => {
  const nine = weekly(33, 32);
  const five = nine.filter((_, k) => k % 2 === 0);
  const three = [nine[0], nine[4], nine[8]];

  it('is deterministic with the fixed seed', () => {
    const a = compositionMaintenance(build({ tapes: nine }));
    const b = compositionMaintenance(build({ tapes: nine }));
    expect(a).toEqual(b);
  });

  it('a different seed moves the interval only slightly', () => {
    const a = ok(compositionMaintenance(build({ tapes: nine })));
    const b = ok(compositionMaintenance({ ...build({ tapes: nine }), seed: 7 }));
    expect(Math.abs(a.median - b.median)).toBeLessThan(25);
  });

  it('the interval widens as tapes become fewer / sparser over the same span', () => {
    const w9 = ok(compositionMaintenance(build({ tapes: nine }))).halfWidth80;
    const w5 = ok(compositionMaintenance(build({ tapes: five }))).halfWidth80;
    const w3 = ok(compositionMaintenance(build({ tapes: three }))).halfWidth80;
    expect(w5).toBeGreaterThan(w9);
    expect(w3).toBeGreaterThan(w5);
  });

  it('DXA points carry σ 1.0 and no method-change error — far narrower than tapes', () => {
    const tapes = ok(compositionMaintenance(build({ tapes: nine }))).halfWidth80;
    const dxa = ok(compositionMaintenance(build({ dxa: [13, 41, 69].map((i, k) => ({ i, pct: 17 - k * 0.5 })) })));
    expect(dxa.sources).toEqual({ dxa: 3, other: 0, navy: 0 });
    expect(dxa.halfWidth80).toBeLessThan(tapes / 2);
  });

  it('tapes over 8 weeks are Low confidence; the median sits inside its own interval', () => {
    const r = ok(compositionMaintenance(build({ tapes: nine })));
    expect(r.confidence).toBe('low');
    expect(r.p10).toBeLessThan(r.median);
    expect(r.median).toBeLessThan(r.p90);
  });
});

describe('DXA-anchored mode (ADR-0043 §Open 1)', () => {
  const nine = weekly(33, 32);

  it('two DXA scans ≥ 28 days apart → the change comes from DXA alone, tapes ignored', () => {
    const r = ok(compositionMaintenance(build({ tapes: nine, dxa: [{ i: 13, pct: 17 }, { i: 69, pct: 16 }] })));
    expect(r.mode).toBe('dxa_anchored');
    expect(r.points).toBe(2);
    expect(r.sources).toEqual({ dxa: 2, other: 0, navy: 0 });
    expect(r.bodyFatStartPct).toBeCloseTo(17, 9);
    expect(r.bodyFatEndPct).toBeCloseTo(16, 9);
  });

  it('a DXA pair 8 weeks apart is Medium; tapes over the same span are Low', () => {
    const tapes = ok(compositionMaintenance(build({ tapes: nine })));
    const dxa = ok(compositionMaintenance(build({ tapes: nine, dxa: [{ i: 13, pct: 17 }, { i: 69, pct: 16 }] })));
    expect(tapes.mode).toBe('mixed');
    expect(tapes.confidence).toBe('low');
    // σ √2 %BF on the change × ~71 kg × (9,440 − 1,816) / 56 d × 1.28 ≈ ±175.
    expect(dxa.halfWidth80).toBeGreaterThan(150);
    expect(dxa.halfWidth80).toBeLessThan(200);
    expect(dxa.confidence).toBe('medium');
  });

  it('reaches back 182 days for the pair — past the 84-day tape window', () => {
    const r = ok(compositionMaintenance(build({ first: -60, dxa: [{ i: -50, pct: 18 }, { i: 69, pct: 16 }] })));
    expect(r.mode).toBe('dxa_anchored');
    expect(r.spanDays).toBe(119);
    expect(r.confidence).toBe('high');
  });

  it('a scan older than 182 days does not count', () => {
    const r = compositionMaintenance(build({ first: -120, dxa: [{ i: -114, pct: 18 }, { i: 69, pct: 16 }] }));
    // The recent scan is alone in its method, so it counts for nothing in
    // mixed mode either: one reading has a level, not a change.
    expect(r).toMatchObject({ status: 'insufficient_tapes', points: 0 });
  });

  it('a DXA pair under 28 days apart falls back to the mixed estimate', () => {
    const r = ok(compositionMaintenance(build({ tapes: nine, dxa: [{ i: 48, pct: 17 }, { i: 69, pct: 16.5 }] })));
    expect(r.mode).toBe('mixed');
    expect(r.sources.dxa).toBe(2);
  });

  it('a DXA pair that fails on weight, with no tapes to fall back on, says WEIGHT — not "log a tape"', () => {
    const f = build({ first: -60, dxa: [{ i: -50, pct: 18 }, { i: 69, pct: 16 }] });
    const weights = Object.fromEntries(Object.entries(f.dailyWeights).filter(([k]) => k >= keyOf(0)));
    expect(compositionMaintenance({ ...f, dailyWeights: weights })).toMatchObject({ status: 'insufficient_weight' });
  });

  it('a DXA pair with no weigh-ins around the older scan falls back to the mixed estimate', () => {
    const f = build({ first: -60, tapes: nine, dxa: [{ i: -50, pct: 18 }, { i: 69, pct: 16 }] });
    const weights = Object.fromEntries(Object.entries(f.dailyWeights).filter(([k]) => k >= keyOf(0)));
    const r = ok(compositionMaintenance({ ...f, dailyWeights: weights }));
    expect(r.mode).toBe('mixed');
    expect(r.firstKey).toBe(keyOf(13));
  });
});

describe('a row-capped log cache', () => {
  it('intake starts where the cache is complete — older days are unknown, not unlogged', () => {
    const f = build({ intake: (i) => (i < 41 ? 1500 : 2000), tapes: weekly(32, 32) });
    const r = ok(compositionMaintenance({ ...f, logsCompleteFromKey: keyOf(41) }));
    expect(r.meanIntake).toBe(2000);
    expect(r.loggedDays).toBe(28); // days 41..68
    expect(r.intakeFromKey).toBe(keyOf(41));
  });

  it('logsCompleteFrom: undefined below the cap; the day AFTER the oldest row at it', () => {
    const logs = build({}).logs;
    expect(logsCompleteFrom(logs, logs.length + 1)).toBeUndefined();
    // The oldest cached day may be missing rows the cap cut off, so it is out too.
    expect(logsCompleteFrom(logs, logs.length)).toBe(keyOf(1));
  });
});

describe('confidenceFromHalfWidth', () => {
  it.each([[0, 'high'], [150, 'high'], [151, 'medium'], [300, 'medium'], [301, 'low']] as const)('%i → %s', (w, c) => {
    expect(confidenceFromHalfWidth(w)).toBe(c);
  });
});

describe('Forbes prior (flag OFF)', () => {
  it('p = 10.4 / (10.4 + FM) and the blended density', () => {
    expect(forbesLeanFraction(10.4)).toBe(0.5);
    expect(forbesEnergyDensityKcalPerKg(10.4)).toBe(0.5 * 1816 + 0.5 * 9440);
  });

  it('a losing slope priced at the Forbes density reads lower than at 3,500 kcal/lb when lean', () => {
    const forbes = forbesMaintenance({ avgDailyIntake: 1890, weightSlopeLbsPerDay: -0.228 / 7, fmKg: 10.8 });
    const constant = 1890 + (0.228 / 7) * KCAL_PER_POUND;
    expect(forbes).toBeLessThan(constant);
  });
});

describe('display only — the target never reads it', () => {
  it('targets.ts and tdee.ts import nothing from the composition modules', () => {
    // `import.meta.glob`, not node:fs — core's tsconfig pins `"types": []`
    // (see tdee-consumers.test.ts for why).
    const sources = (import.meta as any).glob(['./targets.ts', './tdee.ts', './tdee-recalibration.ts'], {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(3);
    for (const src of Object.values(sources)) {
      // Any quote style, with or without an extension, and the barrel too.
      expect(src).not.toMatch(/['"]\.\/(index|composition-maintenance|body-composition|recomp-signal)(\.[jt]s)?['"]/);
    }
  });

  it('the existing maintenance and target are pinned (ADR-0043: flag OFF ⇒ byte-identical)', () => {
    // dailyTargets / calculateTdee take no measurements at all. This pins
    // their full output for a fixture WITH tapes, so any future wiring of
    // composition into the target fails here. The same JSON was produced by
    // the pre-change code (git HEAD 6b850326) — see the ADR's verification.
    const f = build({ tapes: weekly(33, 32), weight: (i) => 158 - 0.03 * i });
    const profile = { sex: 'male', heightIn: 68, age: 40, weightLbs: 156, activityLevel: 'moderate', targetPaceLbsPerWeek: 0.5 } as unknown as Profile;
    const t = dailyTargets(profile, f.logs, f.dailyWeights, NOW);
    const tdee = calculateTdee(mergeDailyWeights(f.logs, f.dailyWeights), undefined, undefined, NOW);
    // The source/suggestion fields (2026-10-08) are additive — they restate the
    // target, never change it — so the pin below stays the pre-ADR JSON.
    const { calorieSource, proteinSource, calorieSuggestion, proteinSuggestion, proteinBasis, ...pinned } = t;
    expect({ calorieSource, proteinSource, calorieSuggestion, proteinSuggestion, proteinBasis })
      .toEqual({ calorieSource: 'auto', proteinSource: 'auto', calorieSuggestion: t.calorieTarget, proteinSuggestion: t.proteinTarget, proteinBasis: null });
    expect(JSON.stringify({ t: pinned, tdee })).toMatchInlineSnapshot(`"{"t":{"calorieTarget":1855,"proteinTarget":115,"proteinMinTarget":115,"currentWeight":155.93,"tdee":{"trueTdee":2105,"newDailyTarget":1855,"weightChangeTrend":1.23,"source":"measured","loggingCompletenessPct":100,"windowDays":42,"intakeDays":41,"spanDays":42,"reliable":true,"outliersDropped":0,"measuredTdee":2105,"confidence":1,"avgDailyIntake":2000,"weightSlopeLbsPerDay":-0.03,"dailyDeficitAchieved":105,"seTdee":0,"ci95Tdee":1,"runsUsed":1,"estimateState":"measuring","windowUsedDays":42}},"tdee":{"trueTdee":2105,"newDailyTarget":1605,"weightChangeTrend":1.23,"source":"measured","loggingCompletenessPct":100,"windowDays":42,"intakeDays":41,"spanDays":42,"reliable":true,"outliersDropped":0,"measuredTdee":2105,"confidence":1,"avgDailyIntake":2000,"weightSlopeLbsPerDay":-0.03,"dailyDeficitAchieved":105,"seTdee":0,"ci95Tdee":1,"runsUsed":1,"estimateState":"measuring","windowUsedDays":42}}"`);
  });
});
