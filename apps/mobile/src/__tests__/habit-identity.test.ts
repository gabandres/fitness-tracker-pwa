import { HABIT_TABS, TRENDS_HABIT_TAB_KEY, habitColor, type HabitMetric } from '@/lib/habit-identity';
import { palettes } from '@/theme';

/**
 * The habit identity hues are THEME-DERIVED, not constants (ADR-0014).
 *
 * What is pinned: `habitColor` answers from whichever palette it is handed —
 * so a component reading it through `useTheme().colors` re-skins when the
 * scheme flips — and the three metrics stay distinguishable from each other
 * within a theme, which is the entire point of the feature (in-app feedback,
 * 2026-08-30: "should have some sort of color to identify it more clearly").
 * A static `colors` import cannot pass the first half: it would return the
 * same value for both palettes.
 */
describe('habit identity colours', () => {
  const metrics: readonly HabitMetric[] = HABIT_TABS;

  it('derives from the palette it is handed — light and dark answer differently', () => {
    for (const m of metrics) {
      expect(habitColor(palettes.light.colors, m)).not.toBe(habitColor(palettes.dark.colors, m));
    }
  });

  it('returns the palette token, not a hardcoded hex', () => {
    for (const { colors } of [palettes.light, palettes.dark]) {
      expect(habitColor(colors, 'sleep')).toBe(colors.habitSleep);
      expect(habitColor(colors, 'fasting')).toBe(colors.habitFasting);
      expect(habitColor(colors, 'water')).toBe(colors.habitWater);
    }
  });

  it('keeps the three metrics distinguishable within each theme', () => {
    for (const { colors } of [palettes.light, palettes.dark]) {
      const hues = metrics.map((m) => habitColor(colors, m));
      expect(new Set(hues).size).toBe(metrics.length);
    }
  });

  it('exposes the strip contract the Today shortcut writes against', () => {
    // The shortcut stores one of these under this key; `usePersistedTab`
    // validates against the same list. Renaming either half without the other
    // silently strands the shortcut on the default face.
    expect(HABIT_TABS).toEqual(['sleep', 'fasting', 'water']);
    expect(TRENDS_HABIT_TAB_KEY).toBe('trends.tab.habits');
  });
});
