/**
 * Large text, S21 — the hierarchy and the compact surfaces at the largest
 * sizes, plus the recalibration card that repeated the hero.
 *
 * Pins: below the accessibility sizes the page title keeps its measured 1.1×
 * cap (`header-title-fit.test.ts`); from them it stacks, and its cap puts
 * `font.h1` at or above uncapped body text at AX5; the update banner stays two
 * capped single lines with a full-size dismiss; the recalibration card says
 * what CHANGED and never restates the hero's two numbers on their own.
 */
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' } }),
}));

let mockOta = { pending: false, applying: false, apply: jest.fn() };
let mockStore = { available: false, open: jest.fn(), dismiss: jest.fn() };
jest.mock('@/lib/app-update', () => ({
  useOtaUpdate: () => mockOta,
  useStoreUpdate: () => mockStore,
}));

let mockRecal: Record<string, unknown> = {};
jest.mock('@/hooks/useRecalibration', () => ({ useRecalibration: () => mockRecal }));

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { renderWithProviders as render } from '@/test-utils';
import { ACCESSIBILITY_FONT_SCALE, LARGE_TITLE_MAX_SCALE, largeTitleFor } from '@/lib/font-scale';
import { font, headerTitle, TARGET } from '@/theme';
import { BANNER_MAX_SCALE, UpdateBanner } from '@/components/UpdateBanner';
import { RecalibrationCard } from '@/components/RecalibrationCard';

/** RN's multiplier at AX5 (`RCTFontSizeMultiplier`, react-native 0.86). */
const AX5 = 3.571;
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

describe('large titles', () => {
  it('standard sizes keep the measured inline cap — nothing changes there', () => {
    for (const s of [1, 1.118, 1.235, 1.353]) {
      const lt = largeTitleFor(s);
      expect(lt.stacked).toBe(false);
      expect(lt.titleProps.maxFontSizeMultiplier).toBe(headerTitle.maxFontScale);
      expect(lt.rowStyle).toBeUndefined();
    }
  });

  it('accessibility sizes stack the header and keep the title >= body text at AX5', () => {
    const lt = largeTitleFor(1.786); // AX1
    expect(lt.stacked).toBe(true);
    expect(ACCESSIBILITY_FONT_SCALE).toBeLessThan(1.786);
    // The title is the whole first line, the icons wrap below it.
    expect(lt.rowStyle).toEqual({ flexWrap: 'wrap' });
    expect(lt.titleStyle).toEqual({ width: '100%' });
    // Shrinks to fit a long locale's word rather than clipping it.
    expect(lt.titleProps.numberOfLines).toBe(1);
    expect(lt.titleProps.adjustsFontSizeToFit).toBe(true);
    // Uncapped body text at AX5 vs the title at its cap.
    expect(font.h1 * LARGE_TITLE_MAX_SCALE).toBeGreaterThanOrEqual(font.body * AX5);
  });

  it('all four tab titles use it (Train had no cap at all)', () => {
    const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
    for (const screen of ['index', 'trends', 'body', 'train']) {
      const src = read(`app/(app)/${screen}.tsx`);
      expect(src).toMatch(/useLargeTitle\(\)/);
      expect(src).toMatch(/\{\.\.\.largeTitle\.titleProps\}/);
      expect(src).toMatch(/largeTitle\.rowStyle/);
    }
  });

  it('tab labels grow past 1.2x, shrink to fit, and give way to icons at accessibility sizes', () => {
    const src = readFileSync(join(__dirname, '..', 'app/(app)/_layout.tsx'), 'utf8');
    expect(src).toMatch(/const TAB_LABEL_MAX_SCALE = 1\.4;/);
    expect(src).toMatch(/adjustsFontSizeToFit/);
    expect(src).toMatch(/fontScale >= ACCESSIBILITY_FONT_SCALE/);
    // The name stays on the tab for a screen reader and the large-content viewer.
    expect(src).toMatch(/accessibilityLabel=\{spoken\}/);
    expect(src).toMatch(/accessibilityLargeContentTitle=\{label\}/);
  });
});

