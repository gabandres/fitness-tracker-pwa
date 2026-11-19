import { renderWithProviders as render } from '@/test-utils';
import React from 'react';
import { StyleSheet } from 'react-native';
import { TARGET } from '@/theme';

/**
 * First-run standards fixes (OTA-1 sweep) outside sign-in and onboarding:
 * the loader is a labelled progress element, the tour's dots are one labelled
 * progress element with visible inactive dots, and its Skip is a full target.
 */

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/tour',() => ({ markTourSeen: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

import { BrandLoader } from '@/components/BrandLoader';
import Tour from '@/app/tour';

it('BrandLoader is a progress element named "Loading"', async () => {
  const screen = await render(<BrandLoader />);
  const loader = screen.getByTestId('brand-loader');
  expect(loader.props.accessibilityRole).toBe('progressbar');
  expect(loader.props.accessible).toBe(true);
  expect(loader.props.accessibilityLabel).toBeTruthy();
});

it('the tour dots are one labelled progress element, Skip a full target', async () => {
  const screen = await render(<Tour />);
  const dots = screen.getByTestId('tour-dots');
  expect(dots.props.accessible).toBe(true);
  expect(dots.props.accessibilityRole).toBe('progressbar');
  expect(dots.props.accessibilityLabel).toMatch(/^Step 1 of \d+$/);
  expect(StyleSheet.flatten(screen.getByTestId('tour-skip').props.style).minHeight).toBe(TARGET);
});
