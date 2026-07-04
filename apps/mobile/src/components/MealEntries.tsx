import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { type DailyLog, type MealSlot, groupByMealSlot } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import { enterUp, PressScale, springLayout } from '@/lib/motion';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

const SLOT_KEY: Record<MealSlot, I18nKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
  other: 'meal.other',
};

function timeOf(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function macroLine(log: DailyLog): string {
  const parts: string[] = [];
  if (log.protein != null) parts.push(`P ${log.protein}g`);
  if (log.carbs != null) parts.push(`C ${log.carbs}g`);
  if (log.fat != null) parts.push(`F ${log.fat}g`);
  return parts.join(' · ');
}

/**
 * The day's food entries, grouped into meal slots (breakfast → lunch → dinner
 * → snack → other) with per-slot calorie subtotals and a per-entry log time.
 * When every entry is untagged (single `other` group) the slot header is
 * suppressed so it reads as a plain list. Tapping a row calls `onPress`.
 */
export function MealEntries({ logs, onPress }: { logs: DailyLog[]; onPress: (log: DailyLog) => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const groups = groupByMealSlot(logs);
  const showHeaders = groups.length > 1 || (groups[0]?.slot !== 'other');

  // Rows fade+rise in with a stagger (index counted across groups so the
  // whole list reads as one cascade), spring into place when a sibling is
  // added/removed, and fade out on delete.
  let row = 0;
  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.slot} style={styles.group}>
          {showHeaders ? (
            <View style={styles.slotHead}>
              <Text style={styles.slotLabel}>{t(SLOT_KEY[g.slot])}</Text>
              <Text style={styles.slotTotal}>{g.totalCalories.toLocaleString()} kcal</Text>
            </View>
          ) : null}
          {g.entries.map((log) => {
            const sub = [timeOf(log.date), macroLine(log)].filter(Boolean).join('  ·  ');
            return (
              <Animated.View key={log.id} entering={enterUp(row++)} exiting={FadeOut} layout={springLayout}>
                <PressScale scaleTo={0.98} style={styles.entry} onPress={() => onPress(log)} testID={`entry-${log.id}`}>
                  <View style={styles.entryMain}>
                    <Text style={styles.entryLabel}>{log.mealLabel || t('today.entry')}</Text>
                    <Text style={styles.entryMacros}>{sub || '—'}</Text>
                  </View>
                  <Text style={styles.entryKcal}>{log.calories.toLocaleString()}</Text>
                </PressScale>
              </Animated.View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  wrap: { gap: space.md },
  group: { gap: space.sm },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  slotLabel: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'capitalize' },
  slotTotal: { fontSize: font.small, color: colors.faint, fontWeight: '600' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...shadow.e1,
  },
  entryMain: { flex: 1, gap: 2 },
  entryLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  entryMacros: { fontSize: font.small, color: colors.muted },
  entryKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink, marginLeft: space.md },
});
