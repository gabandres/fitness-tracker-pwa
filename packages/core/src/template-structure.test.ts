import { describe, expect, it } from 'vitest';
import {
  applyStructureChanges,
  proposeStructureChanges,
  rowFromPerformed,
  type TemplateStructureChange,
} from './template-structure';
import type { SessionExercise, TemplateExercise, WorkoutSet } from './workout';

/**
 * S23-10 (owner, 2026-10-12): a session started from a template whose lifts
 * were ADDED or REMOVED mid-session offers, at Finish, to make the template
 * match. These pin what "added" and "removed" mean and what an update writes.
 */
const AT = new Date('2026-10-12T15:00:00Z');
const STARTED = new Date('2026-10-12T14:00:00Z');

const row = (id: string, extra: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId: id,
  name: id.toUpperCase(),
  targetLoad: 100,
  plannedSets: [{ kind: 'working', reps: 8 }, { kind: 'working', reps: 8 }],
  ...extra,
});
const done = (weight: number | undefined, reps: number, extra: Partial<WorkoutSet> = {}): WorkoutSet =>
  ({ kind: 'working', weight, reps, done: true, ...extra });
const ex = (id: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: id, name: id.toUpperCase(), cues: [], sets, ...extra,
});
/** A template lift as the session snapshotted it, not yet started. */
const unstarted = (id: string): SessionExercise => ex(id, [{ kind: 'working', weight: 100, targetReps: 8, done: false }]);

describe('proposeStructureChanges — what counts as added and removed', () => {
  it('nothing changed → nothing to ask', () => {
    const rows = [row('a'), row('b')];
    expect(proposeStructureChanges(rows, { exercises: [ex('a', [done(100, 8)]), ex('b', [done(100, 8)])], date: STARTED })).toEqual([]);
  });

  it('a lift added mid-session and logged is an ADD, anchored after the lift before it in the session', () => {
    const rows = [row('a'), row('b')];
    const changes = proposeStructureChanges(rows, {
      exercises: [ex('a', [done(100, 8)]), ex('fly', [done(30, 12), done(30, 11)]), ex('b', [done(100, 8)])],
      date: STARTED,
    });
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'add', exerciseId: 'fly', name: 'FLY', after: 'a' }),
    ]);
  });

  it('an added lift first in the session anchors to the top (after: null)', () => {
    const changes = proposeStructureChanges([row('a')], {
      exercises: [ex('fly', [done(30, 12)]), ex('a', [done(100, 8)])], date: STARTED,
    });
    expect(changes).toEqual([expect.objectContaining({ kind: 'add', exerciseId: 'fly', after: null })]);
  });

  it('two added lifts in a row: the second anchors to the first', () => {
    const changes = proposeStructureChanges([row('a'), row('b')], {
      exercises: [ex('a', [done(100, 8)]), ex('x', [done(20, 10)]), ex('y', [done(20, 10)]), ex('b', [done(100, 8)])],
      date: STARTED,
    });
    expect(changes.map((c) => [c.kind, c.exerciseId, c.kind === 'add' ? c.after : undefined])).toEqual([
      ['add', 'x', 'a'],
      ['add', 'y', 'x'],
    ]);
  });

  it('an added lift with NOTHING logged is not proposed (there is nothing to prescribe, and the save drops it)', () => {
    const changes = proposeStructureChanges([row('a')], {
      exercises: [ex('a', [done(100, 8)]), ex('fly', [{ kind: 'working', weight: 30, done: false }])],
      date: STARTED,
    });
    expect(changes).toEqual([]);
  });

  it('a template lift deleted from the session is a REMOVE', () => {
    const changes = proposeStructureChanges([row('a'), row('b'), row('c')], {
      exercises: [ex('a', [done(100, 8)]), ex('c', [done(100, 8)])], date: STARTED,
    });
    expect(changes).toEqual([{ kind: 'remove', exerciseId: 'b', name: 'B' }]);
  });

  it('unstarted ≠ removed: a template lift still in the session with zero logged sets is NOT a remove', () => {
    const changes = proposeStructureChanges([row('a'), row('b')], {
      exercises: [ex('a', [done(100, 8)]), unstarted('b')], date: STARTED,
    });
    expect(changes).toEqual([]);
  });

  it('a row added to the template AFTER the session started is not "removed" from it', () => {
    const changes = proposeStructureChanges(
      [row('a'), row('late', { lastModifiedAt: '2026-10-12T14:30:00.000Z' })],
      { exercises: [ex('a', [done(100, 8)])], date: STARTED },
    );
    expect(changes).toEqual([]);
  });

  it('a row last changed BEFORE the start and missing from the session is still a remove', () => {
    const changes = proposeStructureChanges(
      [row('a'), row('old', { lastModifiedAt: '2026-10-01T10:00:00.000Z' })],
      { exercises: [ex('a', [done(100, 8)])], date: STARTED },
    );
    expect(changes).toEqual([{ kind: 'remove', exerciseId: 'old', name: 'OLD' }]);
  });

  it('a swap (lift replaced mid-session) is a remove plus an add in its place', () => {
    const changes = proposeStructureChanges([row('a'), row('b'), row('c')], {
      exercises: [ex('a', [done(100, 8)]), ex('b2', [done(90, 8)]), ex('c', [done(100, 8)])], date: STARTED,
    });
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'add', exerciseId: 'b2', after: 'a' }),
      { kind: 'remove', exerciseId: 'b', name: 'B' },
    ]);
  });
});

