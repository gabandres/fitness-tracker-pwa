import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import { MIDNIGHT } from './day-boundary';
import { ladderCall, recommend, type Recommendation } from './progression-engine';
import { reentryFor, reentryLoad, reentrySessionExercises, REENTRY_LOAD_FACTOR } from './reentry';
import { sessionCall } from './superset-context';
import { bestE1RMByExercise, engineSessions, exerciseHistory } from './train-view';
import type { TravelPeriod } from './travel';
import { travelMaintenanceCheck } from './travel-volume';
import { creditsFor } from './volume-credits';
import type { SessionExercise, TemplateExercise, WorkoutSession } from './workout';

/**
 * Travel mode, Train side (owner, 2026-10-26): re-entry sessions at −10 % /
 * RIR 2 that the engine never reads, "different equipment — not comparable"
 * sessions out of e1RM and progression, the no-equipment ladder, and the
 * Trends maintenance check.
 */

const BOLIVIA: TravelPeriod = { start: '2026-10-31', end: '2026-11-18', label: 'Bolivia' };
const TRAVEL_IDS = new Set(['travelA', 'travelB']);

const lift = (id: string, weight: number, reps: number[]): SessionExercise => ({
  exerciseId: id,
  name: id,
  cues: [],
  sets: reps.map((r) => ({ kind: 'working' as const, weight, reps: r, done: true })),
});
const session = (day: string, templateId: string, ex: SessionExercise[] = [lift('bench', 100, [8, 8, 8])], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  status: 'completed',
  date: new Date(`${day}T18:00:00`),
  templateId,
  exercises: ex,
  createdAt: new Date(`${day}T18:00:00`),
  updatedAt: new Date(`${day}T18:00:00`),
  ...extra,
});
const reentry = (templateId: string, today: string, sessions: WorkoutSession[]) =>
  reentryFor({ templateId, today, sessions, periods: [BOLIVIA], travelTemplateIds: TRAVEL_IDS, boundary: MIDNIGHT });

describe('reentryFor — when a session is re-entry', () => {
  const home = [session('2026-10-27', 'push'), session('2026-10-28', 'pull'), session('2026-10-29', 'legs')];

  it('during the trip: the first gym session after ≥ 7 days without one', () => {
    expect(reentry('push', '2026-11-05', home)).toBe('travel'); // 7 days after 10/29
    expect(reentry('push', '2026-11-04', home)).toBeNull(); // 6 days
  });

  it('a hotel-room calisthenics session is not the gym and does not reset the count', () => {
    const withTravel = [...home, session('2026-11-03', 'travelA')];
    expect(reentry('push', '2026-11-06', withTravel)).toBe('travel');
    // …and a travel template is never re-entry itself.
    expect(reentry('travelA', '2026-11-06', withTravel)).toBeNull();
  });

  it('after the trip: the FIRST session of each template is re-entry, the second is not', () => {
    expect(reentry('push', '2026-11-19', home)).toBe('post-travel');
    expect(reentry('pull', '2026-11-20', [...home, session('2026-11-19', 'push')])).toBe('post-travel');
    expect(reentry('push', '2026-11-22', [...home, session('2026-11-19', 'push')])).toBeNull();
  });

  it('only for a template with history before the trip, and only inside the window', () => {
    expect(reentry('new', '2026-11-19', home)).toBeNull();
    expect(reentry('push', '2027-01-15', home)).toBeNull();
  });

  it('never without a trip on file', () => {
    expect(reentryFor({ templateId: 'push', today: '2026-11-19', sessions: home, periods: [], boundary: MIDNIGHT })).toBeNull();
  });
});

