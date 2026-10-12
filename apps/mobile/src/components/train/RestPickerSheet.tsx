import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
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
 *
 * Both modes pick without closing and apply "Keep" on ANY close — Done in the
 * header, a swipe, a backdrop tap — in one write (L-N6: the plain picker
 * closed on the chip, so a Keep ticked after it saved nothing). Every rest
 * reads as a clock, "0:30" (L-N16: one picker showed "0:30" and "30 s").
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
  running,
}: {
  visible: boolean;
  name: string;
  /** Opened from the running countdown: say that a pick changes the NEXT
   *  rests and that ±30 s changes this one (L-N5 — the superset picker said
   *  so; the plain one, for a straight lift, said nothing). */
  running?: boolean;
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
    /** Write the picked rests onto the template's leader row, together. */
    onSave: (rests: { transition?: number; round?: number }) => void;
    /** Opened from the countdown: the rest that is running, so its row says
     *  "Running now" — a switch, a round, or a lift's own rest (`own`). */
    running?: 'transition' | 'round' | 'own' | null;
    /** A lift's own between-cluster / after-lift rest — offered only when
     *  that is the rest running (a leftover round runs on it, and neither
     *  group rest sets it). For this workout; "Keep" does not write it. */
    own?: { label: string; current: number | null; fallback: number; onPick: (seconds: number | null) => void } | null;
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
    const row = (
      field: 'transition' | 'round' | 'own',
      current: number | null,
      fallback: number,
      label: string,
      pick: (seconds: number | null) => void,
      choiceList?: readonly number[],
      format?: (seconds: number) => string,
    ) => {
      // Defaults resolved in the body, not as parameter defaults: React
      // Compiler cannot reorder an arrow-function default and skips the
      // whole component.
      const choices = choiceList ?? SUPERSET_REST_CHOICES_SEC;
      const fmt = format ?? clock;
      const running = superset.running === field;
      // The value in force is always a chip: an override outside the list
      // (picked elsewhere, or a list that changed) still shows as selected.
      const values: (number | null)[] = [null, ...choices, ...(current != null && !choices.includes(current) ? [current] : [])];
      return (
        <View key={field} style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={running ? `${label}, ${t('train.restRunningNow')}` : label}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.fieldLabel, { flexShrink: 1 }]}>{label}</Text>
            {running ? (
              <Text style={[styles.fieldLabel, { color: colors.teal }]} testID={`rest-pick-${field}-running`}>
                {`· ${t('train.restRunningNow')}`}
              </Text>
            ) : null}
          </View>
          <View style={styles.kindChips}>
            {values.map((value) => {
              const on = current === value;
              return (
                <Touchable
                  key={`${field}-${value ?? 'default'}`}
                  style={[styles.kindChip, on && styles.kindChipOn]}
                  onPress={() => {
                    haptics.tap();
                    pick(value);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  testID={`rest-pick-${field}-${value ?? 'default'}`}
                >
                  <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>
                    {value == null ? t('train.restDefault', { time: fmt(fallback) }) : fmt(value)}
                  </Text>
                </Touchable>
              );
            })}
          </View>
        </View>
      );
    };
    const groupRow = (field: 'transition' | 'round', current: number | null, fallback: number, label: string) =>
      row(field, current, fallback, label, (v) => superset.onPick(field, v));
    const own = superset.own;
    const ownRow = own ? row('own', own.current, own.fallback, own.label, own.onPick, REST_CHOICES_SEC, clock) : null;
    // "Keep" is applied on ANY close — Done, a swipe down or a backdrop tap —
    // in ONE template write. Ticking it after picking used to save nothing,
    // every chip tap with it on saved again, and a swipe dropped it silently.
    const commitAndClose = () => {
      if (keep && saveTo && (superset.transition != null || superset.round != null)) {
        superset.onSave({
          ...(superset.transition != null ? { transition: superset.transition } : {}),
          ...(superset.round != null ? { round: superset.round } : {}),
        });
      }
      onClose();
    };
    return (
      <BottomSheet native detents="fit" visible={visible} onClose={commitAndClose} backdropTestID="rest-picker-backdrop" contentStyle={styles.sheetBody} maxHeight="80%">
        <View style={styles.sheetStack}>
          {/* Done in the header, as every Train sheet has it (L-N7); the
              full-width button at the foot is gone. */}
          <SheetHeader
            title={t('train.superset.restPickerTitle', { group: superset.group })}
            trailing={{ label: t('common.done'), onPress: commitAndClose, testID: 'rest-picker-done' }}
          />
          <Text style={styles.sheetHint}>
            {superset.running ? `${t('train.superset.restPickerHint')} ${t('train.restRunningHint')}` : t('train.superset.restPickerHint')}
          </Text>
          {/* The rest running now leads (L16 follow-up). */}
          {superset.running === 'own' ? ownRow : null}
          {groupRow('transition', superset.transition, superset.transitionFallback, t('train.superset.switchRestLabel'))}
          {groupRow('round', superset.round, superset.roundFallback, t('train.superset.roundRestLabel'))}
          {superset.running !== 'own' ? ownRow : null}
          {saveTo ? (
            <Touchable
              style={styles.checkRow}
              onPress={() => {
                haptics.tap();
                setKeep((k) => !k);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: keep }}
              testID="rest-keep-superset"
            >
              <Ionicons name={keep ? 'checkbox' : 'square-outline'} size={20} color={keep ? colors.teal : colors.muted} />
              <Text style={styles.progToggleText}>{t('train.superset.keepForGroup', { group: superset.group, template: saveTo })}</Text>
            </Touchable>
          ) : null}
        </View>
      </BottomSheet>
    );
  }
  // "Default" means "no override" — there is nothing to keep.
  const commitPlain = () => {
    if (keep && saveTo && current != null) onSave?.(current);
    onClose();
  };
  return (
    <BottomSheet native detents="fit" visible={visible} onClose={commitPlain} contentStyle={styles.sheetBody} maxHeight="80%">
      <View style={styles.sheetStack}>
        <SheetHeader
          title={t('train.restPickerTitle')}
          trailing={{ label: t('common.done'), onPress: commitPlain, testID: 'rest-picker-done' }}
        />
        <Text style={styles.sheetHint}>{`${name} · ${t('train.restPickerHint')}`}</Text>
        {running ? (
          <Text style={[styles.sheetHint, { color: colors.teal }]} testID="rest-picker-running-hint">
            {t('train.restRunningHint')}
          </Text>
        ) : null}
        <View style={styles.kindChips} accessibilityRole="radiogroup">
          {chip(null, t('train.restDefault', { time: clock(fallback) }), 'rest-pick-default')}
          {[...REST_CHOICES_SEC, ...(current != null && !(REST_CHOICES_SEC as readonly number[]).includes(current) ? [current] : [])]
            .map((s) => chip(s, clock(s), `rest-pick-${s}`))}
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