describe('rowFromPerformed — an added lift\'s targets come from what was performed', () => {
  it('straight sets: one planned set per logged set with its reps; the load goes to targetLoad, never per set', () => {
    const r = rowFromPerformed(ex('fly', [done(30, 12), done(30, 11), done(30, 10)], { logStyle: 'weight-reps' }))!;
    expect(r.exerciseId).toBe('fly');
    expect(r.name).toBe('FLY');
    expect(r.targetLoad).toBe(30);
    expect(r.logStyle).toBe('weight-reps');
    expect(r.plannedSets).toEqual([
      { kind: 'working', reps: 12 },
      { kind: 'working', reps: 11 },
      { kind: 'working', reps: 10 },
    ]);
    // A per-set weight would freeze progression (FIX-R, S23-11).
    expect(r.plannedSets.some((p) => 'weight' in p)).toBe(false);
    expect(r.supersetGroup).toBeUndefined();
  });

  it('skips sets that were never logged', () => {
    const r = rowFromPerformed(ex('fly', [done(30, 12), { kind: 'working', weight: 30, done: false }]))!;
    expect(r.plannedSets).toEqual([{ kind: 'working', reps: 12 }]);
  });

  it('nothing logged → no row', () => {
    expect(rowFromPerformed(ex('fly', [{ kind: 'working', weight: 30 }]))).toBeNull();
  });

  it('a cluster keeps its kinds and groups; minis carry no weight of their own', () => {
    const r = rowFromPerformed(ex('curl', [
      { kind: 'activation', group: 1, weight: 25, reps: 12, rir: 0, done: true },
      { kind: 'mini', group: 1, weight: 25, reps: 4, done: true },
      { kind: 'mini', group: 1, weight: 25, reps: 3, done: true },
    ]))!;
    expect(r.targetLoad).toBe(25);
    expect(r.plannedSets).toEqual([
      { kind: 'activation', group: 1, reps: 12 },
      { kind: 'mini', group: 1, reps: 4 },
      { kind: 'mini', group: 1, reps: 3 },
    ]);
  });

  it('the load is the first working set\'s, not a warm-up\'s; warm-ups and drops keep their own lighter weight', () => {
    const r = rowFromPerformed(ex('press', [
      { kind: 'warmup', weight: 45, reps: 10, done: true },
      done(135, 8),
      done(135, 7),
      { kind: 'drop', weight: 95, reps: 10, done: true },
    ]))!;
    expect(r.targetLoad).toBe(135);
    expect(r.plannedSets).toEqual([
      { kind: 'warmup', reps: 10, weight: 45 },
      { kind: 'working', reps: 8 },
      { kind: 'working', reps: 7 },
      { kind: 'drop', reps: 10, weight: 95 },
    ]);
  });

  it('a bodyweight lift logged with 0 keeps targetLoad 0 (no added load), not "unknown"', () => {
    const r = rowFromPerformed(ex('pullup', [done(0, 8), done(0, 7)]))!;
    expect(r.targetLoad).toBe(0);
  });

  it('a time lift prescribes durations and no load', () => {
    const r = rowFromPerformed(ex('plank', [
      { kind: 'working', durationSec: 60, done: true },
      { kind: 'working', durationSec: 45, done: true },
    ], { logStyle: 'time' }))!;
    expect(r.targetLoad).toBeUndefined();
    expect(r.plannedSets).toEqual([
      { kind: 'working', durationSec: 60 },
      { kind: 'working', durationSec: 45 },
    ]);
  });

  it('an L/R label survives', () => {
    const r = rowFromPerformed(ex('split', [
      { kind: 'activation', group: 1, label: 'L', weight: 20, reps: 10, done: true },
      { kind: 'activation', group: 2, label: 'R', weight: 20, reps: 10, done: true },
    ]))!;
    expect(r.plannedSets.map((p) => p.label)).toEqual(['L', 'R']);
  });
});

