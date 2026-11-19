import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';

/**
 * Tour card order (2026-11-19). The tour opens right after the first add
 * sheet closes, so its reader has just logged. The FIRST card is what the
 * numbers on Today mean, starting with the big "kcal left" (an audit found the
 * tour explained "0 / 2,000 kcal" but never that number); "ways to log" moves
 * near the end. Six cards or fewer, skippable from the first.
 */

const mockReplace = jest.fn();
const mockMarkSeen = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/tour', () => ({ markTourSeen: (...a: unknown[]) => mockMarkSeen(...a) }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

import Tour from '@/app/tour';

beforeEach(() => {
  mockReplace.mockClear();
  mockMarkSeen.mockClear();
});

type Screen = Awaited<ReturnType<typeof render>>;

/** Walk Next to the end, collecting each card's step id. */
async function cardOrder(screen: Screen): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const card = screen.getByTestId(/^tour-step-/);
    ids.push(String(card.props.testID).replace('tour-step-', ''));
    if (screen.queryByTestId('tour-done')) break;
    await fireEvent.press(screen.getByTestId('tour-next'));
  }
  return ids;
}

it('opens on the numbers card, and that card explains "kcal left" first', async () => {
  const screen = await render(<Tour />);
  expect(screen.getByTestId('tour-step-numbers')).toBeTruthy();
  // The first row of the first card is the kcal-left row (its label and its
  // plain-sentence explanation), before "0 / 2,000 kcal".
  const { en } = jest.requireActual('@/i18n/en') as { en: Record<string, string> };
  const label = en['tour.numbers.left'] ?? 'tour.numbers.left';
  const sub = en['tour.numbers.leftSub'] ?? 'tour.numbers.leftSub';
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText(sub)).toBeTruthy();
});

it('keeps six cards or fewer, numbers first, ways-to-log after the map', async () => {
  const screen = await render(<Tour />);
  const ids = await cardOrder(screen);
  expect(ids.length).toBeLessThanOrEqual(6);
  expect(ids[0]).toBe('numbers');
  expect(ids.indexOf('log')).toBeGreaterThan(ids.indexOf('map'));
  expect(ids[ids.length - 1]).toBe('done');
});

it('is skippable from the first card, and Skip marks it seen', async () => {
  const screen = await render(<Tour />);
  await fireEvent.press(screen.getByTestId('tour-skip'));
  expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith('/(app)');
});
