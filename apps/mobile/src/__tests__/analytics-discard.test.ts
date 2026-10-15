const mockRecordUsage = jest.fn<Promise<void>, [string, string, string, object]>();
jest.mock('@/lib/ledger', () => ({
  recordUsage: (...a: unknown[]) =>
    mockRecordUsage(...(a as [string, string, string, object])),
}));

import { discardAnalytics, flush, resetAnalytics, setAnalyticsUser, track } from '@/lib/analytics';

/**
 * Account deletion must not write analytics AFTER the server erased the
 * account (2026-10-15 audit). `signOut` flushes the buffer so counts land
 * under the uid they belong to — correct for a sign-out, wrong for a deletion,
 * where the flush recreated a `usageEvents` row for a user who had just been
 * erased. The deletion path discards instead, and anything tracked after that
 * (the onboarding screen mounting as the profile vanishes) is dropped.
 */
beforeEach(() => {
  jest.useFakeTimers();
  mockRecordUsage.mockReset().mockResolvedValue(undefined);
  resetAnalytics();
  setAnalyticsUser('u1');
});
afterEach(() => jest.useRealTimers());

it('drops the buffer without writing it', async () => {
  track('log_added');
  discardAnalytics();
  await flush();
  setAnalyticsUser(null);
  await Promise.resolve();
  expect(mockRecordUsage).not.toHaveBeenCalled();
});

it('drops events tracked after the discard', async () => {
  discardAnalytics();
  track('onboarding_start');
  await flush();
  expect(mockRecordUsage).not.toHaveBeenCalled();
});

it('a later sign-in starts clean', async () => {
  track('log_added');
  discardAnalytics();
  setAnalyticsUser('u2');
  track('app_open');
  await flush();
  expect(mockRecordUsage).toHaveBeenCalledTimes(1);
  expect(mockRecordUsage).toHaveBeenCalledWith('u2', expect.any(String), expect.any(String), { app_open: 1 });
});
