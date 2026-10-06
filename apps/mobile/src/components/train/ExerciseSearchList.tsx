import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  type SeedExercise,
  searchExerciseLibrary,
  seedExerciseName,
} from '@macrolog/core';
import type { Exercise } from '@/lib/workout';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { useThemedStyles } from '@/lib/theme-context';
import { font } from '@/theme';
import { createStyles } from './train-styles';
import { logStyleKey } from './train-shared';

/** One row's identity in a multi-pick, across both halves of the list. */
export const catalogPickKey = (e: Exercise) => `c:${e.id ?? e.name}`;
export const seedPickKey = (s: SeedExercise) => `s:${s.key}`;

/**
 * Exercise search results — the user's own catalog first, then the shipped
 * library — in one list, for every surface that picks an exercise.
 *
 * ## Why this exists
 *
 * `EXERCISE_LIBRARY` ships ~70 movements carrying muscle groups and coaching
 * cues in three locales, and until now **no screen could reach it**. Both
 * pickers (the in-session add sheet and the template editor's adder) filtered
 * `train.catalog` and nothing else, so the library only entered a catalog as a
 * side effect of cloning a starter template. A new account typing "Bench" saw
 * an empty list and free-typed a movement written with `muscles: []` — which
 * no screen could then edit, which is precisely what the weekly cluster
 * audit's `unattributed` line had been reporting all along.
 *
 * ## One component, three hosts
 *
 * The in-session add sheet, the template editor's adder and the home Library
 * browser all ask the same question and differ only in what they do with the
 * answer. They had three separate copies of the filter-and-map, and two of
 * them had already drifted on how a seeded mobility movement is classified.
 * The hosts keep their own chrome (title, text field, create-new row); this
 * owns only the results.
 *
 * Library rows are hidden once the movement is in the catalog — offering it
 * would mint nothing and read as a duplicate of the row directly above.
 */
export function ExerciseSearchList({
  query,
  catalog,
  onPickCatalog,
  onPickSeed,
  catalogLimit = 6,
  libraryLimit = 6,
  testIDPrefix = 'ex-search',
  selected,
  onToggleCatalog,
  onToggleSeed,
}: {
  query: string;
  catalog: readonly Exercise[];
  onPickCatalog: (e: Exercise) => void;
  onPickSeed: (s: SeedExercise) => void;
  /**
   * Multi-pick, for a host that offers it (the in-session add sheet): the
   * picked rows by {@link catalogPickKey} / {@link seedPickKey}. With the two
   * toggles given, every row carries a tick box at its end; a host without
   * them keeps the one-tap rows exactly as they were.
   */
  selected?: ReadonlySet<string>;
  onToggleCatalog?: (e: Exercise) => void;
  onToggleSeed?: (s: SeedExercise) => void;
  /** Catalog rows to show. The browse case (empty query) wants more. */
  catalogLimit?: number;
  libraryLimit?: number;
  testIDPrefix?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);

  const q = query.trim().toLowerCase();
  const mine = (q ? catalog.filter((e) => e.name.toLowerCase().includes(q)) : catalog)
    .slice(0, catalogLimit);
  // Every seed key the user already owns, so the library half never offers a
  // movement that is one row above it in the catalog half.
  const owned = new Set<string>();
  for (const e of catalog) if (e.seedKey) owned.add(e.seedKey);
  const library = searchExerciseLibrary(query, locale, { exclude: owned, limit: libraryLimit });

  const muscleLine = (seed: SeedExercise): string =>
    seed.muscles.map((m) => t(`train.muscle.${m}` as I18nKey)).join(' · ');

  /** The tick box at a row's end, when the host multi-picks. A sibling of the
   *  row's own button, not inside it, so VoiceOver reaches both. */
  const tick = (key: string, name: string, onToggle: () => void, testID: string) => {
    const on = selected?.has(key) ?? false;
    return (
      <TouchableOpacity
        style={styles.setDoneCell}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={t('train.selectExerciseA11y', { name })}
        testID={testID}
      >
        <View style={[styles.doneBox, on && styles.doneBoxOn]}>
          <Ionicons name="checkmark" size={font.small + 2} style={[styles.doneCheck, on && styles.doneCheckOn]} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      {mine.length > 0 ? (
        <>
          <Text style={styles.searchGroup}>{t('train.searchMine')}</Text>
          {mine.map((e, i) => {
            const row = (
              <TouchableOpacity
                key={e.id ?? `mine-${i}`}
                style={[styles.catalogRow, onToggleCatalog && styles.pickRowMain]}
                onPress={() => onPickCatalog(e)}
                accessibilityRole="button"
                // Indexed, not keyed by doc id: a UI test can know "the first
                // match" but never a Firestore id it did not create.
                testID={`${testIDPrefix}-mine-${i}`}
              >
                <Text style={styles.catalogName}>{e.name}</Text>
                <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
              </TouchableOpacity>
            );
            return onToggleCatalog ? (
              <View key={e.id ?? `mine-${i}`} style={styles.pickRow}>
                {row}
                {tick(catalogPickKey(e), e.name, () => onToggleCatalog(e), `${testIDPrefix}-mine-${i}-pick`)}
              </View>
            ) : row;
          })}
        </>
      ) : null}

      {library.length > 0 ? (
        <>
          <Text style={styles.searchGroup}>{t('train.searchLibrary')}</Text>
          {library.map((seed, i) => {
            const name = seedExerciseName(seed, locale);
            const row = (
              <TouchableOpacity
                key={seed.key}
                style={[styles.catalogRow, onToggleSeed && styles.pickRowMain]}
                onPress={() => onPickSeed(seed)}
                accessibilityRole="button"
                testID={`${testIDPrefix}-lib-${i}`}
              >
                <View style={styles.searchMain}>
                  <Text style={styles.catalogName}>{name}</Text>
                  {/* The muscle line is the reason to pick the library row over
                      typing the same name: it is the metadata the free-type path
                      cannot produce, and the weekly cluster audit reads it. */}
                  {seed.muscles.length > 0 ? (
                    <Text style={styles.searchMuscles}>{muscleLine(seed)}</Text>
                  ) : null}
                </View>
                <Text style={styles.catalogStyle}>{t(logStyleKey(seed.logStyle))}</Text>
              </TouchableOpacity>
            );
            return onToggleSeed ? (
              <View key={seed.key} style={styles.pickRow}>
                {row}
                {tick(seedPickKey(seed), name, () => onToggleSeed(seed), `${testIDPrefix}-lib-${i}-pick`)}
              </View>
            ) : row;
          })}
        </>
      ) : null}

      {mine.length === 0 && library.length === 0 ? (
        <Text style={styles.empty}>{q ? t('train.searchNone') : t('train.noSaved')}</Text>
      ) : null}
    </>
  );
}
