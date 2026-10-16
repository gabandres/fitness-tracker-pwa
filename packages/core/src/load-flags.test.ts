import { describe, expect, it } from 'vitest';
import { overdueLoads } from './load-flags';
import type { TemplateExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';

const at = new Date(2026, 9, 15, 8);
const act = (w: number, reps: number, group = 1, label?: string): WorkoutSet => ({ kind: 'activation', group, weight: w, reps, rir: 0, done: true, ...(label ? { label } : {}) });
const tpl = (rows: TemplateExercise[]): WorkoutTemplate => ({ id: 't', name: 'Pull Day', exercises: rows, createdAt: at, updatedAt: at });
const row = (id: string, name: string, load: number, over: Partial<TemplateExercise> = {}): TemplateExercise => ({ exerciseId: id, name, targetLoad: load, plannedSets: [], ...over });
const sess = (sets: Record<string, WorkoutSet[]>, d = at, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  status: 'completed', date: d, createdAt: d, updatedAt: d, exercises: Object.entries(sets).map(([id, s]) => ({ exerciseId: id, name: id, cues: [], sets: s })), ...over,
});

describe('overdue loads — past the top of the range, template load not moved', () => {
  const catalogOf = () => null;
  it('flags the v2.1 offenders and not a lift inside its range', () => {
    const flags = overdueLoads({
      templates: [tpl([
        row('inc', 'Incline DB Curl 45°', 15),
        row('rd', 'Rear delt DB flye', 15),
        row('calf', 'Single-leg DB calf raise', 25),
        row('ham', 'DB hammer curl', 20),
      ])],
      sessions: [sess({ inc: [act(15, 17)], rd: [act(15, 16)], calf: [act(25, 16, 1, 'L'), act(25, 18, 2, 'R')], ham: [act(20, 12)] })],
      catalogOf, now: at,
    });
    expect(flags.map((f) => [f.name, f.load, f.reps, f.max])).toEqual([
      ['Incline DB Curl 45°', 15, [17], 15],
      ['Rear delt DB flye', 15, [16], 15],
      ['Single-leg DB calf raise', 25, [16, 18], 15],
    ]);
  });

  it('a template load already moved is not flagged', () => {
    const flags = overdueLoads({ templates: [tpl([row('inc', 'Incline DB Curl 45°', 17.5)])], sessions: [sess({ inc: [act(15, 17)] })], catalogOf, now: at });
    expect(flags).toEqual([]);
  });

  it('a pending baseline holds the lift: flagged, with why it waits (machine row 100 × 13/13)', () => {
    const baseline = { since: '2026-10-16', reason: 'context changed: position 2026-10-14' };
    const [f] = overdueLoads({
      templates: [tpl([row('row', 'Seated Machine Row', 100, { baseline })])],
      sessions: [sess({ row: [act(100, 13, 1), act(100, 13, 2)] })], catalogOf, now: at,
    });
    expect(f).toMatchObject({ name: 'Seated Machine Row', reps: [13, 13], max: 12, held: baseline });
  });

  // Review 2026-10-15: "pending" is the engine's rule — no read on or after
  // `since` yet — not `since > today`, which flipped the row to "raise" on
  // the baseline's own date, before its first session.
  it('on the baseline date itself, before its first session, the row is still held', () => {
    const baseline = { since: '2026-10-16', reason: 'context changed: v2.1' };
    const t = tpl([row('row', 'Seated Machine Row', 100, { baseline })]);
    const before = sess({ row: [act(100, 13, 1), act(100, 13, 2)] }, new Date(2026, 9, 14));
    const [f] = overdueLoads({ templates: [t], sessions: [before], catalogOf, now: new Date(2026, 9, 16, 7) });
    expect(f.held).toEqual(baseline);
    // Its first session on/after `since` is the new context's read: past the top → raise.
    const first = sess({ row: [act(100, 14, 1), act(100, 13, 2)] }, new Date(2026, 9, 16, 9));
    const [g] = overdueLoads({ templates: [t], sessions: [before, first], catalogOf, now: new Date(2026, 9, 16, 12) });
    expect(g.held).toBeUndefined();
  });

  it('only the latest session counts, and never a deload', () => {
    const older = sess({ inc: [act(15, 17)] }, new Date(2026, 9, 8));
    const newer = sess({ inc: [act(15, 14)] }, new Date(2026, 9, 15));
    expect(overdueLoads({ templates: [tpl([row('inc', 'Incline DB Curl 45°', 15)])], sessions: [older, newer], catalogOf, now: at })).toEqual([]);
    const deload = sess({ inc: [act(15, 9)] }, new Date(2026, 9, 16), { deload: true });
    expect(overdueLoads({ templates: [tpl([row('inc', 'Incline DB Curl 45°', 15)])], sessions: [newer, older, deload].reverse().concat([sess({ inc: [act(15, 16)] }, new Date(2026, 9, 15, 9))]), catalogOf, now: at })).toHaveLength(1);
  });
});
