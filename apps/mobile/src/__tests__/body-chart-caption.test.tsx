import { renderWithProviders as render } from '@/test-utils';
import React from 'react';

/**
 * The weight chart draws two lines over two different windows: a solid
 * 14-day series and a dashed continuation fitted over 28 days
 * (`PROJECTION_WINDOW_DAYS` in useBody). That is deliberate — a 14-day fit is
 * dominated by water weight — but until 2026-08-12 nothing on screen said so,
 * and a flat-looking fortnight could sprout a steeply falling dash.
 *
 * The caption only earns its space when there IS a dash, so both states are
 * pinned here.
 */

const baseBody = {
  loading: false,
  error: null,
  currentWeight: 180,
  todayWeight: 180,
  weighIns: [],
  setWeight: jest.fn(),
  measurements: [],
  bodyFat: null,
  bodyFatGap: 'measurement',
  bodyFatMissing: ['waist', 'neck'],
  addMeasurement: jest.fn(),
  updateMeasurement: jest.fn(),
  deleteMeasurement: jest.fn(),
  goalProgress: null,
};

let mockBodyState: Record<string, unknown> = { ...baseBody };

jest.mock('@/hooks/useBody', () => ({ useBody: () => mockBodyState }));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 } }),
}));

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: false, error: null }),
}));

import BodyScreen from '@/app/(app)/body';

const CAPTION = 'Last 14 days · the dashed line projects your 4-week trend';

describe('Body screen — weight chart caption', () => {
  it('names both windows when a forecast is drawn', async () => {
    mockBodyState = {
      ...baseBody,
      weightSeries: [181, 180.4, 180.8, 180.1, 179.9, 180.3, 179.7],
      projectedSeries: [179.5, 179.3, 179.1, 178.9, 178.7, 178.5, 178.3],
      projection: { slopeLbPerWeek: -1.4, goalDateKey: null },
    };

    const screen = await render(<BodyScreen />);

    expect(screen.getByTestId('weight-chart')).toBeTruthy();
    expect(screen.getByText(CAPTION)).toBeTruthy();
  });

  it('stays silent when there is no dash to explain', async () => {
    mockBodyState = {
      ...baseBody,
      weightSeries: [181, 180.4, 180.8],
      projectedSeries: [],
      projection: null,
    };

    const screen = await render(<BodyScreen />);

    expect(screen.getByTestId('weight-chart')).toBeTruthy();
    expect(screen.queryByText(CAPTION)).toBeNull();
  });
});
