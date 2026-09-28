import { hkSampleFilter, hkWorkoutQueryOptions, hkWorkoutTypeName } from '@/lib/health';

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

describe('the workout query', () => {
  it('nests its window under `date` too — FilterForWorkouts extends the samples filter', () => {
    const q = hkWorkoutQueryOptions(90) as unknown as { filter: Record<string, unknown> };
    expect(Object.keys(q.filter)).toEqual(['date']);
    expect('startDate' in q.filter).toBe(false);
    const { startDate, endDate } = q.filter.date as { startDate: Date; endDate: Date };
    expect(Math.abs(endDate.getTime() - startDate.getTime() - 90 * DAY)).toBeLessThan(60_000);
  });
});

describe('the workout activity type', () => {
  // The shape of a TS numeric enum at runtime: forward AND reverse mapping.
  const names = { running: 37, 37: 'running', walking: 52, 52: 'walking', cycling: 13, 13: 'cycling' };

  it('maps the numeric enum HealthKit hands over back to its name', () => {
    expect(hkWorkoutTypeName(names, 37)).toBe('running');
    expect(hkWorkoutTypeName(names, 52)).toBe('walking');
    expect(hkWorkoutTypeName(names, '13')).toBe('cycling');
  });

  it('never yields the bare digits that classify every workout as `other`', () => {
    // `String(37)` was the shipped mapping: it matches no modality pattern, so
    // an Apple Watch run was declined as "not cardio".
    expect(hkWorkoutTypeName(names, 37)).not.toBe('37');
  });

  it('falls back to the raw value when the table is missing or has no entry', () => {
    expect(hkWorkoutTypeName(undefined, 37)).toBe('37');
    expect(hkWorkoutTypeName(names, 999)).toBe('999');
    expect(hkWorkoutTypeName(names, 'HKWorkoutActivityTypeRunning')).toBe('HKWorkoutActivityTypeRunning');
    expect(hkWorkoutTypeName(names, undefined)).toBe('');
  });
});
