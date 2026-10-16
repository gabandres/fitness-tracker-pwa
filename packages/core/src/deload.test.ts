import { describe, expect, it } from 'vitest';
import { deloadProgress, deloadSessionExercises, deloadSignal, DELOAD_MAX_DAYS } from './deload';
import { engineSessions } from './train-view';
import type { SessionExercise, TemplateExercise, WorkoutSession, WorkoutSet } from './workout';

const day = (d: number) => new Date(2026, 9, d, 8);
const act = (w: number, reps: number, group = 1, label?: string): WorkoutSet => ({ kind: 'activation', group, weight: w, reps, rir: 0, done: true, ...(label ? { label } : {}) });
const mini = (w: number, reps: number, group = 1, label?: string): WorkoutSet => ({ kind: 'mini', group, weight: w, reps, done: true, ...(label ? { label } : {}) });
const exOf = (id: string, sets: WorkoutSet[]): SessionExercise => ({ exerciseId: id, name: id, cues: [], sets });
const session = (d: number, exercises: SessionExercise[], over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  status: 'completed', templateId: 'push', date: day(d), createdAt: day(d), updatedAt: day(d), exercises, ...over,
});
const row = (id: string, over: Partial<TemplateExercise> = {}): TemplateExercise => ({ exerciseId: id, name: id, plannedSets: [], ...over });
const tpl = (rows: TemplateExercise[]) => [{ exercises: rows }];
// One session of two lifts at fixed loads: press and curl activation reps.
const two = (d: number, press: number, curl: number, over: Partial<WorkoutSession> = {}) =>
  session(d, [exOf('press', [act(25, press), mini(25, 4)]), exOf('curl', [act(15, curl), mini(15, 4)])], over);

describe('the deload trigger', () => {
  it('fires when 2 lifts are down ≥ 2 reps at the same load for 2 consecutive sessions', () => {
    const sessions = [two(1, 12, 15), two(5, 10, 13), two(9, 10, 12)];
    const s = deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions });
    expect(s.triggered).toBe(true);
    expect(s.lifts).toEqual([
      { exerciseId: 'press', name: 'press', load: 25, reps: [12, 10, 10] },
      { exerciseId: 'curl', name: 'curl', load: 15, reps: [15, 13, 12] },
    ]);
  });

  it('one lift down is not enough', () => {
    const s = deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: [two(1, 12, 15), two(5, 10, 15), two(9, 10, 14)] });
    expect(s).toEqual({ triggered: false, lifts: [{ exerciseId: 'press', name: 'press', load: 25, reps: [12, 10, 10] }] });
  });

  it('down only once (the latest session recovered) is not a trend', () => {
    expect(deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: [two(1, 12, 15), two(5, 10, 13), two(9, 11, 14)] }).triggered).toBe(false);
  });

  it('down by 1 is not down', () => {
    expect(deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: [two(1, 12, 15), two(5, 11, 14), two(9, 11, 14)] }).lifts).toEqual([]);
  });

  it('a load change in between is not "the same load"', () => {
    const heavier = session(5, [exOf('press', [act(30, 9)]), exOf('curl', [act(17.5, 12)])]);
    const s = deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: [two(1, 12, 15), heavier, two(9, 10, 13)] });
    expect(s.triggered).toBe(false);
  });

  it('same context only: reads before a row\'s baseline are not compared', () => {
    const sessions = [two(1, 12, 15), two(5, 10, 13), two(9, 10, 12)];
    // The press moved position on 10/5: its 10/1 read is not its reference.
    const s = deloadSignal({ templates: tpl([row('press', { baseline: { since: '2026-10-05', reason: 'context changed: position' } }), row('curl')]), sessions });
    expect(s.lifts.map((l) => l.exerciseId)).toEqual(['curl']);
    expect(s.triggered).toBe(false);
  });

  it('a deload session is never a read, and nothing before the last deload started is either', () => {
    const sessions = [two(1, 12, 15), two(5, 10, 13), two(9, 10, 12)];
    const withDeload = [...sessions, two(11, 6, 8, { deload: true })];
    expect(deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: withDeload }).triggered).toBe(true);
    expect(deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: withDeload, since: day(11) }).triggered).toBe(false);
  });

  it('an active session never counts', () => {
    const s = deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: [two(1, 12, 15), two(5, 10, 13), two(9, 10, 12, { status: 'active' })] });
    expect(s.triggered).toBe(false);
  });
});

