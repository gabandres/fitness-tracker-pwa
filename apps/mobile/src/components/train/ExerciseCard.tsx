import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import { Touchable } from './Touchable';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  barFor,
  computePlateLoad,
  exerciseHistory,
  formatLoad,
  generateWarmup,
  loadUnit,
  platesFor,
  previousCell,
  previousSets,
  setBeatsBest,
  setRowLabels,
  suggestProgression,
  toDisplayLoad,
} from '@macrolog/core';
import {
  DEFAULT_LOG_STYLE,
  isLoggedSet,
  type Exercise,
  type SessionExercise,
  type TemplateExercise,
  type WorkoutSession,
  type WorkoutSet,
} from '@/lib/workout';
import type { TrainState } from '@/hooks/useTrain';
import { RecommendationNote } from '@/components/train/RecommendationNote';
import { useLocale, useT } from '@/i18n';
import { formatDecimal } from '@/lib/entry-input';
import * as haptics from '@/lib/haptics';
import { smoothLayout } from '@/lib/motion';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { space } from '@/theme';
import type { InputChain } from './input-chain';
import { SetRow } from './SetRow';
import { activationIssueKey, lastHint, loadTargetIndices, recommendationFor } from './train-summary';
import { createStyles } from './train-styles';
import { MenuButton, type MenuButtonAction } from '@/components/MenuButton';

export interface ExerciseCardProps {
  exercise: SessionExercise;
  exerciseIndex: number;
  collapsed: boolean;
  /** The two data fields the history and the engine read — passed as data,
   *  not as the whole hook result, so this card can be memoized. */
  recentSessions: readonly WorkoutSession[];
  catalog: readonly Exercise[];
  /** The template row this exercise was started from, if any. */
  templateRow: TemplateExercise | undefined;
  /** Best estimated-1RM on record, for the rows' "PR" badges. */
  best?: number;
  platesOpen: boolean;
  largeText: boolean;
  dispatch: TrainState['dispatch'];
  commitActive: TrainState['commitActive'];
  chain: InputChain;
  onToggle: (exerciseIndex: number) => void;
  onOpenMenu: (exerciseIndex: number) => void;
  /** The ⋯ rows as a native pull-down (S20). Only the open card gets them, so
   *  the memoised closed cards are not re-rendered by a new array each pass. */
  menuActions?: MenuButtonAction[];
  onOpenSetSheet: (exerciseIndex: number, setIndex: number) => void;
  onOpenLift: (exerciseIndex: number) => void;
  onSetDone: (exerciseIndex: number, setIndex: number, info: { pr: boolean; complete: boolean }) => void;
  /** Remove one set, with the session's Undo. */
  onRemoveSet: (exerciseIndex: number, setIndex: number) => void;
}

/**
 * One exercise of the live session: its head (name, progress, ⋯), the
 * engine's call, and the set table.
 *
 * Memoized with data-and-callback props (Train review item 29). Its sheets —
 * the set sheet, the ⋯ menu, lift settings — are the SESSION's, one each,
 * opened through the callbacks here (item 31); each card used to mount its
 * own three, and every set row its own set sheet.
 */
