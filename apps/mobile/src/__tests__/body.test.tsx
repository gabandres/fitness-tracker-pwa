// ody.tsx now reaches milestones, which import @/lib/ledger -> firebase's
// untranspiled ESM. Mocked for the same reason @/lib/auth already is here.
// Body calls `useScrollToTop`, which needs a navigator's route — there is
// none in a screen test. The rest mirrors `jest.setup.js`'s expo-router mock.
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useFocusEffect: (cb: () => void | (() => void)) => {
      const React = require('react');
      React.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useScrollToTop: jest.fn(),
  };
});

jest.mock('@/lib/ledger', () => ({
  recordMilestone: jest.fn(),
  subscribeMilestones: () => () => {},
}));
// Body's sheets are `native` (Body review P1); iOS-under-jest would render
// them into the root sheet route, which a screen test does not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());

import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';
import type { Measurement } from '@macrolog/core';

/**
 * Regression tests for the Body screen's measurement section.
 *
 * These exist because of three tester-reported bugs on 2026-08-05, two of
 * which this layer can catch: saved rows could not be edited at all, and
 * nothing explained what a tape measurement was for. (The third — the input
 * collapsed to zero height by a stray `flex: 1` — is a LAYOUT bug and is
 * structurally invisible here; RNTL never runs a Yoga pass. That one is
 * covered by .maestro/measurements.yaml.)
 */

const mockAdd = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDelete = jest.fn().mockResolvedValue(undefined);

const mockMeasurements: Measurement[] = [
  { id: 'm1', date: new Date('2026-08-01T12:00:00Z'), waist: 34, neck: 15 },
  { id: 'm2', date: new Date('2026-07-25T12:00:00Z'), waist: 35 },
  { id: 'm3', date: new Date('2026-07-18T12:00:00Z'), bodyFatPct: 21.5, bodyFatMethod: 'dxa' },
];

jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

let mockBodyFatShown: unknown = { source: 'navy', pct: 18.2 };

jest.mock('@/hooks/useBody', () => ({
  useBody: () => ({
    loading: false,
    error: null,
    currentWeight: 180,
    todayWeight: 180,
    weighIns: [],
    setWeight: jest.fn(),
    measurements: mockMeasurements,
    bodyFat: 18.2,
    bodyFatGap: null,
    bodyFatShown: mockBodyFatShown,
    addMeasurement: mockAdd,
    updateMeasurement: mockUpdate,
    deleteMeasurement: mockDelete,
    projection: null,
    weightSeries: [],
    projectedSeries: [],
    goalProgress: null,
  }),
}));

// The composition flag is 'admin' (ADR-0043): off unless a test turns it on.
let mockIsAdmin = false;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 }, isAdmin: mockIsAdmin }),
}));

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: false, error: null }),
}));

import BodyScreen from '@/app/(app)/body';

beforeEach(() => {
  mockAdd.mockClear();
  mockUpdate.mockClear();
  mockDelete.mockClear();
});

describe('Body screen — the body-fat card (ADR-0043)', () => {
  beforeEach(() => {
    mockIsAdmin = true;
  });
  afterEach(() => {
    mockBodyFatShown = { source: 'navy', pct: 18.2 };
    mockIsAdmin = false;
  });

  it('shows the Navy estimate when no newer measured value exists', async () => {
    const screen = await render(<BodyScreen />);
    expect(screen.getByTestId('bodyfat-value').props.children).toBe('18.2%');
    expect(screen.getByTestId('bodyfat-source').props.children).toBe('U.S. Navy estimate');
  });

  it('a newer DXA wins — with its method and date, and the tape estimate kept beside it', async () => {
    mockBodyFatShown = { source: 'measured', pct: 18.4, method: 'dxa', date: new Date(2026, 9, 3, 7) };
    const screen = await render(<BodyScreen />);
    expect(screen.getByTestId('bodyfat-value').props.children).toBe('18.4%');
    expect(screen.getByTestId('bodyfat-source').props.children).toBe('Measured · DXA · Oct 3');
    expect(screen.getByText('Tape estimate: 18.2%')).toBeTruthy();
  });

  it('flag OFF: a stored DXA neither takes over the card nor shows in the list', async () => {
    mockIsAdmin = false;
    mockBodyFatShown = { source: 'measured', pct: 21.5, method: 'dxa', date: new Date(2026, 9, 3, 7) };
    const screen = await render(<BodyScreen />);
    expect(screen.getByTestId('bodyfat-value').props.children).toBe('18.2%');
    expect(screen.getByTestId('bodyfat-source').props.children).toBe('U.S. Navy estimate');
    expect(screen.queryByText(/21\.5%/)).toBeNull();
  });

  it('flag ON: the stored DXA shows in its row', async () => {
    const screen = await render(<BodyScreen />);
    expect(screen.getByText(/21\.5% \(DXA\)/)).toBeTruthy();
  });
});

