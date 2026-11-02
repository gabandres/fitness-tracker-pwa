import { describe, expect, it } from 'vitest';
import { MIDNIGHT } from './day-boundary';
import { calibrationRaise } from './calibration-raise';
import { buildCsv } from './csv-export';
import { kgToLb, lbToKg } from './health-mapping';
import { carryAndStampRows } from './progression-apply';
import { nextLoad, readExercise, recommend, recommendOptionsFor, resolveEngineConfig } from './progression-engine';
import { sessionCall } from './superset-context';
import { nextTemplateUp } from './train-plan';
import { bestE1RMByExercise, engineHistory, exerciseHistory, previousHistory } from './train-view';
import { travelPeriodsOf } from './travel';
import { isBackToBackGymDay, sanitizeTravelPlan, travelWeek, type TravelPlanEntry } from './travel-plan';
import { rowUnitSystem, toDisplayLoad } from './load-units';
import type { SessionExercise, TemplateExercise, WorkoutSession, WorkoutTemplate } from './workout';

const C = 'travel-gym-c';
const D = 'travel-gym-d';
const PLAN: TravelPlanEntry[] = [
  { from: '2026-11-02', to: '2026-11-02', kind: 'rest', label: 'Rest' },
  { from: '2026-11-03', to: '2026-11-03', kind: 'session', label: 'Travel C', templateId: C, note: 'calibration' },
  { from: '2026-11-04', to: '2026-11-05', kind: 'session', label: 'Travel D', templateId: D },
  { from: '2026-11-09', to: '2026-11-09', kind: 'session', label: 'Travel C', templateId: C },
  { from: '2026-11-11', to: '2026-11-11', kind: 'session', label: 'Travel D', templateId: D },
  { from: '2026-11-13', to: '2026-11-18', kind: 'session', label: 'Travel A', templateId: 'a' },
  { from: '2026-11-13', to: '2026-11-18', kind: 'session', label: 'Travel B', templateId: 'b' },
];
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);
const session = (day: string, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  status: 'completed', date: at(day), exercises: [], createdAt: at(day), updatedAt: at(day), ...over,
});
const week = (today: string, sessions: WorkoutSession[] = []) => travelWeek(PLAN, today, sessions, MIDNIGHT);

describe('travelWeek', () => {
  it('Monday 11/02: the week\'s entries, the rest day first, Travel C next', () => {
    const w = week('2026-11-02');
    expect([w.start, w.end]).toEqual(['2026-11-02', '2026-11-08']);
    expect(w.rows.map((r) => [r.label, r.status])).toEqual([['Rest', 'rest'], ['Travel C', 'upcoming'], ['Travel D', 'upcoming']]);
    expect(w.next?.label).toBe('Travel C');
    expect(w.next?.from).toBe('2026-11-03');
  });
  it('a done session is done; a window is due on either day and closes when trained', () => {
    const done = [session('2026-11-03', { templateId: C })];
    expect(week('2026-11-04', done).rows.map((r) => r.status)).toEqual(['rest', 'done', 'due']);
    expect(week('2026-11-04', done).next?.label).toBe('Travel D');
    const both = [...done, session('2026-11-05', { templateId: D })];
    expect(week('2026-11-05', both).next?.from).toBe('2026-11-09');
  });
  it('a skipped session is skipped, not a problem: next moves on', () => {
    const w = week('2026-11-06');
    expect(w.rows.map((r) => r.status)).toEqual(['rest', 'skipped', 'skipped']);
    expect(w.next?.from).toBe('2026-11-09');
  });
  it('the session trained a day late, in the same week, is still that session', () => {
    expect(week('2026-11-04', [session('2026-11-04', { templateId: C })]).rows[1].status).toBe('done');
  });
  it('Santa Cruz: A and B share a window, one each', () => {
    const w = week('2026-11-14', [session('2026-11-13', { templateId: 'a' })]);
    expect(w.rows.map((r) => [r.label, r.status]).slice(-2)).toEqual([['Travel A', 'done'], ['Travel B', 'due']]);
    expect(w.next?.label).toBe('Travel B');
  });
  it('an active workout does not count', () => {
    expect(week('2026-11-03', [session('2026-11-03', { templateId: C, status: 'active' })]).rows[1].status).toBe('due');
  });
});

