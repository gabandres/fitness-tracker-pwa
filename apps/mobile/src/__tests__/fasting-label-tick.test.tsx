/**
 * The running-fast label on Today advances on its own 30 s tick.
 *
 * Found 2026-10-21 in the React Compiler's output: `fastingValue(...)` read
 * `Date.now()` inside a call the compiler caches on its arguments, so the label
 * was computed once per fast and the timer re-rendered the row for nothing. The
 * fix passes `now` in as state. jest does not run the compiler, so this pins the
 * behaviour (the label moves with the clock) rather than the compiled shape —
 * the shape is pinned by the helper taking `now` as a required argument.
 */
import React from 'react';
import { act, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

const noop = () => {};

describe('Today: running fast label', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-21T12:00:00Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('moves forward while the screen stays open', async () => {
    const started = new Date('2026-10-21T10:00:00Z'); // 2 h ago
    const view = await render(
      <DailyMetrics water={0} sleep={null} activity={undefined} fastStartedAt={started}
        onAddWater={noop} onSetSleep={noop} onStartFast={noop} onBreakFast={noop} />,
    );
    const before = view.getByTestId('fast-open').props.accessibilityLabel as string;

    await act(async () => {
      jest.advanceTimersByTime(31 * 60_000);
    });

    const after = view.getByTestId('fast-open').props.accessibilityLabel as string;
    expect(after).not.toBe(before);
  });
});
