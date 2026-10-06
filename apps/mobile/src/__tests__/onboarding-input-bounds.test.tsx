import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import type { Profile } from '@macrolog/core';

/**
 * UX_AUDIT S18-8 / S18-9 / S18-11 — the three input gates onboarding lacked.
 *
 * - The 16+ attestation on the goal step (S18-9; on a welcome step of its own until 2026-10-06): the CTA is disabled until
 *   it is checked, and `ageConfirmedAt` is written after the save — after,
 *   because `isValidProfileInitial` in `firestore.rules` does not list the
 *   field and the save is what flips the profile to the Completed branch.
 * - Metric height (S18-8): one `cm` field on a metric profile, converted to
 *   whole inches with core's `parseMeasureToIn`; the out-of-band message
 *   quotes the band in the user's own unit.
 * - Weight bounds (S18-11): `canAdvance` used to be `weightLbs != null`, so
 *   "1800" built a plan and died at the rules two steps later.
 *
 * The pure halves are pinned directly off the route file's named exports;
 * the wiring is pinned through the rendered wizard, same as the sibling
 * onboarding suites.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockSignOut = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    get profile() {
      return mockProfile;
    },
    signOut: mockSignOut,
  }),
}));
jest.mock('@/lib/ledger', () => ({ saveOnboardingV2: (...a: unknown[]) => mockSave(...a) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...(a as [])),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import Onboarding, {
  ageGateOpen,
  heightBandFor,
  parseHeightInput,
  weightInBand,
} from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
  mockSave.mockClear();
  mockUpdateDoc.mockClear();
  mockSignOut.mockClear();
});

type Screen = Awaited<ReturnType<typeof render>>;

/** attest → goal (lose) → weight, stopping ON the weight step. */
async function walkToWeight(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-age-attest'));
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
}

/** …and on through goal weight to the body step. */
async function walkToBody(screen: Screen, weight: string, target: string) {
  const { getByTestId } = screen;
  await walkToWeight(screen);
  await fireEvent.changeText(getByTestId('onboarding-weight'), weight);
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), target);
  await fireEvent.press(getByTestId('onboarding-next'));
}

describe('pure gates', () => {
  it('ageGateOpen: a first run needs the attestation, a redo never sees it', () => {
    expect(ageGateOpen(false, false)).toBe(false);
    expect(ageGateOpen(false, true)).toBe(true);
    expect(ageGateOpen(true, false)).toBe(true);
  });

  it('parseHeightInput: metric cm → whole inches; US ft/in unchanged; 0 in is legal', () => {
    expect(parseHeightInput('metric', { cm: '175', feet: '', inches: '' })).toBe(69);
    expect(parseHeightInput('metric', { cm: '175,5', feet: '', inches: '' })).toBe(69);
    expect(parseHeightInput('metric', { cm: '', feet: '5', inches: '9' })).toBeNull();
    expect(parseHeightInput('metric', { cm: 'abc', feet: '', inches: '' })).toBeNull();
    expect(parseHeightInput('us', { cm: '175', feet: '5', inches: '9' })).toBe(69);
    expect(parseHeightInput('us', { cm: '', feet: '6', inches: '0' })).toBe(72);
    expect(parseHeightInput('us', { cm: '', feet: '5', inches: '' })).toBeNull();
  });

  it('heightBandFor: quotes HEIGHT_IN_MIN..MAX in the user\'s unit', () => {
    expect(heightBandFor('metric', { ft: 'ft', in: 'in' })).toEqual({ min: '102 cm', max: '243 cm' });
    expect(heightBandFor('us', { ft: 'ft', in: 'in' })).toEqual({ min: '3 ft 4 in', max: '8 ft 0 in' });
  });

  it('weightInBand: WEIGHT_MIN_LB..MAX_LB inclusive, null-safe', () => {
    expect(weightInBand(null)).toBe(false);
    expect(weightInBand(undefined)).toBe(false);
    expect(weightInBand(49.9)).toBe(false);
    expect(weightInBand(50)).toBe(true);
    expect(weightInBand(180)).toBe(true);
    expect(weightInBand(500)).toBe(true);
    expect(weightInBand(1800)).toBe(false);
  });
});

