import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
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
import { CREATION_STYLES, type CreationStyle, logStyleKey } from './train-shared';

/** One row's identity in a multi-pick, across both halves of the list. */
export const catalogPickKey = (e: Exercise) => `c:${e.id ?? e.name}`;
export const seedPickKey = (s: SeedExercise) => `s:${s.key}`;

/** The "Add “<typed>”" row and its log-style chips, when the host offers
 *  creating a new exercise from the typed name. */
export interface SearchCreate {
  /** The trimmed typed name. */
  name: string;
  style: CreationStyle;
  onStyleChange: (s: CreationStyle) => void;
  onCreate: () => void;
  testID?: string;
  /** Each chip is `${prefix}-${style}`. */
  styleTestIDPrefix?: string;
}

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
  create,
  inTemplate,
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
  /**
   * Finding comes before creating (train-ux review T1/L10, 2026-10-11). With
   * matches, the "Add “<typed>”" row sits AFTER them and its four style chips
   * stay folded until it is tapped — the chips only matter to that path, and
   * above the results they pushed every match under the keyboard. With no
   * match, the row and chips lead, because creating is then the only path.
   */
  create?: SearchCreate;
  /**
   * Catalog ids already in the host's list (the template editor's cards).
   * Their rows say "In template" and stay pickable — a second slot of one
   * lift is legitimate — so a browse tap no longer adds a silent duplicate
   * (train-ux E-N5).
   */
  inTemplate?: ReadonlySet<string>;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  /** The create row's chips, unfolded by a first tap when matches exist.
   *  Stays unfolded for the life of the list once asked for. */
  const [stylesOpen, setStylesOpen] = useState(false);

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
        {/* The mark only when ticked: a faint check in an empty box read as
            "lightly selected" (train-ux E-N12). */}
        <View style={[styles.doneBox, on && styles.doneBoxOn]}>
          {on ? <Ionicons name="checkmark" size={font.small + 2} style={[styles.doneCheck, styles.doneCheckOn]} /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  const hasMatches = mine.length > 0 || library.length > 0;
  const chipsShown = create != null && (!hasMatches || stylesOpen);

  const createBlock = create ? (
    <>
      <TouchableOpacity
        style={styles.createRow}
        onPress={() => {
          // With matches, the first tap unfolds the chips (pick how it is
          // logged); the second creates. Without, there is nothing to fold.
          if (hasMatches && !stylesOpen) setStylesOpen(true);
          else create.onCreate();
        }}
        accessibilityRole="button"
        accessibilityState={hasMatches ? { expanded: stylesOpen } : undefined}
        testID={create.testID}
      >
        <Text style={styles.createText}>{t('train.addNamed', { name: create.name })}</Text>
      </TouchableOpacity>
      {chipsShown ? (
        <View style={[styles.styleRow, styles.styleRowWrap, { marginTop: 0 }]} accessibilityRole="radiogroup">
          {CREATION_STYLES.map((ls) => {
            const on = create.style === ls.value;
            return (
              <TouchableOpacity
                key={ls.value}
                style={[styles.styleChip, styles.styleChipHalf, on && styles.styleChipOn]}
                onPress={() => create.onStyleChange(ls.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={create.styleTestIDPrefix ? `${create.styleTestIDPrefix}-${ls.value}` : undefined}
              >
                <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </>
  ) : null;

  return (
    <>
      {!hasMatches ? createBlock : null}
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
                <View style={styles.searchMain}>
                  <Text style={styles.catalogName}>{e.name}</Text>
                  {e.id && inTemplate?.has(e.id) ? (
                    <Text style={styles.searchMuscles} testID={`${testIDPrefix}-mine-${i}-in`}>{t('train.inTemplate')}</Text>
                  ) : null}
                </View>
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

      {mine.length === 0 && library.length === 0 && !create ? (
        <Text style={styles.empty}>{q ? t('train.searchNone') : t('train.noSaved')}</Text>
      ) : null}
      {hasMatches ? createBlock : null}
    </>
  );
}
