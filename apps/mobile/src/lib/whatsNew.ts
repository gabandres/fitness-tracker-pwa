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
// Bumped for the mobility ship. The first mobility OTA deliberately did NOT
// bump — it only extended the meal-text copy, on the same-day precedent that a
// re-bump nags whoever dismissed the banner hours earlier. This one is a
// judgement the owner made explicitly: a new way to log a whole category of
// work is worth re-firing for, where a bug fix was not. The body leads with
// mobility and keeps a condensed meal-text paragraph, because anyone who
// dismissed the earlier banner never read that part either.
// Bumped for the Trends water card (#115 §3, 2026-08-30). Milestones shipped
// two days earlier and deliberately did NOT bump — a banner announcing a record
// is the forward pressure that feature is built to avoid — so the copy leads
// with water and says nothing about them.
// Bumped 2026-09-01 for the rest-timer change: the countdown now follows the
// set that is COMING (short inside a cluster, long after its last mini), and an
// exercise can carry its own mini-set rest. A behaviour every lifter feels on
// the next session is worth one banner.
export const WHATS_NEW_VERSION = '2026-09-01-rest-timer';

const KEY = 'whatsNew.seen';

export async function getWhatsNewSeen(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function markWhatsNewSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, WHATS_NEW_VERSION);
}
