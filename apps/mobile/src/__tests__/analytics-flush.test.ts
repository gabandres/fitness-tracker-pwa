const mockRecordUsage = jest.fn<Promise<void>, [string, string, string, object]>();
jest.mock('@/lib/ledger', () => ({
  recordUsage: (...a: unknown[]) =>
    mockRecordUsage(...(a as [string, string, string, object])),
}));

import { flush, resetAnalytics, setAnalyticsUser, track } from '@/lib/analytics';

/**
 * The flush must survive a write that never answers — without counting it
 * twice when it finally does (2026-09-30).
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

  it('does not send a hung write\'s counts twice — they land when the connection returns', async () => {
    // The offline shape: never resolves, never rejects. Real Firestore keeps
    // the write queued and applies the `increment` on reconnect, so putting
    // the counts back and flushing again double-counted them: the owner's
    // 2026-09-29 row read `workout_finished: 4` for one finished workout.
    mockRecordUsage.mockReturnValue(new Promise<void>(() => {}));
    track('workout_finished');

    const pending = flush();
    jest.advanceTimersByTime(5000);
    await pending;

    mockRecordUsage.mockResolvedValue(undefined);
    await flush();

    expect(mockRecordUsage).toHaveBeenCalledTimes(1);
  });

  it('restores the counts if a write that outlived the deadline then fails for real', async () => {
    let fail!: (e: Error) => void;
    mockRecordUsage.mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject; }));
    track('log_queued_offline');

    const pending = flush();
    jest.advanceTimersByTime(5000);
    await pending;
    fail(new Error('permission-denied'));
    await Promise.resolve();

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

  it("does not hand a signed-out account's counts to whoever signs in next", async () => {
    // Sign-out: `setAnalyticsUser(null)` flushes A's buffer and clears the uid.
    // Offline that flush hangs, times out, and used to put A's counts BACK —
    // into a buffer the next sign-in inherits, so B's first flush wrote A's
    // session under `usageEvents/{B}_{day}`.
    mockRecordUsage.mockReturnValue(new Promise<void>(() => {}));
    track('log_added');
    setAnalyticsUser(null);
    await jest.advanceTimersByTimeAsync(5000);

    setAnalyticsUser('u2');
    mockRecordUsage.mockReset();
    mockRecordUsage.mockResolvedValue(undefined);
    await flush();

    expect(mockRecordUsage).not.toHaveBeenCalled();
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
