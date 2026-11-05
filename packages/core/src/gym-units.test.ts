import { describe, expect, it } from 'vitest';
import { kgToLb } from './health-mapping';
import {
  dualLoadText, gymLoadHint, kgOf, rangeNudge, relabelRows, rememberUnit, setUnit, startUnit, switchRowUnit, unitAskOf, UNIT_BY_GYM_MAX,
} from './gym-units';
import { buildCsv } from './csv-export';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';

const set = (o: Partial<WorkoutSet>): WorkoutSet => ({ kind: 'working', ...o });
const session = (id: string, day: string, exercises: SessionExercise[], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, status: 'completed', date: new Date(`${day}T12:00:00Z`), exercises, createdAt: new Date(), updatedAt: new Date(), ...extra,
});

describe('kgOf — round(lb ÷ 2.2046, 1)', () => {
  it('derives the owner\'s numbers', () => {
    expect(kgOf(25)).toBe(11.3);
    expect(kgOf(88.1848)).toBe(40);
    expect(kgOf(26.45544)).toBe(12);
  });
  it('a kg entry stored as full-precision lb comes back exactly', () => {
    for (const kg of [1, 2.5, 4, 10, 12, 12.5, 37, 40, 102.5, 250]) expect(kgOf(kgToLb(kg))).toBe(kg);
  });
});

describe('dualLoadText', () => {
  it('shows the entry unit first, no trailing .0', () => {
    expect(dualLoadText(kgToLb(12), 'kg', 'en')).toBe('12 kg (26.5 lb)');
    expect(dualLoadText(25, 'lb', 'en')).toBe('25 lb (11.3 kg)');
  });
});

describe('setUnit / startUnit / switchRowUnit', () => {
  it('a set reads in its typed unit, else the row, else the account', () => {
    expect(setUnit({ unit: 'kg' }, 'lb', 'us')).toBe('kg');
    expect(setUnit({}, 'kg', 'us')).toBe('kg');
    expect(setUnit({}, undefined, 'metric')).toBe('kg');
    expect(setUnit({}, undefined, undefined)).toBe('lb');
  });
  it('memory beats the row, the row beats travel, travel beats the account', () => {
    expect(startUnit({ remembered: 'lb', rowUnit: 'kg', travel: true, unitSystem: 'us' })).toBe('lb');
    expect(startUnit({ rowUnit: 'kg', travel: false, unitSystem: 'us' })).toBe('kg');
    expect(startUnit({ travel: true, unitSystem: 'us' })).toBe('kg');
    expect(startUnit({ travel: false, unitSystem: 'us' })).toBe('lb');
  });
  it('switching moves unticked sets only', () => {
    const ex = { loadUnit: 'kg' as const, sets: [set({ unit: 'kg', done: true, weight: 22 }), set({ unit: 'kg' }), set({})] };
    const out = switchRowUnit(ex, 'lb');
    expect(out.loadUnit).toBe('lb');
    expect(out.sets.map((s) => s.unit)).toEqual(['kg', 'lb', undefined]);
  });
  it('remembers per gym and caps the map', () => {
    let m = {};
    for (let i = 0; i < UNIT_BY_GYM_MAX + 3; i++) m = rememberUnit(m, `g${i}`, 'kg');
    expect(Object.keys(m)).toHaveLength(UNIT_BY_GYM_MAX);
    expect(m).toHaveProperty(`g${UNIT_BY_GYM_MAX + 2}`, 'kg');
    const same = rememberUnit(m, `g${UNIT_BY_GYM_MAX + 2}`, 'kg');
    expect(same).toBe(m);
  });
});

describe('gymLoadHint', () => {
  const home = (lb: number, day: string, extra?: Partial<WorkoutSession>) =>
    session(day, day, [{ exerciseId: 'x', name: 'DB Flat Press', cues: [], sets: [set({ weight: lb, reps: 10 })] }], extra);
  const away = (lb: number, day: string) =>
    session(`a${day}`, day, [{ exerciseId: 'x', name: 'DB Flat Press', cues: [], awayGym: 'Haven Gym', sets: [set({ weight: lb, reps: 9, kind: 'activation' })] }]);
  const row = { exerciseId: 'x', name: 'DB Flat Press', awayGym: 'Haven Gym' };

  it('(a) the last load at the same gym wins', () => {
    const h = gymLoadHint([home(50, '2026-10-20'), away(kgToLb(10), '2026-11-04')], row);
    expect(h).toMatchObject({ source: 'gym', kg: 10 });
  });
  it('(b) else last home load −10 %, down to 2 kg for dumbbells', () => {
    // 50 lb = 22.7 kg; × 0.9 = 20.4 → 20.
    const h = gymLoadHint([home(45, '2026-10-01'), home(50, '2026-10-20')], row);
    expect(h).toMatchObject({ source: 'home', kg: 20 });
    expect(kgOf(h!.lb)).toBe(20);
  });
  it('down to 1 kg on a machine stack', () => {
    const s = session('m', '2026-10-20', [{ exerciseId: 'm', name: 'Lat Pulldown', cues: [], sets: [set({ weight: 90, reps: 10 })] }]);
    // 90 lb = 40.8 kg; × 0.9 = 36.7 → 36.
    expect(gymLoadHint([s], { exerciseId: 'm', name: 'Lat Pulldown', awayGym: 'Haven Gym' })).toMatchObject({ kg: 36 });
  });
  it('skips not-comparable and deload sessions, and says nothing at home', () => {
    expect(gymLoadHint([home(50, '2026-10-20', { notComparable: true })], row)).toBeNull();
    expect(gymLoadHint([home(50, '2026-10-20', { deload: true })], row)).toBeNull();
    expect(gymLoadHint([home(50, '2026-10-20')], { exerciseId: 'x', name: 'DB Flat Press' })).toBeNull();
  });
});

