import { useState } from 'react';
import type { AccessibilityActionEvent, AccessibilityProps } from 'react-native';

/**
 * One chart = one accessible element that a screen-reader user can STEP
 * through, a day at a time — VoiceOver's swipe up/down on an adjustable, and
 * TalkBack's equivalent.
 *
 * ## Why adjustable, and not one element per bar
 *
 * Fourteen focusable columns per strip, times four strips, is fifty-six stops
 * of swiping before reaching Coach; nobody listens to that. An image with a
 * summary label (what the budget strip had, UX_AUDIT S18-5) is the other
 * extreme: the gist, and no way to ask about Tuesday. Adjustable is the
 * pattern Apple's own Health charts use — the label is the summary, the value
 * is the day under the cursor, and increment/decrement move it.
 *
 * The per-day strings are produced by the caller (`labelAt`), which is also
 * what a native `AXChartDescriptor` would want later: a summary plus one
 * (x, y) description per point. Nothing here would change for that.
 *
 * Starts on the NEWEST day — the one a sighted reader looks at first.
 */
export interface AdjustableDays {
  /** The day the cursor is on. */
  index: number;
  setIndex: (i: number) => void;
  /** Spread onto the chart's container. */
  a11y: AccessibilityProps & { accessible: true };
}

export function useAdjustableDays(
  count: number,
  summary: string,
  labelAt: (i: number) => string,
  extra: {
    /** Custom rotor actions, e.g. "Open this day in History". */
    actions?: { name: string; label: string; run: (index: number) => void }[];
  } = {},
): AdjustableDays {
  const [raw, setIndex] = useState<number | null>(null);
  // Clamp on read, not on write: the series can shrink under a held index
  // (a range chip, a day rolling over) and a stale index must not read
  // "undefined" aloud.
  const index = count <= 0 ? 0 : Math.min(count - 1, Math.max(0, raw ?? count - 1));
  const custom = extra.actions ?? [];

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'increment') setIndex(Math.min(count - 1, index + 1));
    else if (name === 'decrement') setIndex(Math.max(0, index - 1));
    else custom.find((a) => a.name === name)?.run(index);
  };

  return {
    index,
    setIndex,
    a11y: {
      accessible: true,
      accessibilityRole: 'adjustable',
      accessibilityLabel: summary,
      accessibilityValue: count > 0 ? { text: labelAt(index) } : undefined,
      accessibilityActions: [
        { name: 'increment' },
        { name: 'decrement' },
        ...custom.map((a) => ({ name: a.name, label: a.label })),
      ],
      onAccessibilityAction,
    },
  };
}