export const ExerciseCard = memo(function ExerciseCard({
  exercise: ex,
  exerciseIndex,
  collapsed,
  recentSessions,
  catalog,
  templateRow,
  best,
  platesOpen,
  largeText,
  dispatch,
  commitActive,
  chain,
  onToggle,
  onOpenMenu,
  menuActions,
  onOpenSetSheet,
  onOpenLift,
  onSetDone,
  onRemoveSet,
}: ExerciseCardProps) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const { colors } = useTheme();
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
  const setLabels = useMemo(() => setRowLabels(ex.sets), [ex.sets]);

  // Set progress drives the collapsed-row badge (a check when every set is
  // logged, else "done/total") so a long session stays scannable at a glance.
  const totalSets = ex.sets.length;
  const loggedCount = ex.sets.filter((s) => isLoggedSet(s, style)).length;
  const allDone = totalSets > 0 && loggedCount === totalSets;

  // "Last time" ghost + deterministic +load bump. The progression rule is
  // snapshotted from the source template onto the session exercise (ad-hoc
  // exercises carry none → ghost only, no bump). Memoized: it walks history,
  // and it ran on every keystroke in the session (Train review item 29).
  const history = useMemo(
    () => exerciseHistory(recentSessions, ex.exerciseId),
    [recentSessions, ex.exerciseId],
  );
  const sug = useMemo(
    () => suggestProgression(history, ex.progression, style),
    [history, ex.progression, style],
  );
  const ghost = lastHint(sug, style, t, unitSystem);
  const bumpTo = sug.bumped ? sug.suggestedWeight : undefined;
  // The progression engine's call. On a clustered lift it REPLACES the
  // double-progression bump and the blocked note below (it subsumes both: the
  // RIR band is its layer 1, the bump its layer 2). A straight-set lift gets
  // `action: 'none'` and keeps exactly what it had. `ex` is in the deps whole:
  // an ad-hoc lift's own sets decide whether it is clustered, and the memo
  // used to omit them and serve a stale call (Train review bug 11).
  const rec = useMemo(
    () => recommendationFor({ recentSessions, catalog }, ex.exerciseId, templateRow, ex),
    [recentSessions, catalog, ex, templateRow],
  );
  const engineHasCall = rec.action !== 'none';
  const catalogEx = catalog.find((e) => e.id === ex.exerciseId) ?? null;
  // Last session's sets, positionally — row 3 compares against row 3. This is
  // the PREVIOUS column every competitor puts on every row and this app had
  // only as one aggregate line at the card head.
  const prevSets = useMemo(() => previousSets(history), [history]);
  // When core withheld a recommendation because the last activation was
  // unreadable, SAY so. Silence and "no bump today" look identical otherwise,
  // and the second one is a claim about the training rather than about the data.
  const blockedNote = sug.blockedBy ? t(activationIssueKey(sug.blockedBy)) : null;

  // Plate + warm-up math keys off the first loaded set's weight, else the
  // snapshotted target load. Barbell-only (weight-reps).
  const keyWeight = ex.sets.find((s) => (s.weight ?? 0) > 0)?.weight ?? ex.targetLoad;
  const showPanel = style === 'weight-reps';
  // Solved in the DISPLAY unit with that unit's own bar and plates — a metric
  // gym's bar is 20 kg and its smallest plate is 1.25 kg, and converting a
  // pound solve afterwards yields 20.4 kg plates nobody owns. See
  // `load-units.ts` for why this module exists separately from body weight.
  const load =
    platesOpen && keyWeight && keyWeight > 0
      ? computePlateLoad(toDisplayLoad(keyWeight, unitSystem), barFor(unitSystem), platesFor(unitSystem))
      : null;
  // Same rule as the plate solve directly above: the ladder is BUILT from
  // plate loads, so running it in pounds and rendering the result next to a
  // kg working set produced `45 x 10` under `WORKING SET · 100 KG`.
  const warm =
    platesOpen && keyWeight && keyWeight > 0
      ? generateWarmup(toDisplayLoad(keyWeight, unitSystem), barFor(unitSystem), platesFor(unitSystem))
      : [];

  // The haptic a tick deserves, decided where the whole exercise is in view:
  // a record, the last set of the lift, or just a tick (Train review items
  // 25, 35). The row reports the set as it now stands.
  //
  // The sets are read through a ref, not closed over: with `ex.sets` in the
  // deps every keystroke made a new `onDone`, and every row of the open card
  // re-rendered with it (Train re-score, performance).
  const setsRef = useRef(ex.sets);
  useEffect(() => {
    setsRef.current = ex.sets;
  });
  const onDone = useCallback(
    (setIndex: number, done: WorkoutSet) => {
      const after = setsRef.current.map((s, i) => (i === setIndex ? done : s));
      onSetDone(exerciseIndex, setIndex, {
        pr: setBeatsBest(done, style, best),
        complete: after.length > 0 && after.every((s) => isLoggedSet(s, style)),
      });
    },
    [exerciseIndex, onSetDone, style, best],
  );

  const countA11y = t('train.setCountA11y', { done: loggedCount, total: totalSets });

  /**
   * One load for the whole lift — an accepted recommendation or the bump chip
   * — onto every set `loadTargetIndices` names. Each patch is deferred and the
   * lot committed ONCE: an immediate dispatch per set was N writes of the
   * whole session for one tap (Train re-score bug 9).
   */
  const applyLoad = (load: number) => {
    haptics.tap();
    const targets = loadTargetIndices(ex.sets);
    for (const setIndex of targets) {
      void dispatch({ type: 'patchSet', exerciseIndex, setIndex, patch: { weight: load } }, { defer: true });
    }
    if (targets.length > 0) void commitActive();
  };

  return (
    <Animated.View style={styles.exCard} layout={smoothLayout}>
      <View style={styles.exHeadRow}>
        <Touchable
          style={styles.exHead}
          onPress={() => onToggle(exerciseIndex)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={[ex.name, totalSets > 0 ? countA11y : null, collapsed ? ghost : null]
            .filter(Boolean)
            .join(', ')}
          testID={`exercise-head-${exerciseIndex}`}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.exName}>{ex.name}</Text>
            {/* Only while collapsed: an open card shows last session per ROW,
                and repeating an aggregate above it is two answers to one
                question. */}
            {collapsed && ghost ? <Text style={styles.ghost}>{ghost}</Text> : null}
          </View>
          {allDone ? (
            <View style={styles.exDone}>
              <Ionicons name="checkmark" size={15} color={colors.onInk} />
            </View>
          ) : totalSets > 0 ? (
            <View style={styles.exCount}>
              <Text style={styles.exCountText} maxFontSizeMultiplier={1.6}>{loggedCount}/{totalSets}</Text>
            </View>
          ) : null}
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={20} color={colors.faint} style={styles.exChevron} />
        </Touchable>
        {/* One overflow control in place of four permanent inline ones. Only on
            an open card: a collapsed row is a list item, not a form. */}
        {collapsed ? null : (
          <MenuButton
            style={[styles.exMoreBtn, styles.headerIconBtn]}
            title={ex.name}
            actions={menuActions ?? []}
            accessibilityLabel={t('train.exMenuA11y', { name: ex.name })}
            testID={`exercise-menu-${exerciseIndex}`}
            iconSize={20}
            iconColor={colors.muted}
            onFallbackPress={() => onOpenMenu(exerciseIndex)}
          />
        )}
      </View>

      {collapsed ? null : (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          {engineHasCall ? (
            <RecommendationNote
              rec={rec}
              testID={`recommendation-${exerciseIndex}`}
              onSettings={catalogEx ? () => onOpenLift(exerciseIndex) : undefined}
              // The accepted load lands on every working set that has no
              // weight yet, so a cluster's minis inherit it too.
              onAccept={applyLoad}
            />
          ) : bumpTo != null ? (
            <Touchable
              style={styles.bumpChip}
              hitSlop={{ top: 6, bottom: 6 }}
              // Every unweighted working set, as an accepted call does — it
              // filled only the first, and sets 2 and 3 were then ticked at
              // last week's load (Train re-score 3, bug 4).
              onPress={() => applyLoad(bumpTo)}
              accessibilityRole="button"
              testID={`bump-${exerciseIndex}`}
            >
              <Text style={styles.bumpText}>
                {t('train.bumpTo', { weight: formatLoad(bumpTo, unitSystem) })}
              </Text>
            </Touchable>
          ) : blockedNote ? (
            <View style={styles.blockedRow} testID={`progression-blocked-${exerciseIndex}`}>
              <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
              <Text style={styles.blockedText}>{blockedNote}</Text>
            </View>
          ) : null}

          {/* Row labels are derived from the whole sequence, not the index: a
              cluster takes one set number with lettered sub-sets (2a/2b/2c).
              Hidden from screen readers — every cell below names itself. */}
          <View style={styles.setHeadRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={[styles.setHeadCell, styles.setNumHead]} maxFontSizeMultiplier={1.6}>#</Text>
            {/* PREVIOUS. The single highest-leverage cell on the screen and the
                one this app did not have: it turns logging from a decision into
                a comparison — match it or beat it. At large text it is a line
                above each row instead of a column. */}
            {largeText ? null : (
              <Text style={[styles.setHeadCell, styles.setPrevCell, styles.setPrevText]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.6}>
                {t('train.prevShort')}
              </Text>
            )}
            {/* The column header IS the unit, so it stops being a fixed string. */}
            {style === 'weight-reps' ? (
              <Text style={[styles.setHeadCell, styles.setInputCell]} maxFontSizeMultiplier={1.6}>{loadUnit(unitSystem)}</Text>
            ) : null}
            <Text style={[styles.setHeadCell, styles.setInputCell]} maxFontSizeMultiplier={1.6}>
              {style === 'time' ? t('train.sec') : t('train.reps')}
            </Text>
            <Text style={[styles.setHeadCell, styles.setRirCell]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.6}>
              {t('train.rirShort')}
            </Text>
            <View style={styles.setDoneCell} />
          </View>

          {ex.sets.map((set, setIdx) => (
            <SetRow
              key={setIdx}
              exerciseIndex={exerciseIndex}
              setIndex={setIdx}
              set={set}
              logStyle={style}
              label={setLabels[setIdx]}
              // Positional: row 3 against row 3. Comparing against the nth
              // WORKING set instead would silently re-point the moment a
              // warm-up is added or dropped, and a comparison that moves is
              // worse than none.
              previous={previousCell(prevSets[setIdx], style, unitSystem)}
              previousSet={prevSets[setIdx]}
              isLastSet={setIdx === ex.sets.length - 1}
              best={best}
              largeText={largeText}
              dispatch={dispatch}
              commitActive={commitActive}
              onDone={onDone}
              onOpenSheet={onOpenSetSheet}
              onRemove={onRemoveSet}
              chain={chain}
            />
          ))}

          {/* The ONE action taken mid-set stays on the card. Everything else
              moved into the overflow menu — burying the most frequent action to
              tidy the rarest ones is the same mistake in the other direction. */}
          <Touchable
            style={[styles.addSetBtn, styles.textAction]}
            onPress={() => {
              haptics.tap();
              void dispatch({ type: 'addSet', exerciseIndex });
            }}
            accessibilityRole="button"
            testID={`add-set-${exerciseIndex}`}
          >
            <Ionicons name="add" size={18} color={colors.teal} />
            <Text style={styles.addSetText}>{t('train.addSet')}</Text>
          </Touchable>

          {showPanel && platesOpen ? (
            <View style={styles.panel} testID={`plates-panel-${exerciseIndex}`}>
              {keyWeight && keyWeight > 0 ? (
                <>
                  <Text style={styles.panelLabel}>{`${t('train.workingSet')} · ${formatLoad(keyWeight, unitSystem)}`}</Text>
                  <Text style={styles.plateText}>
                    {load && load.perSide.length
                      ? `${load.perSide.map((p) => `${formatDecimal(p.plate, locale)}×${p.count}`).join('   ')}  ${t('train.perSidePlates')}`
                      : t('train.barOnly')}
                  </Text>
                  {load && load.remainder > 0 ? (
                    <Text style={styles.panelHint}>{`+${formatDecimal(load.remainder, locale)} ${t('train.short')}`}</Text>
                  ) : null}
                  {warm.length ? (
                    <>
                      <Text style={[styles.panelLabel, { marginTop: space.sm }]}>{t('train.warmupLabel')}</Text>
                      {warm.map((w, i) => (
                        <Text key={i} style={styles.warmRow}>
                          {`${formatDecimal(w.weight, locale)} × ${w.reps}${w.pct != null ? `   ${Math.round(w.pct * 100)}%` : ''}`}
                        </Text>
                      ))}
                    </>
                  ) : null}
                </>
              ) : (
                <Text style={styles.panelHint}>{t('train.enterWeight')}</Text>
              )}
            </View>
          ) : null}
        </Animated.View>
      )}
    </Animated.View>
  );
});
