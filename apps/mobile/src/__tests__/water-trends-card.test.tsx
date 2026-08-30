// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

// The real hook reads AsyncStorage, whose jest mock PERSISTS ACROSS TESTS IN A
// FILE — one dismiss in an early case silently hid the row in a later one while
// the suite stayed green. Stubbed for that reason, exactly as the fasting card's
// test does.
const mockDismiss = jest.fn();
let mockDismissed = false;
jest.mock('@/hooks/useDismissedStub', () => ({
  useDismissedStub: () => [mockDismissed, mockDismiss],
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import {
  WATER_STRIP_CEILING_FLOZ,
  WATER_WINDOW_DAYS,
  type DateKey,
  waterWindow,
} from '@macrolog/core';
import { WaterTrendsCard } from '@/components/WaterTrendsCard';
import type { WaterTrends } from '@/hooks/useWaterTrends';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';

/**
 * The three states of the water card, and the one thing it must never say
 * (#115 §3).
 *
 * The arithmetic is pinned in `packages/core/src/water-history.test.ts`. What is
 * here is the rendering contract: which state produces a card and which produces
 * one row, that the stub row acts and does not name an unearned target, and that
 * the copy never invents a daily water goal in any locale.
 *
 * **RNTL runs no Yoga layout pass**, so nothing below proves the strip is the
 * right shape on a 360×720 dp screen, or that three tabs fit on one line. That
 * is a device screenshot's job, and it is the reason this repo has shipped
 * layout bugs past 500 green specs.
 */

const key = (i: number) => `2026-08-${String(i + 1).padStart(2, '0')}` as DateKey;
const keys = Array.from({ length: WATER_WINDOW_DAYS }, (_, i) => key(i));

function cardState(amounts: Record<number, number>): WaterTrends {
  const byDay: Record<string, number> = {};
  for (const [i, flOz] of Object.entries(amounts)) byDay[key(Number(i))] = flOz;
  return { kind: 'card', window: waterWindow(byDay, keys) };
}

describe('state 3 — no water at all, which is four accounts in five', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockDismissed = false;
  });

  it('renders one row and no card', async () => {
    const { getByTestId, queryByTestId } = await render(
      <WaterTrendsCard water={{ kind: 'empty', recorded: 0 }} />,
    );

    expect(getByTestId('water-empty-row')).toBeTruthy();
    // No card and no section header: a permanently empty widget on a screen
    // this dense is the generic-dashboard failure.
    expect(queryByTestId('water-card')).toBeNull();
  });

  it('does NOT name the threshold to someone who has logged nothing', async () => {
    // The whole point of two stub sentences rather than one. Telling a user with
    // zero days that they need three names an unearned target — the
    // forward-pressure pattern #115 §0 proposed, and rightly killed, and that
    // #108 went on to ban in code for milestones.
    const { getByTestId } = await render(<WaterTrendsCard water={{ kind: 'empty', recorded: 0 }} />);

    expect(getByTestId('water-empty-row')).toBeTruthy();
    expect(en['trends.waterEmpty']).not.toMatch(/\{need\}/);
    expect(en['trends.waterEmpty']).not.toMatch(/\b3\b/);
  });

  it('DOES name it once there is progress to name', async () => {
    const { getByText } = await render(<WaterTrendsCard water={{ kind: 'empty', recorded: 2 }} />);

    // The sleep card's progress shape: a silent wait reads as "nothing
    // happened", which is how a feature gets reported as broken.
    expect(getByText(/2 of 3 days/)).toBeTruthy();
  });

  it('taps through to Today, where water is actually logged', async () => {
    const { getByTestId } = await render(<WaterTrendsCard water={{ kind: 'empty', recorded: 0 }} />);

    fireEvent.press(getByTestId('water-empty-link'));

    // `replace`, never `push` — Today is a SIBLING TAB, and pushing a tab route
    // stacks a second copy of it over Trends instead of switching tabs.
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });

  it('renders nothing at all while the listener has not answered', async () => {
    // Not a row that becomes a card a frame later, and not a skeleton.
    const { queryByTestId } = await render(<WaterTrendsCard water={{ kind: 'pending' }} />);

    expect(queryByTestId('water-empty-row')).toBeNull();
    expect(queryByTestId('water-card')).toBeNull();
  });
});

