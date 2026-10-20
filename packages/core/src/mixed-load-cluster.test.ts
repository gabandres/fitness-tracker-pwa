/**
 * A load that moved inside a lift (owner, 2026-10-20). The engine used to call
 * the whole lift `load-changed` and skip it; it now reads the activation
 * set(s) at the load of the last performed cluster, flags the call, and every
 * set still counts as volume. Shapes are the owner's logged sessions.
 */
import { describe, expect, it } from 'vitest';
import { epleyE1rm, readExercise, recommend, resolveEngineConfig } from './progression-engine';
import { clusterCount, volumeBetween } from './volume-credits';
import { sessionVolume } from './train-view';
import type { SessionExercise, WorkoutSet } from './workout';

type Row = [group: number, kind: 'activation' | 'mini', weight: number, reps: number, rir?: number];
const ex = (name: string, rows: Row[]): SessionExercise => ({
  exerciseId: name, name, cues: [], logStyle: 'weight-reps',
  sets: rows.map(([group, kind, weight, reps, rir]): WorkoutSet => ({ kind, group, weight, reps, done: true, ...(rir != null ? { rir } : {}) })),
});
const lift = (name: string) => ({
  expectsCluster: true, structure: 'myoreps' as const,
  config: resolveEngineConfig({ name }, null),
});

// 2026-10-20 Pull Day — Wide-grip lat pulldown: activation 90 × 8, minis at 80.
const PULLDOWN = ex('Wide-grip lat pulldown', [[1, 'activation', 90, 8, 0], [1, 'mini', 80, 4, 0], [1, 'mini', 80, 3, 0]]);
// 2026-10-15 Push Day — Weighted Floor Crunch: cluster 1 all at 25, cluster 2
// all at 30. Each cluster is uniform; the load moved BETWEEN them.
const CRUNCH = ex('Weighted Floor Crunch', [
  [1, 'activation', 25, 20, 0], [1, 'mini', 25, 7, 0], [1, 'mini', 25, 6, 0],
  [2, 'activation', 30, 13, 0], [2, 'mini', 30, 4, 0], [2, 'mini', 30, 4, 0],
]);

describe('a load change inside a cluster (10/20 Lat Pulldown)', () => {
  it('is read from the activation: load 90, 8 reps, valid, flagged', () => {
    const r = readExercise(PULLDOWN, { expectsCluster: true });
    expect(r).toMatchObject({ valid: true, load: 90, mixedLoad: true, issue: null });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]).toMatchObject({ load: 90, reps: 8, loadChanged: true, minis: [4, 3] });
  });

  it('produces a call (not a skip) at the activation load, with the note', () => {
    const rec = recommend([PULLDOWN], lift('Wide-grip lat pulldown'));
    expect(rec.action).not.toBe('repeat-invalid');
    expect(rec.reason.kind).not.toBe('invalid');
    expect(rec).toMatchObject({ currentLoad: 90, targetReps: 9 });
    expect(rec.warnings).toContain('load-changed-mid-cluster');
  });

  it('e1RM comes from the activation set only (the lighter minis never enter it)', () => {
    // Past the top of 6-12 at 100, minis at 90: an increase candidate whose
    // e1RM is Epley on the ACTIVATION — 100 × (1 + 13/30).
    const top = ex('Seated Machine Row', [[1, 'activation', 100, 13, 0], [1, 'mini', 90, 4, 0], [1, 'mini', 90, 3, 0]]);
    const rec = recommend([top], lift('Seated Machine Row'));
    expect(rec.warnings).toContain('load-changed-mid-cluster');
    expect(rec.currentLoad).toBe(100);
    expect(rec).toMatchObject({ action: 'add-load', reason: { kind: 'increase', reps: 13 } });
    expect((rec.reason as { e1rm: number }).e1rm).toBeCloseTo(epleyE1rm(100, 13), 6);
  });

  it('the minis still count toward volume: the cluster, and their tonnage at 80', () => {
    expect(clusterCount(PULLDOWN.sets)).toBe(1);
    expect(sessionVolume({ exercises: [PULLDOWN] })).toBe(90 * 8 + 80 * 4 + 80 * 3);
    const at = Date.parse('2026-10-20T12:30:00Z');
    const v = volumeBetween([{ date: new Date(at), status: 'completed', exercises: [PULLDOWN] } as never], [], at - 1000, at + 1000);
    expect(v.total).toBe(1);
  });
});

describe('a load change between clusters (10/15 Floor Crunch, 25 then 30)', () => {
  it('is read at the last cluster\'s load: cluster 2 at 30, 13 reps', () => {
    const r = readExercise(CRUNCH, { expectsCluster: true });
    expect(r).toMatchObject({ valid: true, load: 30, mixedLoad: true });
    expect(r.clusters.map((c) => [c.group, c.load, c.reps])).toEqual([[2, 30, 13]]);
  });

  it('holds at 30 and builds reps — a call, flagged; both clusters stay in volume', () => {
    const rec = recommend([CRUNCH], lift('Weighted Floor Crunch'));
    expect(rec).toMatchObject({ currentLoad: 30, load: 30, targetReps: 14 });
    expect(rec.warnings).toContain('load-changed-mid-cluster');
    expect(clusterCount(CRUNCH.sets)).toBe(2);
  });
});

describe('a uniform lift is unchanged', () => {
  it('no flag, the same read and the same call', () => {
    const same = ex('Wide-grip lat pulldown', [[1, 'activation', 90, 12, 0], [1, 'mini', 90, 4, 0], [1, 'mini', 90, 3, 0]]);
    const r = readExercise(same, { expectsCluster: true });
    expect(r).toMatchObject({ valid: true, load: 90 });
    expect(r.mixedLoad).toBeUndefined();
    expect(r.clusters[0].loadChanged).toBe(false);
    const rec = recommend([same], lift('Wide-grip lat pulldown'));
    expect(rec.warnings).not.toContain('load-changed-mid-cluster');
  });
});
