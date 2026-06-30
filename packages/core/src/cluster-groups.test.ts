import { describe, expect, it } from 'vitest';
import { normalizeClusterGroups } from './cluster-groups';
import type { SetKind } from './workout';

const s = (kind: SetKind, group?: number) => ({ kind, group });

describe('normalizeClusterGroups', () => {
  it('numbers clusters sequentially from the activation/mini sequence', () => {
    const out = normalizeClusterGroups([
      s('activation'),
      s('mini'),
      s('mini'),
      s('activation'),
      s('mini'),
      s('mini'),
    ]);
    expect(out.map((x) => x.group)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('heals corrupted group numbers (append-typed) without losing structure', () => {
    const out = normalizeClusterGroups([
      s('activation', 12),
      s('mini', 2),
      s('mini', 2),
      s('activation', 10),
      s('mini', 2),
      s('mini', 3),
    ]);
    expect(out.map((x) => x.group)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('leaves working / warmup / drop sets ungrouped', () => {
    const out = normalizeClusterGroups([s('warmup', 5), s('working', 9), s('drop', 1)]);
    expect(out.map((x) => x.group)).toEqual([undefined, undefined, undefined]);
  });

  it('does not extend a cluster across a plain working set', () => {
    const out = normalizeClusterGroups([
      s('activation'),
      s('mini'),
      s('working'),
      s('activation'),
      s('mini'),
    ]);
    expect(out.map((x) => x.group)).toEqual([1, 1, undefined, 2, 2]);
  });

  it('opens a cluster for an orphan mini with no preceding activation', () => {
    const out = normalizeClusterGroups([s('mini'), s('mini')]);
    expect(out.map((x) => x.group)).toEqual([1, 1]);
  });

  it('preserves other set fields and reuses already-correct entries', () => {
    const correct = { kind: 'activation' as SetKind, group: 1, weight: 50, reps: 8, done: true };
    const out = normalizeClusterGroups([correct, { kind: 'mini', group: 1, reps: 4 }]);
    expect(out[0]).toBe(correct); // unchanged → same reference
    expect(out[1]).toEqual({ kind: 'mini', group: 1, reps: 4 });
  });
});
