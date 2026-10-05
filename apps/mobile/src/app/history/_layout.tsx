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
 * `initialRouteName` puts the calendar beneath a day opened cold (a deep
 * link straight to `/history/2026-08-09`), so back from that day lands on the
 * month, not out of History.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function HistoryStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
