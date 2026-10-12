import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { creditsFor, MUSCLE_GROUPS, type VolumeMuscle } from '@macrolog/core';
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
 *
 * A long-press is invisible to a sighted user, so with two or more tags a
 * "Primary: Chest · Change" row under the chips does the same by tapping
 * (train-ux X10). Change opens the TAGGED muscles as a choice and the pick is
 * the new primary — it used to hand primary to the next tag in order, which
 * with three tags cycled, and "Change" promised a choice (H-N14).
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
  /** The primary picker under the "Primary: … · Change" row is open. */
  const [picking, setPicking] = useState(false);
  const makePrimary = (m: MuscleGroup) => {
    if (value[0] === m) return;
    haptics.tap();
    onChange([m, ...value.filter((x) => x !== m)]);
  };
  const primaryName = value[0] ? t(`train.muscle.${value[0]}` as I18nKey) : '';
  return (
    <View style={{ gap: 4 }}>
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
    {value.length >= 2 ? (
      <>
      <TouchableOpacity
        style={styles.liftClear}
        onPress={() => {
          haptics.tap();
          setPicking((p) => !p);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: picking }}
        accessibilityLabel={`${t('train.musclePrimaryLine', { muscle: primaryName })}, ${t('train.musclePrimaryNext')}`}
        testID={`${testIDPrefix}-primary-next`}
      >
        <Text style={styles.liftHint}>
          {t('train.musclePrimaryLine', { muscle: primaryName })}
          {' · '}
          <Text style={styles.recTemplateLink}>{t('train.musclePrimaryNext')}</Text>
        </Text>
      </TouchableOpacity>
      {picking ? (
        <View style={styles.kindChips} accessibilityRole="radiogroup" accessibilityLabel={t('train.musclePrimary')}>
          {value.map((m) => {
            const on = value[0] === m;
            return (
              <TouchableOpacity
                key={m}
                style={[styles.kindChip, on && styles.kindChipOn]}
                onPress={() => {
                  makePrimary(m);
                  setPicking(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={`${testIDPrefix}-primary-${m}`}
              >
                <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>{t(`train.muscle.${m}` as I18nKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      </>
    ) : null}
    </View>
  );
}

/**
 * What "Myo-rep clusters by muscle" will actually credit for one cluster of
 * this lift — core `creditsFor`, the same call the sheet makes. The name table
 * wins over the tags there, so a tagged "Romanian deadlift" still counts as
 * hamstrings 1 · glutes ½; the line says so instead of letting the tags look
 * like they decide it (train-ux X1, parts 1–2; whether tags should win is an
 * owner call, not made here).
 */
/** A credit's name in the CHIP taxonomy the line sits under: the chips offer
 *  "Shoulders", never "Front delt", so a finer muscle is named as its chip
 *  plus which part ("Shoulders (front) ½", Train UX v2 QA). Same-named
 *  muscles read the chip's own key. */
const CREDIT_NAME_KEY: Record<VolumeMuscle, I18nKey> = {
  chest: 'train.muscle.chest',
  frontDelt: 'train.muscleCredit.frontDelt',
  sideDelt: 'train.muscleCredit.sideDelt',
  rearDelt: 'train.muscleCredit.rearDelt',
  triceps: 'train.muscle.triceps',
  back: 'train.muscle.back',
  biceps: 'train.muscle.biceps',
  quads: 'train.muscle.quads',
  hamstrings: 'train.muscle.hamstrings',
  glutes: 'train.muscle.glutes',
  calves: 'train.muscle.calves',
  abs: 'train.muscleCredit.abs',
};

export function MuscleCreditLine({ name, muscles, testID }: { name: string; muscles: readonly MuscleGroup[]; testID?: string }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const credits = creditsFor(name, muscles);
  const fromName = creditsFor(name).length > 0;
  if (credits.length === 0) {
    return <Text style={styles.liftHint} testID={testID}>{t('train.musclesVolumeNone')}</Text>;
  }
  const list = credits
    .map((c) => `${t(CREDIT_NAME_KEY[c.muscle])} ${c.weight === 1 ? '1' : '½'}`)
    .join(' · ');
  return (
    <Text style={styles.liftHint} testID={testID}>
      {t('train.musclesVolumeCredit', { list })}
      {fromName ? ` ${t('train.musclesVolumeFromName')}` : ''}
    </Text>
  );
}
