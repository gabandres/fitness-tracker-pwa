jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/lib/ledger', () => ({ getLogStats: jest.fn(), subscribeLatestReport: jest.fn() }));
jest.mock('@/lib/weeklyReport', () => ({ requestWeeklyReport: jest.fn(), reportErrorCode: () => undefined }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/hooks/useCoach', () => ({ useCoach: () => ({}) }));

import type { DailyLog } from '@macrolog/core';
import { milestoneFromStats } from '@/hooks/useWeeklyReport';

/**
 * `buildMilestoneContext` is documented as lifetime-only, and the hook fed it
 * the 400-row coach window — so "N months of logging" stopped growing once an
 * account outgrew the window. The all-time read now feeds it; the window is a
 * floor, and the fallback when the read fails.
 */
const log = (iso: string): DailyLog =>
  ({ id: iso, date: new Date(iso), timestamp: new Date(iso), calories: 500, protein: 30 }) as unknown as DailyLog;

const window = [log('2026-09-01T12:00:00Z'), log('2026-09-02T12:00:00Z')];

it('uses the all-time count and earliest date when the read succeeded', () => {
  const m = milestoneFromStats({ totalLogs: 1834, earliestLogAt: new Date('2024-02-10T08:00:00Z') }, window, 5);
  expect(m.totalLogs).toBe(1834);
  expect(m.earliestLogAt?.toISOString()).toBe('2024-02-10T08:00:00.000Z');
  expect(m.currentStreak).toBe(5);
});

it('never reports LESS than the window in hand (a lagging count cannot undercut it)', () => {
  const m = milestoneFromStats({ totalLogs: 1, earliestLogAt: new Date('2026-09-02T12:00:00Z') }, window, 0);
  expect(m.totalLogs).toBe(2);
  expect(m.earliestLogAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
});

it('falls back to the window when the all-time read failed', () => {
  const m = milestoneFromStats(null, window, 2);
  expect(m).toEqual({ totalLogs: 2, earliestLogAt: new Date('2026-09-01T12:00:00Z'), currentStreak: 2 });
});

it('handles an account with a count but no readable oldest doc', () => {
  const m = milestoneFromStats({ totalLogs: 3, earliestLogAt: null }, [], 0);
  expect(m).toEqual({ totalLogs: 3, earliestLogAt: null, currentStreak: 0 });
});
