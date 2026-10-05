import { Text, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles } from '@/lib/theme-context';
import { REST_CHOICES_SEC, clock } from './train-summary';
import { createStyles } from './train-styles';

/**
 * Rest after each set, for ONE exercise of the live workout (Train review
 * item 7) — the ⋯ menu's "Rest timer".
 *
 * Session-local by design: it changes how long the next countdowns run, not
 * the template. A rest that should hold every week belongs in the template
 * editor's per-exercise rest, which this does not overwrite.
 */
export function RestPickerSheet({
  visible,
  name,
  current,
  fallback,
  onPick,
  onClose,
}: {
  visible: boolean;
  name: string;
  /** The override in force, or null for the template's / default rest. */
  current: number | null;
  /** What applies with no override, seconds. */
  fallback: number;
  onPick: (seconds: number | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const chip = (value: number | null, text: string, testID: string) => {
    const on = current === value;
    return (
      <TouchableOpacity
        key={testID}
        style={[styles.kindChip, on && styles.kindChipOn]}
        hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
        onPress={() => {
          haptics.tap();
          onPick(value);
          onClose();
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, checked: on }}
        testID={testID}
      >
        <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>{text}</Text>
      </TouchableOpacity>
    );
  };
  return (
    <BottomSheet native detents="fit" visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <View style={styles.sheetStack}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.restPickerTitle')}</Text>
        <Text style={styles.sheetHint}>{`${name} · ${t('train.restPickerHint')}`}</Text>
        <View style={styles.kindChips} accessibilityRole="radiogroup">
          {chip(null, t('train.restDefault', { time: clock(fallback) }), 'rest-pick-default')}
          {REST_CHOICES_SEC.map((s) => chip(s, clock(s), `rest-pick-${s}`))}
        </View>
      </View>
    </BottomSheet>
  );
}
