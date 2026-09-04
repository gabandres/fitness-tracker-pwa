/**
 * `first-scan`, the recovery half (#109).
 *
 * The award is made at the WRITE (`lib/first-scan.ts`, covered in
 * `log-writes.test.tsx`), because a photo scan is an event and `earnedAt`
 * should be the moment it happened. This file covers what Today contributes:
 * a second chance, derived from a field on rows the screen already holds, for
 * the one case the write path cannot cover — the milestone write failing in the
 * seconds after the meal succeeded.
 *
 * The properties that matter here are as much about what it must NOT do. It
 * must cost no read, it must not award off an empty window, and it must not
 * spend a review request: the recovery can fire days later, on a launch that
 * has nothing to do with a win.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { MIDNIGHT } from '@macrolog/core';

const mockRecordMilestone = jest.fn(async () => true);
const mockHasAnyCompletedFast = jest.fn(async () => false);
const mockHasAnyCompletedWorkout = jest.fn(async () => false);
/** What the milestones listener answers with. Mutable per test. */
const earned = { current: {} as Record<string, Date> };

jest.mock('@/lib/ledger', () => ({
  recordMilestone: (...a: unknown[]) => mockRecordMilestone(...(a as [])),
  hasAnyCompletedFast: (...a: unknown[]) => mockHasAnyCompletedFast(...(a as [])),
  hasAnyCompletedWorkout: (...a: unknown[]) => mockHasAnyCompletedWorkout(...(a as [])),
  subscribeMilestones: (_uid: string, cb: (rows: Record<string, Date>) => void) => {
    cb(earned.current);
    return () => {};
  },
}));

import { useMilestones } from '@/hooks/useMilestones';

const evidence = (over: Partial<Parameters<typeof useMilestones>[0]> = {}) => ({
  uid: 'u1',
  streak: 0,
  hasWeighIn: false,
  boundary: MIDNIGHT,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  earned.current = {};
});

/**
 * Mount the hook with the listener answering synchronously.
 *
 * Wrapped in `act` rather than called bare: `subscribeMilestones` is mocked to
 * answer inside the mount effect, so `setEarned`/`setReady` land during the
 * commit and React 19 reports them as updates outside act — a warning on a
 * green test, which is how a suite starts asserting against a half-rendered
 * tree without anyone noticing.
 */
const mount = async (ev: Parameters<typeof useMilestones>[0]) => {
  await act(async () => {
    renderHook(() => useMilestones(ev));
  });
};

describe('useMilestones — first-scan evidence', () => {
  it('records first-scan when a photo-scanned row is in the window', async () => {
    await mount(evidence({ hasPhotoScan: true }));

    await waitFor(() => expect(mockRecordMilestone).toHaveBeenCalledWith('u1', 'first-scan'));
  });

  it('records nothing when the window holds no scanned row', async () => {
    // `false` means "no scan in this bounded window" (ADR-0004), never "never
    // scanned" — so the honest behaviour is silence, not an inference.
    await mount(evidence({ hasPhotoScan: false }));

    await waitFor(() => expect(mockHasAnyCompletedFast).toHaveBeenCalled());
    expect(mockRecordMilestone).not.toHaveBeenCalled();
  });

  it('does not re-attempt a milestone already on file', async () => {
    // `newlyEarned` filters it out, so the common case — every launch after the
    // first scan, forever — issues no write at all.
    earned.current = { 'first-scan': new Date('2026-09-01T10:00:00Z') };
    await mount(evidence({ hasPhotoScan: true }));

    await waitFor(() => expect(mockHasAnyCompletedFast).toHaveBeenCalled());
    expect(mockRecordMilestone).not.toHaveBeenCalled();
  });

  it('costs no extra read — the evidence is a field, not a probe', async () => {
    // The two collection probes each cost a `limit(1)` read. `first-scan`
    // deliberately does not add a third: `useToday` already subscribes the rows
    // that carry `source`, so this milestone is free where the others are not.
    await mount(evidence({ hasPhotoScan: true }));

    await waitFor(() => expect(mockRecordMilestone).toHaveBeenCalledTimes(1));
    // Both probes are the pre-existing ones; neither belongs to first-scan.
    expect(mockHasAnyCompletedFast).toHaveBeenCalledTimes(1);
    expect(mockHasAnyCompletedWorkout).toHaveBeenCalledTimes(1);
  });

  it('reads absent evidence as absent, not as a scan', async () => {
    // The field is optional so an older caller compiles unchanged. `undefined`
    // must behave as `false`, or every screen that forgot to pass it would
    // award the milestone to everyone.
    await mount(evidence());

    await waitFor(() => expect(mockHasAnyCompletedFast).toHaveBeenCalled());
    expect(mockRecordMilestone).not.toHaveBeenCalled();
  });
});
