jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (o: object) => mockConfirm(o),
  confirmNative: (o: object) => mockConfirm({ ...o, native: true }),
}));

import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { FastSheet } from '@/components/FastSheet';

/**
 * Audit 2026-10-15, FastSheet on binaries WITHOUT the native picker (the
 * typed path every OTA-only install still runs):
 *
 * - #12 the day-forward step and a typed time could push the end (or start)
 *   past now — a fast that "ended" tomorrow saved. Day-forward stops at today
 *   and a future instant is refused with the sheet's own "in the future" line.
 * - #13 a leading 0 ("07") in the 12-hour hour field was refused at the 0.
 * - #18 the discard confirm drawn over this native sheet is the system one.
 */
type Screen = Awaited<ReturnType<typeof render>>;
async function tap(screen: Screen, id: string) {
  fireEvent.press(screen.getByTestId(id));
  await waitFor(() => {});
}
async function type(screen: Screen, id: string, text: string) {
  fireEvent.changeText(screen.getByTestId(id), text);
  await waitFor(() => {});
}
function sheet(anchorEnd: Date) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  return { onSave, onClose, ui: <FastSheet visible mode="add" anchorEnd={anchorEnd} onSave={onSave} onClose={onClose} /> };
}

beforeEach(() => mockConfirm.mockReset());

it('will not step the end past today', async () => {
  const { ui } = sheet(new Date());
  const screen = await render(ui);
  await tap(screen, 'fast-end-row');
  expect(screen.getByTestId('fast-end-day-next').props.accessibilityState).toMatchObject({ disabled: true });
});

it('refuses an end typed into the future, and says why', async () => {
  // Anchor at 1:00 AM today, so "11 PM today" is certainly still ahead.
  const today1am = new Date();
  today1am.setHours(1, 0, 0, 0);
  const { onSave, ui } = sheet(today1am);
  const screen = await render(ui);
  await tap(screen, 'fast-end-row');
  await type(screen, 'fast-end-hour', '11');
  await tap(screen, 'fast-end-pm');
  if (new Date().getHours() >= 23) return; // the one hour this cannot be ahead
  expect(screen.getByTestId('fast-warning')).toHaveTextContent("That's in the future.");
  await tap(screen, 'fast-save');
  expect(onSave).not.toHaveBeenCalled();
});

it('accepts a leading 0 in the 12-hour hour field', async () => {
  const anchor = new Date(2026, 7, 28, 12);
  const { onSave, ui } = sheet(anchor);
  const screen = await render(ui);
  await type(screen, 'fast-start-hour', '0');
  // A refused keystroke reverts a tick later (SheetTextInput), so wait past it.
  await new Promise((r) => setTimeout(r, 50));
  await waitFor(() => {});
  expect(screen.getByTestId('fast-start-hour').props.value).toBe('0');
  await type(screen, 'fast-start-hour', '07');
  await tap(screen, 'fast-start-am');
  await tap(screen, 'fast-save');
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0].getHours()).toBe(7);
});

it('asks to discard through the system dialog, not a sheet on the sheet', async () => {
  const { ui } = sheet(new Date(2026, 7, 28, 12));
  const screen = await render(ui);
  await tap(screen, 'fast-start-day-prev');
  fireEvent.press(screen.getByTestId('fast-backdrop'));
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ native: true })));
});
