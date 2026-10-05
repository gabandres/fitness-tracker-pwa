/**
 * The fasting Live Activity's "End" button, and Siri's "Start fast" /
 * "End fast", on the JS side.
 *
 * Two rules carry the feature and both are invisible on a device until they go
 * wrong at the worst moment:
 *
 * 1. **A Lock Screen End only ends the fast it was showing.** It carries that
 *    fast's start; if a different fast is running by the time the app reads the
 *    note (restarted elsewhere), applying it would destroy the wrong fast.
 * 2. **Between the tap and the write, nothing may re-arm the timer.** The
 *    Activity is gone the instant End is tapped, but `profile.fastStartedAt`
 *    still says "running" until the app's `breakFast` lands — and the
 *    reconciler's whole job is to re-arm exactly that state.
 */

const mockStart = jest.fn();
const mockEnd = jest.fn();
const mockStatus = jest.fn();
const mockPeek = jest.fn();

jest.mock('../../modules/fasting-live-activity', () => ({
  ...jest.requireActual('../../modules/fasting-live-activity'),
  startFastActivity: (...args: unknown[]) => mockStart(...args),
  endFastActivity: (...args: unknown[]) => mockEnd(...args),
  getFastActivityStatus: (...args: unknown[]) => mockStatus(...args),
}));
jest.mock('../../modules/intent-inbox', () => ({
  peekIntentInbox: (...args: unknown[]) => mockPeek(...args),
}));

import {
  SPOKEN_ACTION_MAX_AGE_MS,
  markFastEnding,
  planFastInboxAction,
  reconcileFastActivity,
} from '@/lib/fast-activity';

const START = new Date('2026-10-04T02:00:00.000Z');
const NOW = START.getTime() + 16 * 3600_000;

beforeEach(() => {
  jest.clearAllMocks();
  markFastEnding(null);
  mockStart.mockResolvedValue(null);
  mockStatus.mockResolvedValue({ state: 'stopped' });
  mockPeek.mockResolvedValue([]);
});

describe('planFastInboxAction', () => {
  it('Lock Screen End ends THAT fast, at the instant tapped', () => {
    const tapped = NOW - 60_000;
    expect(
      planFastInboxAction({ kind: 'fastEnd', atMs: tapped, startedAtMs: START.getTime(), endedAtMs: tapped }, START, NOW),
    ).toEqual({ type: 'end', endedAt: new Date(tapped) });
  });

  it('…and refuses to end a DIFFERENT fast', () => {
    const other = new Date(START.getTime() + 3600_000);
    expect(
      planFastInboxAction({ kind: 'fastEnd', atMs: NOW, startedAtMs: START.getTime(), endedAtMs: NOW }, other, NOW),
    ).toEqual({ type: 'none' });
    expect(
      planFastInboxAction({ kind: 'fastEnd', atMs: NOW, startedAtMs: START.getTime(), endedAtMs: NOW }, null, NOW),
    ).toEqual({ type: 'none' });
  });

  it('has no age limit on a Lock Screen End — it is keyed to the fast, not the moment', () => {
    const tapped = NOW - 6 * 3600_000;
    expect(
      planFastInboxAction({ kind: 'fastEnd', atMs: tapped, startedAtMs: START.getTime(), endedAtMs: tapped }, START, NOW),
    ).toEqual({ type: 'end', endedAt: new Date(tapped) });
  });

  it('never ends a fast in the future, whatever the device clock wrote', () => {
    expect(
      planFastInboxAction({ kind: 'fastEnd', atMs: NOW, startedAtMs: START.getTime(), endedAtMs: NOW + 60_000 }, START, NOW),
    ).toEqual({ type: 'end', endedAt: new Date(NOW) });
  });

  it('Siri "End fast" ends the running fast at the instant spoken', () => {
    const spoken = NOW - 5_000;
    expect(planFastInboxAction({ kind: 'fastStop', atMs: spoken }, START, NOW)).toEqual({
      type: 'end',
      endedAt: new Date(spoken),
    });
    expect(planFastInboxAction({ kind: 'fastStop', atMs: spoken }, null, NOW)).toEqual({ type: 'none' });
  });

  it('Siri "Start fast" starts one — or SHOWS the one already running instead of restarting it', () => {
    expect(planFastInboxAction({ kind: 'fastStart', atMs: NOW - 1_000 }, null, NOW)).toEqual({
      type: 'start',
      at: new Date(NOW - 1_000),
    });
    expect(planFastInboxAction({ kind: 'fastStart', atMs: NOW - 1_000 }, START, NOW)).toEqual({ type: 'show' });
  });

  it('drops a spoken action nobody acted on for too long', () => {
    const old = NOW - SPOKEN_ACTION_MAX_AGE_MS - 1;
    expect(planFastInboxAction({ kind: 'fastStart', atMs: old }, null, NOW)).toEqual({ type: 'none' });
    expect(planFastInboxAction({ kind: 'fastStop', atMs: old }, START, NOW)).toEqual({ type: 'none' });
  });
});

describe('reconcileFastActivity after a Lock Screen End', () => {
  it('does not re-arm while the End note is still waiting in the inbox', async () => {
    mockPeek.mockResolvedValue([{ kind: 'fastEnd', atMs: NOW, startedAtMs: START.getTime(), endedAtMs: NOW }]);
    await reconcileFastActivity(START, 'en');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does not re-arm while the app is writing that end', async () => {
    markFastEnding(START.getTime());
    await reconcileFastActivity(START, 'en');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('still re-arms a fast whose End note named a different fast', async () => {
    mockPeek.mockResolvedValue([{ kind: 'fastEnd', atMs: NOW, startedAtMs: START.getTime() - 1, endedAtMs: NOW }]);
    await reconcileFastActivity(START, 'en');
    expect(mockStart).toHaveBeenCalledWith(START, 'en');
  });

  it('re-arms as before once the end has settled', async () => {
    markFastEnding(START.getTime());
    markFastEnding(null);
    await reconcileFastActivity(START, 'en');
    expect(mockStart).toHaveBeenCalledWith(START, 'en');
  });
});
