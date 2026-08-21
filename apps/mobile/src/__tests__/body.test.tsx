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
];

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
    addMeasurement: mockAdd,
    updateMeasurement: mockUpdate,
    deleteMeasurement: mockDelete,
    projection: null,
    weightSeries: [],
    projectedSeries: [],
    goalProgress: null,
  }),
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 } }),
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

  it('deletion is an explicit control, not a hidden long-press', async () => {
    const screen = await render(<BodyScreen />);
    // Discoverability regression guard: the trash affordance must exist per row.
    expect(screen.getByTestId('measurement-delete-m1')).toBeTruthy();
  });
});
