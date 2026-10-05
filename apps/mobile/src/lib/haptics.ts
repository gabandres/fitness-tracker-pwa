import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptics by MEANING, not by motor (UX_AUDIT Today review P6).
 *
 * Every call site used to pick between three motors — a light tap, a success
 * and a warning — so a delete played the same "it worked!" buzz as a save, a
 * water stepper thumped like a button, and one logged meal could fire three
 * haptics in a row (the save, the protein ring closing, the streak ticking
 * up). The verbs below say what happened; this file decides what it feels
 * like on each platform.
 *
 * **Android uses `performAndroidHapticsAsync`** — the system's own
 * `HapticFeedbackConstants`, which the OEM tunes per device and the user's
 * "touch feedback" setting governs. `notificationAsync` on Android is a
 * vibration pattern the app made up, and on a cheap motor it reads as a
 * phone call.
 *
 * ## One outcome per gesture
 *
 * `success`, `warning`, `removed` and `celebrate` are OUTCOMES. Two rules
 * keep them from stacking:
 *
 *   - {@link tapThenOutcome} replaces the "tap now, success when the write
 *     resolves" pair: the tap is held for {@link LEAD_TAP_GRACE_MS} and
 *     dropped if an outcome lands first, so a fast write feels like one beat.
 *   - {@link celebrateIfQuiet} is for celebrations raised by an EFFECT (the
 *     ring closing, the streak extending) rather than by the gesture itself:
 *     if any outcome played within {@link OUTCOME_QUIET_MS}, the gesture
 *     already had its haptic and this one is dropped. The gesture that caused
 *     the moment chooses `celebrate` up front instead, when it can predict it.
 *
 * No-ops on web (Playwright + Expo web); real feedback on device.
 */

/** How long a leading tap waits for an outcome before it plays anyway. */
export const LEAD_TAP_GRACE_MS = 300;
/** How long after an outcome an effect-raised celebration stays silent. */
export const OUTCOME_QUIET_MS = 1500;

let lastOutcomeAt = 0;
const now = () => Date.now();
const off = () => Platform.OS === 'web';
const swallow = () => {};

function android(type: Haptics.AndroidHaptics): void {
  Haptics.performAndroidHapticsAsync(type).catch(swallow);
}

function outcome(): void {
  lastOutcomeAt = now();
}

/** A press: buttons, chips, opening something. */
export function tap(): void {
  if (off()) return;
  if (Platform.OS === 'android') return android(Haptics.AndroidHaptics.Virtual_Key);
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(swallow);
}

/** Moving through discrete values — steppers, segmented choices, a swipe
 *  crossing its commit point, a pull-to-refresh arming. */
export function selection(): void {
  if (off()) return;
  if (Platform.OS === 'android') return android(Haptics.AndroidHaptics.Segment_Tick);
  Haptics.selectionAsync().catch(swallow);
}

/** Something was saved. */
export function success(): void {
  if (off()) return;
  outcome();
  if (Platform.OS === 'android') return android(Haptics.AndroidHaptics.Confirm);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(swallow);
}

/** Something failed, or was refused. */
export function warning(): void {
  if (off()) return;
  outcome();
  if (Platform.OS === 'android') return android(Haptics.AndroidHaptics.Reject);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(swallow);
}

/** Something was removed. Not `success`: a delete is not an achievement, and
 *  feeling the same as a save made a mis-swipe feel like a save. A firm,
 *  single knock — the Undo in the toast is what carries the reassurance. */
export function removed(): void {
  if (off()) return;
  outcome();
  if (Platform.OS === 'android') return android(Haptics.AndroidHaptics.Gesture_End);
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(swallow);
}

/**
 * The one celebration a gesture gets — a target closed, a streak extended.
 * A success with a soft second beat, so it is recognisably more than a save
 * without being a second, separate haptic.
 */
export function celebrate(): void {
  if (off()) return;
  outcome();
  if (Platform.OS === 'android') return android(Haptics.AndroidHaptics.Confirm);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(swallow);
  setTimeout(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(swallow);
  }, 140);
}

/** {@link celebrate}, unless the gesture behind it already had its outcome
 *  haptic — see the module note. For effects, never for the gesture itself. */
export function celebrateIfQuiet(): void {
  if (now() - lastOutcomeAt < OUTCOME_QUIET_MS) return;
  celebrate();
}

/**
 * The press feedback for an action whose outcome haptic follows: plays the
 * tap only if no outcome arrives within {@link LEAD_TAP_GRACE_MS}. A write
 * that resolves at once is one beat (its outcome); a slow one still
 * acknowledges the press.
 */
export function tapThenOutcome(): void {
  if (off()) return;
  const armedAt = now();
  setTimeout(() => {
    if (lastOutcomeAt < armedAt) tap();
  }, LEAD_TAP_GRACE_MS);
}

/** Test seam: forget the last outcome. */
export function __resetHaptics(): void {
  lastOutcomeAt = 0;
}
