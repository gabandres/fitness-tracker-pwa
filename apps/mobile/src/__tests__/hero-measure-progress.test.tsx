jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

import { renderWithProviders as render } from '@/test-utils';
import { HeroRings } from '@/components/HeroRings';
import type { MaintenanceView, MeasurementProgress } from '@macrolog/core';

/**
 * The hero footer before measured mode opens (2026-09-10, retention: the
 * daily habit). What is pinned is the slot discipline, which no core test can
 * see: the progress readout renders when there is progress to show, hands the
 * footer to the maintenance line the moment there is one, and never draws an
 * empty frame when there is neither.
 */

const base = { calConsumed: 900, calTarget: 2000, protConsumed: 60, protTarget: 150, carbs: 80, fat: 30 };

const progress = (over: Partial<MeasurementProgress> = {}): MeasurementProgress => ({
  loggedDays: 5,
  neededDays: 14,
  daysToGo: 9,
  weighIns: 1,
  neededWeighIns: 2,
  weighInsToGo: 1,
  fraction: 5 / 14,
  ...over,
});

const maintenance: MaintenanceView = {
  maintenance: 2358,
  consumed: 900,
  delta: -1458,
  reliable: true,
  loggedDays: 28,
  spanDays: 30,
  weighInsDropped: 0,
  confidence: 1,
  provisional: false,
  holding: false,
};

describe('HeroRings measured-burn progress', () => {
  it('counts the days toward the measured burn and says how many are left', async () => {
    const { getByTestId, getByText } = await render(
      <HeroRings {...base} maintenance={null} progress={progress()} />,
    );
    expect(getByTestId('measure-progress')).toBeTruthy();
    expect(getByText('5 of 14 logged days toward your measured burn')).toBeTruthy();
    expect(getByText('Log 9 more and Ignia measures what you actually burn — no formula')).toBeTruthy();
  });

  it('names the weigh-ins once the days are all there', async () => {
    const { getByText } = await render(
      <HeroRings
        {...base}
        maintenance={null}
        progress={progress({ loggedDays: 14, daysToGo: 0, weighIns: 0, weighInsToGo: 2, fraction: 1 })}
      />,
    );
    expect(getByText('14 of 14 logged days toward your measured burn')).toBeTruthy();
    expect(getByText('2 more weigh-in(s) and it unlocks — the trend needs two')).toBeTruthy();
  });

  it('yields the slot to the maintenance line — never both', async () => {
    const { queryByTestId } = await render(
      <HeroRings {...base} maintenance={maintenance} progress={progress()} />,
    );
    expect(queryByTestId('maintenance-line')).toBeTruthy();
    expect(queryByTestId('measure-progress')).toBeNull();
  });

  it('draws no footer at all with nothing to say', async () => {
    const { queryByTestId } = await render(<HeroRings {...base} maintenance={null} progress={null} />);
    expect(queryByTestId('measure-progress')).toBeNull();
    expect(queryByTestId('maintenance-line')).toBeNull();
  });
});