describe('rangeNudge', () => {
  const ten = (rir: number | undefined, done = true) => set({ reps: 10, rir, done });
  it('three 10s at RIR ≥ 2 running, across the last session and this one', () => {
    expect(rangeNudge({ sets: [ten(2)] }, { sets: [ten(2), ten(3)] })).toBe(true);
    expect(rangeNudge({ sets: [ten(2), ten(2), ten(2)] })).toBe(true);
  });
  it('not on RIR 0/1, a blank RIR, 11 reps or an unticked set', () => {
    expect(rangeNudge({ sets: [ten(2), ten(2), ten(0)] })).toBe(false);
    expect(rangeNudge({ sets: [ten(2), ten(2), ten(undefined)] })).toBe(false);
    expect(rangeNudge({ sets: [ten(2), ten(2), set({ reps: 11, rir: 2, done: true })] })).toBe(false);
    expect(rangeNudge({ sets: [ten(2), ten(2), ten(2, false)] })).toBe(false);
  });
});

describe('unit ask + relabel', () => {
  it('parses the profile field', () => {
    expect(unitAskOf({ gym: 'Haven Gym', question: 'q', exerciseIds: ['a'] })).toEqual({ gym: 'Haven Gym', question: 'q', exerciseIds: ['a'] });
    expect(unitAskOf({ gym: 'Haven Gym', question: 'q', exerciseIds: [] })).toBeNull();
  });
  it('kg: the typed number becomes kg, once', () => {
    const rows: SessionExercise[] = [
      { exerciseId: 'row', name: 'Row', cues: [], sets: [set({ weight: 10, reps: 10 })] },
      { exerciseId: 'curl', name: 'Leg Curl', cues: [], sets: [set({ weight: 50, reps: 10 })] },
    ];
    const once = relabelRows(rows, ['row'], 'kg');
    expect(once[0].loadUnit).toBe('kg');
    expect(kgOf(once[0].sets[0].weight!)).toBe(10);
    expect(once[0].sets[0].unit).toBe('kg');
    expect(once[1]).toBe(rows[1]);
    expect(relabelRows(once, ['row'], 'kg')).toEqual(once);
  });
  it('lb: labels only', () => {
    const out = relabelRows([{ exerciseId: 'row', name: 'Row', cues: [], sets: [set({ weight: 10, reps: 10 })] }], ['row'], 'lb');
    expect(out[0].sets[0]).toMatchObject({ weight: 10, unit: 'lb' });
  });
});

describe('export kg columns', () => {
  it('every set and template row carries derived kg and a unit', () => {
    const s = session('s', '2026-11-04', [
      { exerciseId: 'x', name: 'DB RDL', cues: [], loadUnit: 'kg', sets: [set({ weight: kgToLb(12), reps: 8, unit: 'kg' })] },
      { exerciseId: 'y', name: 'Curl', cues: [], sets: [set({ weight: 25, reps: 10 })] },
    ]);
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, workoutSessions: [s],
      templates: [{ id: 't', name: 'T', exercises: [{ exerciseId: 'x', name: 'DB RDL', targetLoad: kgToLb(12), loadUnit: 'kg', plannedSets: [] }], createdAt: new Date(), updatedAt: new Date() }],
    });
    const [h, ...rows] = csv.split('\r\n');
    const cols = h.split(',');
    const at = (r: string, c: string) => r.split(',')[cols.indexOf(c)];
    const sets = rows.filter((r) => r.startsWith('workout_set'));
    expect(sets.map((r) => [at(r, 'setWeightKg'), at(r, 'unit')])).toEqual([['12', 'kg'], ['11.3', 'lb']]);
    const tpl = rows.find((r) => r.startsWith('template'))!;
    expect([at(tpl, 'loadKg'), at(tpl, 'unit')]).toEqual(['12', 'kg']);
  });
});
