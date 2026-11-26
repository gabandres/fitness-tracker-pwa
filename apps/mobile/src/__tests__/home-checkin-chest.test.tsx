import React from 'react';
import { renderWithProviders as render } from '@/test-utils';
import { MIDNIGHT, type HomePlanCheckIn } from '@macrolog/core';
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { HomeCheckInCard } from '@/components/HomePlanCards';

/**
 * Owner, 2026-11-26: chest is tracked alongside waist and neck. With no chest
 * baseline the card says "not taped yet", then shows the first reading.
 */
const checkIn: HomePlanCheckIn = {
  date: '2026-11-30',
  title: 'Tape + photo check',
  sites: ['waist', 'neck', 'chest'],
  baseline: { date: '2026-10-30', weightLb: 151.8, waistIn: 31.25, neckIn: 14.5 },
};

describe('check-in card: chest (2026-11-26)', () => {
  it('lists chest as not taped yet before the tape', async () => {
    const { getByTestId } = await render(
      <HomeCheckInCard checkIn={checkIn} todayKey="2026-11-30" weights={{}} measurements={[]} boundary={MIDNIGHT} />,
    );
    expect(getByTestId('home-checkin-waist')).toHaveTextContent('Waist: not taped yet (baseline 31.25 in)');
    expect(getByTestId('home-checkin-chest')).toHaveTextContent('Chest: not taped yet');
  });

  it('shows the first chest reading with no delta', async () => {
    const { getByTestId } = await render(
      <HomeCheckInCard
        checkIn={checkIn}
        todayKey="2026-11-30"
        weights={{}}
        measurements={[{ id: 'm', date: new Date(2026, 10, 30, 7), waist: 31, neck: 14.5, chest: 38.5 }]}
        boundary={MIDNIGHT}
      />,
    );
    expect(getByTestId('home-checkin-chest')).toHaveTextContent('Chest 38.5 in (first reading)');
    expect(getByTestId('home-checkin-waist')).toHaveTextContent('Waist 31 in (−0.25 vs 31.25)');
  });

  it('without sites, the baseline decides: no chest line', async () => {
    const { queryByTestId } = await render(
      <HomeCheckInCard checkIn={{ ...checkIn, sites: undefined }} todayKey="2026-11-30" weights={{}} measurements={[]} boundary={MIDNIGHT} />,
    );
    expect(queryByTestId('home-checkin-chest')).toBeNull();
    expect(queryByTestId('home-checkin-neck')).not.toBeNull();
  });
});
