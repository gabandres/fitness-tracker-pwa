/**
 * The "Update required" screen and its root gate. Non-dismissible by design:
 * the one control is the store listing, and the app beneath is untouchable and
 * hidden from screen readers.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

let mockRequired = false;
jest.mock('@/lib/update-required', () => ({ useUpdateRequired: () => mockRequired }));
const mockOpenStore = jest.fn(async () => undefined);
jest.mock('@/lib/app-update', () => ({
  ...jest.requireActual('@/lib/app-update'),
  openStoreListing: () => mockOpenStore(),
}));

import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { UpdateRequiredGate, UpdateRequiredScreen } from '@/components/UpdateRequiredScreen';
import { isGateableRuntime } from '@/lib/app-update';
import { palettes } from '@/theme';

const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

describe('UpdateRequiredScreen', () => {
  beforeEach(() => mockOpenStore.mockClear());

  it('says what happened, keeps the data promise, and offers exactly one action', async () => {
    const view = await render(<UpdateRequiredScreen />);
    expect(view.getByRole('header').props.children).toBe('Update required');
    expect(view.getByText(/no longer supported/)).toBeTruthy();
    expect(view.getByText(/saved to your account/)).toBeTruthy();
    // No dismiss, no close, no back: one button, and it goes to the store.
    expect(view.getAllByRole('button')).toHaveLength(1);
    const button = view.getByTestId('update-required-open-store');
    expect(button.props.accessibilityLabel).toBe('Update Ignia in App Store');
    fireEvent.press(button);
    expect(mockOpenStore).toHaveBeenCalledTimes(1);
  });

  it('puts onFill text on the accent fill, never a hard-coded white', async () => {
    const view = await render(<UpdateRequiredScreen />);
    const label = view.getByText('Update');
    // The test ThemeProvider resolves to light; onFill is the token, whatever it is.
    expect(flat(label.props.style).color).toBe(palettes.light.colors.onFill);
    expect(flat(view.getByTestId('update-required-open-store').props.style).backgroundColor).toBe(palettes.light.colors.accent);
    expect(view.getByTestId('update-required').props.accessibilityViewIsModal).toBe(true);
  });
});

describe('UpdateRequiredGate', () => {
  it('renders the app untouched when no update is required', async () => {
    mockRequired = false;
    const view = await render(<UpdateRequiredGate><Text>the app</Text></UpdateRequiredGate>);
    expect(view.getByText('the app')).toBeTruthy();
    expect(view.queryByTestId('update-required')).toBeNull();
  });

  it('covers the app, blocks its touches and hides it from screen readers when required', async () => {
    mockRequired = true;
    const view = await render(<UpdateRequiredGate><Text>the app</Text></UpdateRequiredGate>);
    expect(view.getByTestId('update-required')).toBeTruthy();
    // Hidden from the a11y tree, so query including hidden elements.
    const app = view.getByText('the app', { includeHiddenElements: true });
    let wrapper = app.parent;
    while (wrapper && wrapper.props.pointerEvents === undefined) wrapper = wrapper.parent;
    expect(wrapper!.props.pointerEvents).toBe('none');
    expect(wrapper!.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wrapper!.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('isGateableRuntime', () => {
  it('is false in dev (jest runs with __DEV__), so a dev client is never gated', () => {
    expect(isGateableRuntime()).toBe(false);
  });
});
