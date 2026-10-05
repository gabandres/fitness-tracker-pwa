import {
  endFastActivity,
  getFastActivityStatus,
  startFastActivity,
} from '../../modules/fasting-live-activity';
import { type IntentInboxAction, peekIntentInbox } from '../../modules/intent-inbox';

/**
 * The fast the user just ended from the Lock Screen whose archive write the app
 * has not landed yet — `startedAt` epoch ms, or null.
 *
 * The "End" button (`EndFastIntent`) removes the Live Activity at once and
 * leaves the Firestore write to the app (`targets/_shared/IntentInbox.swift`).
 * Until that write lands, `profile.fastStartedAt` still says the fast is
 * running, and a reconcile in that window would see "fast running, no
 * Activity" and RE-ARM the timer the user just dismissed. Set by
 * `useIntentInbox` around its `breakFast`; read below.
 */
let endingStartMs: number | null = null;

export function markFastEnding(startedAtMs: number | null): void {
  endingStartMs = startedAtMs;
}

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

  // Ended from the Lock Screen and not yet written — never re-arm it. Both
  // checks run AFTER the peek resolves: the inbox drain removes the entry and
  // marks the fast as ending in one step, so whichever of the two the drain has
  // reached by then, one of them is visible here.
  const startMs = fastStartedAt.getTime();
  const pending = await peekIntentInbox(['fastEnd']);
  if (endingStartMs === startMs || pending.some((a) => a.kind === 'fastEnd' && a.startedAtMs === startMs)) {
    return;
  }

  await startFastActivity(fastStartedAt, locale);
}

/** Siri actions older than this are dropped rather than applied: the app was
 *  opened by the phrase, so a note still unread after this long was left by a
 *  session that never reached Today (signed out, onboarding) and acting on it
 *  now would start or end a fast nobody just asked about. */
export const SPOKEN_ACTION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * What Today should do about one fast action from the intent inbox.
 *
 * - `end` — run the ordinary `breakFast` (archive + Undo toast) at `endedAt`:
 *   the instant the user tapped End or spoke, never "now", so a slow cold
 *   launch does not lengthen the fast.
 * - `start` — `startFast` at the instant spoken.
 * - `show` — "start a fast" while one is already running: open the fast sheet
 *   rather than silently restarting the clock (a restart would discard hours).
 * - `none` — not applicable to the fast that is actually running.
 *
 * The Lock Screen's `fastEnd` names the fast it ended (`startedAtMs`) and is
 * applied ONLY to that fast: if a different one is running — restarted
 * elsewhere in between — ending it would destroy the wrong fast. It has no age
 * limit, because it is keyed to the fast rather than to the moment.
 *
 * Pure; `now` is injectable for tests.
 */
export type FastInboxStep =
  | { type: 'end'; endedAt: Date }
  | { type: 'start'; at: Date }
  | { type: 'show' }
  | { type: 'none' };

export function planFastInboxAction(
  action: Extract<IntentInboxAction, { kind: 'fastEnd' | 'fastStart' | 'fastStop' }>,
  fastStartedAt: Date | null,
  now = Date.now(),
): FastInboxStep {
  const running = fastStartedAt?.getTime() ?? null;
  switch (action.kind) {
    case 'fastEnd':
      if (running == null || running !== action.startedAtMs) return { type: 'none' };
      return { type: 'end', endedAt: new Date(Math.min(action.endedAtMs, now)) };
    case 'fastStop':
      if (now - action.atMs > SPOKEN_ACTION_MAX_AGE_MS || running == null) return { type: 'none' };
      return { type: 'end', endedAt: new Date(Math.min(Math.max(action.atMs, running), now)) };
    case 'fastStart':
      if (now - action.atMs > SPOKEN_ACTION_MAX_AGE_MS) return { type: 'none' };
      if (running != null) return { type: 'show' };
      return { type: 'start', at: new Date(Math.min(action.atMs, now)) };
  }
}
