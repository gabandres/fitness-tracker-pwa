import type { ColorTokens } from '@/theme';

/**
 * The three habit metrics' shared identity — one hue and one Trends face per
 * habit, used by BOTH the Today metric rows (`DailyMetrics`) and the Trends
 * Habits strip, so a habit reads as the same thing on both screens.
 *
 * Built from in-app feedback (2026-08-30): *"Fasting, sleeping and water
 * should have some sort of color to identify it more clearly … can we make
 * somewhat a shortcut from 'Today' … goes to Trends and the appropriate
 * graph?"* Both halves live here so they cannot drift: the colour that marks a
 * row is looked up the same way as the colour that marks its tab, and the tab
 * key a shortcut stores is validated against the same list the strip renders.
 *
 * Colour discipline (ADR-0014 + UX_AUDIT §S12): identity, never urgency. The
 * hues are calm accents from families the palette already vetted — an icon
 * tint, a chart bar, a tab dot — not a repaint. Callers read them through
 * `useTheme()`'s palette, never a static import, which is what keeps them
 * correct in both themes.
 */
export type HabitMetric = 'sleep' | 'fasting' | 'water';

/** The faces the Trends Habits strip may show, in fixed display order. Also
 *  what `usePersistedTab` validates a stored face against — a full list on
 *  purpose (see the trends screen: a preference for a face whose card has gone
 *  quiet is still a valid preference). */
export const HABIT_TABS = ['sleep', 'fasting', 'water'] as const;

/** The AsyncStorage key the Habits strip persists its face under. Shared with
 *  the Today shortcut, which pre-selects a face by writing it here before
 *  navigating (`setPersistedTab`). */
export const TRENDS_HABIT_TAB_KEY = 'trends.tab.habits';

/**
 * The habit's identity colour, from the ACTIVE palette — pass
 * `useTheme().colors`, so the value tracks the theme. A function rather than a
 * static map because a static map would have to pick one palette, which is the
 * exact mistake ADR-0014 removed.
 */
export function habitColor(colors: ColorTokens, metric: HabitMetric): string {
  return metric === 'sleep'
    ? colors.habitSleep
    : metric === 'fasting'
      ? colors.habitFasting
      : colors.habitWater;
}
