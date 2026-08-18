import { describe, expect, it } from 'vitest';
import { normalizeClusterGroups, setRowLabels } from './cluster-groups';
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

describe('setRowLabels', () => {
  const label = (kinds: [SetKind, number?][]) =>
    setRowLabels(normalizeClusterGroups(kinds.map(([k, g]) => s(k, g))));

  it('numbers plain sets 1, 2, 3', () => {
    expect(label([['working'], ['working'], ['working']])).toEqual(['1', '2', '3']);
  });

  it('gives a cluster ONE number with lettered sub-sets', () => {
    expect(label([['activation'], ['mini'], ['mini']])).toEqual(['1a', '1b', '1c']);
  });

  it('continues the count past a cluster rather than restarting', () => {
    // The C1 notation could not express this: it read 1, C1, C1, C1, 2 —
    // the cluster's index, interleaved with row positions.
    expect(label([['working'], ['activation'], ['mini'], ['mini'], ['working']])).toEqual([
      '1', '2a', '2b', '2c', '3',
    ]);
  });

  it('numbers two clusters as two separate set numbers', () => {
    expect(label([['activation'], ['mini'], ['activation'], ['mini']])).toEqual([
      '1a', '1b', '2a', '2b',
    ]);
  });

  it('gives an orphan mini its own number', () => {
    expect(label([['mini'], ['working']])).toEqual(['1a', '2']);
  });

  it('counts warmup and drop sets as plain rows', () => {
    expect(label([['warmup'], ['working'], ['drop']])).toEqual(['1', '2', '3']);
  });

  it('is empty for no sets', () => {
    expect(setRowLabels([])).toEqual([]);
  });

  it('runs past z without colliding', () => {
    const long = setRowLabels(
      normalizeClusterGroups([s('activation'), ...Array.from({ length: 26 }, () => s('mini'))]),
    );
    expect(long).toHaveLength(27);
    expect(new Set(long).size).toBe(27);
    expect(long[0]).toBe('1a');
    expect(long[26]).toBe('1aa');
  });
});
