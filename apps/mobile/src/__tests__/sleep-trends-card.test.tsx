// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import { SLEEP_MIN_NIGHTS, SLEEP_WINDOW_DAYS, sleepWindow, type SleepEntry } from '@macrolog/core';
import { SleepTrendsCard } from '@/components/SleepTrendsCard';
import type { SleepTrends } from '@/hooks/useSleepTrends';

/**
 * The three states of the sleep card, and the two things it must never say
 * (ADR-0033, issue #81).
 *
 * The arithmetic is pinned in `packages/core/src/sleep-intake.test.ts`. What is
 * here is the rendering contract: which state produces a card and which
 * produces one row, that the sentence appears only with a contrast, and that
 * the copy stays descriptive.
 *
 * **RNTL runs no Yoga layout pass**, so nothing below proves the strip is the
 * right shape on a 360×720 dp screen. That is a device screenshot's job and it
 * is the reason this repo has shipped layout bugs past 400 green specs.
 */

const key = (i: number) => `2026-03-${String(i + 1).padStart(2, '0')}`;
const keys = Array.from({ length: SLEEP_WINDOW_DAYS }, (_, i) => key(i));

function cardState(
  nights: number,
  contrast: Extract<SleepTrends, { kind: 'card' }>['contrast'] = null,
): SleepTrends {
  const sleepByDay: Record<string, SleepEntry> = {};
  for (let i = 0; i < nights; i++) sleepByDay[key(i)] = { hours: 6.5, source: 'import' };
  return { kind: 'card', window: sleepWindow(sleepByDay, keys), contrast };
}

const CONTRAST = {
  shortCount: 5,
  longCount: 6,
  shortMeanKcal: 2410,
  longMeanKcal: 2150,
  differenceKcal: 260,
  shortKeys: [key(0), key(1), key(2), key(3), key(4)],
  medianHours: 6.75,
};

describe('state 3 — no sleep at all, which is most people', () => {
  it('renders one row and no card', async () => {
    const { queryByTestId, getByTestId } = await render(
      <SleepTrendsCard sleep={{ kind: 'empty', connectedTo: null }} />,
    );

    expect(getByTestId('sleep-empty-row')).toBeTruthy();
    // No card and no section header: a permanently empty widget on a screen
    // this dense is the generic-dashboard failure.
    expect(queryByTestId('sleep-card')).toBeNull();
  });

  it('says something DIFFERENT when a source is connected and has produced nothing', async () => {
    // ADR-0026's empty-state rule: the Oura app can have its export switched
    // off, so "you have no sleep" would be a lie about the user rather than a
    // fact about the integration.
    const invite = await render(<SleepTrendsCard sleep={{ kind: 'empty', connectedTo: null }} />);
    const connected = await render(<SleepTrendsCard sleep={{ kind: 'empty', connectedTo: 'oura' }} />);

    expect(invite.getByText(/connect Oura or Apple Health/)).toBeTruthy();
    expect(connected.getByText(/connected to Oura — no nights yet/)).toBeTruthy();
  });

  it('taps through to Connected apps — the chevron is a promise', async () => {
    // It was inert in the first device build, and a chevron that does nothing
    // reads as a broken row rather than as decoration. Caught by looking at a
    // screenshot; pinned here so it cannot come back.
    mockPush.mockClear();
    const { getByTestId } = await render(
      <SleepTrendsCard sleep={{ kind: 'empty', connectedTo: null }} />,
    );

    fireEvent.press(getByTestId('sleep-empty-link'));

    expect(mockPush).toHaveBeenCalledWith('/connected-apps');
  });

  it('renders nothing at all while the listener has not answered', async () => {
    // A listener that has not spoken is not "no sleep". Showing the invitation
    // first and a card a frame later is the flash this avoids.
    const { queryByTestId } = await render(<SleepTrendsCard sleep={{ kind: 'pending' }} />);

    expect(queryByTestId('sleep-card')).toBeNull();
    expect(queryByTestId('sleep-empty-row')).toBeNull();
  });
});

describe('state 2 — some nights, not enough', () => {
  it('shows the card and the progress line, naming the exact threshold', async () => {
    const { getByTestId, queryByTestId } = await render(<SleepTrendsCard sleep={cardState(5)} />);

    expect(getByTestId('sleep-card')).toBeTruthy();
    expect(getByTestId('sleep-strip')).toBeTruthy();
    expect(queryByTestId('sleep-claim')).toBeNull();
    // A silent wait reads as "nothing happened", and that is how a Health
    // connection gets revoked.
    expect(getByTestId('sleep-progress').props.children).toContain(String(SLEEP_MIN_NIGHTS));
  });

  it('captions the headline with the nights it actually has', async () => {
    const { getByText } = await render(<SleepTrendsCard sleep={cardState(5)} />);
    expect(getByText('a night, 5 nights')).toBeTruthy();
  });
});

describe('state 1 — the sentence', () => {
  const full = cardState(SLEEP_WINDOW_DAYS, CONTRAST);

  it('states the comparison in the user’s own units', async () => {
    const { getByTestId } = await render(<SleepTrendsCard sleep={full} />);

    expect(getByTestId('sleep-claim').props.children).toBe(
      'On your 5 shortest nights you logged 2,410 kcal — 260 more than on your 6 longest.',
    );
  });

  it('says "less" when the difference is negative', async () => {
    // A card that only knew the magnitude would tell a user who eats less when
    // tired that they eat more.
    const less = cardState(SLEEP_WINDOW_DAYS, {
      ...CONTRAST,
      differenceKcal: -260,
      shortMeanKcal: 1890,
    });
    const { getByTestId } = await render(<SleepTrendsCard sleep={less} />);

    expect(getByTestId('sleep-claim').props.children).toContain('260 less than');
  });

  it('qualifies the claim rather than causing it', async () => {
    const { getByText } = await render(<SleepTrendsCard sleep={full} />);
    expect(getByText('Your own days, side by side. A pattern, not a proof.')).toBeTruthy();
  });

  it('names provenance at window level and never a provider', async () => {
    const { getByText, queryByText } = await render(<SleepTrendsCard sleep={full} />);

    expect(getByText(/14 of 14 nights · imported/)).toBeTruthy();
    // `dailySleep` has no `provider` field, so this claim is unsupportable and
    // must not appear even by accident.
    expect(queryByText(/via Oura/)).toBeNull();
  });
});

describe('the vocabulary the card is forbidden', () => {
  it('renders no score, no percentage and no coefficient in any state', async () => {
    const states: SleepTrends[] = [
      { kind: 'empty', connectedTo: null },
      cardState(5),
      cardState(SLEEP_WINDOW_DAYS, CONTRAST),
    ];

    for (const state of states) {
      const text = JSON.stringify((await render(<SleepTrendsCard sleep={state} />)).toJSON());
      // A 0–100 built from one duration is a number wearing a costume, and an
      // `r` at n≈14 is noise with a decimal point. Both are ruled out by name
      // in ADR-0033, so both are asserted here rather than left to review.
      expect(text).not.toMatch(/\bscore\b/i);
      expect(text).not.toMatch(/correlat/i);
      expect(text).not.toMatch(/\/\s*100\b/);
    }
  });
});
