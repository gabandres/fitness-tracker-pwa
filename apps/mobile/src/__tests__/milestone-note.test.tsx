jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { MilestoneNote } from '@/components/MilestoneNote';
import type { MilestoneKey } from '@macrolog/core';

/**
 * The first run BACKFILLS, and that is what this covers.
 *
 * Every milestone an account has ever earned is recorded the day the feature
 * arrives, so an existing user's first note is not one line. The owner's own
 * screenshot showed four stacked above the fold on Today with no way to clear
 * them; a hundred-day streak would show eight. Both fixes — the cap and the
 * dismiss — came from that screenshot rather than from any test, so they get
 * one here.
 */

const FIVE: MilestoneKey[] = [
  'first-weigh-in',
  'first-workout',
  'streak-7',
  'streak-14',
  'streak-30',
];

const noop = () => {};

describe('MilestoneNote', () => {
  // The dismissal is a real AsyncStorage write and the mock persists across
  // tests in a file — without this, one test's dismiss silently hides the row
  // in the next and the failure looks like a broken component.
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('renders nothing when nothing was recorded today', async () => {
    const { queryByTestId } = await render(
      <MilestoneNote keys={[]} dayKey="2026-08-30" onOpen={noop} />,
    );
    // Not an empty shell — a permanent fixture announcing that nothing
    // happened is worse than no row.
    expect(queryByTestId('milestone-note')).toBeNull();
  });

  it('caps the visible titles and counts the rest', async () => {
    const { getByTestId, queryByText } = await render(
      <MilestoneNote keys={FIVE} dayKey="2026-08-30" onOpen={noop} />,
    );
    expect(getByTestId('milestone-note')).toBeTruthy();
    // Three shown, two counted.
    expect(queryByText('First weigh-in')).toBeTruthy();
    expect(queryByText('A week of logging')).toBeTruthy();
    expect(queryByText('Two weeks of logging')).toBeNull();
    expect(queryByText('+2 more')).toBeTruthy();
  });

  it('shows no counter when everything fits', async () => {
    const { queryByText } = await render(
      <MilestoneNote keys={FIVE.slice(0, 2)} dayKey="2026-08-30" onOpen={noop} />,
    );
    expect(queryByText(/more$/)).toBeNull();
  });

  it('opens the archive when the label is pressed', async () => {
    const onOpen = jest.fn();
    const { getByTestId } = await render(
      <MilestoneNote keys={FIVE} dayKey="2026-08-30" onOpen={onOpen} />,
    );
    fireEvent.press(getByTestId('milestone-note-open'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('dismisses without asking the caller for anything', async () => {
    // The dismiss is entirely local: no callback, no write to Firestore, and
    // it must not require the parent to re-render for the row to go.
    const { getByTestId, queryByTestId } = await render(
      <MilestoneNote keys={FIVE} dayKey="2026-08-30" onOpen={noop} />,
    );
    fireEvent.press(getByTestId('milestone-note-dismiss'));
    // `waitFor`, not a synchronous assertion: under React 19 the state update a
    // press schedules is not committed when `fireEvent.press` returns, so a
    // direct read here sees the PREVIOUS render (AGENTS.md, from the FastSheet
    // work).
    await waitFor(() => expect(queryByTestId('milestone-note')).toBeNull());
  });

  it('the dismiss and the open are separate targets', async () => {
    // Nesting one touchable inside another makes which one fired depend on a
    // few pixels, and these two actions are opposites.
    const onOpen = jest.fn();
    const { getByTestId } = await render(
      <MilestoneNote keys={FIVE} dayKey="2026-08-30" onOpen={onOpen} />,
    );
    fireEvent.press(getByTestId('milestone-note-dismiss'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
