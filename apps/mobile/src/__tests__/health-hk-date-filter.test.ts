import { hkSampleFilter } from '@/lib/health';

/**
 * HealthKit reads must carry the date window in the shape the library
 * understands. `@kingstinct/react-native-healthkit` takes it as
 * `filter.date.{startDate,endDate}`; a flat `filter.{startDate,endDate}` is
 * silently ignored, and with `limit: 0` that means "every sample ever" — which
 * is how a 2017 weigh-in reached a 2026 account. `readSamples` builds its
 * filter through this helper for both the quantity path (weight, water) and
 * the category path (sleep).
 */

const DAY = 86_400_000;

it('nests the window under `date`, spanning exactly the requested days to now', () => {
  const f = hkSampleFilter(400);
  expect(Object.keys(f)).toEqual(['date']);
  const { startDate, endDate } = f.date;
  expect(Math.abs(Date.now() - endDate.getTime())).toBeLessThan(60_000);
  expect(Math.abs(endDate.getTime() - startDate.getTime() - 400 * DAY)).toBeLessThan(60_000);
});

it('is not the flat shape the library ignores', () => {
  const f = hkSampleFilter(90) as unknown as Record<string, unknown>;
  expect('startDate' in f).toBe(false);
  expect('endDate' in f).toBe(false);
});
