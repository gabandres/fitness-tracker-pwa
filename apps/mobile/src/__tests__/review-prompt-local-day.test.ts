/**
 * The rating prompt counts DISTINCT DAYS with a positive moment, and a day is
 * the user's local calendar day — not the UTC date. Until 2026-09-28 it was
 * `toISOString().slice(0, 10)`, so in UTC+14 a 01:00 workout filed under
 * yesterday and an evening one in UTC-5 filed under tomorrow.
 */
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(async () => false),
  hasAction: jest.fn(async () => false),
  requestReview: jest.fn(async () => undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MIDNIGHT, dayKeyAt } from '@macrolog/core';
import { recordPositiveMoment, resetReviewPromptState, reviewDayKey } from '@/lib/reviewPrompt';

afterEach(async () => {
  jest.useRealTimers();
  await resetReviewPromptState();
});

const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

it('keys a moment by the LOCAL calendar day, which differs from the UTC date near midnight', () => {
  // Pick the local hour that puts UTC on the other side of midnight in
  // whatever zone runs this: 23:00 west of Greenwich, 01:00 east of it.
  const probe = new Date(2026, 8, 28, 12, 0, 0);
  const west = probe.getTimezoneOffset() > 0;
  const at = new Date(2026, 8, 28, west ? 23 : 1, 0, 0);
  expect(reviewDayKey(at)).toBe('2026-09-28');
  expect(reviewDayKey(at)).toBe(localKey(at));
  expect(reviewDayKey(at)).toBe(dayKeyAt(at, MIDNIGHT));
  if (probe.getTimezoneOffset() !== 0) {
    // The old computation, shown wrong under this zone.
    expect(at.toISOString().slice(0, 10)).not.toBe(reviewDayKey(at));
  }
});

it('two moments on one local day count once; the next local day counts again', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 28, 1, 0, 0));
  await recordPositiveMoment();
  jest.setSystemTime(new Date(2026, 8, 28, 22, 0, 0));
  await recordPositiveMoment();
  expect(JSON.parse((await AsyncStorage.getItem('review.momentDays')) ?? '[]')).toEqual(['2026-09-28']);
  jest.setSystemTime(new Date(2026, 8, 29, 0, 30, 0));
  await recordPositiveMoment();
  expect(JSON.parse((await AsyncStorage.getItem('review.momentDays')) ?? '[]')).toEqual(['2026-09-28', '2026-09-29']);
});
