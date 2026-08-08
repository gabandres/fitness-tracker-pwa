import {
  endFastActivity,
  getFastActivityStatus,
  startFastActivity,
} from '../../modules/fasting-live-activity';

/**
 * Make iOS show exactly the fast Firestore describes, and nothing else (N3).
 *
 * Split out of `useFastActivity` so it can be tested without pulling React,
 * `@/i18n` and therefore the Firebase auth module into the suite — the branching
 * here is the whole feature on the JS side, and it should not need a device or a
 * rendered tree to check.
 *
 * ## Why reconcile rather than react
 *
 * The obvious shape — start on `startFast`, end on `breakFast` — is wrong,
 * because two things end a Live Activity that no app code observes:
 *
 *   1. **iOS's eight-hour ceiling.** The system ends the Activity 8 hours in and
 *      drops it from the Lock Screen 4 hours after that. A 16:8 fast outlives
 *      both, and an Activity can only be *requested* with the app in the
 *      foreground, so there is no way to pre-empt it from the background.
 *   2. **The user swiping it away**, which is always allowed.
 *
 * A third case only reconciliation catches: the web PWA writes the same
 * `profile.fastStartedAt`, so a fast can be broken and restarted while this app
 * is closed, leaving a Lock Screen counting from an instant nothing will ever
 * correct.
 *
 * The fast's true `startedAt` is what gets armed — never `now` — so a re-armed
 * Activity shows the correct elapsed time rather than restarting from zero.
 *
 * The honest ceiling this leaves: a fast shows a Lock Screen timer for as long
 * as the user has opened the app within the last 8 hours, and shows nothing
 * otherwise. That is a property of ActivityKit, not something to fix later.
 *
 * Never rejects; every call underneath is best-effort. A Lock Screen that will
 * not appear must not be able to disturb the screen drawing the real thing.
 */
export async function reconcileFastActivity(
  fastStartedAt: Date | null,
  locale: string,
): Promise<void> {
  const status = await getFastActivityStatus();

  // Nothing to reconcile against: no module (Android/Expo Go/web) or too old an
  // iOS.
  if (status.state === 'unavailable' || status.state === 'unsupported') return;

  if (!fastStartedAt) {
    // `end` with nothing running is already a no-op in Swift, but skipping the
    // round trip keeps the common case — not fasting, app foregrounded — free.
    if (status.state === 'running') await endFastActivity();
    return;
  }

  // The user turned Live Activities off for Ignia in Settings. A preference, not
  // an error: honoured silently, never nagged about.
  if (status.state === 'disabled') return;

  // Already showing this exact fast, in this locale. The locale comparison is
  // not pedantic — the attributes are immutable, so a language change in
  // Settings can only be applied by replacing the Activity.
  if (
    status.state === 'running' &&
    status.startedAtMs === fastStartedAt.getTime() &&
    status.locale === locale
  ) {
    return;
  }

  await startFastActivity(fastStartedAt, locale);
}
