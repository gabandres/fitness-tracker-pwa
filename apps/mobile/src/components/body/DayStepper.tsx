import { type AccessibilityActionEvent, StyleSheet, Text, View } from 'react-native';
import { addDays, calendarDateKey, parseYmd } from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { NativeDateField, hasNativeDateField } from '@/components/NativeDatePicker';
import { BodyIcon } from './BodyIcon';

/**
 * Which day a weigh-in or measurement belongs to — FastSheet's day row,
 * reused for the same reason it exists there (Body review, U2/U9).
 *
 * The weigh-in sheet could only write TODAY, so the morning someone forgot to
 * log had no way back short of a past row that did not exist yet. "Which day"
 * has two or three plausible answers and a stepper answers it in one tap,
 * without a native date picker — which would move the Expo fingerprint and
 * strand every later fix to this screen behind two store binaries (see the
 * FastSheet header for the full reasoning).
 *
 * Bounded at `maxKey` (today: nobody weighed themselves tomorrow, and a future
 * weigh-in drags the regression's x range — `isStorableWeighInDate`) and at
 * `minKey`. The 44 pt targets are the floor FastSheet's own 28 pt steppers
 * missed (A7).
 *
 * The day itself is ADJUSTABLE to a screen reader (Body re-score): swipe up
 * for a later day, down for an earlier one, the way VoiceOver steps a picker
 * — rather than three separate stops (back, an inert label, forward) to move
 * one day. The two buttons stay for everyone else and for Switch Control.
 */
export function DayStepper({
  dateKey,
  onChange,
  maxKey,
  minKey,
  testIDPrefix,
}: {
  dateKey: string;
  onChange: (next: string) => void;
  maxKey: string;
  minKey?: string;
  testIDPrefix: string;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const canBack = minKey == null || dateKey > minKey;
  const canForward = dateKey < maxKey;
  const label = dateKey === maxKey ? t('body.today') : formatDate(parseYmd(dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });

  function step(delta: number) {
    haptics.tap();
    onChange(calendarDateKey(addDays(parseYmd(dateKey), delta)));
  }

  function onAccessibilityAction(e: AccessibilityActionEvent) {
    if (e.nativeEvent.actionName === 'increment' && canForward) step(1);
    else if (e.nativeEvent.actionName === 'decrement' && canBack) step(-1);
  }

  return (
    <View style={styles.row}>
      <PressScale
        scaleTo={0.9}
        style={[styles.btn, !canBack && styles.btnOff]}
        onPress={() => canBack && step(-1)}
        disabled={!canBack}
        accessibilityRole="button"
        accessibilityLabel={t('fast.dayEarlier')}
        accessibilityState={{ disabled: !canBack }}
        testID={`${testIDPrefix}-day-prev`}
      >
        <BodyIcon sf="chevron.left" ion="chevron-back" size={18} color={colors.ink} />
      </PressScale>
      {/* The day itself: the platform's date picker where the binary has one
          (S20) — a distant day is one pick, not thirty taps — with the ±1
          steppers either side for the common yesterday. */}
      {hasNativeDateField ? (
        <NativeDateField
          mode="date"
          value={parseYmd(dateKey)}
          onChange={(d) => onChange(calendarDateKey(d))}
          maximumDate={parseYmd(maxKey)}
          minimumDate={minKey ? parseYmd(minKey) : null}
          accessibilityLabel={t('entry.date')}
          testID={`${testIDPrefix}-day`}
          style={styles.native}
        />
      ) : (
        <Text
          style={styles.text}
          accessible
          accessibilityRole="adjustable"
          // "Date, Today, adjustable" — the day is the VALUE, so the label is
          // only what it is a value of (it read "Day: Today" before it moved).
          accessibilityLabel={t('entry.date')}
          accessibilityValue={{ text: label }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
          testID={`${testIDPrefix}-day`}
        >
          {label}
        </Text>
      )}
      <PressScale
        scaleTo={0.9}
        style={[styles.btn, !canForward && styles.btnOff]}
        onPress={() => canForward && step(1)}
        disabled={!canForward}
        accessibilityRole="button"
        accessibilityLabel={t('fast.dayLater')}
        accessibilityState={{ disabled: !canForward }}
        testID={`${testIDPrefix}-day-next`}
      >
        <BodyIcon sf="chevron.right" ion="chevron-forward" size={18} color={colors.ink} />
      </PressScale>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    btn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.lineStrong,
    },
    btnOff: { opacity: 0.35 },
    native: { flex: 1, alignItems: 'center' },
    text: { flexShrink: 1, textAlign: 'center', fontSize: font.body, color: colors.ink, fontWeight: '700' },
  });
