import AsyncStorage from '@react-native-async-storage/async-storage';

// The guided tour's "have they seen it" flag.
//
// ## Why this exists at all
//
// A real user asked for it: *"she needs some kind of tutorial or something.
// Like a walkthrough of the app"* (UX_AUDIT, F0, 2026-08-22). The app has never
// explained itself — it is learnable only by tapping at it, which serves the
// people who learn that way and nobody else. GenderMag (Burnett et al.) calls
// that split LEARNING STYLE, tinkering vs process-oriented, and it is one of
// five problem-solving facets whose individual differences cluster by gender.
//
// The load-bearing consequence is what it does NOT license: those are
// statistical clusters, not rules about individuals, so this is a path anyone
// can take and there is no gender branch anywhere in it.
//
// ## Why AsyncStorage and not the profile
//
// Device-local is the right shape and the cheaper one. A Firestore field would
// need a `firestore.rules` change deployed before any client could write it
// (the profile is validated with `keys().hasOnly`), and it would buy only
// cross-device suppression of a screen the user can dismiss in one tap. The
// precedent is already here: `appUpdate.dismissed` in `app-update.ts`.
//
// The cost is honest and small: a new device shows the tour once more. For a
// tour, being offered again on a new phone is closer to right than wrong.

const SEEN_KEY = 'tour.seen';

/** Has the user finished or skipped the tour on this device? `false` on any
 *  storage error — the tour is cheap to show and a lost flag must not become a
 *  crash. */
export async function loadTourSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Record that the tour is done. Called on BOTH the last step and Skip —
 *  skipping is a decision, and re-offering it would punish it. */
export async function markTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage unavailable. The tour reappears next launch, which is a nuisance
    // rather than a fault; there is nothing useful to do about it here.
  }
}

/**
 * Should the tour open by itself right now?
 *
 * Pure, because the two ways this can go wrong are both judgement calls that
 * deserve a test rather than a device:
 *
 *  - opening it for someone mid-task, or on top of another screen;
 *  - never reaching the EXISTING users, who are the ones who asked for it.
 *
 * The second is why this is not simply wired into the end of onboarding. The
 * user who reported the gap already has an account; a first-run-only tour
 * would reach every future user and not the one who asked.
 *
 * @param seen        the stored flag; `null` while it is still loading
 * @param profileCompleted onboarding is done — a half-onboarded user is
 *                    already in a guided flow and must not be interrupted
 * @param route       the current first-level route segment
 */
export function shouldAutoOpenTour(args: {
  seen: boolean | null;
  profileCompleted: boolean;
  route: string | undefined;
}): boolean {
  const { seen, profileCompleted, route } = args;
  // Still reading storage. Never guess: guessing false skips the tour for the
  // people it exists for, and guessing true flashes it at everyone else.
  if (seen === null) return false;
  if (seen) return false;
  if (!profileCompleted) return false;
  // Only from the tab root. Landing on Settings or the scan camera and being
  // yanked into a tour is the intrusive version of this feature.
  return route === 'index';
}
