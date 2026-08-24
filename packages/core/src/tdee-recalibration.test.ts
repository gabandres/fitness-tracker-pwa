import { describe, expect, it } from 'vitest';
import { recalibrationDigest, type RecalibrationAck } from './tdee-recalibration';
import type { DailyLog, Profile } from './types';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY = 86_400_000;

const profile = {
  heightIn: 70,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1.0,
  goalWeightLbs: 180,
} as unknown as Profile;

function log(daysAgo: number, calories: number, weight?: number): DailyLog {
  return { calories, date: new Date(NOW - daysAgo * DAY), weight };
}

/** 20 reliable days: intake 2000, losing 0.1 lb/day → measured, reliable. */
/**
 * 28 logged days, which is what "reliable" now MEANS.
 *
 * This was 20 days until 2026-08-24. The crossing ramp
 * (`RAMP_TO_FULL_DAYS`) holds a 20-day window at ~43% confidence, so the digest
 * would have been reporting a number that is mostly the Mifflin anchor while
 * this file called it "the first reliable reading". 28 is where the ramp
 * completes and where the estimate's own 95% interval first comes inside
 * `CI95_CEILING_KCAL`, so it is the honest fixture for a test about a reading
 * the app is willing to announce.
 */
function reliableLogs(): DailyLog[] {
  const logs: DailyLog[] = [];
  for (let i = 27; i >= 0; i--) logs.push(log(i, 2000, 185 - (27 - i) * 0.1));
  return logs;
}

describe('recalibrationDigest', () => {
  it('is unavailable in formula mode (<14 logged days)', () => {
    const d = recalibrationDigest(profile, [log(0, 2000, 180)], {}, { now: NOW });
    expect(d.available).toBe(false);
    expect(d.shouldSurface).toBe(false);
    expect(d.trueTdee).toBe(0);
  });

  it('is unavailable when measured but not reliable (gappy window)', () => {
    // 14 weigh-ins every other day → ~50% completeness → not reliable.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 14; i++) logs.push(log(27 - i * 2, 2000, 185 - i * 0.1));
    const d = recalibrationDigest(profile, logs, {}, { now: NOW });
    expect(d.available).toBe(false);
    expect(d.shouldSurface).toBe(false);
  });

  it('surfaces the first reliable reading when never acknowledged', () => {
    const d = recalibrationDigest(profile, reliableLogs(), {}, { now: NOW });
    expect(d.available).toBe(true);
    expect(d.shouldSurface).toBe(true);
    expect(d.deltaSinceAck).toBeNull();
    // Real burn (~2350) sits well below the Mifflin estimate (~2760).
    expect(d.deltaVsFormula).not.toBeNull();
    expect(d.deltaVsFormula!).toBeLessThan(-100);
    expect(d.trend).toBe('metabolism-slowed');
    expect(d.trueTdee).toBeGreaterThan(2250);
    expect(d.trueTdee).toBeLessThan(2450);
    expect(d.calorieTarget).toBe(d.trueTdee - 500); // pace 1.0 → 500 kcal deficit
  });

  it('reports a signed weekly weight trend (losing → negative)', () => {
    const d = recalibrationDigest(profile, reliableLogs(), {}, { now: NOW });
    expect(d.weightTrendLbPerWeek).not.toBeNull();
    expect(d.weightTrendLbPerWeek!).toBeLessThan(0);
    // ~0.1 lb/day ≈ 0.7 lb/week.
    expect(d.weightTrendLbPerWeek!).toBeCloseTo(-0.7, 1);
  });

  it('stays quiet after a recent ack with small drift', () => {
    const logs = reliableLogs();
    const base = recalibrationDigest(profile, logs, {}, { now: NOW });
    const ack: RecalibrationAck = { value: base.trueTdee - 20, at: NOW - 2 * DAY };
    const d = recalibrationDigest(profile, logs, {}, { now: NOW, ack });
    expect(d.available).toBe(true);
    expect(d.shouldSurface).toBe(false);
    expect(d.deltaSinceAck).toBe(20);
    expect(d.trend).toBe('steady'); // 20 kcal < 75 threshold
  });

  it('re-surfaces when drift clears the threshold AND the quiet period elapsed', () => {
    const logs = reliableLogs();
    const base = recalibrationDigest(profile, logs, {}, { now: NOW });
    // Acked 30 days ago at a TDEE 200 kcal higher than today's reading.
    const ack: RecalibrationAck = { value: base.trueTdee + 200, at: NOW - 30 * DAY };
    const d = recalibrationDigest(profile, logs, {}, { now: NOW, ack });
    expect(d.shouldSurface).toBe(true);
    expect(d.deltaSinceAck).toBe(-200);
    expect(d.trend).toBe('metabolism-slowed');
  });

  it('holds quiet when the drift is big but the quiet period has NOT elapsed', () => {
    const logs = reliableLogs();
    const base = recalibrationDigest(profile, logs, {}, { now: NOW });
    const ack: RecalibrationAck = { value: base.trueTdee + 200, at: NOW - 3 * DAY };
    const d = recalibrationDigest(profile, logs, {}, { now: NOW, ack });
    expect(d.shouldSurface).toBe(false);
  });

  it('holds quiet when the quiet period elapsed but the drift is small', () => {
    const logs = reliableLogs();
    const base = recalibrationDigest(profile, logs, {}, { now: NOW });
    const ack: RecalibrationAck = { value: base.trueTdee + 30, at: NOW - 30 * DAY };
    const d = recalibrationDigest(profile, logs, {}, { now: NOW, ack });
    expect(d.shouldSurface).toBe(false);
  });

  it('classifies an upward drift vs the ack as metabolism-faster', () => {
    const logs = reliableLogs();
    const base = recalibrationDigest(profile, logs, {}, { now: NOW });
    const ack: RecalibrationAck = { value: base.trueTdee - 200, at: NOW - 30 * DAY };
    const d = recalibrationDigest(profile, logs, {}, { now: NOW, ack });
    expect(d.deltaSinceAck).toBe(200);
    expect(d.trend).toBe('metabolism-faster');
    expect(d.shouldSurface).toBe(true);
  });

  it('respects custom threshold + cadence options', () => {
    const logs = reliableLogs();
    const base = recalibrationDigest(profile, logs, {}, { now: NOW });
    const ack: RecalibrationAck = { value: base.trueTdee - 40, at: NOW - 5 * DAY };
    // Default (75 kcal / 14 d) → quiet. Loosened (30 kcal / 3 d) → surfaces.
    expect(recalibrationDigest(profile, logs, {}, { now: NOW, ack }).shouldSurface).toBe(false);
    const d = recalibrationDigest(profile, logs, {}, {
      now: NOW, ack, driftThresholdKcal: 30, minDaysSinceAck: 3,
    });
    expect(d.shouldSurface).toBe(true);
  });

  it('returns null deltaVsFormula when the profile is incomplete', () => {
    const d = recalibrationDigest(null, reliableLogs(), {}, { now: NOW });
    // No profile → seed/formula fields missing, but measured mode still works
    // off logs alone.
    expect(d.available).toBe(true);
    expect(d.deltaVsFormula).toBeNull();
  });
});

