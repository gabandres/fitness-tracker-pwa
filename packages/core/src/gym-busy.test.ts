import { describe, expect, it } from 'vitest';
import { GYM_BUSY_MUSCLE_REST_SEC, gymBusyRows } from './gym-busy';
import type { MuscleGroup, SessionExercise, WorkoutSet } from './workout';

const T0 = new Date('2026-11-10T11:00:00Z');
const sec = (s: number) => new Date(T0.getTime() + s * 1000);
const logged = (s: number): WorkoutSet => ({ kind: 'activation', group: 1, weight: 40, reps: 12, done: true, loggedAt: sec(s).toISOString() });
const open: WorkoutSet = { kind: 'activation', group: 2, done: false };
const ex = (exerciseId: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise =>
  ({ exerciseId, name: exerciseId, cues: [], sets, ...extra });
const muscles: Record<string, MuscleGroup[]> = { flat: ['chest', 'triceps'], pec: ['chest'], curl: ['hamstrings'], row: ['back'] };

describe('gymBusyRows', () => {
  const session = [
    ex('flat', [logged(0), open], { supersetGroup: 'B', pairPosition: 1 }),
    ex('row', [logged(30), logged(60)]),
    ex('pec', [open, open]),
    ex('curl', [open]),
  ];
  it('lists only lifts with sets left, with done/total and the superset tag', () => {
    const rows = gymBusyRows(session, (id) => muscles[id], sec(40));
    expect(rows.map((r) => r.name)).toEqual(['flat', 'pec', 'curl']);
    expect(rows[0]).toMatchObject({ tag: 'B1', done: 1, total: 2 });
  });
  it('waits on the same PRIMARY muscle only, until 90 s', () => {
    const rows = gymBusyRows(session, (id) => muscles[id], sec(40));
    expect(rows.find((r) => r.name === 'pec')).toMatchObject({ muscle: 'chest', restedSec: 40, waitSec: GYM_BUSY_MUSCLE_REST_SEC - 40 });
    expect(rows.find((r) => r.name === 'curl')).toMatchObject({ waitSec: 0 });
    expect(rows.find((r) => r.name === 'curl')?.restedSec).toBeUndefined();
    expect(gymBusyRows(session, (id) => muscles[id], sec(95)).find((r) => r.name === 'pec')?.waitSec).toBe(0);
  });
  it('sets without times give no hint, never a wait', () => {
    const untimed = [ex('flat', [{ ...logged(0), loggedAt: undefined }, open]), ex('pec', [open])];
    expect(gymBusyRows(untimed, (id) => muscles[id], sec(10))[1]).toMatchObject({ waitSec: 0 });
  });
});