describe('the plan on the period', () => {
  it('sanitizer: keeps good entries sorted, drops malformed ones', () => {
    const out = sanitizeTravelPlan([
      PLAN[3], PLAN[0],
      { from: '2026-11-05', to: '2026-11-04', kind: 'rest', label: 'x' },
      { from: 'soon', to: '2026-11-04', kind: 'rest', label: 'x' },
      { from: '2026-11-04', to: '2026-11-04', kind: 'nap', label: 'x' },
      { from: '2026-11-04', to: '2026-11-04', kind: 'rest', label: ' ' },
      null,
    ]);
    expect(out.map((e) => e.from)).toEqual(['2026-11-02', '2026-11-09']);
    expect(sanitizeTravelPlan('nope')).toEqual([]);
  });
  it('travelPeriodsOf keeps it, so saving a trip from Settings does not lose it', () => {
    const [p] = travelPeriodsOf({ travelPeriods: [{ start: '2026-10-31', end: '2026-11-18', plan: PLAN }] });
    expect(p.plan).toHaveLength(PLAN.length);
    expect(travelPeriodsOf({ travelPeriods: [{ start: '2026-10-31', end: '2026-11-18' }] })[0].plan).toBeUndefined();
  });
});

const row = (over: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId: 'flat', name: 'DB Flat Press', targetLoad: kgToLb(10), plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }], ...over,
});
const liftRow = (reps: number, load: number, over: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: 'flat', name: 'DB Flat Press', cues: [],
  sets: [{ kind: 'activation', group: 1, weight: load, reps, rir: 1, done: true }, { kind: 'mini', group: 1, weight: load, reps: 3, done: true }, { kind: 'mini', group: 1, weight: load, reps: 2, done: true }],
  ...over,
});
const haven = { awayGym: 'Haven Gym', linkedHome: true } as const;

describe('a linked lift at an away gym: one record, two sets of evidence', () => {
  const home = session('2026-10-30', { exercises: [liftRow(10, 25)] });
  const away = session('2026-11-03', { exercises: [liftRow(11, 22.05, haven)] });
  const newestFirst = [away, home];

  it('the home row never reads the away session, and the away row reads only those', () => {
    expect(engineHistory(newestFirst, 'flat', row()).map((e) => e.sets[0].weight)).toEqual([25]);
    expect(engineHistory(newestFirst, 'flat', row({ awayGym: 'Haven Gym' })).map((e) => e.sets[0].weight)).toEqual([22.05]);
    expect(sessionCall(row(), newestFirst, null).basedOn).toEqual(home.date);
    expect(sessionCall(row({ awayGym: 'Haven Gym' }), newestFirst, null).basedOn).toEqual(away.date);
  });
  it('the e1RM chart and PRs stay home', () => {
    expect(exerciseHistory(newestFirst, 'flat').map((e) => e.sets[0].weight)).toEqual([25]);
    const prs = bestE1RMByExercise([session('2026-11-03', { exercises: [liftRow(20, 200, haven)] }), home]);
    expect(prs.flat).toBeLessThan(40);
  });
  it('an own-id lift at the gym charts normally', () => {
    const own = session('2026-11-03', { exercises: [liftRow(11, 22.05, { awayGym: 'Haven Gym' })] });
    expect(exerciseHistory([own], 'flat')).toHaveLength(1);
  });
  it('"last time": the home numbers on the first session of a linked lift, then its own', () => {
    expect(previousHistory([home], { exerciseId: 'flat', ...haven }).map((e) => e.sets[0].weight)).toEqual([25]);
    expect(previousHistory(newestFirst, { exerciseId: 'flat', ...haven }).map((e) => e.sets[0].weight)).toEqual([22.05]);
    expect(previousHistory([home], { exerciseId: 'flat', awayGym: 'Haven Gym' })).toEqual([]);
  });
});