/**
 * The precision gate, and the incident it exists for.
 *
 * On 2026-08-20 an account was measured AND reliable — `confidence` 0.957 — and
 * the card announced a recalibration to 2,509 kcal. The number came from a
 * nine-day run whose slope was not statistically distinguishable from zero, and
 * the 95% interval on maintenance ran 1,775..3,242. `reliable` asks whether
 * enough days were LOGGED; it cannot ask whether the answer is worth saying out
 * loud, and telling someone their metabolism changed is a strong claim.
 */
describe('recalibrationDigest — precision gate', () => {
  /** Steady intake, real trend, tight scale: a genuinely measurable account. */
  function tightLogs(): DailyLog[] {
    const logs: DailyLog[] = [];
    // Deterministic ±0.15 lb wobble — enough to be realistic, not enough to
    // swamp a 0.1 lb/day trend.
    const wob = [0.1, -0.12, 0.05, -0.08, 0.14, -0.05, 0.02, -0.14, 0.09, -0.03];
    for (let i = 29; i >= 0; i--) {
      const d = 29 - i;
      logs.push(log(i, 2000, 185 - d * 0.1 + wob[d % wob.length]));
    }
    return logs;
  }

  /** Same days logged, but the scale is pure noise — no recoverable rate. */
  function noisyLogs(): DailyLog[] {
    const logs: DailyLog[] = [];
    const wob = [2.4, -2.1, 1.8, -2.6, 2.2, -1.7, 2.9, -2.3, 1.5, -2.8];
    for (let i = 29; i >= 0; i--) {
      const d = 29 - i;
      logs.push(log(i, 2000, 185 + wob[d % wob.length]));
    }
    return logs;
  }

  it('surfaces for an account whose interval is tight', () => {
    const d = recalibrationDigest(profile, tightLogs(), {}, { now: NOW });
    expect(d.available).toBe(true);
    expect(d.shouldSurface).toBe(true);
  });

  it('stays silent when the interval is too wide to support a headline', () => {
    const d = recalibrationDigest(profile, noisyLogs(), {}, { now: NOW });
    expect(d.available).toBe(false);
    expect(d.shouldSurface).toBe(false);
  });

  it('honours an explicit ceiling', () => {
    const logs = tightLogs();
    // A ceiling of 1 kcal cannot be cleared by any real estimate.
    const tight = recalibrationDigest(profile, logs, {}, { now: NOW, ci95CeilingKcal: 1 });
    expect(tight.available).toBe(false);
    // ...and a very loose one lets the same account through unchanged.
    const loose = recalibrationDigest(profile, logs, {}, { now: NOW, ci95CeilingKcal: 100000 });
    expect(loose.available).toBe(true);
  });
});