describe('the deload week', () => {
  it('halves clusters (never under one), keeps loads, lowers the activation target by 3', () => {
    const plan = (n: number, drop = false): WorkoutSet[] => [
      ...Array.from({ length: n }, (_, g) => [
        { kind: 'activation' as const, group: g + 1, weight: 15, targetReps: 12 },
        { kind: 'mini' as const, group: g + 1, weight: 15, targetReps: 4 },
      ]).flat(),
      ...(drop ? [{ kind: 'drop' as const, group: n, weight: 10 }] : []),
    ];
    const [two, one, lateral] = deloadSessionExercises([exOf('two', plan(2)), exOf('one', plan(1)), exOf('lat', plan(2, true))]);
    expect(two.sets.map((s) => `${s.kind}${s.group}`)).toEqual(['activation1', 'mini1']);
    expect(two.sets[0]).toMatchObject({ weight: 15, targetReps: 9 });
    expect(two.sets[1].targetReps).toBe(4);
    expect(one.sets.map((s) => `${s.kind}${s.group}`)).toEqual(['activation1', 'mini1']);
    // The drop rode on cluster 2, which goes.
    expect(lateral.sets.map((s) => s.kind)).toEqual(['activation', 'mini']);
  });

  it('an L/R lift is one cluster: both legs stay', () => {
    const calf = exOf('calf', [act(30, 0, 1, 'L'), mini(30, 0, 1, 'L'), act(30, 0, 2, 'R'), mini(30, 0, 2, 'R')].map((s) => ({ ...s, reps: undefined, done: false })));
    expect(deloadSessionExercises([calf])[0].sets.map((s) => s.label)).toEqual(['L', 'L', 'R', 'R']);
  });

  it('warm-ups stay; straight working sets halve too', () => {
    const sets: WorkoutSet[] = [{ kind: 'warmup' }, { kind: 'working' }, { kind: 'working' }, { kind: 'working' }, { kind: 'working' }];
    expect(deloadSessionExercises([exOf('x', sets)])[0].sets.map((s) => s.kind)).toEqual(['warmup', 'working', 'working']);
  });

  it('runs one rotation, then the program resumes; it lapses after two weeks', () => {
    const started = day(16);
    const ids = ['push', 'pull', 'leg'];
    const s = (d: number, templateId: string, deload = true): Pick<WorkoutSession, 'status' | 'deload' | 'date' | 'templateId'> =>
      ({ status: 'completed', deload, date: day(d), templateId });
    expect(deloadProgress({ startedAt: started, templateIds: ids, sessions: [], now: day(16) })).toEqual({ active: true, remaining: ids, done: [] });
    expect(deloadProgress({ startedAt: started, templateIds: ids, sessions: [s(16, 'leg'), s(17, 'pull', false)], now: day(17) }))
      .toEqual({ active: true, remaining: ['push', 'pull'], done: ['leg'] });
    expect(deloadProgress({ startedAt: started, templateIds: ids, sessions: [s(16, 'leg'), s(17, 'pull'), s(18, 'push')], now: day(18) }).active).toBe(false);
    expect(deloadProgress({ startedAt: started, templateIds: ids, sessions: [], now: new Date(started.getTime() + (DELOAD_MAX_DAYS + 1) * 86_400_000) }).active).toBe(false);
    expect(deloadProgress({ templateIds: ids, sessions: [], now: day(16) }).active).toBe(false);
  });

  it('the engine skips a deload session', () => {
    const sessions = [two(9, 10, 12, { deload: true }), two(5, 10, 13)];
    expect(engineSessions(sessions).map((x) => x.date.getDate())).toEqual([5]);
  });
});

// Review 2026-10-15 (Program v2.1).
describe('deload — review fixes', () => {
  it('an unreadable session (mixed loads) breaks the run instead of being stepped over', () => {
    const mixed = session(5, [exOf('press', [act(25, 10, 1), act(30, 9, 2)]), exOf('curl', [act(15, 13, 1), act(20, 12, 2)])]);
    const s = deloadSignal({ templates: tpl([row('press'), row('curl')]), sessions: [two(1, 12, 15), mixed, two(9, 10, 12), two(12, 10, 12)] });
    // The newest three are 12, 9, 5 — the 5th is unreadable: no trend.
    expect(s.triggered).toBe(false);
  });

  it('an L/R lift with different side loads is read one side at a time — and can trigger', () => {
    const calf = (d: number, l: number, r: number) =>
      exOf('calf', [act(30, l, 1, 'L'), mini(30, 4, 1, 'L'), act(35, r, 2, 'R'), mini(35, 4, 2, 'R')]);
    const s3 = (d: number, l: number, r: number, press: number) => session(d, [calf(d, l, r), exOf('press', [act(25, press), mini(25, 4)])]);
    const s = deloadSignal({ templates: tpl([row('calf'), row('press')]), sessions: [s3(1, 16, 15, 12), s3(5, 16, 13, 10), s3(9, 16, 12, 10)] });
    expect(s.triggered).toBe(true);
    expect(s.lifts[0]).toEqual({ exerciseId: 'calf', name: 'calf (R)', load: 35, reps: [15, 13, 12] });
  });

  it('halving pairs the i-th L with the i-th R, so L L R R keeps both legs', () => {
    const sets = [act(30, 15, 1, 'L'), act(30, 15, 2, 'L'), act(30, 15, 3, 'R'), act(30, 15, 4, 'R')];
    const [out] = deloadSessionExercises([exOf('calf', sets)]);
    expect(out.sets.map((x) => [x.group, x.label])).toEqual([[1, 'L'], [3, 'R']]);
  });

  it('an ungrouped drop set (as the editor saves it) goes with the cluster it follows', () => {
    const sets: WorkoutSet[] = [act(15, 15, 1), mini(15, 4, 1), act(15, 15, 2), mini(15, 4, 2), { kind: 'drop', weight: 10, reps: 8, done: false }];
    const [out] = deloadSessionExercises([exOf('lat', sets)]);
    expect(out.sets.map((x) => x.kind)).toEqual(['activation', 'mini']);
  });
});
