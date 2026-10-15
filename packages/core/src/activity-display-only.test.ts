import { describe, expect, it } from 'vitest';
import { activityMultiplier, reduceActivityWindow } from './activity-level';
import { workoutMarkerEntry } from './cardio';
import { addDays, calendarDateKey } from './date';
import { targetSnapshot } from './target-history';
import { dailyTargets } from './targets';
import { basalMifflinStJeor } from './tdee';
import type { DailyLog, Profile } from './types';

/**
 * Steps, active kcal and cardio kcal are DISPLAY-ONLY (owner, 2026-10-15).
 *
 * Maintenance is energy balance — logged intake against the weight trend —
 * and the activity a day contained is already in that trend. The calorie
 * target is the user's own number when they typed one. Neither may move
 * because a watch counted more steps or a ring reported a run.
 *
 * `tdee-wearable-independence.test.ts` and `cardio-energy-independence.test.ts`
 * pin the same seam at full confidence. What this file adds is the two places
 * those could not reach:
 *
 *   - the LOW-confidence blend, where the measured estimate is mixed with a
 *     Mifflin anchor — until 2026-10-15 that anchor used the device-derived
 *     `activityMultiplier`, so active kcal reached maintenance for every
 *     account between 14 and 27 logged days;
 *   - the record the app stores each day (`targetSnapshot`), which is where
 *     `maintenanceEstimate` and `kcalTarget` are actually read back from.
 */

const NOW = new Date(2026, 9, 15, 9, 0, 0);

/** The owner's shape: a typed 1,850 that must win, a cut pace kept for
 *  projections, a floor at the same number. */
const OWNER = {
  heightIn: 68,
  age: 33,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 0.8,
  goalDirection: 'lose',
  calorieFloor: 1850,
  targetMode: 'custom',
  manualCaloriesTarget: 1850,
  manualProteinTarget: 140,
  profileCompleted: true,
} as unknown as Profile;

/** Same person with the target left automatic — the case where an activity
 *  leak WOULD show up in kcalTarget, since it follows maintenance. */
const AUTO = { ...OWNER, targetMode: 'auto', manualCaloriesTarget: undefined, calorieFloor: 1500 } as unknown as Profile;

/** `days` logged days ending yesterday: two meals a day, a slow downward
 *  weight trend with a fixed wiggle. Deterministic, so every comparison below
 *  is between identical intake and weights. */
function history(days: number) {
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  for (let i = days; i >= 1; i--) {
    const day = addDays(NOW, -i);
    const n = days - i;
    const kcal = 1900 + (((n * 37) % 7) - 3) * 40;
    logs.push({ date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8), calories: Math.round(kcal * 0.4), protein: 50 });
    logs.push({ date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 19), calories: Math.round(kcal * 0.6), protein: 90 });
    weights[calendarDateKey(day)] = Math.round((160 - n * 0.07 + (((n * 13) % 5) - 2) * 0.2) * 10) / 10;
  }
  return { logs, weights };
}

/** A 28-day activity window around ~10,000 steps / 600 active kcal a day,
 *  with ONE day replaced. High enough that the derived multiplier sits above
 *  its 1.40 floor, so the one day really does change it. */
function activityWindow(daySteps: number, dayActiveKcal: number) {
  const steps = Array.from({ length: 28 }, () => 10_000);
  const activeKcals = Array.from({ length: 28 }, () => 600);
  steps[27] = daySteps;
  activeKcals[27] = dayActiveKcal;
  return { steps, activeKcals };
}

/** What the profile would carry had the user accepted the activity suggestion
 *  computed from that window — the only way device energy is ever STORED. */
function withDeviceMultiplier(p: Profile, activeKcals: number[], weightLb: number): Profile {
  const basal = basalMifflinStJeor({ heightIn: 68, age: 33, sex: 'male' }, weightLb);
  const m = activityMultiplier(reduceActivityWindow(activeKcals).mean, basal);
  return { ...p, activityMultiplier: m ?? undefined } as Profile;
}

/** Activity fields riding along on that day's rows — what a careless merge of
 *  `dailyActivity` into the logs would produce. The chain must not read them. */
function stampActivity(logs: DailyLog[], key: string, steps: number, activeKcal: number): DailyLog[] {
  return logs.map((l) =>
    calendarDateKey(l.date) === key ? ({ ...l, steps, activeKcal } as DailyLog) : l,
  );
}

function record(profile: Profile, logs: DailyLog[], weights: Record<string, number>) {
  const t = dailyTargets(profile, logs, weights, NOW);
  return { t, snap: targetSnapshot(t, profile) };
}

