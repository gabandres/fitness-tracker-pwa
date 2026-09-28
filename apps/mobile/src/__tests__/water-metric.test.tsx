import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';

/**
 * The water row under a METRIC profile (UX_AUDIT S18-8). `water-entry.test`
 * covers the US path; what this pins is that a metric user sees ml, taps ml
 * pills, types ml — and `onAddWater` still receives fl oz, because that is
 * what the store, the rules and the Trends card hold.
 */
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null, profile: { unitSystem: 'metric' } }),
}));

const noop = () => {};

function setup(water = 16) {
  const onAddWater = jest.fn();
  const view = render(
    <DailyMetrics
      water={water}
      sleep={null}
      activity={undefined}
      fastStartedAt={null}
      onAddWater={onAddWater}
      onSetSleep={noop}
      onStartFast={noop}
      onBreakFast={noop}
    />,
  );
  return { onAddWater, view };
}

describe('Water row, metric profile', () => {
  it('shows the stored fl oz as ml and offers ml pills', async () => {
    const { view } = setup(16);
    const { getByText, getByTestId } = await view;
    // 16 fl oz × 29.5735 = 473 ml.
    expect(getByText('473 ml')).toBeTruthy();
    expect(getByTestId('water-plus-8')).toHaveTextContent('+250');
    expect(getByTestId('water-plus-16')).toHaveTextContent('+500');
    expect(getByTestId('water-plus-24')).toHaveTextContent('+750');
    expect(getByTestId('water-plus-8').props.accessibilityLabel).toBe('Add 250 ml of water');
  });

  it('hands the store fl oz when a ml pill is tapped', async () => {
    const { onAddWater, view } = setup(16);
    const { getByTestId } = await view;
    await fireEvent.press(getByTestId('water-plus-8'));
    expect(onAddWater).toHaveBeenCalledTimes(1);
    // 16 + 250/29.5735 — unrounded; the ledger clamps and rounds on write.
    expect(onAddWater.mock.calls[0][0]).toBeCloseTo(16 + 250 / 29.5735, 3);
  });

  it('takes a typed ml amount in the sheet and converts once at save', async () => {
    const { onAddWater, view } = setup(16);
    const { getByTestId, getByText } = await view;
    await fireEvent.press(getByTestId('water-open'));
    expect(getByText('Today: 473 ml')).toBeTruthy();
    await fireEvent.changeText(getByTestId('water-input'), '500');
    // Preview reasons in ml: 473 → 973.
    expect(getByTestId('water-preview')).toHaveTextContent('473 → 973 ml');
    await act(async () => {
      await fireEvent.press(getByTestId('water-save'));
    });
    // 973 ml → 32.9 fl oz → clamped to a whole 33 by clampWaterFlOz.
    expect(onAddWater).toHaveBeenCalledWith(33);
  });

  it('refuses a total past the daily maximum, stated in ml', async () => {
    const { onAddWater, view } = setup(600);
    const { getByTestId } = await view;
    await fireEvent.press(getByTestId('water-open'));
    await fireEvent.changeText(getByTestId('water-input'), '5000');
    expect(getByTestId('water-preview')).toHaveTextContent(/19992 ml daily maximum/);
    await act(async () => {
      await fireEvent.press(getByTestId('water-save'));
    });
    expect(onAddWater).not.toHaveBeenCalled();
  });
});
