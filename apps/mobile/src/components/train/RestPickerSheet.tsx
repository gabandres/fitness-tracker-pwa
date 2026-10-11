import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { REST_CHOICES_SEC, clock } from './train-summary';
import { createStyles } from './train-styles';

/** Superset rests on offer, seconds — the 30–45 s prescription and a little either side. */
const SUPERSET_REST_CHOICES_SEC = [15, 30, 45, 60, 90] as const;

/**
 * Rest after each set, for ONE exercise of the live workout (Train review
 * item 7) — the ⋯ menu's "Rest timer".
 *
 * Session-local by default: it changes how long the next countdowns run, not
 * the template. "Keep for this lift in <template>" (`saveTo`) is the opt-in
 * that writes the choice onto the template row as well — so a rest picked
 * mid-workout is not lost on a restart and does not have to be picked again
 * next week (Train re-score). Off each time the sheet opens: overwriting the
 * template is a decision, not a default.
 */
export function RestPickerSheet({
  visible,
  superset,
  name,
  current,
  fallback,
  onPick,
  saveTo,
  onSave,
  onClose,
}: {
  visible: boolean;
  name: string;
  /** The override in force, or null for the template's / default rest. */
  current: number | null;
  /** What applies with no override, seconds. */
  fallback: number;
  onPick: (seconds: number | null) => void;
  /** The template this lift came from, by name — offers "Keep for this lift".
   *  Null for an ad-hoc lift, which has no template row to write to. */
  saveTo?: string | null;
  /** Write a picked rest onto the template row (only with `saveTo`). */
  onSave?: (seconds: number) => void;
  onClose: () => void;
  /** A superset member: the picker sets the GROUP's two rests — switching to
   *  the partner and between rounds — for this workout, and "Keep" writes
   *  them on the template's leader row. The mini-set rest is not offered: a
   *  60 s rest between myo-reps minis is a different protocol. */
  superset?: {
    group: string;
    transition: number | null;
    round: number | null;
    transitionFallback: number;
    roundFallback: number;
    onPick: (field: 'transition' | 'round', seconds: number | null) => void;
    onSave: (field: 'transition' | 'round', seconds: number) => void;
  };
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // Reset to off on every opening — derived during render (React's "previous
  // value" pattern) rather than in an effect, which would paint a frame of the
  // last opening's choice first.
  const [keep, setKeep] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setKeep(false);
  }
  const chip = (value: number | null, text: string, testID: string) => {
    const on = current === value;
    return (
      <Touchable
        key={testID}
        style={[styles.kindChip, on && styles.kindChipOn]}
        onPress={() => {
          haptics.tap();
          onPick(value);
          // "Default" means "no override" — there is nothing to keep.
          if (keep && saveTo && value != null) onSave?.(value);
          onClose();
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, checked: on }}
        testID={testID}
      >
        <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>{text}</Text>
      </Touchable>
    );
  };
  if (superset) {
    const row = (field: 'transition' | 'round', current: number | null, fallback: number, label: string) => (
      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.kindChips}>
          {[null, ...SUPERSET_REST_CHOICES_SEC].map((value) => {
            const on = current === value;
            return (
              <Touchable
                key={`${field}-${value ?? 'default'}`}
                style={[styles.kindChip, on && styles.kindChipOn]}
                onPress={() => {
                  haptics.tap();
                  superset.onPick(field, value);
                  if (keep && saveTo && value != null) superset.onSave(field, value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={`rest-pick-${field}-${value ?? 'default'}`}
              >
                <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>
                  {value == null ? t('train.restDefault', { time: clock(fallback) }) : clock(value)}
                </Text>
              </Touchable>
            );
          })}
        </View>
      </View>
    );
    return (
      <BottomSheet native detents="fit" visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
        <View style={styles.sheetStack}>
          <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.superset.restPickerTitle', { group: superset.group })}</Text>
          <Text style={styles.sheetHint}>{t('train.superset.restPickerHint')}</Text>
          {row('transition', superset.transition, superset.transitionFallback, t('train.superset.switchRestLabel'))}
          {row('round', superset.round, superset.roundFallback, t('train.superset.roundRestLabel'))}
          {saveTo ? (
            <Touchable
              style={styles.checkRow}
              onPress={() => setKeep((k) => !k)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: keep }}
              testID="rest-keep-superset"
            >
              <Ionicons name={keep ? 'checkbox' : 'square-outline'} size={20} color={keep ? colors.teal : colors.muted} />
              <Text style={styles.progToggleText}>{t('train.superset.keepForGroup', { group: superset.group, template: saveTo })}</Text>
            </Touchable>
          ) : null}
          <Touchable style={styles.tplStart} onPress={onClose} accessibilityRole="button" testID="rest-picker-done">
            <Text style={styles.tplStartText}>{t('common.done')}</Text>
          </Touchable>
        </View>
      </BottomSheet>
    );
  }
  return (
    <BottomSheet native detents="fit" visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <View style={styles.sheetStack}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.restPickerTitle')}</Text>
        <Text style={styles.sheetHint}>{`${name} · ${t('train.restPickerHint')}`}</Text>
        <View style={styles.kindChips} accessibilityRole="radiogroup">
          {chip(null, t('train.restDefault', { time: clock(fallback) }), 'rest-pick-default')}
          {REST_CHOICES_SEC.map((s) => chip(s, clock(s), `rest-pick-${s}`))}
        </View>
        {saveTo ? (
          <Touchable
            style={styles.checkRow}
            onPress={() => {
              haptics.tap();
              setKeep((k) => !k);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: keep }}
            testID="rest-keep-for-lift"
          >
            <Ionicons name={keep ? 'checkbox' : 'square-outline'} size={20} color={keep ? colors.teal : colors.muted} />
            <Text style={[styles.moreText, { flex: 1 }]}>{t('train.restSaveForLift', { template: saveTo })}</Text>
          </Touchable>
        ) : null}
      </View>
    </BottomSheet>
  );
}
