const mockRecordUsage = jest.fn<Promise<void>, [string, string, string, object]>();
jest.mock('@/lib/ledger', () => ({
  recordUsage: (...a: unknown[]) =>
    mockRecordUsage(...(a as [string, string, string, object])),
}));

import { flush, resetAnalytics, setAnalyticsUser, track } from '@/lib/analytics';

/**
 * The flush must survive a write that never answers.
 *
 * Found in production, not in review: an airplane-mode test on 2026-08-13
 * logged a meal and force-quit. The meal survived — it had a deadline and a
 * durable queue. Its usage count did not, because `setDoc` hangs rather than
 * rejecting when offline, so the restore path was unreachable and the buffer
 * had already been cleared.
 */
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllTimers();
  mockRecordUsage.mockReset();
  resetAnalytics();
  setAnalyticsUser('u1');
});
afterEach(() => jest.useRealTimers());

describe('analytics flush', () => {
  it('writes the buffered counts', async () => {
    mockRecordUsage.mockResolvedValue(undefined);
    track('log_added');
    track('app_open');

    await flush();

    expect(mockRecordUsage).toHaveBeenCalledWith('u1', expect.any(String), expect.any(String), {
      log_added: 1,
      app_open: 1,
    });
  });

  it('keeps the counts when the write hangs, instead of losing them', async () => {
    // The offline shape: never resolves, never rejects.
    mockRecordUsage.mockReturnValue(new Promise<void>(() => {}));
    track('log_queued_offline');

    const pending = flush();
    jest.advanceTimersByTime(5000);
    await pending;

    // Second attempt, now online — the count must still be there.
    mockRecordUsage.mockResolvedValue(undefined);
    await flush();

    expect(mockRecordUsage).toHaveBeenLastCalledWith(
      'u1',
      expect.any(String),
      expect.any(String),
      { log_queued_offline: 1 },
    );
  });

  it('keeps the counts when the write rejects outright', async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error('permission-denied'));
    track('coach_ask');
    await flush();

    mockRecordUsage.mockResolvedValue(undefined);
    await flush();

    expect(mockRecordUsage).toHaveBeenLastCalledWith('u1', expect.any(String), expect.any(String), {
      coach_ask: 1,
    });
  });

  it('does not write at all when nothing was recorded', async () => {
    await flush();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('records nothing while signed out — a count belongs to an account', async () => {
    setAnalyticsUser(null);
    track('log_added');
    setAnalyticsUser('u2');
    await flush();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });
});
