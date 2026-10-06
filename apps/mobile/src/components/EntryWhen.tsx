import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import { MEAL_TYPES, type MealType } from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { formatTime } from '@/lib/date-format';
import { sentenceCase } from '@/lib/entry-input';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { NativeDateField, hasNativeDateField } from '@/components/NativeDatePicker';

/**
 * "Which meal, and when" — the two controls every way of logging needs and the
 * scan review did not have (U6): a plate photographed at 9 PM filed by the
 * clock at the moment of Add, with no way to say it was lunch. One copy, used
 * by the add sheet's form and the scan review, so the two cannot drift.
 */

/** Past this Dynamic Type scale the time row's five controls no longer fit on
 *  one line of a 375pt phone; the time goes on its own line above the steppers. */
const WRAP_FONT_SCALE = 1.35;

/** The time row's four steppers, earliest first. Hour and five-minute steps:
 *  12:00 → 4:15 PM is seven taps, where a single 15-minute step took
 *  seventeen. The row's whole control where the binary has no native picker;
 *  beside one they step aside (see `TimeOfDayRow`). */
export const TIME_STEPS = [
  { minutes: -60, label: 'entry.timeMinusHour', a11y: 'entry.timeEarlierHourA11y', testID: 'entry-time-minus-hour' },
  { minutes: -5, label: 'entry.timeMinusMin', a11y: 'entry.timeEarlierMinA11y', testID: 'entry-time-minus-min' },
  { minutes: 5, label: 'entry.timePlusMin', a11y: 'entry.timeLaterMinA11y', testID: 'entry-time-plus-min' },
  { minutes: 60, label: 'entry.timePlusHour', a11y: 'entry.timeLaterHourA11y', testID: 'entry-time-plus-hour' },
] as const;

/**
 * The four meal slots as a single-choice group. A radio group to a screen
 * reader (A2) — "Lunch, radio button, 2 of 4, checked" says what the chips
 * are, where "Lunch, button, selected" did not. Tapping the checked chip
 * clears it (the slot is optional; the write path then files by the clock).
 * Labels are sentence-cased in JS, not by `textTransform: 'capitalize'`,
 * which made pt-BR "café da manhã" into "Café Da Manhã" (B4).
 */
