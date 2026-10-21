/**
 * iOS workout heart rate (2026-10-20): one statistics query per workout, so it
 * is read only inside a window — the last week, or the whole import window on
 * the one-time backfill (`importHealthWorkouts`).
 */
jest.unmock('@/lib/health');
import { HR_READ_WINDOW_MS, hkIndoor, hkWorkoutHr } from '@/lib/health';

const NOW = Date.UTC(2026, 9, 20, 22);
const row = (daysAgo: number) => ({
  startDate: new Date(NOW - daysAgo * 86_400_000 - 1_800_000),
  endDate: new Date(NOW - daysAgo * 86_400_000),
  getStatistic: jest.fn(async () => ({ averageQuantity: { quantity: 112.4 }, maximumQuantity: { quantity: 131 } })),
});

describe('hkWorkoutHr', () => {
  it('reads avg / peak bpm for a recent workout', async () => {
    expect(await hkWorkoutHr(row(2), NOW)).toEqual({ avgHr: 112, maxHr: 131 });
  });
  it('skips an older one by default, and reads it with the backfill window', async () => {
    const old = row(30);
    expect(await hkWorkoutHr(old, NOW)).toEqual({});
    expect(old.getStatistic).not.toHaveBeenCalled();
    expect(await hkWorkoutHr(old, NOW, 90 * 86_400_000)).toEqual({ avgHr: 112, maxHr: 131 });
    expect(HR_READ_WINDOW_MS).toBe(7 * 86_400_000);
  });
  it('an unreadable statistic (not granted, no samples) is no HR, not a failure', async () => {
    const r = { ...row(1), getStatistic: jest.fn(async () => { throw new Error('denied'); }) };
    expect(await hkWorkoutHr(r, NOW)).toEqual({});
  });
});

describe('hkIndoor', () => {
  it('reads HKIndoorWorkout as true / false, else unknown', () => {
    expect(hkIndoor({ HKIndoorWorkout: false })).toBe(false);
    expect(hkIndoor({ HKIndoorWorkout: 1 })).toBe(true);
    expect(hkIndoor({})).toBeUndefined();
    expect(hkIndoor(undefined)).toBeUndefined();
  });
});