describe('reentryLoad — −10 %, on a load the equipment has', () => {
  it('rounds DOWN to the step', () => {
    expect(REENTRY_LOAD_FACTOR).toBe(0.9);
    expect(reentryLoad(100, { stepLb: 5 })).toBe(90);
    expect(reentryLoad(95, { stepLb: 5 })).toBe(85); // 85.5 → 85
    expect(reentryLoad(22.5, { stepLb: 2.5, loadGrid: 2.5 })).toBe(20);
    expect(reentryLoad(80, { stepLb: 10, loadSteps: [50, 60, 70, 80, 90] })).toBe(70); // 72 → 70
  });

  it('never zeroes a light lift, never raises one, leaves bodyweight alone', () => {
    expect(reentryLoad(5, { stepLb: 5 })).toBe(5);
    expect(reentryLoad(0, { stepLb: 5 })).toBe(0);
    expect(reentryLoad(50, { stepLb: 10, loadSteps: [60, 70] })).toBe(50);
  });

  it('gives an assisted lift MORE help', () => {
    expect(reentryLoad(40, { stepLb: 10, assisted: true })).toBe(50); // 44.4 → 50
  });

  it('drops the frozen engine calls from a re-entry session', () => {
    const ex = { ...lift('bench', 100, [8]), recommendation: { action: 'add-load' } as unknown as SessionExercise['recommendation'] };
    const [out] = reentrySessionExercises([ex], () => ({ stepLb: 5 }));
    expect(out.sets[0].weight).toBe(90);
    expect(out.recommendation).toBeUndefined();
  });
});

describe('what the engine and the PRs read', () => {
  const pre = session('2026-10-27', 'push', [lift('bench', 100, [8, 8, 8])]);
  const back = session('2026-11-19', 'push', [lift('bench', 90, [6, 6, 6])], { reentry: 'post-travel' });
  const away = session('2026-11-08', 'push', [lift('bench', 140, [10, 10, 10])], { notComparable: true, reentry: 'travel' });

  it('never reads a re-entry or a not-comparable session: the second session back reads the pre-trip one', () => {
    const newestFirst = [back, away, pre];
    expect(engineSessions(newestFirst)).toEqual([pre]);
    const row: TemplateExercise = {
      exerciseId: 'bench', name: 'Bench', plannedSets: [], setStructure: 'straight',
      progression: { targetReps: 10, holdSessions: 1, incrementLb: 5 },
    } as unknown as TemplateExercise;
    const { rec } = sessionCall(row, newestFirst, null);
    expect(rec.currentLoad).toBe(100);
  });

  it('keeps another gym\'s equipment out of e1RM and PRs', () => {
    expect(exerciseHistory([away, pre], 'bench')).toHaveLength(1);
    expect(bestE1RMByExercise([away, pre]).bench).toBe(bestE1RMByExercise([pre]).bench);
  });
});

describe('the no-equipment ladder', () => {
  const base: Recommendation = recommend([], {});
  const hist = (weight: number, reps: number[]) => [lift('pushup', weight, reps)];

  it('is silent below the cap: the engine\'s own call stands', () => {
    expect(ladderCall({ capReps: 20 }, hist(0, [18, 16, 15]), base)).toBeNull();
  });

  it('an unloaded lift at the cap: tempo first, holding the load at none', () => {
    const r = ladderCall({ capReps: 20, harder: 'feet elevated' }, hist(0, [20, 17, 15]), base);
    expect(r).toMatchObject({ action: 'hold', load: 0, reason: { kind: 'harder-ladder', next: 'tempo', reps: 20, cap: 20, harder: 'feet elevated' } });
  });

  it('a backpack-loaded lift at the cap: more load (then the variation), load held', () => {
    const r = ladderCall({ capReps: 15, harder: 'deficit + feet elevated' }, hist(15, [15, 14]), base);
    expect(r).toMatchObject({ action: 'hold', load: 15, reason: { kind: 'harder-ladder', next: 'load' } });
  });
});

