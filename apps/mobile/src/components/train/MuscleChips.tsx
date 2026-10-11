import { Text, TouchableOpacity, View } from 'react-native';
import { MUSCLE_GROUPS } from '@macrolog/core';
import type { MuscleGroup } from '@macrolog/core/workout';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles } from '@/lib/theme-context';
import { createStyles } from './train-styles';

/**
 * The muscle tags of one exercise, with the PRIMARY one marked.
 *
 * `muscles[0]` is the primary muscle — what the weekly cluster count credits
 * and what a superset's same-muscle / opposing-muscle judgement reads. Until
 * 2026-10-11 nothing on screen said so: the tap ORDER decided it, and turning a
 * chip off and on again silently demoted it. Now the first chip carries a
 * "Primary" label, and a long-press (or the screen reader's "Make primary"
 * action) moves any tagged muscle to the front.
 */
export function MuscleChips({
  value,
  onChange,
  testIDPrefix = 'edit-muscle',
}: {
  value: readonly MuscleGroup[];
  onChange: (next: MuscleGroup[]) => void;
  testIDPrefix?: string;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const makePrimary = (m: MuscleGroup) => {
    if (value[0] === m) return;
    haptics.tap();
    onChange([m, ...value.filter((x) => x !== m)]);
  };
  return (
    <View style={styles.kindChips}>
      {MUSCLE_GROUPS.map((m) => {
        const on = value.includes(m);
        const primary = value[0] === m;
        const name = t(`train.muscle.${m}` as I18nKey);
        return (
          <TouchableOpacity
            key={m}
            style={[styles.kindChip, on && styles.kindChipOn]}
            onPress={() => {
              haptics.tap();
              onChange(on ? value.filter((x) => x !== m) : [...value, m]);
            }}
            onLongPress={() => (on ? makePrimary(m) : onChange([m, ...value]))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={primary ? t('train.musclePrimaryA11y', { muscle: name }) : name}
            accessibilityActions={on && !primary ? [{ name: 'makePrimary', label: t('train.musclePrimary') }] : []}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'makePrimary') makePrimary(m);
            }}
            testID={`${testIDPrefix}-${m}`}
          >
            <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>
              {primary ? `${name} · ${t('train.musclePrimary')}` : name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