describe('UpdateBanner at the largest sizes', () => {
  beforeEach(() => {
    mockOta = { pending: false, applying: false, apply: jest.fn() };
    mockStore = { available: false, open: jest.fn(), dismiss: jest.fn() };
  });

  it('the store card: two capped single lines and a full-size dismiss', async () => {
    mockStore = { available: true, open: jest.fn(), dismiss: jest.fn() };
    const view = await render(<UpdateBanner />);
    const lines = ['New version available', 'Tap to update Ignia in the store.'].map((s) => view.getByText(s));
    for (const line of lines) {
      expect(line.props.numberOfLines).toBe(1);
      expect(line.props.maxFontSizeMultiplier).toBe(BANNER_MAX_SCALE);
    }
    expect(BANNER_MAX_SCALE).toBeLessThanOrEqual(1.6);
    const dismiss = flat(view.getByTestId('store-update-dismiss').props.style);
    expect(dismiss.minWidth).toBeGreaterThanOrEqual(44);
    expect(dismiss.minHeight).toBeGreaterThanOrEqual(44);
    expect(view.getByTestId('store-update-dismiss').props.accessibilityRole).toBe('button');
  });

  it('the OTA card: every visible line is one capped line', async () => {
    mockOta = { pending: true, applying: false, apply: jest.fn() };
    const view = await render(<UpdateBanner />);
    // By copy, not `/./`: the vector icons are text nodes too.
    const texts = ['Update ready', 'Ignia restarts to apply it — a few seconds.', 'Restart'].map((s) => view.getByText(s));
    for (const line of texts) {
      expect(line.props.numberOfLines).toBe(1);
      expect(line.props.maxFontSizeMultiplier).toBe(BANNER_MAX_SCALE);
    }
  });
});

describe('RecalibrationCard says what changed, not what the hero says', () => {
  const digest = {
    available: true,
    trueTdee: 2380,
    calorieTarget: 1880,
    weightTrendLbPerWeek: -0.7,
    loggingCompletenessPct: 80,
    deltaSinceAck: -70,
    deltaVsFormula: -300,
    trend: 'metabolism-slowed',
    shouldSurface: true,
  };
  /** Every text node's content, joined — what a reader sees. */
  const allText = (view: Awaited<ReturnType<typeof render>>) =>
    view.getAllByText(/./).map((n) => String([n.props.children].flat().join(''))).join(' | ');

  it('a drift: old → new lines and the why — no sentence restating today’s numbers', async () => {
    mockRecal = { digest, acknowledge: jest.fn(), previous: { tdee: 2450, target: 1950 } };
    const view = await render(<RecalibrationCard />);
    const text = allText(view);
    expect(text).toContain('Maintenance: 2,450 → 2,380 kcal/day');
    expect(text).toContain('Daily target: 1,950 → 1,880 kcal');
    // The old body: "…real burn at about 2,380 kcal/day. We’ve set your daily target to 1,880 kcal."
    expect(text).not.toMatch(/real burn at about/);
    expect(text).not.toMatch(/set your daily target to/);
    // Each hero number appears once, inside its own change line.
    expect(text.match(/2,380/g)).toHaveLength(1);
    expect(text.match(/1,880/g)).toHaveLength(1);
    expect(view.getByTestId('recalibration-why')).toHaveTextContent(/running lower than expected/);
    expect(view.queryByTestId('recalibration-basis')).toBeNull();
  });

  it('no "from" to show: a number-free basis line, never the hero numbers', async () => {
    mockRecal = { digest: { ...digest, deltaSinceAck: null, deltaVsFormula: null }, acknowledge: jest.fn(), previous: null };
    const view = await render(<RecalibrationCard />);
    const text = allText(view);
    expect(text).not.toMatch(/2,380|1,880/);
    expect(view.getByTestId('recalibration-basis')).toHaveTextContent('Measured from your last few weeks of weigh-ins and logged meals.');
  });

  it('"Got it" is a labelled button at full target size', async () => {
    mockRecal = { digest, acknowledge: jest.fn(), previous: { tdee: 2450, target: 1950 } };
    const view = await render(<RecalibrationCard />);
    const ack = view.getByTestId('recalibration-ack');
    expect(ack.props.accessibilityRole).toBe('button');
    expect(ack.props.accessibilityLabel).toBe('Got it');
    expect(flat(ack.props.style).minHeight).toBe(TARGET);
  });
});
