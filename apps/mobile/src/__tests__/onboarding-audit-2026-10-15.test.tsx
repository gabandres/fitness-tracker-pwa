import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';
import { BackHandler } from 'react-native';
import type { Profile } from '@macrolog/core';

/**
 * Onboarding audit fixes, 2026-10-15.
 *
 *  #3/#4 A first run's `isRedo` was DERIVED from the live profile. The save
 *        flips `profileCompleted`, so if the age stamp after it failed the
 *        screen turned into a redo mid-flow: the stamp was never retried,
 *        `onboarding_complete` never fired, reminders and first-log were
 *        skipped, and the sign-out control became the redo's Cancel X. The
 *        first-run/redo split is now latched when the screen mounts.
 *  #6    The plan numbers announced only their label ("Calories"), not the
 *        number a sighted user reads.
 *  #7    Inches above 11 were accepted (5 ft 14 in = 74 in).
 *  8b    Android hardware back quit the app from the middle of the wizard.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn();
const mockTrack = jest.fn();
const mockReplace = jest.fn();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    get profile() {
      return mockProfile;
    },
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/ledger', () => ({
  saveOnboardingV2: (...args: unknown[]) => mockSave(...args),
  getLatestDailyWeight: jest.fn().mockResolvedValue(null),
  getRecentLogs: async () => [],
  getAllDailyWeights: async () => ({}),
  setUnitSystem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
const mockUpdateDoc = jest.fn();
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...(a as [])),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

import Onboarding, { parseHeightInput } from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
  mockSave.mockReset().mockImplementation(async () => {
    // The real save flips the live profile — the listener delivers it.
    mockProfile = { ...mockProfile, profileCompleted: true };
  });
  mockTrack.mockClear();
  mockReplace.mockClear();
  mockUpdateDoc.mockReset().mockResolvedValue(undefined);
});

type Screen = Awaited<ReturnType<typeof render>>;

async function walkToPlan(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-age-attest'));
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-skip-body'));
}

describe('first run stays a first run after the save (#3, #4)', () => {
  it('a failed age stamp keeps the first-run UI and is retried on the next tap', async () => {
    mockUpdateDoc.mockRejectedValueOnce({ code: 'unavailable' });
    const screen = await render(<Onboarding />);
    await walkToPlan(screen);

    await fireEvent.press(screen.getByTestId('onboarding-save'));
    await waitFor(() => expect(screen.getByText('Could not save. Check your connection and try again.')).toBeTruthy());
    // The profile now reads completed — the screen must not become a redo.
    expect(screen.queryByTestId('onboarding-cancel')).toBeNull();
    expect(screen.getByTestId('onboarding-signout')).toBeTruthy();
    expect(mockTrack.mock.calls.map((c) => c[0])).not.toContain('onboarding_complete');

    await fireEvent.press(screen.getByTestId('onboarding-save'));
    await waitFor(() => expect(screen.getByTestId('onboarding-reminders')).toBeTruthy());
    expect(mockUpdateDoc).toHaveBeenCalledTimes(2);
    expect(mockUpdateDoc.mock.calls[1][1]).toEqual({ ageConfirmedAt: { __serverTimestamp: true } });
    expect(mockTrack.mock.calls.filter((c) => c[0] === 'onboarding_complete')).toHaveLength(1);
    expect(mockReplace).not.toHaveBeenCalledWith('/settings');
  });

  it('a successful first run reaches reminders without a redo Cancel X', async () => {
    const screen = await render(<Onboarding />);
    await walkToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    await waitFor(() => expect(screen.getByTestId('onboarding-reminders')).toBeTruthy());
    expect(screen.queryByTestId('onboarding-cancel')).toBeNull();
  });
});

it('the plan numbers announce their value, not just their label (#6)', async () => {
  const screen = await render(<Onboarding />);
  await walkToPlan(screen);
  const kcal = screen.getByTestId('onboarding-kcal');
  expect(kcal.props.accessibilityLabel).toMatch(/Calories/i);
  expect(kcal.props.accessibilityLabel).toMatch(/\d/);
  expect(screen.getByTestId('onboarding-protein').props.accessibilityLabel).toMatch(/\d+ g/);
});

describe('inches above 11 (#7)', () => {
  it('parseHeightInput refuses them', () => {
    expect(parseHeightInput('us', { cm: '', feet: '5', inches: '14' })).toBeNull();
    expect(parseHeightInput('us', { cm: '', feet: '5', inches: '12' })).toBeNull();
    expect(parseHeightInput('us', { cm: '', feet: '5', inches: '11' })).toBe(71);
  });
});

describe('Android hardware back (8b)', () => {
  let handlers: (() => boolean)[];
  let spy: jest.SpyInstance;
  beforeEach(() => {
    handlers = [];
    spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h as () => boolean);
      return { remove: () => handlers.splice(handlers.indexOf(h as () => boolean), 1) } as never;
    });
  });
  afterEach(() => spy.mockRestore());
  const back = () => handlers[handlers.length - 1]();

  it('steps back instead of leaving the app', async () => {
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-age-attest'));
    await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-weight')).toBeTruthy();

    let handled: boolean | undefined;
    await act(async () => {
      handled = back();
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId('onboarding-weight')).toBeNull();
    expect(screen.getByTestId('onboarding-goal-lose')).toBeTruthy();
  });

  it('lets back through on the first step of a first run', async () => {
    await render(<Onboarding />);
    let handled: boolean | undefined;
    await act(async () => {
      handled = back();
    });
    expect(handled).toBe(false);
  });

  it('returns a redo to Settings from its first step', async () => {
    mockProfile = { profileCompleted: true, goalDirection: 'lose' };
    await render(<Onboarding />);
    let handled: boolean | undefined;
    await act(async () => {
      handled = back();
    });
    expect(handled).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/settings');
  });
});
