import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';

/**
 * The last step of onboarding must never present a live-looking CTA that does
 * nothing, and must never blame the user's email for a number it accepted.
 *
 * Two HIGH findings from the 2026-09-22 code review, both on the plan step:
 *
 *  - Clearing the protein field set `protein` to null. `canAdvance` checked
 *    only the calorie number, so the CTA stayed fully enabled over an
 *    `onFinish` whose first line was `if (... protein == null) return` — a
 *    silent no-op the user could tap forever.
 *  - Typing a protein target of 1000 or more was accepted by the client and
 *    rejected by `firestore.rules`. `onFinish` maps permission-denied to
 *    "verify your email first", so a verified user on the final step was sent
 *    to check their inbox with no way forward.
 *
 * A rejected calorie number had the matching cosmetic bug: only `belowFloor`
 * rendered a message, so an above-ceiling or cleared value greyed the CTA with
 * nothing on screen to say why.
 */

const mockSave = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    profile: { profileCompleted: false },
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/ledger', () => ({ saveOnboardingV2: (...a: unknown[]) => mockSave(...a) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import Onboarding from '@/app/onboarding';

type Screen = Awaited<ReturnType<typeof render>>;

/** welcome -> goal -> weight -> goalWeight -> body, skipped -> plan. */
async function walkToPlan(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-skip-body'));
}

/** Open the protein editor and type into it. */
async function typeProtein(screen: Screen, value: string) {
  await fireEvent.press(screen.getByTestId('onboarding-protein'));
  await fireEvent.changeText(screen.getByTestId('onboarding-protein-input'), value);
}

beforeEach(() => mockSave.mockClear());

it('refuses to save a cleared protein field, and says so', async () => {
  const screen = await render(<Onboarding />);
  await walkToPlan(screen);
  await typeProtein(screen, '');

  expect(screen.getByTestId('onboarding-protein-error')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('onboarding-save'));
  expect(mockSave).not.toHaveBeenCalled();
});

it('refuses a protein target the rules would reject, instead of blaming the email', async () => {
  const screen = await render(<Onboarding />);
  await walkToPlan(screen);
  await typeProtein(screen, '1200');

  expect(screen.getByTestId('onboarding-protein-error')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('onboarding-save'));
  expect(mockSave).not.toHaveBeenCalled();
});

it('still saves a protein target inside the band', async () => {
  const screen = await render(<Onboarding />);
  await walkToPlan(screen);
  await typeProtein(screen, '160');

  expect(screen.queryByTestId('onboarding-protein-error')).toBeNull();
  await fireEvent.press(screen.getByTestId('onboarding-save'));
  expect(mockSave).toHaveBeenCalledWith(
    'u1',
    expect.objectContaining({ manualProteinTarget: 160, targetMode: 'custom' }),
  );
});

it('explains a rejected calorie number rather than only greying the button', async () => {
  const screen = await render(<Onboarding />);
  await walkToPlan(screen);
  await fireEvent.press(screen.getByTestId('onboarding-kcal'));
  await fireEvent.changeText(screen.getByTestId('onboarding-kcal-input'), '7000');

  expect(screen.getByTestId('onboarding-kcal-error')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('onboarding-save'));
  expect(mockSave).not.toHaveBeenCalled();
});
