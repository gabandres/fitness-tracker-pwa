import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderWithProviders as render } from '@/test-utils';
import { openingTags } from './jsx-scan';

/**
 * Settings and the screens it opens, after the S21 UX review.
 *
 * Mostly a source scan — the shape `a11y-roles.test.ts` uses, for its reason:
 * it reaches the controls behind conditional branches (Pro, tips, the
 * reminder rows) that no render here would mount. Settings itself is not
 * rendered: it pulls in a dozen native-backed cards whose own suites cover
 * them, and what is pinned here is wiring a scan can see.
 */
const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** Every file this review brought up to "every control says what it is". */
const FILES = [
  'app/settings.tsx',
  'app/daily-targets.tsx',
  'app/refine-targets.tsx',
  'app/feedback.tsx',
  'app/coach.tsx',
  'app/milestones.tsx',
  'app/connected-apps.tsx',
  'components/SignInMethodsCard.tsx',
  'components/UpdateBanner.tsx',
];
const TOUCHABLES = ['TouchableOpacity', 'Pressable', 'PressScale', 'Touchable'];

describe('S21-2 — every control announces what it is', () => {
  it.each(FILES)('%s: no touchable without an accessibilityRole', (file) => {
    const bad = openingTags(read(file), TOUCHABLES)
      .filter((tag) => !tag.attrs.includes('accessibilityRole'))
      .map((tag) => `${file}:${tag.line}`);
    expect(bad).toEqual([]);
  });

  it.each(FILES)('%s: every Switch is named, and its off track is lineStrong (S21-3)', (file) => {
    for (const tag of openingTags(read(file), ['Switch'])) {
      // A bare Switch reads "switch, off" — on WHAT?
      expect(tag.attrs).toMatch(/accessibilityLabel=/);
      // `line` measured 1.1–1.2:1 against the card: an off switch that is
      // nearly invisible (WCAG 1.4.11 wants 3:1 for a control's boundary).
      expect(tag.attrs).toMatch(/false:\s*colors\.lineStrong/);
    }
  });

  it.each(FILES)('%s: every text field has a label', (file) => {
    for (const tag of openingTags(read(file), ['TextInput'])) {
      expect(tag.attrs).toMatch(/accessibilityLabel=/);
    }
  });

  it('every Settings section label is a header', () => {
    const src = read('app/settings.tsx');
    const sections = openingTags(src, ['Text']).filter((tag) => tag.attrs.includes('style={styles.section}'));
    expect(sections.length).toBeGreaterThanOrEqual(8);
    for (const tag of sections) expect(tag.attrs).toMatch(/accessibilityRole="header"/);
  });

  it('steppers say what they change, not just "Lower" / "Raise"', () => {
    const src = read('app/settings.tsx') + read('app/refine-targets.tsx');
    expect(src).not.toMatch(/accessibilityLabel=\{t\('settings\.(lower|raise|earlier|later)'\)\}/);
    expect(src).toMatch(/settings\.stepLower', \{ what: t\('settings\.calorieFloor'\)/);
    expect(src).toMatch(/settings\.stepEarlier', \{ what: meal \}/);
  });
});

describe('S21-4 — Settings reads top to bottom in the order people look', () => {
  const src = read('app/settings.tsx');
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    if (i < 0) throw new Error(`missing ${needle}`);
    return i;
  };

  it('targets, help, preferences, reminders, your data, about, account — in that order', () => {
    const order = [
      "t('settings.profileTargetsSection')",
      "t('settings.helpFeedbackSection')",
      "t('settings.preferencesSection')",
      "t('settings.reminders')",
      "t('settings.yourDataSection')",
      "t('settings.aboutLegalSection')",
      '<SignInMethodsCard />',
      "t('settings.account')",
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('Units, Theme and Language come before About & legal and the build line', () => {
    expect(at('settings-unit-')).toBeLessThan(at('settings-privacy'));
    expect(at('settings-lang-')).toBeLessThan(at('testID="settings-build"'));
  });

  it('the three target doors share one group, each with its own subtitle', () => {
    const group = src.slice(at("t('settings.profileTargetsSection')"), at("t('settings.helpFeedbackSection')"));
    for (const id of ['settings-daily-targets', 'settings-refine', 'settings-redo-setup']) {
      expect(group).toContain(`testID="${id}"`);
    }
    expect(group).toContain("t('settings.refineSub')");
    expect(group).toContain("t('settings.redoSetupSub')");
  });

  it('Sign out sits above Delete account, and Delete account is the last control', () => {
    expect(at('settings-signout')).toBeLessThan(at('settings-delete-account'));
    const testIDs = [...src.matchAll(/testID=\{?["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    expect(testIDs[testIDs.length - 1]).toBe('settings-delete-account');
  });

  it('no section heading repeats the title of the one row under it', () => {
    // MILESTONES over "Milestones", SEND FEEDBACK over "Send feedback",
    // CONNECTED APPS over "Connected apps", HELP and ABOUT & HELP both.
    expect(src).not.toMatch(/styles\.section[^>]*>\{t\('(milestones\.title|feedback\.title|oura\.section|settings\.help|settings\.aboutSection)'\)/);
  });

  it('hosts its own confirms — the tab layout\'s host is underneath it now (S21-1)', () => {
    // Sign out and Sign-in methods' Disconnect both `confirm()`. As a hidden
    // tab, Settings shared the tab layout's host; as a root stack route over
    // the tabs, a confirm sent there would open beneath this screen.
    expect(src).toMatch(/<ConfirmHost \/>/);
  });

  it('draws no header of its own — the native one is the title (S21-1/9)', () => {
    expect(src).not.toMatch(/testID="settings-back"/);
    expect(src).not.toMatch(/edges=\{\['top'/);
  });
});

describe('S21-5 — Connected apps names the health store', () => {
  it('the Settings row interpolates the platform store', () => {
    expect(read('app/settings.tsx')).toMatch(/settings\.connectedAppsSub', \{ store: healthStore \}/);
  });

  it.each(['en', 'es-PR', 'pt-BR'])('%s copy leads with {store}, and no card says "Connect Health Connect"', (loc) => {
    const dict = read(`i18n/${loc}.ts`);
    expect(dict).toMatch(/'settings\.connectedAppsSub': '\{store\}, Oura/);
    expect(dict).not.toMatch(/Connect(ar)?( o)? Health Connect/);
  });
});

describe('S21-6 — the targets screens', () => {
  it.each(['app/daily-targets.tsx', 'app/refine-targets.tsx'])('%s: Save is a button with a disabled state', (file) => {
    const src = read(file);
    const save = openingTags(src, ['TouchableOpacity', 'Touchable']).find((tag) => /testID="(targets|refine)-save"/.test(tag.attrs));
    expect(save?.attrs).toMatch(/accessibilityRole="button"/);
    expect(save?.attrs).toMatch(/accessibilityState=\{\{ disabled:/);
  });

  it.each(['app/daily-targets.tsx', 'app/refine-targets.tsx'])('%s: field borders are lineStrong', (file) => {
    const input = read(file).match(/\binput: \{[\s\S]*?\n {2,4}\},/);
    expect(input?.[0]).toMatch(/borderColor: colors\.lineStrong/);
  });

  it('Refine no longer works around being a tab', () => {
    const src = read('app/refine-targets.tsx');
    expect(src).not.toMatch(/BackHandler/);
    expect(src).not.toMatch(/router\.replace\(returnTo\)/);
    // The pace is shown in the user's unit and locale, not `toFixed` + "lb".
    expect(src).not.toMatch(/pace\.toFixed/);
    expect(src).toMatch(/bodyWeightUnit\(unitSystem\)/);
  });
});

describe('S21-8 — the update banner stays compact', () => {
  const src = read('components/UpdateBanner.tsx');
  it('caps the text scale and keeps title and body to a line each', () => {
    const texts = openingTags(src, ['Text']).filter((tag) => /styles\.(title|body)/.test(tag.attrs));
    expect(texts.length).toBe(4);
    for (const tag of texts) {
      expect(tag.attrs).toMatch(/numberOfLines=\{1\}/);
      expect(tag.attrs).toMatch(/maxFontSizeMultiplier=\{BANNER_MAX_SCALE\}/);
    }
    expect(src).toMatch(/const BANNER_MAX_SCALE = 1\.6;/);
  });

  it('the dismiss button is 44pt on its own and labelled', () => {
    expect(src).toMatch(/dismiss: \{ minWidth: 44, minHeight: 44/);
    const dismiss = openingTags(src, ['TouchableOpacity']).find((tag) => tag.attrs.includes('store-update-dismiss'));
    expect(dismiss?.attrs).toMatch(/accessibilityLabel=\{t\('common\.dismiss'\)\}/);
  });
});

// ── Render: the sign-in methods card names the provider (S21-2) ──────────

jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));
let mockLinked = ['password'];
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    linkedProviders: mockLinked,
    linkProvider: jest.fn(),
    linkPassword: jest.fn(),
    unlinkProvider: jest.fn(),
    appleAvailable: false,
  }),
}));

import { SignInMethodsCard } from '@/components/SignInMethodsCard';

describe('S21-2 — Sign-in methods', () => {
  it('Connect / Disconnect name the provider and are buttons', async () => {
    mockLinked = ['password', 'google.com'];
    const ui = await render(<SignInMethodsCard />);
    const google = ui.getByTestId('signin-methods-disconnect-google.com');
    expect(google.props.accessibilityRole).toBe('button');
    expect(google.props.accessibilityLabel).toBe('Disconnect Google');
    expect(ui.getByTestId('signin-methods-disconnect-password').props.accessibilityLabel).toBe(
      'Disconnect Email and password',
    );
  });

  it('an unconnected provider reads "Connect Google"', async () => {
    mockLinked = ['password'];
    const ui = await render(<SignInMethodsCard />);
    expect(ui.getByTestId('signin-methods-connect-google.com').props.accessibilityLabel).toBe('Connect Google');
  });

  it('the controls are at least 44pt tall', () => {
    expect(read('components/SignInMethodsCard.tsx')).toMatch(/actionBtn: \{ minHeight: 48, minWidth: 48/);
  });
});

describe('S21 simulator QA — cosmetic', () => {
  it('Safety floors: the two rows have distinct titles in every locale', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const dicts = [require('@/i18n/en').en, require('@/i18n/es-PR').esPR, require('@/i18n/pt-BR').ptBR] as Record<string, string>[];
    /* eslint-enable @typescript-eslint/no-require-imports */
    for (const dict of dicts) {
      expect(dict['settings.calorieFloor']).toBeTruthy();
      expect(dict['settings.calorieFloor']).not.toBe(dict['settings.proteinFloor']);
    }
  });

  it('the targets summary spaces its grams ("145 g"), like the rest of the app', () => {
    const src = read('app/settings.tsx');
    expect(src).toMatch(/\$\{formatNumber\(protein, locale\)\} \$\{t\('settings\.proteinUnit'\)\}/);
    expect(src).not.toMatch(/\$\{protein\}\$\{t\('settings\.proteinUnit'\)\}/);
  });

  it.each(['app/(app)/trends.tsx', 'app/(app)/body.tsx', 'components/train/train-styles.ts'])(
    '%s: the header row, not the title, carries the top padding — icons centre on the title line',
    (file) => {
      const src = read(file);
      expect(src).toMatch(/headerRow: \{[^}]*paddingTop: space\.md/);
      expect(src).not.toMatch(/title: \{ fontFamily: type\.display, fontSize: font\.h1[^}]*paddingTop/);
    },
  );
});
