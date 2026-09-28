/**
 * Body — UX_AUDIT S18-7 (Retry), S18-16 (past weigh-ins are editable and
 * deletable) and S18-5 (the hero carries its value for a reader).
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

const mockDeleteDailyWeight = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/ledger', () => ({
  deleteDailyWeight: (...a: unknown[]) => mockDeleteDailyWeight(...a),
  recordMilestone: jest.fn(),
  switchToMaintenance: jest.fn(),
  subscribeMilestones: () => () => {},
}));
// `confirm()` needs a mounted host; here it answers yes at once so the test
// can assert what a confirmed delete does. The destructive flag is asserted.
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (opts: { destructive?: boolean; onConfirm: () => void }) => {
    mockConfirm(opts);
    opts.onConfirm();
  },
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 } }),
}));
jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: false, error: null }),
}));

const mockSetWeight = jest.fn().mockResolvedValue(undefined);
const mockBody = {
  loading: false,
  error: null as Error | null,
  currentWeight: 180,
  todayWeight: 180,
  weighIns: [
    { dateKey: '2026-09-28', weight: 180 },
    { dateKey: '2026-09-20', weight: 181.5 },
  ],
  setWeight: mockSetWeight,
  measurements: [],
  bodyFat: null,
  bodyFatGap: 'measurement',
  bodyFatMissing: ['waist'],
  addMeasurement: jest.fn(),
  updateMeasurement: jest.fn(),
  deleteMeasurement: jest.fn(),
  projection: null,
  weightSeries: [],
  projectedSeries: [],
  goalProgress: null,
  goalCrossed: false,
};
const mockUseBody = jest.fn(() => mockBody);
jest.mock('@/hooks/useBody', () => ({ useBody: () => mockUseBody() }));

import BodyScreen from '@/app/(app)/body';

beforeEach(() => {
  mockUseBody.mockClear();
  mockSetWeight.mockClear();
  mockDeleteDailyWeight.mockClear();
  mockConfirm.mockClear();
  mockBody.error = null;
});

describe('Body — past weigh-ins', () => {
  it('tapping a row opens the sheet prefilled and saves to THAT day', async () => {
    const screen = await render(<BodyScreen />);

    await fireEvent.press(screen.getByTestId('weighin-2026-09-20'));
    await waitFor(() => expect(screen.getByTestId('weight-input').props.value).toBe('181.5'));

    await fireEvent.changeText(screen.getByTestId('weight-input'), '180.5');
    await fireEvent(screen.getByTestId('weight-input'), 'submitEditing');

    await waitFor(() => expect(mockSetWeight).toHaveBeenCalledWith(180.5, '2026-09-20'));
  });

  it('the trash icon deletes the day after a destructive confirm', async () => {
    const screen = await render(<BodyScreen />);

    await fireEvent.press(screen.getByTestId('weighin-delete-2026-09-20'));

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(mockDeleteDailyWeight).toHaveBeenCalledWith('u1', '2026-09-20'));
  });

  it('rows are buttons that announce their value', async () => {
    const screen = await render(<BodyScreen />);
    const row = screen.getByTestId('weighin-2026-09-20');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityValue).toEqual({ text: '181.5 lb' });
  });
});

describe('Body — Retry and hero value', () => {
  it('Retry remounts the screen so the feed re-opens', async () => {
    mockBody.error = new Error('offline');
    const screen = await render(<BodyScreen />);
    const before = mockUseBody.mock.calls.length;

    await fireEvent.press(screen.getByTestId('retry'));

    expect(mockUseBody.mock.calls.length).toBeGreaterThan(before);
  });

  it('the hero exposes the weight as an accessibility value', async () => {
    const screen = await render(<BodyScreen />);
    expect(screen.getByTestId('body-hero-tap').props.accessibilityValue).toEqual({ text: '180 lb' });
  });
});
