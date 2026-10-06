import { ScrollView, Text, View } from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import { useEffect, useState } from 'react';
import type { SeedExercise } from '@macrolog/core';
import type { Exercise } from '@/lib/workout';
import { useT } from '@/i18n';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { createStyles } from './train-styles';
import { ExerciseSearchList } from './ExerciseSearchList';

/**
 * Browse every movement — the ones you have logged, and the ones the app
 * ships — from one searchable sheet.
 *
 * ## Why it is a sheet and not a home-screen section
 *
 * The catalog used to render as an **unbounded list at the bottom of the Train
 * tab**, below the hero, the cluster audit, the start button, the templates
 * and the whole session history. A library is a lookup surface: you go to it
 * with a movement in mind. Putting one on a home screen costs every visit a
 * scroll past it and buys nothing, and it was the sixth stacked section on a
 * screen whose complaint was crowding.
 *
 * Picking a movement that is already yours opens its detail (history, PRs,
 * e1RM). Picking a library movement clones it into the catalog first — which
 * is what finally gives a hand-made catalog entry its muscle groups.
 *
 * ## Revived 2026-10-04 as a NATIVE sheet (Train review items 21, 32)
 *
 * It was retired on 2026-09-17 because no row inside its ScrollView fired
 * `onPress` on iOS — inside the JS sheet's RN `Modal`, cause never found
 * (eight candidates disproven; `train.tsx` history). On iOS it is now a
 * `UISheetPresentationController` route, which has no RN Modal in it at all,
 * so the one structure the failure was observed in is gone. Android keeps the
 * JS sheet, where the rows were never reported dead. The home screen keeps a
 * short inline list beside "Browse all", so a regression here costs the long
 * tail, not the whole catalog — VERIFY ON AN iPHONE before trusting it.
 */
export function ExerciseLibrarySheet({
  visible,
  catalog,
  onClose,
  onOpenExercise,
  onAddSeed,
}: {
  visible: boolean;
  catalog: readonly Exercise[];
  onClose: () => void;
  onOpenExercise: (e: Exercise) => void;
  /** Clone a library movement into the catalog. Resolves to nothing; the
   *  sheet closes and the catalog subscription brings the new row in. */
  onAddSeed: (s: SeedExercise) => Promise<void>;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const inputRef = useDeferredFocus(visible, NATIVE_SHEETS ? 450 : 300);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setBusy(false);
    }
  }, [visible]);

  async function addSeed(seed: SeedExercise) {
    if (busy) return;
    setBusy(true);
    try {
      await onAddSeed(seed);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet native detents={[0.6, 1]} visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <View style={styles.sheetStack}>
      <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.libraryTitle')}</Text>
      <SheetTextInput
        ref={inputRef}
        style={styles.input}
        placeholder={t('train.librarySearchPh')}
        placeholderTextColor={colors.faint}
        value={query}
        onChangeText={setQuery}
        accessibilityLabel={t('train.librarySearchPh')}
        testID="library-search"
      />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ExerciseSearchList
          query={query}
          catalog={catalog}
          onPickCatalog={onOpenExercise}
          onPickSeed={(s) => void addSeed(s)}
          // A browse surface, not a picker: show the whole catalog when the
          // query is empty rather than the six a picker would.
          catalogLimit={query.trim() ? 8 : 200}
          libraryLimit={query.trim() ? 8 : 12}
          testIDPrefix="library"
        />
        <View style={styles.setSheetTail} />
      </ScrollView>
      </View>
    </BottomSheet>
  );
}