describe('Body screen — the measured body-fat field (ADR-0043)', () => {
  beforeEach(() => {
    mockIsAdmin = true;
    mockAdd.mockClear();
    mockUpdate.mockClear();
  });
  afterEach(() => {
    mockIsAdmin = false;
  });

  it('is hidden with the flag off', async () => {
    mockIsAdmin = false;
    const screen = await render(<BodyScreen />);
    await fireEvent.press(screen.getByTestId('add-measurement'));
    await waitFor(() => expect(screen.getByTestId('measure-waist')).toBeTruthy());
    expect(screen.queryByTestId('measure-bodyfat-block')).toBeNull();
  });

  it('a method with no number blocks save and says why — it used to save as nothing', async () => {
    const screen = await render(<BodyScreen />);
    await fireEvent.press(screen.getByTestId('add-measurement'));
    await waitFor(() => expect(screen.getByTestId('measure-waist')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('measure-waist'), '33');
    await fireEvent.press(screen.getByTestId('measure-bf-dxa'));
    expect(screen.getByText('Enter the body-fat %, or unselect the method.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('measure-save'));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('emptying the % on a row that had one clears the pair', async () => {
    const screen = await render(<BodyScreen />);
    await fireEvent.press(screen.getByTestId('measurement-m3'));
    await waitFor(() => expect(screen.getByTestId('measure-bodyfat').props.value).toBe('21.5'));
    await fireEvent.changeText(screen.getByTestId('measure-bodyfat'), '');
    await fireEvent.changeText(screen.getByTestId('measure-waist'), '33');
    await fireEvent.press(screen.getByTestId('measure-save'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const patch = mockUpdate.mock.calls[0][1];
    expect('bodyFatPct' in patch).toBe(true);
    expect(patch.bodyFatPct).toBeUndefined();
  });
});

describe('Body screen — measurements', () => {
  it('opens the sheet PREFILLED when a saved row is tapped', async () => {
    const screen = await render(<BodyScreen />);

    await fireEvent.press(screen.getByTestId('measurement-m1'));

    // The bug this pins: an edit form that opens blank reads as "start over",
    // and saving it would wipe every field the user did not retype.
    await waitFor(() => {
      expect(screen.getByTestId('measure-waist').props.value).toBe('34');
    });
    expect(screen.getByTestId('measure-neck').props.value).toBe('15');
    // A field the row does not carry stays empty rather than showing 0.
    expect(screen.getByTestId('measure-hip').props.value).toBe('');
  });

  it('saving an opened row UPDATES it instead of creating a duplicate', async () => {
    const screen = await render(<BodyScreen />);

    await fireEvent.press(screen.getByTestId('measurement-m1'));
    await waitFor(() => expect(screen.getByTestId('measure-waist')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('measure-waist'), '33.5');
    await fireEvent.press(screen.getByTestId('measure-save'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('m1', expect.objectContaining({ waist: 33.5 }));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('the Add entry point still creates a new row', async () => {
    const screen = await render(<BodyScreen />);

    await fireEvent.press(screen.getByTestId('add-measurement'));
    await waitFor(() => expect(screen.getByTestId('measure-waist')).toBeTruthy());
    // Opening "add" after an edit must not inherit the edited values.
    expect(screen.getByTestId('measure-waist').props.value).toBe('');
    await fireEvent.changeText(screen.getByTestId('measure-waist'), '36');
    await fireEvent.press(screen.getByTestId('measure-save'));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('every site is editable, not just waist', async () => {
    const screen = await render(<BodyScreen />);
    await fireEvent.press(screen.getByTestId('measurement-m1'));
    await waitFor(() => expect(screen.getByTestId('measure-waist')).toBeTruthy());

    for (const site of ['waist', 'neck', 'hip', 'chest', 'bicep']) {
      expect(screen.getByTestId(`measure-${site}`)).toBeTruthy();
    }
  });

  it('explains how to measure, on demand', async () => {
    const screen = await render(<BodyScreen />);

    expect(screen.queryByTestId('measure-how')).toBeNull();
    await fireEvent.press(screen.getByTestId('measure-how-toggle'));
    expect(screen.getByTestId('measure-how')).toBeTruthy();
  });

  it('deletion is reachable by every user, not a hidden long-press', async () => {
    const screen = await render(<BodyScreen />);
    // Discoverability regression guard (Body review A1 / bug 6): the trash
    // used to be a button NESTED in the row, which VoiceOver never reaches.
    // The row itself now carries the delete action (and a swipe reveals it).
    const row = screen.getByTestId('measurement-m1');
    expect(row.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(
      expect.arrayContaining(['edit', 'delete']),
    );
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('m1'));
  });
});

describe('Body screen — the weight number is an entry point', () => {
  it('tapping the hero opens the weigh-in sheet and counts the tap', async () => {
    const { track } = jest.requireMock('@/lib/analytics') as { track: jest.Mock };
    const screen = await render(<BodyScreen />);
    expect(screen.queryByTestId('weight-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('body-hero-tap'));
    await waitFor(() => expect(screen.getByTestId('weight-input')).toBeTruthy());
    expect(track).toHaveBeenCalledWith('body_hero_tap');
  });
});
