/**
 * "Day fully logged?" on Today (2026-10-24): a tri-state row in the daily
 * metrics card. Yes / No are two chips, the chosen one checked; tapping the
 * chosen one again takes the answer back (unset). The rule the answer feeds is
 * pinned in `packages/core/src/complete-day.test.ts`, the storage in the rules
 * spec and `day-logged-ledger.test.ts`, and the hook wiring in
 * `today-day-listeners.test.tsx`; this pins what the user sees and what the
 * row hands the store.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

const noop = () => {};

function today(dayLogged: boolean | null, onSetDayLogged = jest.fn()) {
  return render(
    <DailyMetrics water={0} sleep={8} dayLogged={dayLogged} onSetDayLogged={onSetDayLogged} activity={undefined}
      fastStartedAt={null} onAddWater={noop} onSetSleep={noop} onStartFast={noop} onBreakFast={noop} />,
  );
}

describe('Today: "Day fully logged?"', () => {
  it('starts unset: neither chip checked, and says what unset means', async () => {
    const view = await today(null);
    expect(view.getByText('Day fully logged?')).toBeTruthy();
    expect(view.getByTestId('day-logged-state')).toHaveTextContent('Counts toward maintenance at 1,000 kcal or more');
    expect(view.getByTestId('day-logged-yes').props.accessibilityState).toMatchObject({ checked: false });
    expect(view.getByTestId('day-logged-no').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('Yes and No answer the day', async () => {
    const onSet = jest.fn();
    const view = await today(null, onSet);
    await fireEvent.press(view.getByTestId('day-logged-yes'));
    expect(onSet).toHaveBeenLastCalledWith(true);
    await fireEvent.press(view.getByTestId('day-logged-no'));
    expect(onSet).toHaveBeenLastCalledWith(false);
  });

  it('shows the answer, and switching it sends the other one', async () => {
    const onSet = jest.fn();
    const view = await today(true, onSet);
    expect(view.getByTestId('day-logged-yes').props.accessibilityState).toMatchObject({ checked: true });
    expect(view.getByTestId('day-logged-state')).toHaveTextContent('Counts toward maintenance');
    await fireEvent.press(view.getByTestId('day-logged-no'));
    expect(onSet).toHaveBeenCalledWith(false);
  });

  it('tapping the chosen answer again takes it back (unset)', async () => {
    const onSet = jest.fn();
    const view = await today(false, onSet);
    expect(view.getByTestId('day-logged-state')).toHaveTextContent('Left out of maintenance');
    expect(view.getByTestId('day-logged-no').props.accessibilityHint).toBe('Tap again to clear your answer');
    await fireEvent.press(view.getByTestId('day-logged-no'));
    expect(onSet).toHaveBeenCalledWith(null);
  });

  it('no row without a setter (callers that do not offer it)', async () => {
    const view = await render(
      <DailyMetrics water={0} sleep={null} activity={undefined} fastStartedAt={null}
        onAddWater={noop} onSetSleep={noop} onStartFast={noop} onBreakFast={noop} />,
    );
    expect(view.queryByTestId('day-logged-row')).toBeNull();
  });
});
