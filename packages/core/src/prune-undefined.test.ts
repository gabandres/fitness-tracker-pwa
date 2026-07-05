import { describe, expect, it } from 'vitest';
import { pruneUndefined } from './prune-undefined';

describe('pruneUndefined', () => {
  it('drops undefined-valued keys at the top level', () => {
    expect(pruneUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('recurses into nested objects and arrays', () => {
    const input = {
      keep: 1,
      drop: undefined,
      nested: { a: undefined, b: 2 },
      list: [{ x: undefined, y: 3 }, 'raw'],
    };
    expect(pruneUndefined(input)).toEqual({
      keep: 1,
      nested: { b: 2 },
      list: [{ y: 3 }, 'raw'],
    });
  });

  it('preserves null (only undefined is pruned)', () => {
    expect(pruneUndefined({ a: null, b: undefined })).toEqual({ a: null });
  });

  it('treats Date as an opaque leaf (never flattened to {})', () => {
    const d = new Date('2026-07-05T00:00:00Z');
    const out = pruneUndefined({ when: d, gone: undefined });
    expect(out.when).toBe(d);
    expect(out).toEqual({ when: d });
  });

  it('keeps Dates inside arrays intact', () => {
    const d = new Date(0);
    expect(pruneUndefined({ list: [d] }).list[0]).toBe(d);
  });

  it('treats a value flagged by isOpaque (e.g. an SDK Timestamp) as a leaf', () => {
    // Stand-in for firebase Timestamp — a class core must not import.
    class FakeTimestamp {
      constructor(public seconds: number) {}
    }
    const ts = new FakeTimestamp(123);
    const out = pruneUndefined(
      { at: ts, gone: undefined },
      (v) => v instanceof FakeTimestamp,
    );
    expect(out.at).toBe(ts);
    expect(out).toEqual({ at: ts });
  });

  it('still descends into plain objects when isOpaque returns false', () => {
    const out = pruneUndefined({ nested: { a: undefined, b: 2 } }, () => false);
    expect(out).toEqual({ nested: { b: 2 } });
  });

  it('returns primitives unchanged', () => {
    expect(pruneUndefined(5)).toBe(5);
    expect(pruneUndefined('s')).toBe('s');
    expect(pruneUndefined(undefined)).toBe(undefined);
    expect(pruneUndefined(null)).toBe(null);
  });
});