export function MealSlotChips({
  value,
  onChange,
}: {
  value: MealType | undefined;
  onChange: (next: MealType | undefined) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {MEAL_TYPES.map((mt) => {
        const on = value === mt;
        return (
          <TouchableOpacity
            key={mt}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => {
              // A selection tick, not a press (D1): the chips had none.
              haptics.selection();
              onChange(on ? undefined : mt);
            }}
            // 40dp chip + 4 slop = 48 (S18-15; Android's 48dp too); chips sit 8dp apart.
            hitSlop={4}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, selected: on }}
            testID={`meal-type-${mt}`}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]} maxFontSizeMultiplier={2.2}>
              {sentenceCase(t(`meal.${mt}`), locale)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * The time of day: ± an hour / five minutes around a label that opens a typed
 * field (8:15, 815, 6:30pm). Controlled — the owner keeps the typed text,
 * because a typed time still open when Add is tapped has to count, and Add
 * does not blur the field.
 */
export function TimeOfDayRow({
  at,
  draft,
  onDraftChange,
  onStep,
  onCommit,
  onSet,
}: {
  at: Date;
  /** The typed text while the field is open; null shows the label. */
  draft: string | null;
  onDraftChange: (text: string | null) => void;
  onStep: (minutes: number) => void;
  /** Settle the typed text (blur / Done). */
  onCommit: () => void;
  /** Set the time outright — given, the platform's own time picker replaces
   *  the typed field AND the steps where the binary has one (S20). */
  onSet?: (next: Date) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  const { fontScale } = useWindowDimensions();
  const wrap = fontScale > WRAP_FONT_SCALE;

  const step = (st: (typeof TIME_STEPS)[number]) => (
    <TouchableOpacity
      key={st.minutes}
      style={styles.step}
      onPress={() => onStep(st.minutes)}
      hitSlop={2}
      accessibilityRole="button"
      accessibilityLabel={t(st.a11y)}
      testID={st.testID}
    >
      <Text style={styles.stepText} maxFontSizeMultiplier={1.6}>{t(st.label)}</Text>
    </TouchableOpacity>
  );

  // Today only, never ahead of now: a meal logged at 23:00 for 23:30 is a typo.
  const dayStart = new Date(at);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(at);
  dayEnd.setHours(23, 59, 0, 0);
  // The system picker alone (re-score gap 12): its wheel sets any minute in
  // one gesture, and four ± steppers around it were seven controls in one row
  // doing one job. Without it (Expo Go, an older binary) the steps remain the
  // fast way, and the label opens the typed field.
  if (onSet && hasNativeDateField) {
    return (
      <View style={styles.row}>
        <NativeDateField
          mode="time"
          value={at}
          onChange={onSet}
          minimumDate={dayStart}
          maximumDate={new Date(Math.min(dayEnd.getTime(), Date.now()))}
          accessibilityLabel={t('entry.time')}
          testID="entry-time-native"
          style={styles.nativeField}
        />
      </View>
    );
  }
  const label =
    draft != null ? (
      <SheetTextInput
        style={[styles.label, styles.input]}
        value={draft}
        onChangeText={onDraftChange}
        // Done blurs a single-line field (`blurOnSubmit`),
        // so blur is the one commit — both would apply twice.
        onBlur={onCommit}
        autoFocus
        selectTextOnFocus
        placeholder={t('entry.timeTypePlaceholder')}
        placeholderTextColor={colors.faint}
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="done"
        maxLength={10}
        maxFontSizeMultiplier={1.4}
        accessibilityLabel={t('entry.timeTypeA11y')}
        keyboardAppearance={scheme}
        testID="entry-time-input"
      />
    ) : (
      <TouchableOpacity
        style={styles.labelTap}
        onPress={() => onDraftChange('')}
        accessibilityRole="button"
        accessibilityLabel={formatTime(at, locale)}
        accessibilityHint={t('entry.timeTypeA11y')}
        testID="entry-time-tap"
      >
        <Text style={[styles.label, styles.labelText]} maxFontSizeMultiplier={2.2} testID="entry-time">
          {formatTime(at, locale)}
        </Text>
        <Text style={styles.tapHint} maxFontSizeMultiplier={2.2}>{t('entry.timeTapHint')}</Text>
      </TouchableOpacity>
    );

  // At a large text size the label takes a line of its own and the four
  // steppers share the next (A1): squeezed into one row they wrapped mid-word.
  if (wrap) {
    return (
      <View style={styles.stack}>
        <View style={styles.row}>{label}</View>
        <View style={styles.row}>{TIME_STEPS.map(step)}</View>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {TIME_STEPS.slice(0, 2).map(step)}
      {label}
      {TIME_STEPS.slice(2).map(step)}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: {
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      backgroundColor: colors.inputBg,
      minHeight: 40,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    chipText: { fontSize: font.small, color: colors.muted },
    chipTextOn: { color: colors.onInk },
    stack: { gap: space.sm },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
    // 44 + the 2dp hitSlop on each = 48. Wider than a date ± so "+5 min" fits.
    step: {
      minWidth: 52,
      minHeight: TARGET,
      paddingHorizontal: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    label: { flex: 1, textAlign: 'center', fontSize: font.body, color: colors.ink, fontWeight: '700' },
    labelTap: { flex: 1, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    // The compact pill sizes itself; it starts the row like the date pill
    // above it rather than floating in the middle of an empty line.
    nativeField: { alignItems: 'flex-start' },
    labelText: { flex: 0 },
    // `muted`, not `faint`: 12pt text, and on iOS it can sit on the sheet's
    // material rather than on `paper` — the margin is worth more than the step
    // of hierarchy (re-score, A).
    tapHint: { fontSize: font.tiny, color: colors.muted },
    input: {
      minHeight: TARGET,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      backgroundColor: colors.inputBg,
      paddingVertical: 0,
    },
  });
