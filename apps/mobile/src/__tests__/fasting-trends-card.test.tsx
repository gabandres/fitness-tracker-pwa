// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

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
  FASTING_WINDOW_DAYS,
  type DateKey,
  type Fast,
  fastingWindow,
  fastsInWindow,
} from '@macrolog/core';
import { FastingTrendsCard } from '@/components/FastingTrendsCard';
import type { FastingTrends } from '@/hooks/useFastingTrends';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';

/**
 * The three states of the fasting card, and the several things it must never
 * say (ADR-0034, issue #98).
 *
 * The arithmetic is pinned in `packages/core/src/fasting-history.test.ts`. What
 * is here is the rendering contract: which state produces a card and which
 * produces one row, that the stub row acts and tells the truth about WHY it is
 * empty, and that the copy stays descriptive.
 *
 * **RNTL runs no Yoga layout pass**, so nothing below proves the strip is the
 * right shape on a 360×720 dp screen. That is a device screenshot's job, and it
 * is the reason this repo has shipped layout bugs past 400 green specs — the
 * sleep card's own empty row shipped with an inert chevron that only a device
 * capture found.
 */

const day = (i: number) => `2026-08-${String(i + 1).padStart(2, '0')}` as DateKey;
const keys = Array.from({ length: FASTING_WINDOW_DAYS }, (_, i) => day(i));

/** A 16-hour fast ending at noon on the i-th day of the window. */
const fastEndingOn = (i: number, hours = 16): Fast => {
  const endedAt = new Date(2026, 7, i + 1, 12, 0, 0, 0);
  return { startedAt: new Date(endedAt.getTime() - hours * 3_600_000), endedAt };
};

function cardState(fasts: readonly Fast[]): FastingTrends {
  return {
    kind: 'card',
    window: fastingWindow(fasts, keys),
    fastCount: fastsInWindow(fasts, keys),
  };
}

const THREE = [fastEndingOn(2, 14), fastEndingOn(4, 16), fastEndingOn(6, 18)];

describe('FastingTrendsCard states', () => {
  beforeEach(() => mockReplace.mockReset());

  it('renders nothing at all while the listener has not answered', async () => {
    // Not a header, not a skeleton — a row that becomes a card a frame later is
    // worse than a beat of nothing.
    // Asserted by absence of every testID rather than a null tree: the render
    // helper wraps in providers, so the tree is never literally null.
    const { queryByTestId } = await render(<FastingTrendsCard fasting={{ kind: 'pending' }} />);
    expect(queryByTestId('fasting-card')).toBeNull();
    expect(queryByTestId('fasting-empty-row')).toBeNull();
    expect(queryByTestId('fasting-strip')).toBeNull();
  });

  it('renders one row and no card below the threshold', async () => {
    const { queryByTestId } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: false }} />,
    );
    expect(queryByTestId('fasting-empty-row')).toBeTruthy();
    expect(queryByTestId('fasting-card')).toBeNull();
    // No section header either: Trends already carries a hero, This Week,
    // Budget, sleep and Coach, and a permanently empty widget on top of that is
    // the generic-dashboard failure ADR-0034 rejects.
    expect(queryByTestId('fasting-strip')).toBeNull();
  });

  it('renders the card from three completed fasts', async () => {
    const { queryByTestId } = await render(<FastingTrendsCard fasting={cardState(THREE)} />);
    expect(queryByTestId('fasting-card')).toBeTruthy();
    expect(queryByTestId('fasting-strip')).toBeTruthy();
    expect(queryByTestId('fasting-empty-row')).toBeNull();
  });
});

describe('the stub row must act, and must not lie about why it is empty', () => {
  beforeEach(() => mockReplace.mockReset());

  it('goes somewhere — the chevron is a promise', async () => {
    // ADR-0033 Amendment 2 shipped a row with a chevron and no action, found on
    // a device screenshot rather than by any of 427 green specs. An affordance
    // that does not act reads as a broken row.
    const { getByTestId } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: false }} />,
    );
    fireEvent.press(getByTestId('fasting-empty-link'));
    // Today, because that is the only place the emptiness can be resolved: it
    // is where the timer is. `replace` rather than `push` — Today is a sibling
    // tab, and pushing a tab route stacks a second copy of it over Trends.
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });

  it('does not tell someone mid-fast that they have no fasts', async () => {
    const { queryByText } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: true }} />,
    );
    expect(queryByText(/your fast is running/i)).toBeTruthy();
    expect(queryByText(/from now on/i)).toBeNull();
  });

  it('names the threshold when some fasts exist, rather than waiting silently', async () => {
    // A silent wait reads as "nothing happened", which is how a user concludes
    // the feature is broken and stops using it.
    const { queryByText } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 2, fastRunning: false }} />,
    );
    expect(queryByText(/2 of 3 fasts/i)).toBeTruthy();
  });

  it('says Ignia keeps fasts FROM NOW ON when there is nothing at all', async () => {
    // The specific misreading this closes: a user who fasted for months before
    // #97 shipped has no history, and "no fasts yet" reads as data loss rather
    // than as a feature that just started.
    const { queryByText } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: false }} />,
    );
    expect(queryByText(/from now on/i)).toBeTruthy();
  });
});

