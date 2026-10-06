import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { Profile, UnitSystem } from '@macrolog/core';
import { palettes } from '@/theme';
import { unitSystemForLocale } from '@/lib/use-unit-system';
import { en } from '@/i18n/en';

/**
 * First-run UX review S21 (2026-10-06), onboarding half.
 *
 *  #1 The reminders and first-log panels were BLANK in dark mode: their rows
 *     sat on `heroPanel` (dark in both themes) in `onInk`, which is the
 *     near-black canvas in dark mode — 1.02:1. The previous fix (ink → onInk,
 *     2026-09-02) was right for light only; the failure flipped themes.
 *  #2 The selected goal card's hint (2.41:1) and icon (1.31:1) in dark mode.
 *  #3 Onboarding asked every new user in pounds, pt-BR included.
 * #11 A second welcome screen existed only to carry the 16+ checkbox.
 *
 * NB: RNTL runs no layout pass, so nothing here is evidence of how the steps
 * LOOK on a 360×720 phone — that stays a device check.
 */

let mockProfile: Partial<Profile> | null = null;
let mockDeviceUnit: UnitSystem = 'us';
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockSetUnitSystem = jest.fn().mockResolvedValue(undefined);

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
  saveOnboardingV2: (...a: unknown[]) => mockSave(...a),
  setUnitSystem: (...a: unknown[]) => mockSetUnitSystem(...a),
}));
jest.mock('@/lib/use-unit-system', () => ({
  ...jest.requireActual('@/lib/use-unit-system'),
  deviceUnitSystem: () => mockDeviceUnit,
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ setRemindersEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import Onboarding from '@/app/onboarding';

// ── WCAG relative luminance, the same arithmetic as theme-contrast.test ──
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const color = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as never) as { color?: string } | undefined)?.color;

const dark = palettes.dark.colors;
const light = palettes.light.colors;

beforeEach(async () => {
  mockProfile = { profileCompleted: false };
  mockDeviceUnit = 'us';
  mockSave.mockClear();
  mockSetUnitSystem.mockClear();
  await AsyncStorage.clear();
});

/** Force the dark palette through the real ThemeProvider, and wait until it
 *  has hydrated — `muted` differs between palettes, so a `planSub` line in
 *  dark `muted` proves the switch happened before anything is asserted. */
async function renderDark() {
  await AsyncStorage.setItem('macrolog.theme-preference', 'dark');
  return render(<Onboarding />);
}

type Screen = Awaited<ReturnType<typeof render>>;

async function walkToReminders(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-age-attest'));
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-skip-body'));
  await fireEvent.press(getByTestId('onboarding-save'));
  await waitFor(() => expect(getByTestId('onboarding-reminders')).toBeTruthy());
}

describe('#1 hero-panel rows are legible in DARK mode', () => {
  it('the token pair is the problem: onInk on heroPanel is invisible in dark', () => {
    // Why the old fix failed — pinned so nobody "fixes" it back.
    expect(contrast(dark.onInk, dark.heroPanel)).toBeLessThan(1.5);
    // heroText is the panel's own token and the panel does not invert.
    for (const p of [light, dark]) expect(contrast(p.heroText, p.heroPanel)).toBeGreaterThanOrEqual(4.5);
  });

  it('reminders and first-log rows render in heroText in the dark palette', async () => {
    const screen = await renderDark();
    await walkToReminders(screen);
    await waitFor(() =>
      expect(color(screen.getByText(en['onboarding.remindersBody']))).toBe(dark.muted),
    );

    const rows = [
      screen.getByText(/^Lunch · /),
      screen.getByText(/^Dinner · /),
      screen.getByText(/^Only if a day is about to go unlogged · /),
    ];
    for (const r of rows) {
      expect(color(r)).toBe(dark.heroText);
      expect(contrast(color(r)!, dark.heroPanel)).toBeGreaterThanOrEqual(4.5);
    }

    await fireEvent.press(screen.getByTestId('onboarding-reminders-skip'));
    for (const k of ['onboarding.firstLogSearch', 'onboarding.firstLogPhoto', 'onboarding.firstLogType'] as const) {
      const r = screen.getByText(en[k]);
      expect(color(r)).toBe(dark.heroText);
      expect(contrast(color(r)!, dark.heroPanel)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('#2 the selected goal card', () => {
  it('hint ≥ 4.5:1 and icon ≥ 3:1 in both palettes', () => {
    for (const p of [light, dark]) {
      // Hint: `onInk` text on the card's `ink` fill.
      expect(contrast(p.onInk, p.ink)).toBeGreaterThanOrEqual(4.5);
      // Icon: `heroText` glyph on the `heroTrack` tile.
      expect(contrast(p.heroText, p.heroTrack)).toBeGreaterThanOrEqual(3);
    }
  });

  it('renders those tokens in dark mode', async () => {
    const screen = await renderDark();
    await waitFor(() => expect(color(screen.getByText(en['goal.loseHint']))).toBe(dark.muted));
    await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
    expect(color(screen.getByText(en['goal.loseHint']))).toBe(dark.onInk);
  });
});

describe('#3 the unit a new user is asked in', () => {
  it('unitSystemForLocale: region decides; US/LR/MM/PR are pounds', () => {
    expect(unitSystemForLocale('en-US')).toBe('us');
    expect(unitSystemForLocale('es-PR')).toBe('us');
    expect(unitSystemForLocale('en-LR')).toBe('us');
    expect(unitSystemForLocale('my-MM')).toBe('us');
    expect(unitSystemForLocale('pt-BR')).toBe('metric');
    expect(unitSystemForLocale('en-GB')).toBe('metric');
    expect(unitSystemForLocale('es-MX')).toBe('metric');
    expect(unitSystemForLocale('en_CA')).toBe('metric');
    expect(unitSystemForLocale('zh-Hans-CN')).toBe('metric');
    expect(unitSystemForLocale('es-419')).toBe('metric');
    // An explicit measurement-system extension beats the region.
    expect(unitSystemForLocale('en-US-u-ms-metric')).toBe('metric');
    expect(unitSystemForLocale('pt-BR-u-ms-ussystem')).toBe('us');
    // No region: English/Spanish keep the historical default.
    expect(unitSystemForLocale('en')).toBe('us');
    expect(unitSystemForLocale('es')).toBe('us');
    expect(unitSystemForLocale('pt')).toBe('metric');
    expect(unitSystemForLocale(undefined)).toBe('us');
  });

  it('a metric phone asks in kg, and the save writes metric + pounds', async () => {
    mockDeviceUnit = 'metric';
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-age-attest'));
    await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    // The field's unit label AND the toggle's selected segment.
    expect(screen.getAllByText('kg')).toHaveLength(2);
    expect(screen.getByTestId('onboarding-unit-weight-metric').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '80');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '75');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    // The body step asks height in cm.
    expect(screen.getByTestId('onboarding-height-cm')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    const [, sub] = mockSave.mock.calls[0];
    expect(sub.weightLbs).toBeCloseTo(176.37, 1); // stored in POUNDS, always
    expect(sub.targetWeightLbs).toBeCloseTo(165.35, 1);
    expect(mockSetUnitSystem).toHaveBeenCalledWith('u1', 'metric');
  });

  it('the toggle converts what is typed instead of reinterpreting it', async () => {
    const screen = await render(<Onboarding />); // a US phone
    await fireEvent.press(screen.getByTestId('onboarding-age-attest'));
    await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-unit-weight-metric'));
    expect(screen.getByTestId('onboarding-weight').props.value).toBe('81.6');
    await fireEvent.press(screen.getByTestId('onboarding-unit-weight-us'));
    expect(screen.getByTestId('onboarding-weight').props.value).toBe('179.9');
  });

  it('a US phone that keeps lb writes no unit at all (absent already reads us)', async () => {
    const screen = await render(<Onboarding />);
    await walkToReminders(screen);
    expect(mockSetUnitSystem).not.toHaveBeenCalled();
  });

  it('a redo keeps the profile unit and never shows the toggle', async () => {
    mockDeviceUnit = 'metric';
    mockProfile = { profileCompleted: true, goalDirection: 'lose', unitSystem: 'us' } as Partial<Profile>;
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByText('lb')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-unit-weight')).toBeNull();
  });
});

describe('#4/#11 first step semantics', () => {
  it('opens on the goal step with a header title, and the CTA is a button with state', async () => {
    const screen = await render(<Onboarding />);
    expect(screen.getByText(en['onboarding.goalQ']).props.accessibilityRole).toBe('header');
    const cta = screen.getByTestId('onboarding-next');
    expect(cta.props.accessibilityRole).toBe('button');
    expect(cta.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('onboarding-age-attest'));
    await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
    expect(screen.getByTestId('onboarding-next').props.accessibilityState).toMatchObject({ disabled: false });
  });
});
