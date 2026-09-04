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
// Bumped 2026-09-03 for 1.2.2 (vc 44 / build 63): the owner wants the banner
// to announce the new icon, the dark launch screen and Health Connect on
// Android to everyone automatically. Published as an OTA on the NEW runtimes
// so it fires on the second launch after the store update.
// Bumped 2026-09-04, on the owner's explicit instruction, for the photo-scan
// outage. This one is unlike every bump above it: the others announced
// something gained, this one tells people something they already noticed is
// fixed. Scanning returned `429` from the AI provider on every call from
// 2026-08-30 — five days — and the app blamed the user's photograph the whole
// time, so anyone who tried has a concrete memory of it failing and no way to
// know it works again. A banner is the only channel that reaches them: an OTA
// carries no store release notes.
// NOT bumped 2026-09-04 (second OTA of the day: the onboarding-redo overwrite
// and the in-progress-day TDEE fix). Recorded because a non-bump is a decision
// here, and the owner asked for the banner "if needed". Three reasons it was
// not: (1) `2026-09-04-scan-fixed` above shipped hours earlier and users see a
// banner on their SECOND launch, so most have not reached it — a re-bump would
// replace a message they never saw, and that message is the one the owner
// explicitly asked for; (2) the same-day re-bump precedent already recorded
// above (the first mobility OTA declined for exactly this reason: it nags
// whoever dismissed the banner hours earlier); (3) what a user would notice is
// their calorie target moving ~2%, UPWARD, and stopping its daily sag — the
// benign direction. The onboarding half is invisible unless you re-run the
// wizard. If the target move does draw questions, the banner is the channel —
// bump then, with copy about the target, not about the bug.
export const WHATS_NEW_VERSION = '2026-09-04-scan-fixed';

const KEY = 'whatsNew.seen';

export async function getWhatsNewSeen(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function markWhatsNewSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, WHATS_NEW_VERSION);
}
