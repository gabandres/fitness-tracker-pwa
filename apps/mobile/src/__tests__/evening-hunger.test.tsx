/**
 * Evening hunger (2026-10-20): the Today row's save and edit, and the Trends
 * card's 7-day average and rule text. The storage range is pinned in
 * `firestore.rules` (rules spec) and the average itself in
 * `packages/core/src/evening-hunger.test.ts`; this pins what the user sees and
 * what the row hands the store.
 */
import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { hungerWeek } from '@macrolog/core';
import { DailyMetrics } from '@/components/DailyMetrics';
import { HungerTrendsCard } from '@/components/HungerTrendsCard';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});

const noop = () => {};
const WEEK = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];

function today(hunger: number | null, onSetHunger = jest.fn()) {
  return render(
    <DailyMetrics water={0} sleep={8} hunger={hunger} onSetHunger={onSetHunger} activity={undefined} fastStartedAt={null}
      onAddWater={noop} onSetSleep={noop} onStartFast={noop} onBreakFast={noop} />,
  );
}

describe('Today: evening hunger row', () => {
  it('sits with the daily metrics, unrated until saved', async () => {
    const view = await today(null);
    expect(view.getByText('Evening hunger')).toBeTruthy();
    expect(view.getByTestId('hunger-value').props.accessibilityLabel).toBe('Evening hunger, not logged');
    expect(view.getByTestId('hunger-open')).toHaveTextContent('Log');
  });

  it('saves the picked rating', async () => {
    const onSetHunger = jest.fn();
    const view = await today(null, onSetHunger);
    await fireEvent.press(view.getByTestId('hunger-open'));
    expect(view.getByText('0 = full · 10 = starving')).toBeTruthy();
    await fireEvent.press(view.getByTestId('hunger-chip-7'));
    await act(async () => {
      await fireEvent.press(view.getByTestId('hunger-save'));
    });
    expect(onSetHunger).toHaveBeenCalledTimes(1);
    expect(onSetHunger).toHaveBeenCalledWith(7);
  });

  it('will not save with nothing picked', async () => {
    const onSetHunger = jest.fn();
    const view = await today(null, onSetHunger);
    await fireEvent.press(view.getByTestId('hunger-open'));
    await act(async () => {
      await fireEvent.press(view.getByTestId('hunger-save'));
    });
    expect(onSetHunger).not.toHaveBeenCalled();
  });

  it('edits the day\'s rating: opens on the saved value and saves the new one', async () => {
    const onSetHunger = jest.fn();
    const view = await today(6, onSetHunger);
    expect(view.getByText('6 / 10')).toBeTruthy();
    expect(view.getByTestId('hunger-open')).toHaveTextContent('Edit');
    await fireEvent.press(view.getByTestId('hunger-open'));
    expect(view.getByTestId('hunger-chip-6').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(view.getByTestId('hunger-chip-3'));
    await act(async () => {
      await fireEvent.press(view.getByTestId('hunger-save'));
    });
    expect(onSetHunger).toHaveBeenCalledWith(3);
  });

  it('a 0 ("full") is a rating, not an empty row', async () => {
    const view = await today(0);
    expect(view.getByText('0 / 10')).toBeTruthy();
  });

  it('no row without a setter (callers that do not offer it)', async () => {
    const view = await render(
      <DailyMetrics water={0} sleep={null} activity={undefined} fastStartedAt={null}
        onAddWater={noop} onSetSleep={noop} onStartFast={noop} onBreakFast={noop} />,
    );
    expect(view.queryByTestId('hunger-open')).toBeNull();
  });
});

describe('Trends: evening hunger card', () => {
  it('shows the 7-day average, how many days it covers, and the rule at the target + 100', async () => {
    const week = hungerWeek({ '2026-10-18': 6, '2026-10-19': 7, '2026-10-20': 8 }, WEEK);
    const view = await render(<HungerTrendsCard week={week} targetKcal={1850} />);
    expect(view.getByTestId('hunger-avg')).toHaveTextContent('7-day average: 7 / 10');
    expect(view.getByTestId('hunger-rated')).toHaveTextContent('3 of the last 7 days rated');
    expect(view.getByTestId('hunger-rule')).toHaveTextContent('avg ≥7 → consider raising target to ~1,950');
  });

  it('rounds the average to one decimal', async () => {
    const week = hungerWeek({ '2026-10-18': 5, '2026-10-19': 6, '2026-10-20': 6 }, WEEK);
    const view = await render(<HungerTrendsCard week={week} targetKcal={1850} />);
    expect(view.getByTestId('hunger-avg')).toHaveTextContent('7-day average: 5.7 / 10');
  });

  it('draws nothing until a day in the window is rated', async () => {
    const view = await render(<HungerTrendsCard week={hungerWeek({}, WEEK)} targetKcal={1850} />);
    expect(view.queryByTestId('hunger-trends')).toBeNull();
    const pending = await render(<HungerTrendsCard week={null} targetKcal={1850} />);
    expect(pending.queryByTestId('hunger-trends')).toBeNull();
  });
});
