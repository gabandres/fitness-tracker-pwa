import { useEffect, useRef } from 'react';
import { AccessibilityInfo, type Text } from 'react-native';

/**
 * Move the screen reader to a heading when the view it names appears.
 *
 * The add sheet swaps whole modes in place (browse → review form → portion
 * step) inside one Modal. Nothing navigates, so VoiceOver/TalkBack kept their
 * focus on whatever had been tapped — a control that no longer exists — and a
 * blind user heard nothing about the new view until they swiped around for it.
 * Pointing focus at the new mode's title is what a screen push does for free.
 *
 * Re-runs whenever `key` changes while `enabled`. Deferred a beat so the new
 * mode has mounted its node; a no-op when no screen reader is running.
 */
export function useA11yFocus(key: unknown, enabled = true, delayMs = 150) {
  const ref = useRef<Text>(null);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      try {
        // `sendAccessibilityEvent(ref, 'focus')`, not `findNodeHandle` +
        // `setAccessibilityFocus`: the app runs bridgeless Fabric, where a
        // numeric react tag is not reliably resolvable to a native view and
        // the old call silently did nothing on iOS.
        if (ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current, 'focus');
      } catch {
        // A renderer without native handles (tests, web) has nothing to focus.
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, enabled, delayMs]);
  return ref;
}
