/**
 * Health Connect's period aggregation takes an INSTANT.
 *
 * `react-native-health-connect@3.5.3` builds the period request with
 * `getTimeRangeFilterLocal`, whose body is
 * `Instant.parse(startTime).atZone(zone).toLocalDateTime()` — it wants an ISO
 * instant and does the local conversion itself. We used to send a local-naive
 * string (`2025-07-30T00:00:00`), which never reaches a `LocalDateTime`: it dies
 * in `Instant.parse` with *could not be parsed at index 19*, index 19 being
 * where the missing offset should have started.
 *
 * **What that cost is why this file exists.** The rejection took `importScalars`
 * down with it, and `activeEnergy` is the LAST of `IMPORT_KINDS` — so weight,
 * sleep and water imported fine while active energy never landed once, and
 * `importHealthWorkouts`, which runs after `importScalars`, never ran at all.
 * The whole Android half of cardio import (ADR-0026) was dead behind an error
 * no screen showed. Six Sentry events (`IGNIA-MOBILE-S`) on the evening vc 44
 * reached Play production, from the first device that ever held a working
 * Health Connect grant — which is also why four binaries shipped with it.
 *
 * The dynamic `import()` of the native module cannot be exercised under jest,
 * so the filter builder is exported and pinned here — the same seam, and the
 * same reason, as `hkSampleFilter`.
 */
import { hcPeriodFilter } from '@/lib/health';

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

  it('is a between-filter, the operator the period request requires', () => {
    expect(hcPeriodFilter(30, now).operator).toBe('between');
  });
});
