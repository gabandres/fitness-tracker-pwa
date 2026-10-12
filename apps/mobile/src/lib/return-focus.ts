import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import { isScreenReaderOn } from './a11y';

/**
 * Give the screen reader back the control that opened a sheet, once the sheet
 * has gone (WCAG 2.4.3; Train UX pass J10).
 *
 * A sheet that closes leaves VoiceOver / TalkBack wherever the system puts it
 * — usually the top of the screen — so a blind lifter who changed a set's kind
 * had to swipe back down through the whole workout to the row they were on.
 * The control that opens a sheet notes itself here on press
 * (`noteFocusTrigger(e.currentTarget)`), and the screen that owns the sheet
 * calls {@link useReturnFocusOnClose} with its visibility.
 *
 * One pending trigger, module-wide: only one sheet is up at a time. Deferred
 * past the native sheet's dismissal (`SHEET_GONE_MS`, the same beat the
 * session's sheet hand-off waits), and a no-op when no screen reader runs.
 * `sendAccessibilityEvent`, not `findNodeHandle` + `setAccessibilityFocus` —
 * see `use-a11y-focus.ts` for why on bridgeless Fabric.
 *
 * Needs a real VoiceOver / TalkBack pass: a native sheet route may still move
 * focus after this runs.
 */
const SHEET_GONE_MS = 350;

type FocusTarget = Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0];

let pending: unknown = null;

/** Remember the control a sheet is being opened from — a press event's
 *  `currentTarget`, or a ref's current host node. */
export function noteFocusTrigger(node: unknown): void {
  pending = node ?? null;
}

/** Focus the remembered control after the sheet has gone, and forget it. */
export function returnFocusToTrigger(delayMs = SHEET_GONE_MS): void {
  const node = pending;
  pending = null;
  if (node == null || typeof node === 'number' || !isScreenReaderOn()) return;
  setTimeout(() => {
    try {
      AccessibilityInfo.sendAccessibilityEvent(node as FocusTarget, 'focus');
    } catch {
      // An unmounted node, or a renderer without native views (tests).
    }
  }, delayMs);
}

/** Return focus when `visible` goes true → false. */
export function useReturnFocusOnClose(visible: boolean, delayMs?: number): void {
  const was = useRef(visible);
  useEffect(() => {
    if (was.current && !visible) returnFocusToTrigger(delayMs);
    was.current = visible;
  }, [visible, delayMs]);
}