describe('kg rows', () => {
  it('an edit in the template editor keeps the row at its gym', () => {
    const at = new Date('2026-11-04T12:00:00Z');
    const before = row({ loadUnit: 'kg', awayGym: 'Haven Gym', linkedHome: true });
    const [saved] = carryAndStampRows([before], [row({ targetLoad: 30 })], { at, by: 'user' });
    expect(saved).toMatchObject({ loadUnit: 'kg', awayGym: 'Haven Gym', linkedHome: true, targetLoad: 30 });
  });
  it('the unit is the row\'s; the stored number is pounds and round-trips', () => {
    expect(rowUnitSystem('kg', 'us')).toBe('metric');
    expect(rowUnitSystem(undefined, 'us')).toBe('us');
    expect(toDisplayLoad(+kgToLb(10).toFixed(2), 'metric')).toBe(10);
    expect(toDisplayLoad(+kgToLb(37).toFixed(2), 'metric')).toBe(37);
  });
  it('a dumbbell steps on the kg rack, 10 → 12.5 → 15, not 25 lb', () => {
    const config = resolveEngineConfig({ name: 'DB Flat Press', dumbbellStepLb: 5 }, { name: 'DB Flat Press', loadUnit: 'kg' });
    const once = nextLoad(+kgToLb(10).toFixed(2), { grid: config.loadGrid });
    expect(+lbToKg(once.load).toFixed(1)).toBe(12.5);
    expect(+lbToKg(nextLoad(once.load, { grid: config.loadGrid }).load).toFixed(1)).toBe(15);
  });
  it('the home catalog\'s lb steps do not apply on a kg row', () => {
    const config = resolveEngineConfig({ name: 'Lat Pulldown', availableLoads: [80, 90] }, { name: 'Lat Pulldown', loadUnit: 'kg' });
    expect(config.loadSteps).toBeUndefined();
    expect(recommendOptionsFor(row({ loadUnit: 'kg' }), { availableLoads: [80, 90] }).availableLoads).toBeUndefined();
  });
});

