import AsyncStorage from '@react-native-async-storage/async-storage';
import type Ionicons from '@expo/vector-icons/Ionicons';
import type { I18nKey } from '@/i18n';

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
// NOT bumped 2026-09-04 (third OTA of the day: the 70% reliability cliff — a
// measured estimate now governs from the moment measured mode opens, instead of
// waiting for 70% logging completeness). The note directly above says "if the
// target move does draw questions, the banner is the channel — bump then". It
// has not, and this change is a weaker case for a banner than that one was, on
// a fact measured before publishing: it moves EXACTLY TWO of 22 accounts with
// logs (`review@` +144, one real user −140). The other twenty see byte-identical
// numbers, because they are custom mode, carry no seed, or have no measured
// estimate at all.
//
// So a bump would fire a banner at twenty people about something that changed
// nothing for them, and — the deciding half, same as the second OTA above —
// `2026-09-04-scan-fixed` went out hours earlier and users see a banner on their
// SECOND launch, so most have not reached it yet. Re-bumping would REPLACE a
// message they never saw, and that message is the one the owner explicitly
// asked for.
//
// It does not help the one user it could help, either. A global banner saying
// targets adapt sooner cannot explain a specific −140 on a specific account;
// that is `recalibrationDigest`'s job, and it declines here because that
// account's `ci95Tdee` is null. That silence is a known, accepted cost recorded
// in `targets.ts` — a banner is not the fix for it, and pretending otherwise
// would be worse than leaving it visible.
// NOT bumped 2026-09-05 (maintenance mode + the post-OTA sign-in flash fix).
// The flash fix is a bug fix with no user-visible surface on a healthy launch.
// Maintenance mode reaches only an account whose weight trend has crossed its
// own goal, and it announces itself IN PLACE — the card on Body, in the slot
// the goal-reached prompt vacates. A banner to everyone would read "when you
// reach your goal you can…", which is exactly the forward-looking pressure
// `milestones.ts` and UX_AUDIT §S12 keep out of this app. Same precedent as
// the milestones non-bump above.
// Bumped 2026-09-15 for the progression engine (ADR-0038): every clustered
// lift on Train now carries a call for the next session (add load / hold /
// repeat) with its reason, a "Next session" line under each template, and
// weekly cluster chips. A lifter sees new UI on the next Train-tab open, so
// the banner explains what the words mean — and says plainly that an invalid
// read means "repeat", not "you did it wrong".
// Re-bumped the same day, on the owner's instruction, when the banner became
// a full screen (`app/whats-new.tsx`): the notes are the same release, but
// whoever dismissed the CARD never saw the screen, and the owner wants it
// seen. The same-day re-bump precedent above still stands for bug fixes;
// this is a new surface, not a second copy of the same one.
// Bumped 2026-09-16 for ADR-0039 + ADR-0040. This one is not announcing a
// gain — it is getting ahead of a loss that is not one. Once the OTA lands,
// every clustered lift reads "Calibrating — 0 of 3 valid sessions logged" and
// makes no load call, because the rep band is now DERIVED per lift from reads
// at the new RIR 0 standard and the 706 pre-cutoff sets are deliberately
// excluded from deriving it. That is the ADR working as designed, and it is
// indistinguishable from data loss to anyone who was not told. The precedent
// this follows is the 2026-09-01 rest-timer bump ("a behaviour every lifter
// feels on the next session is worth one banner"), not the bug-fix non-bumps:
// the screen is the only channel an OTA has, and the thing it has to say is
// "this is supposed to look like that".
// Bumped 2026-09-17 for ADR-0041 plus the rest-pause fix. Two bumps in two days
// because the 09-16 banner shipped in OTA `478e00b4` and said nothing about
// either: ADR-0041 rearranges the whole Train tab, and the rest fix changes a
// duration every lifter feels on the very next set. Both clear the bar this file
// already set on 2026-09-01 — "a behaviour every lifter feels on the next session
// is worth one banner" — and neither is a bug-fix non-bump.
// The catalog going back to an inline list is deliberately NOT announced: the
// sheet it reverts was never in a shipped build, so for a user nothing changed.
// NOT bumped 2026-09-21 (the verify-email resend copy). A clear bug-fix
// non-bump, and the closest precedent is the 2026-09-04 scan-fixed bump that
// went the OTHER way — so the difference is worth stating. That one earned a
// banner because five days of failures gave users "a concrete memory of it
// failing and no way to know it works again". This one has no such cohort:
// Firebase Auth's throttle only answers a resend tapped seconds after the
// automatic sign-up send, inside a window most users never enter, and the
// production log shows it reaching exactly one account. The people it did hit
// are mid-signup and have not reached a Today banner at all — the screen this
// fires on is one they see after onboarding. A banner would announce a wrong
// error message to thousands who never saw it.
export const WHATS_NEW_VERSION = '2026-09-17-train-logger';

const KEY = 'whatsNew.seen';

export async function getWhatsNewSeen(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function markWhatsNewSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, WHATS_NEW_VERSION);
  } catch {
    // Storage unavailable: the screen reappears next launch, a nuisance
    // rather than a fault. Same stance as the tour's flag.
  }
}

/**
 * The release notes as DATA — icon plus two dictionary keys per item, so the
 * screen reads in whichever language the phone does and the list is three
 * rows, not a paragraph. Rewrite this list with every `WHATS_NEW_VERSION`
 * bump; the previous release's items do not carry over.
 */
export interface WhatsNewItem {
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: I18nKey;
  bodyKey: I18nKey;
}

export const WHATS_NEW_ITEMS: readonly WhatsNewItem[] = [
  { icon: 'barbell-outline', titleKey: 'whatsNew.logger.title', bodyKey: 'whatsNew.logger.body' },
  { icon: 'timer-outline', titleKey: 'whatsNew.restpause.title', bodyKey: 'whatsNew.restpause.body' },
];

/**
 * Should the What's New screen open by itself right now — and if not, should
 * the release be marked seen without showing it?
 *
 * Pure, so the judgement calls live in a test rather than on a device:
 *
 *  - **A fresh install reads nothing.** Everything is new to somebody who just
 *    arrived; release notes on day one are a tour, and the tour is a separate
 *    screen. "Fresh" is: nothing ever stored AND the tour not yet seen. The
 *    caller marks the current release seen (`'mark'`) so the NEXT release is
 *    the first one they read about. An existing user who simply never
 *    dismissed the old banner has toured, so they still get this one.
 *  - **Once per release**, keyed by `WHATS_NEW_VERSION` — several OTAs can
 *    ride one set of notes and none of them re-opens it.
 *  - **Never over someone mid-task**: only from the tab root, never during
 *    onboarding, the tour, or onboarding's first-log sheet.
 *
 * @param seen     the stored version; `undefined` while storage is loading,
 *                 `null` when nothing was ever stored
 * @param tourSeen the tour flag; `null` while loading
 */
export function shouldAutoOpenWhatsNew(args: {
  seen: string | null | undefined;
  profileCompleted: boolean;
  route: string | undefined;
  tourSeen: boolean | null;
  held?: boolean;
}): 'open' | 'mark' | 'none' {
  const { seen, profileCompleted, route, tourSeen, held = false } = args;
  if (seen === undefined || tourSeen === null) return 'none';
  if (seen === WHATS_NEW_VERSION) return 'none';
  if (!profileCompleted) return 'none';
  if (seen === null && !tourSeen) return 'mark';
  if (!tourSeen) return 'none';
  if (held) return 'none';
  return route === 'index' ? 'open' : 'none';
}
