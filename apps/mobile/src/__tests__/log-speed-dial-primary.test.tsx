import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * The + is one tap to the sheet, and the dial is a long-press away
 * (UX_AUDIT S18-18).
 *
 * Until 2026-09-28 a tap fanned the dial open and the food search — the most
 * frequent action in the app — was the second tap. Today's empty state has
 * said "Tap + to log your first meal" the whole time, so this is also the
 * test that makes that sentence true. The gesture split is invisible to
 * `tsc`: both handlers type-check whichever way round they are wired.
 */

const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  usePathname: () => '/',
}));

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

import { LogSpeedDial } from '@/components/LogSpeedDial';

const expanded = (el: { props: { accessibilityState?: { expanded?: boolean } } }) =>
  el.props.accessibilityState?.expanded;

beforeEach(() => mockNavigate.mockClear());

describe('LogSpeedDial — tap vs long-press', () => {
  it('a single tap opens the food search on Today and leaves the dial closed', async () => {
    const { getByTestId } = await render(<LogSpeedDial />);
    await fireEvent.press(getByTestId('log-button'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(app)',
      params: { openAdd: expect.any(String) },
    });
    expect(expanded(getByTestId('log-button'))).toBe(false);
  });

  it('a long-press fans the dial open without navigating', async () => {
    const { getByTestId } = await render(<LogSpeedDial />);
    await fireEvent(getByTestId('log-button'), 'longPress');

    expect(expanded(getByTestId('log-button'))).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('a tap while the dial is open closes it instead of opening the sheet', async () => {
    const { getByTestId } = await render(<LogSpeedDial />);
    await fireEvent(getByTestId('log-button'), 'longPress');
    await fireEvent.press(getByTestId('log-button'));

    expect(expanded(getByTestId('log-button'))).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('the dial still carries Scan and Search as satellites', async () => {
    const { getByTestId } = await render(<LogSpeedDial />);
    await fireEvent(getByTestId('log-button'), 'longPress');
    await fireEvent.press(getByTestId('log-scan'));
    expect(mockNavigate).toHaveBeenCalledWith('/scan');

    await fireEvent(getByTestId('log-button'), 'longPress');
    await fireEvent.press(getByTestId('log-manual'));
    expect(mockNavigate).toHaveBeenLastCalledWith({
      pathname: '/(app)',
      params: { openAdd: expect.any(String) },
    });
  });

  it('tells a screen-reader user about the long-press, and offers it as an action', async () => {
    const { getByTestId } = await render(<LogSpeedDial />);
    const button = getByTestId('log-button');

    expect(button.props.accessibilityHint).toMatch(/long-press/i);
    expect(button.props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'longpress' })]),
    );

    // The action is the timed gesture's equal: it opens the dial too.
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(expanded(getByTestId('log-button'))).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('the Search satellite shows a magnifier, not a pencil (S18-17)', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'LogSpeedDial.tsx'), 'utf8');
    expect(src).toMatch(/name="search-outline"/);
    expect(src).not.toMatch(/name="create-outline"/);
  });

  it("Today's empty-state hint promises exactly what the tap does", () => {
    const { en } = require('@/i18n/en') as { en: Record<string, string> };
    expect(en['today.emptyHint']).toMatch(/^Tap \+ to log/);
  });
});