describe('the 16+ attestation (S18-9)', () => {
  it('is a checkbox on the goal step that gates Continue, even with a goal picked', async () => {
    const screen = await render(<Onboarding />);
    // The first step IS the goal step — no separate welcome greeting.
    expect(screen.getByTestId('onboarding-goal-lose')).toBeTruthy();
    const box = screen.getByTestId('onboarding-age-attest');
    expect(box.props.accessibilityRole).toBe('checkbox');
    expect(box.props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('onboarding-age-attest-hint')).toBeTruthy();

    // A goal but no attestation: Continue does nothing, we stay on goal.
    await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.queryByTestId('onboarding-weight')).toBeNull();
    expect(screen.getByTestId('onboarding-goal-lose')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('onboarding-age-attest'));
    expect(screen.getByTestId('onboarding-age-attest').props.accessibilityState).toEqual({ checked: true });
    expect(screen.queryByTestId('onboarding-age-attest-hint')).toBeNull();
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-weight')).toBeTruthy();
  });

  it('writes ageConfirmedAt AFTER the onboarding save, as a server timestamp', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen, '180', '165');
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, patch] = mockUpdateDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1');
    expect(patch).toEqual({ ageConfirmedAt: { __serverTimestamp: true } });
    // Order: the save flips the profile to Completed; only then does the
    // rules' Completed branch accept the field.
    expect(mockSave.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateDoc.mock.invocationCallOrder[0]);
  });

  it('is never asked on a redo and nothing is stamped', async () => {
    mockProfile = { profileCompleted: true, goalDirection: 'lose', unitSystem: 'us' } as Partial<Profile>;
    const screen = await render(<Onboarding />);
    expect(screen.queryByTestId('onboarding-age-attest')).toBeNull();
    await fireEvent.press(screen.getByTestId('onboarding-next')); // goal, prefilled
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '165');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('sign-out from the top-right slot asks first (S18-6)', async () => {
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-signout'));
    // The sheet is up and nothing has happened yet.
    expect(mockSignOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('weight bounds (S18-11)', () => {
  it('will not advance past 1800 lb, and says the band in lb', async () => {
    const screen = await render(<Onboarding />);
    await walkToWeight(screen);
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '1800');
    expect(screen.getByTestId('onboarding-weight-error').props.children).toBe(
      'Enter a weight between 50 and 500 lb',
    );
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.queryByTestId('onboarding-target-weight')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    expect(screen.queryByTestId('onboarding-weight-error')).toBeNull();
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-target-weight')).toBeTruthy();
  });

  it('quotes the band in kg on a metric profile', async () => {
    mockProfile = { profileCompleted: false, unitSystem: 'metric' } as Partial<Profile>;
    const screen = await render(<Onboarding />);
    await walkToWeight(screen);
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '800');
    expect(screen.getByTestId('onboarding-weight-error').props.children).toBe(
      'Enter a weight between 23 and 226 kg',
    );
  });

  it('gates the goal-weight step the same way', async () => {
    const screen = await render(<Onboarding />);
    await walkToWeight(screen);
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '12');
    expect(screen.getByTestId('onboarding-target-weight-error')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.queryByTestId('onboarding-sex-female')).toBeNull();
  });
});

describe('metric height (S18-8)', () => {
  beforeEach(() => {
    mockProfile = { profileCompleted: false, unitSystem: 'metric' } as Partial<Profile>;
  });

  it('shows one cm field instead of ft/in, and saves whole inches', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen, '82', '75');
    expect(screen.queryByTestId('onboarding-feet')).toBeNull();
    const cm = screen.getByTestId('onboarding-height-cm');
    expect(cm.props.accessibilityLabel).toBe('Height (cm)');

    await fireEvent.press(screen.getByTestId('onboarding-sex-female'));
    await fireEvent.changeText(cm, '175');
    await fireEvent.changeText(screen.getByTestId('onboarding-age'), '30');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-activity-light'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));

    expect(mockSave.mock.calls[0][1].heightIn).toBe(69);
  });

  it('rejects an out-of-band cm value with the band in cm, and does not advance', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen, '82', '75');
    await fireEvent.press(screen.getByTestId('onboarding-sex-female'));
    await fireEvent.changeText(screen.getByTestId('onboarding-height-cm'), '17');
    await fireEvent.changeText(screen.getByTestId('onboarding-age'), '30');
    const err = screen.getByTestId('onboarding-height-error');
    expect(err.props.children).toBe('Enter a height between 102 cm and 243 cm');
    expect(err.props.accessibilityRole).toBe('alert');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.queryByTestId('onboarding-activity-light')).toBeNull();
  });

  it('prefills the cm field from a stored heightIn on a redo', async () => {
    mockProfile = {
      profileCompleted: true,
      unitSystem: 'metric',
      goalDirection: 'lose',
      sex: 'female',
      heightIn: 64,
      age: 45,
      activityLevel: 'light',
    } as Partial<Profile>;
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '82');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '75');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    // 64 in × 2.54 = 162.56 → 163
    expect(screen.getByTestId('onboarding-height-cm').props.value).toBe('163');
  });
});

describe('US height band (S18-8, the other half)', () => {
  it('says the band in feet and inches, not bare inch counts', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen, '180', '165');
    await fireEvent.changeText(screen.getByTestId('onboarding-feet'), '2');
    await fireEvent.changeText(screen.getByTestId('onboarding-inches'), '0');
    expect(screen.getByTestId('onboarding-height-error').props.children).toBe(
      'Enter a height between 3 ft 4 in and 8 ft 0 in',
    );
  });
});