describe('applyStructureChanges', () => {
  const by = { at: AT, by: 'user' as const };
  const add = (id: string, after: string | null): TemplateStructureChange => ({
    kind: 'add', exerciseId: id, name: id.toUpperCase(), after,
    row: { exerciseId: id, name: id.toUpperCase(), targetLoad: 30, plannedSets: [{ kind: 'working', reps: 12 }] },
  });
  const ids = (rows: readonly TemplateExercise[]) => rows.map((r) => r.exerciseId);

  it('no changes → the rows as they were', () => {
    const rows = [row('a'), row('b')];
    expect(applyStructureChanges(rows, [], by)).toEqual(rows);
  });

  it('adds follow the SESSION order: after their anchor; null anchor = top; a missing anchor = the end', () => {
    const rows = [row('a'), row('b')];
    expect(ids(applyStructureChanges(rows, [add('x', 'a')], by))).toEqual(['a', 'x', 'b']);
    expect(ids(applyStructureChanges(rows, [add('x', null)], by))).toEqual(['x', 'a', 'b']);
    expect(ids(applyStructureChanges(rows, [add('x', 'gone')], by))).toEqual(['a', 'b', 'x']);
    expect(ids(applyStructureChanges(rows, [add('x', 'a'), add('y', 'x')], by))).toEqual(['a', 'x', 'y', 'b']);
  });

  it('an added row is stamped as the lifter\'s change; untouched rows keep their stamp', () => {
    const rows = [row('a', { lastModifiedAt: '2026-10-01T00:00:00.000Z', lastModifiedBy: 'engine' }), row('b')];
    const out = applyStructureChanges(rows, [add('x', 'b')], by);
    expect(out[2]).toMatchObject({ exerciseId: 'x', lastModifiedAt: AT.toISOString(), lastModifiedBy: 'user' });
    expect(out[0]).toBe(rows[0]);
    expect(out[2].loadLog).toBeUndefined();
  });

  it('a removed row is gone; the rest keep their loads and load logs', () => {
    const log = [{ at: '2026-10-01T00:00:00.000Z', from: 95, to: 100, by: 'engine' as const, reason: 'r' }];
    const rows = [row('a', { loadLog: log }), row('b'), row('c')];
    const out = applyStructureChanges(rows, [{ kind: 'remove', exerciseId: 'b', name: 'B' }], by);
    expect(ids(out)).toEqual(['a', 'c']);
    expect(out[0].loadLog).toEqual(log);
    expect(out[1].targetLoad).toBe(100);
  });

  it('an add is idempotent: a lift already in the template is not added twice', () => {
    const rows = [row('a'), row('x')];
    expect(ids(applyStructureChanges(rows, [add('x', 'a')], by))).toEqual(['a', 'x']);
  });

  describe('supersets are never broken', () => {
    const pair = () => [
      row('a1', { supersetGroup: 'A', pairPosition: 1, transitionRestSec: 30, roundRestSec: 45 }),
      row('a2', { supersetGroup: 'A', pairPosition: 2 }),
      row('c'),
    ];

    it('an add anchored on a superset member goes AFTER the whole block, never between partners', () => {
      const out = applyStructureChanges(pair(), [add('x', 'a1')], by);
      expect(ids(out)).toEqual(['a1', 'a2', 'x', 'c']);
      expect(out[0]).toMatchObject({ supersetGroup: 'A', pairPosition: 1 });
      expect(out[1]).toMatchObject({ supersetGroup: 'A', pairPosition: 2 });
      expect(out[2].supersetGroup).toBeUndefined();
    });

    it('removing one lift of a PAIR leaves its partner as a straight lift (a group of one is not a superset)', () => {
      const out = applyStructureChanges(pair(), [{ kind: 'remove', exerciseId: 'a2', name: 'A2' }], by);
      expect(ids(out)).toEqual(['a1', 'c']);
      expect(out[0].supersetGroup).toBeUndefined();
      expect(out[0].pairPosition).toBeUndefined();
      expect(out[0].transitionRestSec).toBeUndefined();
      expect(out[0].roundRestSec).toBeUndefined();
    });

    it('removing the LEADER of a tri-set keeps the other two paired, with the group\'s rests on the new leader', () => {
      const rows = [
        row('a1', { supersetGroup: 'A', pairPosition: 1, transitionRestSec: 30, roundRestSec: 45 }),
        row('a2', { supersetGroup: 'A', pairPosition: 2 }),
        row('a3', { supersetGroup: 'A', pairPosition: 3 }),
      ];
      const out = applyStructureChanges(rows, [{ kind: 'remove', exerciseId: 'a1', name: 'A1' }], by);
      expect(ids(out)).toEqual(['a2', 'a3']);
      expect(out[0]).toMatchObject({ supersetGroup: 'A', pairPosition: 1, transitionRestSec: 30, roundRestSec: 45 });
      expect(out[1]).toMatchObject({ supersetGroup: 'A', pairPosition: 2 });
    });

    it('an added lift never joins a group, even one the session paired it into', () => {
      const change = add('x', 'c');
      if (change.kind === 'add') change.row = { ...change.row, supersetGroup: 'B', pairPosition: 2 } as TemplateExercise;
      const out = applyStructureChanges(pair(), [change], by);
      expect(out.find((r) => r.exerciseId === 'x')?.supersetGroup).toBeUndefined();
      expect(out[0].supersetGroup).toBe('A');
    });
  });
});
