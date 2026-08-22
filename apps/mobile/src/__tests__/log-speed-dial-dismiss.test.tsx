import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * The speed dial is rendered by the TAB LAYOUT, so it outlives every screen
 * under it and nothing dismisses it implicitly. A user (UX_AUDIT, Abdiel
 * Medina, 2026-08-21) found it fanned open over the photo-scan result with the
 * scrim covering "Add today", and two distinct defects were reproduced on an
 * LG VS988:
 *
 *   1. the label pill was a plain `View`, so it became the touch target and
 *      swallowed its own tap — tapping the words "Scan meal" did nothing while
 *      the same tap on the circle worked;
 *   2. hardware back navigated out from under the open dial instead of
 *      dismissing it.
 *
 * Both are pinned here. Neither is visible to `tsc` or to the Maestro suite —
 * `06-scan-intro` was GREEN while its only capture was the scan screen greyed
 * out under this dial's scrim, because `assertVisible` passes on a screen
 * mounted underneath an overlay.
 */

const mockNavigate = jest.fn();
let mockPathname = '/';

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  usePathname: () => mockPathname,
}));

// `I18nProvider` reads the locale off the profile, which drags in Firebase Auth
// and its ESM-only `@firebase/util` postinstall shim. The dictionary stays real
// (test-utils explains why) — only the profile behind it is stubbed.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

import { LogSpeedDial } from '@/components/LogSpeedDial';

beforeEach(() => {
  mockNavigate.mockClear();
  mockPathname = '/';
});

describe('LogSpeedDial — dismissal', () => {
  it('acts on a tap that lands on the label pill, not only on the circle', async () => {
    const { getByTestId, getByText } = await render(<LogSpeedDial />);
    await fireEvent.press(getByTestId('log-button'));

    // The pill and the circle are one Pressable now, so the label's own text
    // node reaches the same handler. `getByText` finds the pill; pressing it
    // bubbles to the satellite.
    await fireEvent.press(getByText('Scan meal'));

    expect(mockNavigate).toHaveBeenCalledWith('/scan');
  });

  it('closes when the route changes under it', async () => {
    const { getByTestId, rerender } = await render(<LogSpeedDial />);
    await fireEvent.press(getByTestId('log-button'));
    expect(getByTestId('log-button').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: true }),
    );

    // A deep link, a tab press, hardware back — anything that moves the app
    // while the dial is open. `choose()` does not run for any of them.
    mockPathname = '/scan';
    await rerender(<LogSpeedDial />);

    expect(getByTestId('log-button').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: false }),
    );
  });

  it('takes hardware back while open, and lets it through while closed', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: jest.fn() } as never;
      });

    const { getByTestId } = await render(<LogSpeedDial />);
    // Closed: nothing registered, so back navigates as usual.
    expect(handlers).toHaveLength(0);

    await fireEvent.press(getByTestId('log-button'));
    expect(handlers).toHaveLength(1);
    // `true` = handled; the navigation that used to run underneath does not.
    let handled: boolean | undefined;
    await act(async () => {
      handled = handlers[0]();
    });
    expect(handled).toBe(true);
    expect(getByTestId('log-button').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: false }),
    );

    spy.mockRestore();
  });
});
