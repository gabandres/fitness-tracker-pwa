import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MOBILITY_SEED_KEYS, type SeedExercise } from '@macrolog/core';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { ExerciseSearchList } from './ExerciseSearchList';
import { CREATION_STYLES, type CreationStyle, logStyleFor, setKindFor } from './train-shared';
import { createStyles } from './train-styles';

/**
 * Add an exercise to the live session — or, opened from the ⋯ menu's
 * "Replace exercise", put one in place of the exercise at `replaceIndex`
 * (Train review item 9). Same list either way; only the verb changes.
 */
export function AddExerciseSheet({
  visible,
  train,
  replace,
  onClose,
}: {
  visible: boolean;
  train: Pick<TrainState, 'catalog' | 'addExerciseToActive' | 'addLibraryExerciseToActive'>;
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

  useEffect(() => {
    if (visible) {
      setName('');
      setLogStyle('weight-reps');
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
    } finally {
      setAdding(false);
    }
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

        <TextInput
          ref={addExerciseInputRef}
          style={styles.input}
          placeholder={t('train.exerciseName')}
          placeholderTextColor={colors.faint}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          testID="exercise-name"
        />

        <View style={[styles.styleRow, styles.styleRowWrap]} accessibilityRole="radiogroup">
          {CREATION_STYLES.map((ls) => {
            const on = logStyle === ls.value;
            return (
              <TouchableOpacity
                key={ls.value}
                style={[styles.styleChip, styles.styleChipHalf, on && styles.styleChipOn]}
                onPress={() => setLogStyle(ls.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={`logstyle-${ls.value}`}
              >
                <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {trimmed ? (
          <TouchableOpacity
            style={styles.createRow}
            onPress={() => add(trimmed, logStyle)}
            accessibilityRole="button"
            testID="create-exercise"
          >
            <Text style={styles.createText}>{t('train.addNamed', { name: trimmed })}</Text>
          </TouchableOpacity>
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
            onPickCatalog={(e) =>
              void add(
                e.name,
                e.seedKey != null && MOBILITY_SEED_KEYS.has(e.seedKey)
                  ? 'mobility'
                  : (e.logStyle ?? 'weight-reps'),
                e.id,
              )
            }
            onPickSeed={(seed) => void addSeed(seed)}
          />
        </ScrollView>
      </View>
    </BottomSheet>
  );
}
