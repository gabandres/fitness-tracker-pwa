import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import type { Profile } from '@macrolog/core';

/**
 * The onboarding funnel markers (`@macrolog/core/usage-events`, 2026-08-31).
 *
 * The first fortnight of counters showed 6 signups and 3 `onboarding_complete`
 * with nothing able to say WHERE the other half stopped. Three step events
 * carve the run; what is pinned here is the emission discipline the numbers
 * depend on, which no rules test can see:
 *
 *   - each marker fires ONCE per run, or Back/forward inflates a step and the
 *     "drop" between two steps can go negative;
 *   - a redo via Settings -> Edit goals fires NOTHING, or every goal edit
 *     re-enters the funnel and the drop rates dilute toward zero.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockTrack = jest.fn();

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
}));

jest.mock('@/lib/analytics', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import Onboarding from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
  mockSave.mockClear();
  mockTrack.mockClear();
});

function firedEvents(): string[] {
  return mockTrack.mock.calls.map((c) => c[0] as string);
}

type Screen = Awaited<ReturnType<typeof render>>;

/** welcome -> goal -> weight -> goalWeight, stopping on the body step. */
async function walkToBody(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-next')); // welcome
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
  await fireEvent.press(getByTestId('onboarding-next'));
}

describe('onboarding funnel markers', () => {
  it('fires start on mount, then each step marker on first arrival', async () => {
    const screen = await render(<Onboarding />);
    expect(firedEvents()).toEqual(['onboarding_start']);

    await walkToBody(screen);
    expect(firedEvents()).toEqual(['onboarding_start', 'onboarding_step_body']);

    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    expect(firedEvents()).toEqual([
      'onboarding_start',
      'onboarding_step_body',
      'onboarding_step_plan',
    ]);
  });

  it('does not double-count a step revisited via Back', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-back')); // -> goalWeight
    await fireEvent.press(screen.getByTestId('onboarding-next')); // -> body again
    expect(
      firedEvents().filter((e) => e === 'onboarding_step_body'),
    ).toHaveLength(1);
  });

  it('completing the run still fires onboarding_complete exactly once', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(
      firedEvents().filter((e) => e === 'onboarding_complete'),
    ).toHaveLength(1);
  });

  it('a redo from Settings fires no funnel event at all', async () => {
    mockProfile = {
      profileCompleted: true,
      goalDirection: 'lose',
      sex: 'female',
      heightIn: 64,
      age: 45,
      activityLevel: 'light',
    } as Partial<Profile>;
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-next')); // goal (redo start)
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '165');
    await fireEvent.press(screen.getByTestId('onboarding-next')); // -> body
    await fireEvent.press(screen.getByTestId('onboarding-next')); // -> activity, prefilled
    await fireEvent.press(screen.getByTestId('onboarding-next')); // -> plan
    // `onboarding_complete` on save is also redo-guarded, pre-existing.
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
