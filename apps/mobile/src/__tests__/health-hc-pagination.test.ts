import { hcReadAllRecords } from '@/lib/health';

/**
 * `readRecords` answers ONE page (`pageSize` defaults to 1000, oldest first)
 * and hands back a `pageToken` for the rest. Read once, the 400-day import saw
 * only the OLDEST thousand records of the window — so a water app writing a
 * handful a day pushed every recent day out of the import after ~125 days,
 * and the days a user was actually waiting on never arrived.
 */

const filter = { operator: 'between' as const, startTime: '2025-01-01T00:00:00Z', endTime: '2026-01-01T00:00:00Z' };

function fakeHC(pages: { records: { id: number }[]; pageToken?: string }[]) {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    HC: {
      readRecords: async (_type: never, opts: never) => {
        calls.push(opts);
        return pages[Math.min(i++, pages.length - 1)];
      },
    },
  };
}

it('follows pageToken until the store says there is no more', async () => {
  const { HC, calls } = fakeHC([
    { records: [{ id: 1 }, { id: 2 }], pageToken: 'p2' },
    { records: [{ id: 3 }], pageToken: 'p3' },
    { records: [{ id: 4 }] },
  ]);
  const rows = await hcReadAllRecords<{ id: number }>(HC, 'Weight', filter);
  expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  expect(calls).toHaveLength(3);
  // The first call carries no token; each later one carries the previous answer's.
  expect((calls[0] as { pageToken?: string }).pageToken).toBeUndefined();
  expect((calls[1] as { pageToken?: string }).pageToken).toBe('p2');
  expect((calls[2] as { pageToken?: string }).pageToken).toBe('p3');
  // The range filter rides on every page.
  for (const c of calls) expect((c as { timeRangeFilter: unknown }).timeRangeFilter).toEqual(filter);
});

it('is one call when the first page is the whole answer', async () => {
  const { HC, calls } = fakeHC([{ records: [{ id: 1 }] }]);
  expect(await hcReadAllRecords(HC, 'Weight', filter)).toEqual([{ id: 1 }]);
  expect(calls).toHaveLength(1);
});

it('stops on a token that never clears rather than looping forever', async () => {
  const { HC, calls } = fakeHC([{ records: [{ id: 1 }], pageToken: 'stuck' }]);
  const rows = await hcReadAllRecords(HC, 'Weight', filter, 5);
  expect(calls).toHaveLength(5);
  expect(rows).toHaveLength(5);
});

it('treats an empty or absent result as no records', async () => {
  const HC = { readRecords: async () => null };
  expect(await hcReadAllRecords(HC as never, 'Weight', filter)).toEqual([]);
});