describe('what the card says', () => {
  it('leads with a typical length, not a score', async () => {
    const { queryByText } = await render(<FastingTrendsCard fasting={cardState(THREE)} />);
    // Median of 14/16/18 is 16. A duration, never a 0-100 score: every scored
    // fasting app builds its number from signals Ignia does not have.
    expect(queryByText(/16h 0m typical/i)).toBeTruthy();
  });

  it('counts FASTS in the caption and DAYS in the footer — they are not the same number', async () => {
    // Two fasts ending on one day is one column and two fasts. Conflating them
    // is the easiest wrong number to print here.
    const twoOnOneDay: Fast[] = [
      fastEndingOn(2, 14),
      { startedAt: new Date(2026, 7, 3, 14), endedAt: new Date(2026, 7, 3, 20) },
      fastEndingOn(6, 18),
    ];
    const state = cardState(twoOnOneDay);
    expect(state.kind === 'card' && state.fastCount).toBe(3);
    expect(state.kind === 'card' && state.window.daysWithFast).toBe(2);

    const { queryByText } = await render(<FastingTrendsCard fasting={state} />);
    expect(queryByText(/3 fasts in 14 days/i)).toBeTruthy();
    expect(queryByText(/a fast on 2 of 14 days/i)).toBeTruthy();
  });

  it('states the RANGE, because the chart cannot say it', async () => {
    // The device build is what forced this line. With a real 16:8 habit every
    // bar lands between 65% and 73% of a 24-hour strip, so twelve bars all look
    // the same and the card was asking the reader to infer consistency from a
    // wall of identical blocks. 14h / 18h here.
    const { queryByText } = await render(<FastingTrendsCard fasting={cardState(THREE)} />);
    expect(queryByText(/ran between 14h 0m and 18h 0m/i)).toBeTruthy();
  });

  it('names the median beside the line that draws it', async () => {
    // A reference line with no value next to it is a decoration. This is the
    // one element that makes the strip readable.
    const { queryByText } = await render(<FastingTrendsCard fasting={cardState(THREE)} />);
    expect(queryByText(/your median, 16h 0m/i)).toBeTruthy();
  });

  it('labels the axis, so a bar height means something', async () => {
    const { queryByText } = await render(<FastingTrendsCard fasting={cardState(THREE)} />);
    expect(queryByText('24h')).toBeTruthy();
    expect(queryByText('0h')).toBeTruthy();
  });

  it('draws a column only for a day a fast actually ended on', async () => {
    const state = cardState(THREE);
    expect(state.kind === 'card' && state.window.days).toHaveLength(FASTING_WINDOW_DAYS);
    // The other eleven are null, not zero. A zero-height bar would say the user
    // fasted for no time, which is a claim about them rather than about data.
    expect(state.kind === 'card' && state.window.days.filter((d) => d.hours != null)).toHaveLength(3);
  });

  it('never implies a target, a protocol, a streak or a metabolic stage', async () => {
    // ADR-0032 rules all four out by name, and the likely way they arrive is a
    // well-meaning STRING rather than a new component — so this asserts the
    // strings, in every locale, rather than one render of one of them.
    const dicts = [en, esPR, ptBR];
    const forbidden = [
      'ketosis',
      'autophagy',
      'autofagia',
      'streak',
      'racha',
      'sequência',
      '16:8',
      'omad',
      'goal',
      'meta',
    ];
    for (const dict of dicts) {
      for (const [k, v] of Object.entries(dict)) {
        if (!k.startsWith('trends.fasting')) continue;
        for (const word of forbidden) {
          expect(String(v).toLowerCase()).not.toContain(word);
        }
      }
    }
  });
});

describe('the stub row can be dismissed (#103)', () => {
  beforeEach(() => {
    mockDismiss.mockReset();
    mockDismissed = false;
  });

  afterEach(() => {
    mockDismissed = false;
  });

  it('offers a dismiss beside the row', async () => {
    const { queryByTestId } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: false }} />,
    );
    expect(queryByTestId('fasting-stub-dismiss')).toBeTruthy();
  });

  it('dismissing renders NOTHING — not a collapsed row, not a hairline', async () => {
    // A residue of the thing you asked to remove is worse than the thing.
    mockDismissed = true;
    const { queryByTestId } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: false }} />,
    );
    expect(queryByTestId('fasting-empty-row')).toBeNull();
    expect(queryByTestId('fasting-stub-dismiss')).toBeNull();
  });

  it('calls the dismiss, not the navigation', async () => {
    const { getByTestId } = await render(
      <FastingTrendsCard fasting={{ kind: 'empty', recorded: 0, fastRunning: false }} />,
    );
    fireEvent.press(getByTestId('fasting-stub-dismiss'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    // The two actions are opposites and sit a few pixels apart, which is why
    // the dismiss is a SIBLING pressable rather than nested inside the
    // navigating one — nesting makes which one fired depend on geometry.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('STILL renders the card once the evidence arrives, dismissed or not', async () => {
    // The flag is only ever read in the empty state. This is what makes a
    // one-way dismiss acceptable with no restore affordance: the row comes back
    // as a card the moment it has something to say.
    mockDismissed = true;
    const { queryByTestId } = await render(<FastingTrendsCard fasting={cardState(THREE)} />);
    expect(queryByTestId('fasting-card')).toBeTruthy();
    expect(queryByTestId('fasting-strip')).toBeTruthy();
  });
});
