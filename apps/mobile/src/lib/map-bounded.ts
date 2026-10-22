/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight, results in
 * the items' order. A rejection rejects the whole map, as `Promise.all` would
 * (calls already in flight still run to completion; none new start).
 *
 * Dependency-free on purpose: both the native health adapter (`health.ts`, for
 * Health Connect's per-session aggregates) and the import (`health-sync.ts`,
 * for the guarded per-night sleep writes) use it, and the tests that mock one
 * of those modules wholesale must still get the real helper.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, lane));
  return out;
}
