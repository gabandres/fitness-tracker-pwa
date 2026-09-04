/**
 * Health Connect's daily aggregation of active energy, and the two ways it
 * threw in production.
 *
 * On `react-native-health-connect@3.5.3` the PERIOD API cannot read
 * `ActiveCaloriesBurned` at all: its request builder uses the instant filter
 * helper while Health Connect's `AggregateGroupByPeriodRequest` demands a
 * `LocalDateTime` one. A local-naive string dies in `Instant.parse`
 * (`IGNIA-MOBILE-S`, "could not be parsed at index 19"); an instant gets past
 * that and dies in Health Connect ("Either use TimeRangeFilter with
 * LocalDateTime or AggregateGroupByDurationRequest", `IGNIA-MOBILE-T`). Both
 * shipped. The fix is the DURATION API, whose builder and request agree.
 *
 * **What that cost is why this file exists.** The rejection took
 * `importScalars` down with it, and `activeEnergy` is the LAST of
 * `IMPORT_KINDS` — so weight, sleep and water imported fine while active
 * energy never landed once, and `importHealthWorkouts`, which runs after
 * `importScalars`, never ran at all. The whole Android half of cardio import
 * (ADR-0026) was dead behind an error no screen showed, from the first devices
 * that ever held a working Health Connect grant.
 *
 * The dynamic `import()` of the native module cannot be exercised under jest,
 * so the filter builder and the bucket-keying rule are exported and pinned
 * here — the same seam, and the same reason, as `hkSampleFilter`.
 */
import { hcBucketDateKey, hcPeriodFilter } from '@/lib/health';

/** Anything `Instant.parse` accepts ends in `Z` or a `±HH:MM` offset. An
 *  offset-less local date-time is exactly what threw. */
const IS_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

describe('hcPeriodFilter', () => {
  const now = new Date('2026-09-03T23:33:00.000Z');

  it('emits instants Instant.parse can read, at both ends', () => {
    const f = hcPeriodFilter(400, now);
    expect(f.startTime).toMatch(IS_INSTANT);
    expect(f.endTime).toMatch(IS_INSTANT);
  });

  it('never emits the offset-less shape that threw', () => {
    // The literal regression. `2025-07-30T00:00:00` is the exact string in the
    // Sentry title, and its defining property is that it ends at the seconds.
    const f = hcPeriodFilter(400, now);
    expect(f.startTime).not.toMatch(/T\d{2}:\d{2}:\d{2}$/);
    expect(f.endTime).not.toMatch(/T\d{2}:\d{2}:\d{2}$/);
  });

  it('anchors the start on LOCAL midnight, so a bucket equals one of our days', () => {
    // The half the old comment was right about, kept: Health Connect anchors
    // buckets on the start of the requested range, not on the calendar, so
    // asking at 23:33 without this would give 23:33→23:33 "days". The library
    // converts the instant back with the device zone, so local midnight in,
    // local midnight out.
    const start = new Date(hcPeriodFilter(400, now).startTime);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('spans the requested window and ends now', () => {
    const f = hcPeriodFilter(400, now);
    expect(new Date(f.endTime).getTime()).toBe(now.getTime());
    // 400 days back, then floored to local midnight — so at least 400 days and
    // less than 401.
    const days = (now.getTime() - new Date(f.startTime).getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(400);
    expect(days).toBeLessThan(401);
  });

  it('is a between-filter, the operator the duration request requires', () => {
    expect(hcPeriodFilter(30, now).operator).toBe('between');
  });
});

/**
 * The bucket-keying rule, which is the half that carries the DST risk.
 *
 * Switching from `aggregateGroupByPeriod` to `aggregateGroupByDuration` traded
 * a calendar-aware slicer for a fixed 24 h one. That is the only way to read
 * active energy at all on `react-native-health-connect@3.5.3` (see
 * `hcPeriodFilter`), and the price is that bucket boundaries drift by an hour
 * across a DST transition. Keying by the MIDPOINT is what absorbs the drift;
 * these cases exist so nobody "simplifies" it back to the start.
 */
describe('hcBucketDateKey', () => {
  /** Local midnight on the given local date, as the instant the OS returns. */
  const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

  it('keys an exactly-aligned bucket to its own day', () => {
    expect(hcBucketDateKey(localMidnight(2026, 9, 3))).toBe('2026-09-03');
  });

  it('keys a bucket that starts an hour EARLY to the intended day', () => {
    // Clocks went back: the fixed 24h boundary now lands at 23:00 the night
    // before. Keying off the start would file this day's burn under yesterday
    // — and would keep doing it for every remaining day of the import.
    const anHourEarly = new Date(new Date(2026, 8, 3).getTime() - 60 * 60 * 1000);
    expect(hcBucketDateKey(anHourEarly.toISOString())).toBe('2026-09-03');
  });

  it('keys a bucket that starts an hour LATE to the intended day', () => {
    const anHourLate = new Date(new Date(2026, 8, 3).getTime() + 60 * 60 * 1000);
    expect(hcBucketDateKey(anHourLate.toISOString())).toBe('2026-09-03');
  });

  it('reads the instant form the duration API returns, not a local-naive one', () => {
    // Duration slicing hands back `Instant.toString()`, so the value always
    // carries a `Z`. This pins that we parse it as a moment.
    const key = hcBucketDateKey(new Date(2026, 0, 15, 0, 0, 0).toISOString());
    expect(key).toBe('2026-01-15');
  });

  it('does not throw on a missing startTime', () => {
    // The field is optional on the wire; a bad bucket must not take the whole
    // import down, which is the failure class this whole file exists for.
    expect(() => hcBucketDateKey(undefined)).not.toThrow();
  });
});