describe('volume credits for the travel moves (owner\'s table, 2026-10-26)', () => {
  const credits = (name: string) => creditsFor(name).map((c) => `${c.muscle}:${c.weight}`).sort();
  it.each([
    ['Deficit Push-up', ['chest:1', 'frontDelt:0.5', 'triceps:0.5']],
    ['Feet-Elevated Push-up', ['chest:1', 'frontDelt:0.5', 'triceps:0.5']],
    ['Pike Push-up', ['frontDelt:1', 'sideDelt:0.5', 'triceps:0.5']],
    ['Bulgarian Split Squat', ['glutes:0.5', 'quads:1']],
    ['Reverse Lunge', ['glutes:0.5', 'quads:1']],
    ['Single-leg RDL', ['glutes:0.5', 'hamstrings:1']],
    ['Single-leg Glute Bridge', ['glutes:1']],
    ['Backpack Row', ['back:1', 'biceps:0.5', 'rearDelt:0.5']],
    ['Towel Door Row', ['back:1', 'biceps:0.5', 'rearDelt:0.5']],
    ['Band Lateral Raise', ['sideDelt:1']],
    ['Weighted Crunch', ['abs:1']],
    ['Lying Leg Raise', ['abs:1']],
    ['Band Curl', ['biceps:1']],
    ['Band Pull-apart', ['rearDelt:1']],
  ])('%s', (name, expected) => {
    expect(credits(name)).toEqual(expected);
  });
});

describe('travelMaintenanceCheck — a third of normal per muscle', () => {
  // Four weeks before the trip: chest 3 sets × 2 sessions a week = 6/week.
  const before: WorkoutSession[] = [];
  for (let w = 0; w < 4; w++) {
    for (const d of [1, 4]) {
      const day = new Date(2026, 9, 3 + w * 7 + d);
      before.push({ status: 'completed', date: day, createdAt: day, updatedAt: day, exercises: [{ ...lift('x', 0, [10, 10, 10]), name: 'Deficit Push-up' }] });
    }
  }
  const away: WorkoutSession = {
    status: 'completed', date: new Date(2026, 10, 3, 18), createdAt: new Date(2026, 10, 3, 18), updatedAt: new Date(2026, 10, 3, 18), exercises: [{ ...lift('x', 0, [15, 14]), name: 'Deficit Push-up' }],
  };

  it('reads chest as 6/week normally and needs 2 — 2 sets this week is enough', () => {
    const check = travelMaintenanceCheck({
      sessions: [...before, away], catalog: [], period: BOLIVIA, now: new Date(2026, 10, 5, 12), boundary: MIDNIGHT,
    });
    const chest = check.rows.find((r) => r.muscle === 'chest');
    expect(chest).toMatchObject({ normalWeekly: 6, needed: 2, thisWeek: 2, ok: true });
    expect(check.windowFrom.getTime()).toBe(new Date(2026, 9, 31).getTime()); // never before the trip
  });
});

describe('the export', () => {
  it('marks an eyeballed meal, a travel weigh-in, the trip, and re-entry sessions', () => {
    const csv = buildCsv({
      logs: [{ date: new Date('2026-11-02T13:00:00'), calories: 550, protein: 35, mealLabel: 'Salteña + chicken', estimateQuality: 'eyeballed', proteinFirst: true }],
      measurements: [],
      dailyWeights: { '2026-10-30': 152, '2026-11-08': 156.2 },
      dailyWater: {},
      dailySleep: {},
      workoutSessions: [session('2026-11-19', 'push', [lift('bench', 90, [6])], { reentry: 'post-travel' })],
      travelPeriods: [BOLIVIA],
    });
    const [head, ...lines] = csv.split('\r\n');
    const cols = head.split(',');
    const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
    expect(rows.find((r) => r.type === 'meal')).toMatchObject({ estimateQuality: 'eyeballed', proteinFirst: 'true' });
    expect(rows.find((r) => r.type === 'weight' && r.date === '2026-11-08')?.notes).toBe('travel scale — not comparable');
    expect(rows.find((r) => r.type === 'weight' && r.date === '2026-10-30')?.notes).toBe('');
    expect(rows.find((r) => r.type === 'travel')?.date).toBe('2026-10-31');
    expect(rows.find((r) => r.type === 'workout')?.sessionFlags).toBe('reentry:post-travel');
    expect(rows.find((r) => r.type === 'workout_set')?.rirTarget).toBe('2');
  });
});
