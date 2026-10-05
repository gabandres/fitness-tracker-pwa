import { type ReactNode, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { type Locale, useLocale } from '@/i18n';
import { formatDate, formatTime, localeTag } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import {
  NativeDatePickerView,
  canShowNativeDatePicker,
  showNativeDatePicker,
  type NativeDateMode,
} from '../../modules/native-date-picker';

/**
 * The system date/time control, where the binary has it.
 *
 * - **iOS** — `UIDatePicker` in its compact style, inline: the grey pill that
 *   opens the calendar / wheel popover, exactly what Calendar and Reminders
 *   show. It sizes itself (the native view reports its size to Yoga).
 * - **Android** — a value chip that opens MaterialDatePicker /
 *   MaterialTimePicker (`dateAndTime`: the date, then the time).
 * - **Neither** (Expo Go, web, a binary older than `modules/native-date-picker`
 *   that an OTA reached) — `fallback`, which callers pass as the JS steppers
 *   they already had. Pass nothing and the field renders nothing, so a caller
 *   that cannot do without a control must pass one.
 *
 * Why the earlier "no native picker" decisions (FastSheet, DayStepper headers)
 * no longer bind: they were about paying a store binary for one control. The
 * 1.2.5 binary is being cut for other native work anyway, and the fallback
 * keeps every older binary on the steppers it already has.
 *
 * Controlled. `onChange` receives a `Date` already clamped into
 * `[minimumDate, maximumDate]` — Android's calendar bounds days, not times, so
 * the clamp is what holds a time-of-day limit (an entry not in the future, a
 * fast's end after its start).
 */

export { isNativeDatePickerAvailable } from '../../modules/native-date-picker';

/** True when `NativeDateField` will render a native control, not `fallback`. */
export const hasNativeDateField =
  (Platform.OS === 'ios' && NativeDatePickerView != null) || canShowNativeDatePicker;

/** `value` held inside the bounds. Pure — tested. */
export function clampDate(value: Date, min?: Date | null, max?: Date | null): Date {
  let ms = value.getTime();
  if (min && ms < min.getTime()) ms = min.getTime();
  if (max && ms > max.getTime()) ms = max.getTime();
  return ms === value.getTime() ? value : new Date(ms);
}

/** The Android chip's text for `mode`. Pure — tested. */
export function dateFieldLabel(value: Date, mode: NativeDateMode, locale: Locale): string {
  const day = formatDate(value, locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = formatTime(value, locale);
  if (mode === 'date') return day;
  if (mode === 'time') return time;
  return `${day} · ${time}`;
}

export interface NativeDateFieldProps {
  mode: NativeDateMode;
  value: Date;
  onChange: (next: Date) => void;
  minimumDate?: Date | null;
  maximumDate?: Date | null;
  /** iOS only; must divide 60. */
  minuteInterval?: number;
  /** Names the field ("Meal time", "Fast started"). The value is read out by
   *  the control itself. */
  accessibilityLabel: string;
  testID?: string;
  /** Rendered instead when the native control is absent. */
  fallback?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function NativeDateField({
  mode,
  value,
  onChange,
  minimumDate,
  maximumDate,
  minuteInterval,
  accessibilityLabel,
  testID,
  fallback = null,
  style,
}: NativeDateFieldProps) {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [opening, setOpening] = useState(false);

  if (Platform.OS === 'ios' && NativeDatePickerView != null) {
    const Picker = NativeDatePickerView;
    return (
      <View style={[styles.iosWrap, style]}>
        <Picker
          mode={mode}
          value={value.getTime()}
          minimumDate={minimumDate ? minimumDate.getTime() : null}
          maximumDate={maximumDate ? maximumDate.getTime() : null}
          minuteInterval={minuteInterval}
          locale={localeTag(locale)}
          tintColor={colors.accent}
          pickerAccessibilityLabel={accessibilityLabel}
          pickerTestID={testID}
          onChange={(e) => {
            haptics.selection();
            onChange(clampDate(new Date(e.nativeEvent.timestamp), minimumDate, maximumDate));
          }}
        />
      </View>
    );
  }

  if (canShowNativeDatePicker) {
    const label = dateFieldLabel(value, mode, locale);
    return (
      <PressScale
        scaleTo={0.96}
        style={[styles.chip, style]}
        disabled={opening}
        onPress={async () => {
          haptics.tap();
          setOpening(true);
          const picked = await showNativeDatePicker({
            mode,
            value: value.getTime(),
            min: minimumDate?.getTime() ?? null,
            max: maximumDate?.getTime() ?? null,
          });
          setOpening(false);
          if (picked != null) onChange(clampDate(new Date(picked), minimumDate, maximumDate));
        }}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, ${label}`}
        testID={testID}
      >
        <Text style={styles.chipText} maxFontSizeMultiplier={2}>{label}</Text>
      </PressScale>
    );
  }

  return <>{fallback}</>;
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    // The compact pill brings its own fill and size; this only centres it.
    iosWrap: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    chip: {
      minHeight: 48,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      backgroundColor: colors.inputBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  });
