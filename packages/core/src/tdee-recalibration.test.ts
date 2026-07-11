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
function reliableLogs(): DailyLog[] {
  const logs: DailyLog[] = [];
  for (let i = 19; i >= 0; i--) logs.push(log(i, 2000, 185 - (19 - i) * 0.1));
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
