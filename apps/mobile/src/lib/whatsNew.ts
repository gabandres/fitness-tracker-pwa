import AsyncStorage from '@react-native-async-storage/async-storage';

// Bump this when there's something new worth a one-time banner on Today.
// Mirrors the PWA's WHATS_NEW_VERSION pattern: the banner shows until the
// user dismisses it, then the seen version is stored so it stays hidden until
// the next bump. Device-local (AsyncStorage), like the reminder prefs.
// Suffixed because the copy changed twice in one day: the first 2026-08-07
// value shipped without the home-screen widget, which was still unverified on
// Android at the time. Anyone who already saw and dismissed that one needs to
// see the corrected copy, and equality against the stored value is the only
// thing that decides it — so the string just has to differ, not parse as a date.
// NOT re-bumped for the mobility ship (2026-08-27). Same-day precedent, from
// the third meal-text OTA earlier today: extending the copy tells anyone who
// has not yet seen today's banner about both changes, while re-bumping would
// re-fire the banner at everyone who dismissed it hours ago. Equality against
// the stored value is the only thing that decides it, so unchanged = no nag.
export const WHATS_NEW_VERSION = '2026-08-27-your-words';

const KEY = 'whatsNew.seen';

export async function getWhatsNewSeen(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function markWhatsNewSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, WHATS_NEW_VERSION);
}
