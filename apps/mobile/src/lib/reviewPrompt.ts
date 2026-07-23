import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as StoreReview from 'expo-store-review';

/**
 * In-app rating prompt.
 *
 * Rating count + average is the second-biggest App Store ranking input after
 * the keyword fields, and a freshly-listed app starts at zero. The native
 * sheet (`SKStoreReviewController` on iOS) is the only way to collect them
 * without sending the user out of the app.
 *
 * The rules below exist because iOS silently swallows over-asking: the system
 * shows the sheet at most **3 times per 365 days per user**, and a request
 * spent at a bad moment is simply gone. So we spend requests deliberately:
 *
 *   1. Only at a *positive moment* — the caller decides what that is
 *      (`recordPositiveMoment`), e.g. finishing a workout or closing out a
 *      fully-logged day. Never on launch, never mid-task, never on an error
 *      path.
 *   2. Only after {@link MOMENTS_REQUIRED} distinct qualifying **days** — a
 *      user who logged once isn't a user with an opinion yet.
 *   3. At most once per app version, and never within {@link COOLDOWN_DAYS}
 *      of the last ask.
 *
 * Everything here is device-local (AsyncStorage), like the reminder and
 * what's-new prefs — it is a UI preference, not user data, so it never
 * touches Firestore.
 *
 * There is deliberately **no custom "do you like Ignia?" pre-prompt**. Apple
 * discourages gating the native sheet behind one, and a pre-prompt that
 * filters to only-happy users is the exact pattern review guidelines call out.
 */

/**
 * Deep link straight into the App Store review composer. Used by the
 * always-available Settings row; the throttled native sheet can't serve a
 * user who deliberately went looking for "rate this app".
 * The ID mirrors `submit.production.ios.ascAppId` in eas.json.
 */
export const APP_STORE_REVIEW_URL =
  'https://apps.apple.com/app/id6788589414?action=write-review';

const KEY_DAYS = 'review.momentDays';   // JSON string[] of YYYY-MM-DD
const KEY_LAST_AT = 'review.lastAskAt'; // ISO timestamp of the last request
const KEY_LAST_VER = 'review.lastAskVersion';

/** Distinct days with a positive moment before we're willing to ask. */
const MOMENTS_REQUIRED = 4;
/** Minimum gap between asks, in days — well inside Apple's own throttle. */
const COOLDOWN_DAYS = 120;
/** Cap on the retained day list; we only ever need to count up to the
 *  threshold, and an unbounded array would grow for the app's lifetime. */
const MAX_DAYS_TRACKED = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentVersion(): string {
  return Application.nativeApplicationVersion ?? 'unknown';
}

async function readDays(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_DAYS);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    // Corrupt/unparseable state must not break the calling screen — a lost
    // counter costs us one rating, an exception costs a workout save.
    return [];
  }
}

/**
 * Record that something went right, and ask for a rating if this tips the
 * user over every threshold. Safe to call often and from anywhere; it
 * resolves quietly and never throws.
 *
 * @returns `true` if the native rating sheet was requested.
 */
export async function recordPositiveMoment(): Promise<boolean> {
  try {
    const day = today();
    const days = await readDays();
    if (!days.includes(day)) {
      const next = [...days, day].slice(-MAX_DAYS_TRACKED);
      await AsyncStorage.setItem(KEY_DAYS, JSON.stringify(next));
      return maybeAskForReview(next.length);
    }
    return maybeAskForReview(days.length);
  } catch {
    return false;
  }
}

async function maybeAskForReview(momentDays: number): Promise<boolean> {
  if (momentDays < MOMENTS_REQUIRED) return false;

  // `isAvailableAsync` covers the platform/OS check; `hasAction` also
  // reports false when there is no store to send the user to (e.g. a
  // sideloaded or dev build), which would otherwise burn a request.
  if (!(await StoreReview.isAvailableAsync())) return false;
  if (!(await StoreReview.hasAction())) return false;

  const [lastAt, lastVer] = await Promise.all([
    AsyncStorage.getItem(KEY_LAST_AT),
    AsyncStorage.getItem(KEY_LAST_VER),
  ]);

  const version = currentVersion();
  if (lastVer === version) return false;
  if (lastAt && Date.now() - new Date(lastAt).getTime() < COOLDOWN_DAYS * DAY_MS) return false;

  // Write the guards *before* requesting. iOS gives no callback and no
  // success signal, so if we recorded afterwards a crash or a fast
  // unmount mid-sheet would let the prompt fire again on the next moment.
  await AsyncStorage.multiSet([
    [KEY_LAST_AT, new Date().toISOString()],
    [KEY_LAST_VER, version],
  ]);

  await StoreReview.requestReview();
  return true;
}

/** Test/support hook — clears the local rating state so the prompt can be
 *  re-armed on a device. Does not reset Apple's own 3-per-year throttle. */
export async function resetReviewPromptState(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_DAYS, KEY_LAST_AT, KEY_LAST_VER]);
}
