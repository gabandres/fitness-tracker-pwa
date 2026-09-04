import React from 'react';
import type { RecalibrationDigest } from '@macrolog/core';
import { renderWithProviders as render } from '@/test-utils';

/**
 * The card must not announce an event that did not happen.
 *
 * Until 2026-09-04 it could not tell a first disclosure from a real move,
 * because the two always coincided: the digest was gated on `reliable`, and
 * crossing into `reliable` was the same moment `dailyTargets` switched the
 * day's target to the estimator. `c93a740c` decoupled them — the target now
 * follows the estimator from the moment measured mode opens, and the digest
 * lost the same gate — so the card can reach an account whose target never
 * moved. It did, on the owner's phone, the hour it shipped: it announced a
 * recalibration and "set" a target that read 1,944 before and after.
 *
 * `deltaSinceAck` is the discriminator and needs no new state: null means
 * nothing has been acknowledged, so this is a first showing rather than a
 * drift away from a number the user already saw.
 */

const digest = (over: Partial<RecalibrationDigest> = {}): RecalibrationDigest => ({
  available: true,
  trueTdee: 2396,
  calorieTarget: 1944,
  weightTrendLbPerWeek: -0.7,
  loggingCompletenessPct: 67,
  deltaSinceAck: null,
  deltaVsFormula: -300,
  trend: 'metabolism-slowed',
  shouldSurface: true,
  ...over,
});

let mockDigest: RecalibrationDigest = digest();
jest.mock('@/hooks/useRecalibration', () => ({
  useRecalibration: () => ({ digest: mockDigest, acknowledge: jest.fn() }),
}));

// `test-utils` -> `i18n/index` -> `lib/auth` -> `firebase/auth`, whose ESM the
// jest transform does not take. The i18n provider only reads `useAuth().user`
// (for the profile locale), so the whole module is stubbed to that — same
// approach as `SignInMethodsCard.test.tsx`.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' } }),
}));

// Imported after the mock so the hook is replaced before the module binds it.
import { RecalibrationCard } from './RecalibrationCard';

describe('RecalibrationCard', () => {
  it('a first showing states the number, and does NOT claim a recalibration', async () => {
    mockDigest = digest({ deltaSinceAck: null });
    const screen = await render(<RecalibrationCard />);

    expect(screen.getByText('Your measured burn is ready')).toBeTruthy();
    // The regression: this account's target did not move, so the event wording
    // must not appear. Revert the split and this fails.
    expect(screen.queryByText('Your target just recalibrated')).toBeNull();
  });

  it('a drift away from an acknowledged number keeps the event wording', async () => {
    mockDigest = digest({ deltaSinceAck: -200 });
    const screen = await render(<RecalibrationCard />);

    expect(screen.getByText('Your target just recalibrated')).toBeTruthy();
    expect(screen.queryByText('Your measured burn is ready')).toBeNull();
  });

  it('renders nothing when the digest has nothing worth surfacing', async () => {
    mockDigest = digest({ shouldSurface: false });
    const screen = await render(<RecalibrationCard />);
    expect(screen.queryByTestId('recalibration-card')).toBeNull();
  });
});
