import { Stack } from 'expo-router';

/**
 * History's own stack: the calendar, then a day pushed over it.
 *
 * History itself is a ROOT route pushed over the tabs on the native stack
 * (UX_AUDIT Today review P1, `lib/root-stack.ts`) — no tab bar, swipe-back on
 * iOS, hardware back on Android — the way Coach and Milestones moved in
 * S18-14. It was a hidden TAB until 2026-10-04, which is why it had no back
 * at all: a hidden tab is not on any stack, so there was nothing to go back
 * to and nothing for the edge-swipe to do.
 *
 * `initialRouteName` is meant to put the calendar beneath a day opened cold
 * (a deep link straight to `/history/2026-08-09`). It is NOT applied to a
 * push: Today's "‹ yesterday" lands the day as this stack's only screen, so
 * the system header has no back button to show (owner stranded, 2026-10-07).
 * The day therefore draws its own back (`leaveDay` in `[date].tsx`).
 *
 * Headers are off by default — the calendar draws its own — and the day
 * turns the native header on for itself (`[date].tsx`, Today re-score) so
 * its title can carry the day arrows.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function HistoryStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
