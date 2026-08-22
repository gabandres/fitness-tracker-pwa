import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import type { Profile } from '@macrolog/core';

/**
 * UX_AUDIT F1/F2 — the sex-blind calorie seed.
 *
 * Onboarding used to hand every user `weight x {11|14|17}`. For a 180 lb
 * 45-year-old woman that put "lose fat" at 1,980 kcal, which is 2 kcal ABOVE
 * her own estimated maintenance: follow it exactly, lose nothing, ever. The
 * fix asks the four Mifflin-St Jeor questions during onboarding instead of
 * only in Settings -> Refine targets, where a new user never goes.
 *
 * The arithmetic itself is pinned in
 * `packages/core/src/onboarding-seed.test.ts`. What is pinned HERE is the
 * wiring the arithmetic depends on and that no unit test can see: that the
 * answers reach the save, that skipping writes NONE of them rather than half,
 * and that the screen says which of the two bases produced the number.
 *
 * NB: RNTL renders the element tree and never runs a Yoga layout pass
 * (`jest.config.js`), so nothing below is evidence about how these two steps
 * LOOK on a 360x720dp screen. That is a device check, not a suite one.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
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
}));

jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

import Onboarding from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
  mockSave.mockClear();
  mockReplace.mockClear();
});

type Screen = Awaited<ReturnType<typeof render>>;

/** welcome -> goal -> weight -> goalWeight, stopping on the body step. */
async function walkToBody(screen: Screen, weightLb = '180') {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-next')); // welcome
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), weightLb);
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
  await fireEvent.press(getByTestId('onboarding-next'));
}

/** The body + activity answers for the woman in the F1 table. */
async function answerBody(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-sex-female'));
  await fireEvent.changeText(getByTestId('onboarding-feet'), '5');
  await fireEvent.changeText(getByTestId('onboarding-inches'), '4');
  await fireEvent.changeText(getByTestId('onboarding-age'), '45');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-activity-light'));
  await fireEvent.press(getByTestId('onboarding-next'));
}

describe('onboarding asks the four Mifflin-St Jeor questions', () => {
  it('reaches the body step after goal weight, not the plan', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    expect(screen.getByTestId('onboarding-sex-female')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-preview')).toBeNull();
  });

  it('will not advance past the body step on a partial answer', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-sex-female'));
    await fireEvent.changeText(screen.getByTestId('onboarding-feet'), '5');
    // Age still empty: a half-filled set is not writable (firestore.rules
    // validates the five fields as a group), so it must not be advanceable.
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-sex-female')).toBeTruthy();
  });

  it('rejects an out-of-band age rather than storing it', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-sex-female'));
    await fireEvent.changeText(screen.getByTestId('onboarding-feet'), '5');
    await fireEvent.changeText(screen.getByTestId('onboarding-inches'), '4');
    await fireEvent.changeText(screen.getByTestId('onboarding-age'), '9');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-sex-female')).toBeTruthy();
  });

  it('saves the answers AND a target built from them, not from weight alone', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await answerBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-save'));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const payload = mockSave.mock.calls[0][1];
    expect(payload).toMatchObject({
      sex: 'female',
      heightIn: 64,
      age: 45,
      activityLevel: 'light',
      targetPaceLbsPerWeek: 1,
      targetMode: 'auto',
    });
    // The number this whole finding is about. 180 x 11 = 1,980 was her own
    // maintenance; a real 500 kcal deficit lands under the 1,500 floor, so
    // she is held at the floor and told so.
    expect(payload.manualCaloriesTarget).toBe(1500);
    expect(payload.manualCaloriesTarget).toBeLessThan(1980);
  });

  it('names the basis and the estimated maintenance on the plan step', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await answerBody(screen);
    // 5'4", 45, female, 180 lb, light -> 1,989 kcal maintenance, against the
    // 1,980 the old heuristic called her "lose fat" target.
    expect(screen.getByTestId('onboarding-plan-basis').props.children).toContain('1,989');
    expect(screen.getByTestId('onboarding-plan-floor')).toBeTruthy();
  });

  it('gives a man of the same weight and age a different number', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-sex-male'));
    await fireEvent.changeText(screen.getByTestId('onboarding-feet'), '5');
    await fireEvent.changeText(screen.getByTestId('onboarding-inches'), '4');
    await fireEvent.changeText(screen.getByTestId('onboarding-age'), '45');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-activity-light'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));

    // Same inputs but for sex: +166 kcal of basal, x1.375. The old heuristic
    // gave these two people the identical 1,980.
    expect(mockSave.mock.calls[0][1].manualCaloriesTarget).toBe(1720);
  });
});

describe('the body step is skippable, and says what that costs', () => {
  it('jumps straight to the plan and writes NONE of the five fields', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    expect(screen.getByTestId('onboarding-preview')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('onboarding-save'));
    const payload = mockSave.mock.calls[0][1];
    for (const key of ['sex', 'heightIn', 'age', 'activityLevel']) {
      expect(payload[key]).toBeUndefined();
    }
    // Falls back to the old heuristic, unchanged: 180 x 11.
    expect(payload.manualCaloriesTarget).toBe(1980);
  });

  it('says the number is the rough one rather than staying quiet', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    expect(screen.getByTestId('onboarding-plan-basis').props.children).toContain('rough estimate');
  });

  it('un-skips on Back, landing on the body step rather than the activity one', async () => {
    const screen = await render(<Onboarding />);
    await walkToBody(screen);
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    await fireEvent.press(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('onboarding-sex-female')).toBeTruthy();
  });
});

describe('a redo from Settings', () => {
  beforeEach(() => {
    mockProfile = {
      profileCompleted: true,
      goalDirection: 'lose',
      sex: 'female',
      heightIn: 64,
      age: 45,
      activityLevel: 'light',
      // A pace the user dialled in Refine. Onboarding has no pace control and
      // must not overwrite it with its own default of 1.
      targetPaceLbsPerWeek: 0.7,
    } as Partial<Profile>;
  });

  it('prefills the four answers so nobody is asked twice', async () => {
    const screen = await render(<Onboarding />);
    // Redo starts on the goal step, with the welcome greeting skipped.
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '165');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-feet').props.value).toBe('5');
    expect(screen.getByTestId('onboarding-inches').props.value).toBe('4');
    expect(screen.getByTestId('onboarding-age').props.value).toBe('45');
  });

  it('keeps the stored pace instead of resetting it to 1 lb/wk', async () => {
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '165');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-next')); // body, prefilled
    await fireEvent.press(screen.getByTestId('onboarding-next')); // activity, prefilled
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockSave.mock.calls[0][1].targetPaceLbsPerWeek).toBe(0.7);
  });
});
