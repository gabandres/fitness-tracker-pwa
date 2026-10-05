/**
 * Body — UX_AUDIT S18-7 (Retry), S18-16 (past weigh-ins are editable and
 * deletable) and S18-5 (the hero carries its value for a reader).
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

jest.mock('@/lib/ledger', () => ({
  recordMilestone: jest.fn(),
  switchToMaintenance: jest.fn(),
  subscribeMilestones: () => () => {},
}));
// No confirm in front of a weigh-in delete any more (Body review U5): it is
// undone from the receipt. The toast is captured so its Undo can be pressed.
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (opts: { destructive?: boolean; onConfirm: () => void }) => {
    mockConfirm(opts);
    opts.onConfirm();
  },
}));
const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
  ToastSheetHost: () => null,
}));
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 } }),
}));
jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: false, error: null }),
}));

const mockSetWeight = jest.fn().mockResolvedValue(undefined);
const mockDeleteWeighIn = jest.fn().mockResolvedValue({
  landed: Promise.resolve('saved'),
  fromHealth: Promise.resolve(true),
});
const mockBody = {
  loading: false,
  error: null as Error | null,
  currentWeight: 180,
  todayWeight: 180,
  todayKey: '2026-09-28',
  weighIns: [
    { dateKey: '2026-09-28', weight: 180 },
    { dateKey: '2026-09-20', weight: 181.5 },
  ],
  weights: { '2026-09-28': 180, '2026-09-20': 181.5 },
  setWeight: mockSetWeight,
  deleteWeighIn: mockDeleteWeighIn,
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
  mockConfirm.mockClear();
  mockShowToast.mockClear();
  mockDeleteWeighIn.mockClear();
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

  it('delete is a row action, undone from the receipt — no confirm first (U5, C4)', async () => {
    const screen = await render(<BodyScreen />);

    await fireEvent(screen.getByTestId('weighin-2026-09-20'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });

    await waitFor(() => expect(mockDeleteWeighIn).toHaveBeenCalledWith('2026-09-20'));
    expect(mockConfirm).not.toHaveBeenCalled();
    // The receipt names where it went: Ignia's own Health sample went too.
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [message, opts] = mockShowToast.mock.calls[0];
    expect(message).toBe('Removed · also from Apple Health');
    // Undo writes the same value back on the same day.
    opts.action.onPress();
    await waitFor(() => expect(mockSetWeight).toHaveBeenCalledWith(181.5, '2026-09-20'));
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
