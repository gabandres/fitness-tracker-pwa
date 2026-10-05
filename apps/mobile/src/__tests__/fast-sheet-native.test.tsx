jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
// The 1.2.5 binary: the platform picker is present. Jest has no native module,
// so the field is a stub whose `onChange` the test drives directly — what is
// under test is the sheet around it, not UIDatePicker.
jest.mock('@/components/NativeDatePicker', () => {
  const { View } = require('react-native');
  return {
    hasNativeDateField: true,
    NativeDateField: (p: { testID?: string; mode: string; value: Date; onChange: (d: Date) => void; accessibilityLabel: string }) => (
      <View
        testID={p.testID}
        accessibilityLabel={p.accessibilityLabel}
        accessibilityValue={{ text: `${p.mode}:${p.value.toISOString()}` }}
        onChange={p.onChange}
      />
    ),
  };
});

import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { FastSheet } from '@/components/FastSheet';
import { DayStepper } from '@/components/body/DayStepper';

/**
 * Body re-score 3, bug 1: on the 1.2.5 binary the fast editor rendered the
 * native TIME control alone, so a fast's start or end could no longer move to
 * another day — "the fast began last night" and any 24 h+ fast were
 * unreachable. The day row (±1 day around the native date control) is back
 * over the time control; these pin it.
 */

const at = (y: number, m: number, d: number, h: number, min = 0): Date => new Date(y, m - 1, d, h, min, 0, 0);
const ANCHOR = at(2026, 8, 28, 12);
const HOUR = 60 * 60 * 1000;

type Screen = Awaited<ReturnType<typeof render>>;
async function tap(screen: Screen, testID: string) {
  fireEvent.press(screen.getByTestId(testID));
  await waitFor(() => {});
}

function sheet() {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const ui = <FastSheet visible mode="add" anchorEnd={ANCHOR} onSave={onSave} onClose={jest.fn()} />;
  return { onSave, ui };
}

describe('FastSheet on a binary with the native picker', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: at(2026, 10, 5, 9), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterAll(() => jest.useRealTimers());

  it('shows a day control AND a time control, not the time alone', async () => {
    const { ui } = sheet();
    const screen = await render(ui);
    expect(screen.getByTestId('fast-start-day-prev')).toBeTruthy();
    expect(screen.getByTestId('fast-start-day-next')).toBeTruthy();
    expect(screen.getByTestId('fast-start-date-native')).toBeTruthy();
    expect(screen.getByTestId('fast-start-native')).toBeTruthy();
    // The typed fields are the old binary's; they are not drawn here.
    expect(screen.queryByTestId('fast-start-hour')).toBeNull();
  });

  it('moves the start back a day without touching its time — a 40 h fast', async () => {
    const { onSave, ui } = sheet();
    const screen = await render(ui);
    await tap(screen, 'fast-start-day-prev');
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt, endedAt] = onSave.mock.calls[0];
    expect(startedAt.getDate()).toBe(26);
    expect(startedAt.getHours()).toBe(20);
    expect(endedAt.getTime() - startedAt.getTime()).toBe(40 * HOUR);
  });

  it('a picked date keeps the clock time the time control set', async () => {
    const { onSave, ui } = sheet();
    const screen = await render(ui);
    await act(async () => {
      screen.getByTestId('fast-start-date-native').props.onChange(at(2026, 8, 25, 3, 17));
    });
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt] = onSave.mock.calls[0];
    expect(startedAt.getDate()).toBe(25);
    expect(startedAt.getHours()).toBe(20);
    expect(startedAt.getMinutes()).toBe(0);
  });

  it('will not step a day into the future', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    // Ends "now" (9 AM Oct 5): a day later is tomorrow.
    const screen = await render(
      <FastSheet visible mode="add" anchorEnd={at(2026, 10, 5, 9)} onSave={onSave} onClose={jest.fn()} />,
    );
    await tap(screen, 'fast-end-row');
    const next = screen.getByTestId('fast-end-day-next');
    expect(next.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
});

describe('DayStepper on a binary with the native picker (re-score 3, A11y)', () => {
  it('the picker is labelled "Date, Today" on today, and plain "Date" on a past day', async () => {
    const s = await render(<DayStepper dateKey="2026-10-05" maxKey="2026-10-05" onChange={jest.fn()} testIDPrefix="w" />);
    expect(s.getByTestId('w-day').props.accessibilityLabel).toBe('Date, Today');
    await s.rerender(<DayStepper dateKey="2026-10-01" maxKey="2026-10-05" onChange={jest.fn()} testIDPrefix="w" />);
    expect(s.getByTestId('w-day').props.accessibilityLabel).toBe('Date');
  });
});