describe('the stub row can be dismissed, like its siblings (#103)', () => {
  beforeEach(() => {
    mockDismiss.mockReset();
    mockDismissed = false;
  });
  afterEach(() => {
    mockDismissed = false;
  });

  it('offers a dismiss beside the row', async () => {
    const { queryByTestId } = await render(
      <WaterTrendsCard water={{ kind: 'empty', recorded: 0 }} />,
    );

    expect(queryByTestId('water-stub-dismiss')).toBeTruthy();
  });

  it('dismissing renders NOTHING — not a collapsed row, not a hairline', async () => {
    mockDismissed = true;
    const { queryByTestId } = await render(
      <WaterTrendsCard water={{ kind: 'empty', recorded: 0 }} />,
    );

    expect(queryByTestId('water-empty-row')).toBeNull();
    expect(queryByTestId('water-stub-dismiss')).toBeNull();
  });

  it('calls the dismiss, not the navigation', async () => {
    // The two actions are opposites and sit a few pixels apart, which is why
    // the dismiss is a SIBLING pressable rather than nested inside the
    // navigating one.
    const { getByTestId } = await render(
      <WaterTrendsCard water={{ kind: 'empty', recorded: 0 }} />,
    );

    fireEvent.press(getByTestId('water-stub-dismiss'));

    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('STILL renders the card once the evidence arrives, dismissed or not', async () => {
    // What makes a one-way dismiss safe with no restore affordance to explain:
    // the flag is read ONLY in the empty state, so the card returns the moment
    // there is something to say.
    mockDismissed = true;
    const { getByTestId } = await render(
      <WaterTrendsCard water={cardState({ 0: 48, 1: 64, 2: 56 })} />,
    );

    expect(getByTestId('water-card')).toBeTruthy();
  });
});

describe('the card', () => {
  it('leads with the median, the range and the coverage', async () => {
    const { getByTestId } = await render(
      <WaterTrendsCard water={cardState({ 0: 32, 3: 48, 7: 96, 11: 64 })} />,
    );

    // Median of 32/48/64/96 is 56.
    expect(getByTestId('water-median')).toHaveTextContent('56 fl oz typical');
    expect(getByTestId('water-range')).toHaveTextContent(
      'Your 4 logged days ran between 32 and 96 fl oz.',
    );
    expect(getByTestId('water-coverage')).toHaveTextContent(
      'you logged water on 4 of 14 days',
    );
  });

  it('draws one column per day in the window, gaps included', async () => {
    const { getByTestId } = await render(<WaterTrendsCard water={cardState({ 0: 48, 5: 64, 9: 56 })} />);

    expect(getByTestId('water-strip').props.children[0]).toHaveLength(WATER_WINDOW_DAYS);
  });

  it('states a range even when every day is nearly identical', async () => {
    // The failure the fasting card shipped and had to be rebuilt to fix: a
    // consistent habit draws fourteen bars of the same height and the chart
    // says nothing. Water is MORE prone to it. The sentence is what carries the
    // meaning, so it must survive the case that makes the strip useless.
    const { getByTestId } = await render(
      <WaterTrendsCard water={cardState({ 0: 62, 1: 64, 2: 63, 3: 65, 4: 64 })} />,
    );

    expect(getByTestId('water-range')).toHaveTextContent(/between 62 and 65 fl oz/);
  });

  it('hides its own header when it is one face of the panel', async () => {
    // Two labels for one card reads as a mistake — the tab strip already names
    // it (ADR-0034 decision 4).
    const state = cardState({ 0: 48, 1: 64, 2: 56 });
    const solo = await render(<WaterTrendsCard water={state} />);
    const faced = await render(<WaterTrendsCard water={state} hideHeader />);

    expect(solo.queryByText('Water')).toBeTruthy();
    expect(faced.queryByText('Water')).toBeNull();
  });
});

describe('the copy asserts no water goal, in any locale', () => {
  const WATER_KEYS = [
    'trends.waterTitle',
    'trends.waterHeadline',
    'trends.waterCaption',
    'trends.waterLegend',
    'trends.waterRange',
    'trends.waterCoverage',
    'trends.waterEmptyProgress',
    'trends.waterEmpty',
  ] as const;

  const DICTS = { en, 'es-PR': esPR, 'pt-BR': ptBR } as const;

  it.each(Object.keys(DICTS))('%s ships every water string', (locale) => {
    const dict = DICTS[locale as keyof typeof DICTS] as Record<string, string>;
    for (const k of WATER_KEYS) expect(typeof dict[k]).toBe('string');
  });

  it.each(Object.keys(DICTS))('%s never names a target, streak or goal', (locale) => {
    const dict = DICTS[locale as keyof typeof DICTS] as Record<string, string>;
    // Ignia holds no daily water target and must not imply one. Per-language on
    // purpose: a single English regex would pass every non-English locale
    // vacuously, which is the trap `milestones-copy.test.ts` names.
    const banned: Record<string, RegExp> = {
      en: /\b(goal|target|streak|should|need to|daily minimum|gallon)\b/i,
      'es-PR': /\b(meta|objetivo|racha|deber(í|i)as|deberia|gal(ó|o)n)\b/i,
      'pt-BR': /\b(meta|objetivo|sequ(ê|e)ncia|deveria|gal(ã|a)o)\b/i,
    };
    expect(banned).toHaveProperty(locale);

    const offenders = WATER_KEYS.filter((k) => banned[locale].test(dict[k] ?? ''));
    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(DICTS))('%s keeps the stub separator StubLabel splits on', (locale) => {
    const dict = DICTS[locale as keyof typeof DICTS] as Record<string, string>;
    // `StubLabel` renders the head in `colors.ink` by splitting on ' · '. A
    // locale that loses it degrades to the old all-muted line, which is the
    // hierarchy defect #115 §0 shipped a fix for — so it fails here first.
    expect(dict['trends.waterEmpty']).toContain(' · ');
    expect(dict['trends.waterEmptyProgress']).toContain(' · ');
  });

  it.each(Object.keys(DICTS))('%s interpolates the unit rather than hardcoding it', (locale) => {
    const dict = DICTS[locale as keyof typeof DICTS] as Record<string, string>;
    // es-PR says `oz` where en and pt-BR say `fl oz`. A second copy per string
    // is a drift waiting to happen, so the strings take `{u}` from `water.unit`.
    for (const k of ['trends.waterHeadline', 'trends.waterLegend', 'trends.waterRange'] as const) {
      expect(dict[k]).toContain('{u}');
    }
  });
});

describe('the axis is a scale, not a verdict', () => {
  it('labels the strip with the ceiling and zero', async () => {
    const { getByTestId } = await render(<WaterTrendsCard water={cardState({ 0: 48, 1: 64, 2: 56 })} />);

    // Without the axis no bar height means anything — the headline says 56 and
    // nothing on the strip lets you check it.
    expect(getByTestId('water-axis-max')).toHaveTextContent(String(WATER_STRIP_CEILING_FLOZ));
  });

  it('tops out above the heaviest day anyone here has logged, and below a gallon', async () => {
    // 96 fl oz was the population maximum on 2026-08-30; 128 is "a gallon a
    // day", a fitness-culture target this product does not hold. The ceiling has
    // to clear the first without becoming the second, and the axis is where a
    // user would read it as a goal.
    expect(WATER_STRIP_CEILING_FLOZ).toBeGreaterThan(96);
    expect(WATER_STRIP_CEILING_FLOZ).toBeLessThan(128);
  });
});
