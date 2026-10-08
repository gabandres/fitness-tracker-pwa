import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { SheetTextInput } from '@/components/SheetTextInput';
import { MOBILITY_SEED_KEYS, type SeedExercise } from '@macrolog/core';
import type { Exercise } from '@/lib/workout';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
import { showToast } from '@/components/Toast';
import type { ActivePick, TrainState } from '@/hooks/useTrain';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { ExerciseSearchList, catalogPickKey, seedPickKey } from './ExerciseSearchList';
import { CREATION_STYLES, type CreationStyle, logStyleFor, setKindFor } from './train-shared';
import { createStyles } from './train-styles';

/**
 * Add an exercise to the live session — or, opened from the ⋯ menu's
 * "Replace exercise", put one in place of the exercise at `replaceIndex`
 * (Train review item 9). Same list either way; only the verb changes.
 *
 * Adding takes several at once (Train re-score 3): Hevy and Strong let you
 * tick a few and "Add (3)", and building a session one sheet at a time was
 * three round trips for three lifts. A tap on a row still adds that one and
 * closes, as it always did; the tick at the row's end starts a pick, and once
 * anything is ticked a tap on a row ticks it too. Replacing stays one-for-one.
 */
export function AddExerciseSheet({
  visible,
  train,
  replace,
  onClose,
}: {
  visible: boolean;
  train: Pick<TrainState, 'catalog' | 'addExerciseToActive' | 'addLibraryExerciseToActive' | 'addManyToActive'>;
  /** Replacing rather than adding: the slot and the name it holds now. */
  replace?: { index: number; name: string } | null;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // The native sheet mounts its content a beat after the push, so its field
  // is focused a beat later too.
  const addExerciseInputRef = useDeferredFocus(visible, NATIVE_SHEETS ? 450 : 300);
  const [name, setName] = useState('');
  // A CreationStyle, not a LogStyle: the fourth option is `mobility`, which
  // means a timed exercise WHOSE SETS are mobility. Same seam as the template
  // editor's chip row — this is the other door onto the same defect, and
  // fixing only one leaves a stretch added mid-session able to take a
  // duration PR (ADR-0028).
  const [logStyle, setLogStyle] = useState<CreationStyle>('weight-reps');
  /** The multi-pick, in the order ticked — that is the order they are added. */
  const [picked, setPicked] = useState<ReadonlyMap<string, ActivePick>>(new Map());

  useEffect(() => {
    if (visible) {
      setName('');
      setLogStyle('weight-reps');
      setPicked(new Map());
    }
  }, [visible]);

  const trimmed = name.trim();
  const replaceIndex = replace?.index;
  // One add at a time: a fast double tap on a catalog row used to add the
  // exercise twice, and a rejected write (signed out, offline rules) left the
  // sheet open with nothing said and an unhandled rejection in Sentry.
  const [adding, setAdding] = useState(false);

  async function guarded(run: () => Promise<void>, where: string) {
    if (adding) return;
    haptics.tap();
    setAdding(true);
    try {
      await run();
      onClose();
    } catch (e) {
      haptics.warning();
      showToast(t('train.exerciseSaveErr'));
      captureError(e, { where });
    }
    // After the try/catch, not in a `finally`: React Compiler cannot lower a
    // `finally` and skips the whole component. Nothing above can throw past
    // the catch, so this still runs on both paths.
    setAdding(false);
  }

  function add(exName: string, style: CreationStyle, exerciseId?: string) {
    return guarded(
      () => train.addExerciseToActive(exName, logStyleFor(style), exerciseId, setKindFor(style), replaceIndex),
      'train.addExerciseToActive',
    );
  }

  function addSeed(seed: SeedExercise) {
    return guarded(() => train.addLibraryExerciseToActive(seed, replaceIndex), 'train.addLibraryExerciseToActive');
  }

  /** A catalog row's style: a seeded mobility movement stays mobility when
   *  re-added from the catalog, whatever the chips happen to be showing. */
  const catalogStyle = (e: Exercise): CreationStyle =>
    e.seedKey != null && MOBILITY_SEED_KEYS.has(e.seedKey) ? 'mobility' : (e.logStyle ?? 'weight-reps');

  function toggle(key: string, pick: ActivePick) {
    haptics.selection();
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(key)) next.delete(key);
      else next.set(key, pick);
      return next;
    });
  }
  const toggleCatalog = (e: Exercise) => {
    const style = catalogStyle(e);
    toggle(catalogPickKey(e), { kind: 'catalog', exercise: e, logStyle: logStyleFor(style), setKind: setKindFor(style) });
  };
  const toggleSeed = (seed: SeedExercise) => toggle(seedPickKey(seed), { kind: 'seed', seed });
  /** Replacing is one-for-one; only adding offers the pick. */
  const multi = !replace;
  const picking = multi && picked.size > 0;

  return (
    <BottomSheet
      native
      detents={[0.6, 1]}
      visible={visible}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      <View style={styles.sheetStack}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {replace ? t('train.replaceTitle', { name: replace.name }) : t('train.addExerciseTitle')}
        </Text>
        {multi ? <Text style={styles.sheetHint}>{t('train.addPickHint')}</Text> : null}

        <SheetTextInput
          ref={addExerciseInputRef}
          style={styles.input}
          placeholder={t('train.exerciseName')}
          placeholderTextColor={colors.faint}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          accessibilityLabel={t('train.exerciseName')}
          testID="exercise-name"
        />

        <View style={[styles.styleRow, styles.styleRowWrap]} accessibilityRole="radiogroup">
          {CREATION_STYLES.map((ls) => {
            const on = logStyle === ls.value;
            return (
              <Touchable
                key={ls.value}
                style={[styles.styleChip, styles.styleChipHalf, on && styles.styleChipOn]}
                onPress={() => setLogStyle(ls.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={`logstyle-${ls.value}`}
              >
                <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
              </Touchable>
            );
          })}
        </View>

        {trimmed ? (
          <Touchable
            style={styles.createRow}
            onPress={() => add(trimmed, logStyle)}
            accessibilityRole="button"
            testID="create-exercise"
          >
            <Text style={styles.createText}>{t('train.addNamed', { name: trimmed })}</Text>
          </Touchable>
        ) : null}

        {/* The user's catalog AND the shipped library, one list. The
            library half is the fix for the free-type path minting a
            movement with `muscles: []` that no screen could then edit. */}
        <ScrollView style={NATIVE_SHEETS ? { flexShrink: 1 } : styles.catalogList} keyboardShouldPersistTaps="handled">
          <ExerciseSearchList
            query={name}
            catalog={train.catalog}
            testIDPrefix="add-ex"
            // A seeded mobility movement stays mobility when re-added from
            // the catalog, whatever the chips happen to be showing.
            onPickCatalog={(e) => (picking ? toggleCatalog(e) : void add(e.name, catalogStyle(e), e.id))}
            onPickSeed={(seed) => (picking ? toggleSeed(seed) : void addSeed(seed))}
            selected={multi ? new Set(picked.keys()) : undefined}
            onToggleCatalog={multi ? toggleCatalog : undefined}
            onToggleSeed={multi ? toggleSeed : undefined}
          />
        </ScrollView>

        {picking ? (
          <Touchable
            style={[styles.finishBtn, styles.addPickedBtn, adding && styles.btnDisabled]}
            onPress={() => void guarded(() => train.addManyToActive([...picked.values()]), 'train.addManyToActive')}
            disabled={adding}
            accessibilityRole="button"
            accessibilityState={{ disabled: adding, busy: adding }}
            testID="add-picked"
          >
            <Text style={styles.finishText}>{t('train.addSelected', { n: picked.size })}</Text>
          </Touchable>
        ) : null}
      </View>
    </BottomSheet>
  );
}