describe('progression at the gym', () => {
  const gymRow = (targetReps: number) => row({ awayGym: 'Haven Gym', loadUnit: 'kg', progression: { targetReps, holdSessions: 1, incrementLb: 5.51 } });
  const call = (reps: number, targetReps: number, category: 'compound' | 'isolation', rir = 1) => {
    const r = gymRow(targetReps);
    const ex = liftRow(reps, 22.05, { awayGym: 'Haven Gym' });
    ex.sets[0].rir = rir;
    return recommend([ex], recommendOptionsFor(r, { name: r.name, category, effortStandard: 'rir1' }));
  };
  it('a compound goes up at 12 at the target effort, under 12 it does not', () => {
    expect(call(12, 12, 'compound').action).toBe('add-load');
    expect(call(11, 12, 'compound').action).not.toBe('add-load');
  });
  it('an isolation goes up at 15, not at 13', () => {
    expect(call(15, 15, 'isolation').action).toBe('add-load');
    expect(call(13, 15, 'isolation').action).not.toBe('add-load');
  });
  it('the first read at the gym can already earn the next load, baseline marker or not', () => {
    const r = row({ awayGym: 'Haven Gym', loadUnit: 'kg', baseline: { since: '2026-11-03', reason: 'Haven Gym' }, progression: { targetReps: 12, holdSessions: 1, incrementLb: 5.51 } });
    const ex = liftRow(11, 22.05, { awayGym: 'Haven Gym', linkedHome: true, calibration: true });
    ex.sets[0].rir = 2;
    const called = sessionCall(r, [session('2026-11-03', { exercises: [ex] })], { name: 'DB Flat Press', effortStandard: 'rir1' }).rec;
    expect(called.action).toBe('add-load');
    expect(+lbToKg(called.load!).toFixed(1)).toBe(12.5);
    const home = row({ baseline: { since: '2026-11-03', reason: 'position' } });
    expect(sessionCall(home, [session('2026-11-03', { exercises: [liftRow(14, 22.05)] })], { name: 'DB Flat Press', effortStandard: 'rir1' }).rec.reason).toMatchObject({ kind: 'baseline-set' });
  });
  it('a bodyweight lift reads the gym\'s top of the range, not its category\'s', () => {
    const r = row({ awayGym: 'Haven Gym', exerciseId: 'flat', name: 'Pull-up', targetLoad: 0, loadUnit: 'kg', progression: { targetReps: 12, holdSessions: 1, incrementLb: 5.51 } });
    const config = resolveEngineConfig({ name: 'Pull-up', effortStandard: 'rir1', loadable: true }, r);
    expect(config.category).toBe('bodyweight');
    expect(config.repRange.max).toBe(12);
    expect(resolveEngineConfig({ name: 'Pull-up' }, { name: 'Pull-up' }).repRange.max).toBe(15);
  });
  it('a calibration activation at RIR 2 is not "too easy" for its long first mini', () => {
    const sets = liftRow(10, 22.05).sets.map((s, i) => (i === 1 ? { ...s, reps: 8 } : s));
    expect(readExercise({ sets }).issue).toBe('first-mini-too-many');
    expect(readExercise({ sets, calibration: true }).valid).toBe(true);
  });
});

describe('"raise load now" on a cluster', () => {
  const r = row({ awayGym: 'Haven Gym', loadUnit: 'kg', progression: { targetReps: 12, holdSessions: 1, incrementLb: 5.51 } });
  const opts = recommendOptionsFor(r, { name: 'DB Flat Press' });
  const live = (reps: number): SessionExercise => ({
    exerciseId: 'flat', name: 'DB Flat Press', cues: [],
    sets: [
      { kind: 'activation', group: 1, weight: 22.05, reps, rir: 2, done: true },
      { kind: 'mini', group: 1, weight: 22.05 }, { kind: 'mini', group: 1, weight: 22.05 },
      { kind: 'activation', group: 2, weight: 22.05 }, { kind: 'mini', group: 2, weight: 22.05 }, { kind: 'mini', group: 2, weight: 22.05 },
    ],
  });
  it('at target + 3 it offers the next kg step for the rest of today', () => {
    const raise = calibrationRaise({ row: r, history: [], sessionExercise: live(15), opts });
    expect(raise?.setIndices).toEqual([1, 2, 3, 4, 5]);
    expect(+lbToKg(raise!.suggestedLoad).toFixed(1)).toBe(12.5);
  });
  it('not at target + 2, and not once a read exists', () => {
    expect(calibrationRaise({ row: r, history: [], sessionExercise: live(14), opts })).toBeNull();
    expect(calibrationRaise({ row: r, history: [liftRow(12, 22.05)], sessionExercise: live(15), opts })).toBeNull();
  });
  it('a home cluster still never prompts', () => {
    const home = row({ progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 } });
    expect(calibrationRaise({ row: home, history: [], sessionExercise: live(15), opts: recommendOptionsFor(home, { name: 'DB Flat Press' }) })).toBeNull();
  });
});

