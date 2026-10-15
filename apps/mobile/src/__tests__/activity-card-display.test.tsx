import { renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';

/**
 * Steps and active kcal are display-only (owner, 2026-10-15): they never feed
 * maintenance or the target (`packages/core/src/activity-display-only.test.ts`),
 * and the Activity card on Today is where they still show. Active kcal is
 * labelled a device estimate — it is what the watch modelled, not a measurement.
 */
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null, profile: { unitSystem: 'us' } }),
}));

const noop = () => {};

function setup(activity: { steps?: number; activeKcal?: number } | undefined) {
  return render(
    <DailyMetrics
      water={0}
      sleep={null}
      activity={activity}
      fastStartedAt={null}
      onAddWater={noop}
      onSetSleep={noop}
      onStartFast={noop}
      onBreakFast={noop}
    />,
  );
}

describe('Activity card', () => {
  it('shows steps and active kcal, the kcal labelled a device estimate', async () => {
    const { getByTestId } = await setup({ steps: 6362, activeKcal: 296 });
    expect(getByTestId('activity-value')).toHaveTextContent('6,362 steps · 296 kcal active (device estimate)');
  });

  it('shows steps alone when only steps arrived', async () => {
    const { getByTestId } = await setup({ steps: 2000 });
    expect(getByTestId('activity-value')).toHaveTextContent('2,000 steps');
  });

  it('is hidden when nothing arrived', async () => {
    const { queryByTestId } = await setup(undefined);
    expect(queryByTestId('activity-value')).toBeNull();
  });
});