describe('steps 2,000 vs 12,000 on a day: identical maintenanceEstimate and kcalTarget', () => {
  const lowDay = activityWindow(2_000, 120);
  const highDay = activityWindow(12_000, 700);
  const yesterday = calendarDateKey(addDays(NOW, -1));

  it('the two windows really do differ — the device multiplier moves with that one day', () => {
    const lo = withDeviceMultiplier(OWNER, lowDay.activeKcals, 157).activityMultiplier!;
    const hi = withDeviceMultiplier(OWNER, highDay.activeKcals, 157).activityMultiplier!;
    expect(hi).toBeGreaterThan(lo);
  });

  for (const [label, days] of [
    ['full confidence (60 logged days)', 60],
    ['LOW confidence (20 logged days — the blended case)', 20],
  ] as const) {
    it(`${label}`, () => {
      const { logs, weights } = history(days);
      const a = record(
        withDeviceMultiplier(OWNER, lowDay.activeKcals, 157),
        stampActivity(logs, yesterday, 2_000, 120),
        weights,
      );
      const b = record(
        withDeviceMultiplier(OWNER, highDay.activeKcals, 157),
        stampActivity(logs, yesterday, 12_000, 700),
        weights,
      );
      expect(a.t.tdee.source).toBe('measured');
      if (days === 20) expect((a.t.tdee as { confidence: number }).confidence).toBeLessThan(1);
      expect(b.snap.maintenanceEstimate).toBe(a.snap.maintenanceEstimate);
      expect(b.snap.kcalTarget).toBe(a.snap.kcalTarget);
      expect(a.snap.kcalTarget).toBe(1850);
      expect(a.snap.kcalSource).toBe('user');
    });
  }

  it('an AUTOMATIC target at low confidence does not move either (it follows maintenance)', () => {
    const { logs, weights } = history(20);
    const a = record(withDeviceMultiplier(AUTO, lowDay.activeKcals, 157), logs, weights);
    const b = record(withDeviceMultiplier(AUTO, highDay.activeKcals, 157), logs, weights);
    expect(a.snap.kcalSource).toBe('auto');
    expect(b.snap.maintenanceEstimate).toBe(a.snap.maintenanceEstimate);
    expect(b.snap.kcalTarget).toBe(a.snap.kcalTarget);
  });

  it('the multiplier is still LIVE in formula mode (<14 days) — so the tests above cannot pass because it is dead', () => {
    // ADR-0024: a device prior may seed a profile that has nothing measured yet.
    const { logs, weights } = history(10);
    const a = dailyTargets(withDeviceMultiplier(AUTO, lowDay.activeKcals, 157), logs, weights, NOW);
    const b = dailyTargets(withDeviceMultiplier(AUTO, highDay.activeKcals, 157), logs, weights, NOW);
    expect(a.tdee.source).toBe('formula');
    expect(b.tdee.trueTdee).toBeGreaterThan(a.tdee.trueTdee);
  });

  it('the low-confidence anchor reads the CHOSEN activity level', () => {
    const { logs, weights } = history(20);
    const sedentary = dailyTargets({ ...AUTO, activityLevel: 'sedentary' } as Profile, logs, weights, NOW);
    const active = dailyTargets({ ...AUTO, activityLevel: 'active' } as Profile, logs, weights, NOW);
    expect(active.tdee.trueTdee).toBeGreaterThan(sedentary.tdee.trueTdee);
  });
});

describe('a typed calorie target always wins over the automatic one', () => {
  it('kcalTarget stays 1,850 (user) while measured maintenance moves underneath it', () => {
    const { logs, weights } = history(60);
    const shifted: Record<string, number> = {};
    for (const [k, w] of Object.entries(weights)) shifted[k] = w - 0.05 * Object.keys(shifted).length;
    const a = dailyTargets(OWNER, logs, weights, NOW);
    const b = dailyTargets(OWNER, logs, shifted, NOW);
    expect(b.tdee.trueTdee).not.toBe(a.tdee.trueTdee);
    for (const t of [a, b]) {
      expect(t.calorieTarget).toBe(1850);
      expect(t.calorieSource).toBe('user');
    }
    // The automatic answer is still computed, as a suggestion beside it.
    expect(b.calorieSuggestion).not.toBe(a.calorieSuggestion);
  });
});

describe('a cardio entry with cardioKcal 300 leaves kcalTarget unchanged', () => {
  /** Finishing a session with a 300 kcal cardio block stamps the marker on
   *  that day — the one route a cardio calorie could take into the chain. */
  function withCardio(logs: DailyLog[], daysAgo: number, markerKcal?: number): DailyLog[] {
    const day = addDays(NOW, -daysAgo);
    const marker = workoutMarkerEntry([{ kcal: 300 }]);
    return [
      ...logs,
      {
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17),
        ...marker,
        ...(markerKcal != null ? { calories: markerKcal } : {}),
        cardioCompleted: true,
      },
    ].sort((x, y) => x.date.getTime() - y.date.getTime());
  }

  it('the marker carries 0 kcal, not the 300 the ring reported', () => {
    expect(workoutMarkerEntry([{ kcal: 300 }]).calories).toBe(0);
  });

  for (const [label, profile] of [['typed 1,850', OWNER], ['automatic', AUTO]] as const) {
    it(`${label} target`, () => {
      const { logs, weights } = history(60);
      const before = record(profile, logs, weights).snap;
      const after = record(profile, withCardio(logs, 2), weights).snap;
      expect(after.kcalTarget).toBe(before.kcalTarget);
      expect(after.maintenanceEstimate).toBe(before.maintenanceEstimate);
    });
  }

  it('wired the wrong way (marker = 300 kcal), the automatic target WOULD move', () => {
    const { logs, weights } = history(60);
    const before = record(AUTO, logs, weights).snap;
    const leaked = record(AUTO, withCardio(logs, 2, 300), weights).snap;
    expect(leaked.maintenanceEstimate).not.toBe(before.maintenanceEstimate);
  });
});