describe('back-to-back gym days', () => {
  const gymEx = { awayGym: 'Haven Gym' };
  const today = { date: at('2026-11-04'), exercises: [gymEx] };
  const yesterday = (over: Partial<WorkoutSession> = {}) => session('2026-11-03', { exercises: [liftRow(10, 22, { awayGym: 'Haven Gym' })], ...over });
  it('says so the second day', () => {
    expect(isBackToBackGymDay(today, [yesterday()], MIDNIGHT)).toBe(true);
  });
  it('not with a gap, not after a hotel workout, not off the gym', () => {
    expect(isBackToBackGymDay({ ...today, date: at('2026-11-05') }, [yesterday()], MIDNIGHT)).toBe(false);
    expect(isBackToBackGymDay(today, [session('2026-11-03', { exercises: [liftRow(10, 22)] })], MIDNIGHT)).toBe(false);
    expect(isBackToBackGymDay({ date: at('2026-11-04'), exercises: [{}] }, [yesterday()], MIDNIGHT)).toBe(false);
  });
});

describe('Next up', () => {
  const tpl = (id: string, templateVersion: string): WorkoutTemplate => ({ id, name: id, templateVersion, exercises: [], createdAt: at('2026-10-01'), updatedAt: at('2026-10-01') });
  const all = [tpl('push', 'v2.3'), tpl(C, 'travel-gym-v3'), tpl(D, 'travel-gym-v3'), tpl('a', 'travel-v1'), tpl('b', 'travel-v1')];
  const pushed = [session('2026-10-30', { templateId: 'push' })];
  const periods = [{ start: '2026-10-31', end: '2026-11-18', plan: PLAN }];
  const now = at('2026-11-02').getTime();
  it('inside the trip it is the plan\'s next session', () => {
    expect(nextTemplateUp(all, pushed, now, { today: '2026-11-02', periods, boundary: MIDNIGHT })?.template.id).toBe(C);
    expect(nextTemplateUp(all, [...pushed, session('2026-11-03', { templateId: C })], now, { today: '2026-11-04', periods, boundary: MIDNIGHT })?.template.id).toBe(D);
  });
  it('home again, a never-performed travel template is not next up', () => {
    expect(nextTemplateUp(all, pushed, now, { today: '2026-11-19', periods, boundary: MIDNIGHT })?.template.id).toBe('push');
  });
  it('without a trip argument it reads as it always has', () => {
    expect(nextTemplateUp(all, pushed, now)?.template.id).toBe(C);
  });
});

describe('export', () => {
  it('plan rows, kg columns and the first-session flags', () => {
    const t: WorkoutTemplate = {
      id: C, name: 'Travel C', templateVersion: 'travel-gym-v3', createdAt: at('2026-11-02'), updatedAt: at('2026-11-02'),
      exercises: [row({ loadUnit: 'kg', targetLoad: 22.05, awayGym: 'Haven Gym', linkedHome: true })],
    };
    const s = session('2026-11-03', { templateId: C, templateName: 'Travel C', exercises: [liftRow(11, 22.05, { ...haven, loadUnit: 'kg', calibration: true })] });
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: [t], workoutSessions: [s],
      travelPeriods: [{ start: '2026-10-31', end: '2026-11-18', plan: PLAN }],
    });
    const [head, ...lines] = csv.split(/\r?\n/);
    const cols = head.split(',');
    const cell = (l: string, c: string) => l.split(',')[cols.indexOf(c)];
    expect(lines.filter((l) => l.startsWith('travel_plan,'))).toHaveLength(PLAN.length);
    const tplRow = lines.find((l) => l.startsWith('template,'))!;
    expect([cell(tplRow, 'load'), cell(tplRow, 'loadUnit'), cell(tplRow, 'loadInUnit')]).toEqual(['22.05', 'kg', '10']);
    const act = lines.find((l) => l.startsWith('workout_set,') && l.includes('activation'))!;
    expect([cell(act, 'setWeight'), cell(act, 'loadInUnit'), cell(act, 'rirTarget')]).toEqual(['22.05', '10', '2']);
    expect(cell(act, 'sessionFlags')).toBe('calibration;travel-re-entry');
    expect(cell(lines.find((l) => l.startsWith('workout,'))!, 'sessionFlags')).toBe('travel-re-entry');
  });
});
