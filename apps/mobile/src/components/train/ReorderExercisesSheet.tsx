import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
import { exerciseIsFullyDone, moveBlockAware, supersetTags } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { isLoggedSet, type SessionExercise } from '@/lib/workout';
import { TARGET, space } from '@/theme';
import { Touchable } from './Touchable';
import { createStyles } from './train-styles';

/**
 * Drag the live session's exercises into a new order — the session ⋯ menu's
 * "Reorder exercises" (Train re-score, usability).
 *
 * Move up / Move down in each exercise's ⋯ was the only way, one step and two
 * taps per place; a lift that had to go from last to first in a nine-exercise
 * session was sixteen taps. This is the template editor's drag (same library,
 * same `customHandle` grip, same nested gesture root for the Android JS sheet —
 * see `TemplateEditorModal`), over one compact row per exercise: dragging the
 * live cards themselves would mean dragging a form with a keyboard up.
 *
 * Screen readers move a row with the rotor's Move up / Move down (a drag is a
 * touch gesture), the same two verbs the per-exercise menu keeps. Sighted
 * users who cannot drag — one finger, a tremor, a switch — get the same two
 * moves as visible arrow buttons at each row's end (J-N2, WCAG 2.5.7 / R24).
 * They are hidden from screen readers, which already have the actions on the
 * row, so a row is still one stop.
 */
/** A move arrow: a full target, not a glyph-sized one. */
const ARROW_BTN = { minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' } as const;

/** Large text: the name gets the row's whole width and the count and arrows
 *  drop to a line of their own — beside two 44pt arrows a name at AX sizes
 *  was cut to "Rom…" (S23-3 / F3, R12). It also wraps to two lines and stops
 *  growing at 2×, so a long name reads whole rather than mid-word. */
const LARGE_TEXT_SCALE = 1.5;
const NAME_FONT_CAP = 2;
const ROW_STACKED = { flexDirection: 'column', alignItems: 'stretch' } as const;
const ROW_LINE = { flexDirection: 'row', alignItems: 'center', gap: space.sm } as const;
const ROW_TAIL = { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm } as const;

// `memo`: mounted for a whole live session beside cards that re-render on
// every set edit; `ActiveSession` hands it only stable fields, so a closed
// sheet skips those renders.
export const ReorderExercisesSheet = memo(function ReorderExercisesSheet({
  visible,
  exercises,
  onMove,
  onClose,
}: {
  visible: boolean;
  exercises: readonly SessionExercise[];
  /** Move one exercise from `from` to `to` (core `moveExercise` semantics). */
  onMove: (from: number, to: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // Sortable's children are measured from themselves, so a row needs a pixel
  // width to fill the sheet (the template editor's finding) — the list's own,
  // measured, since the sheet is narrower than the window on an iPhone Duo's
  // inner display. The window figure stands in for the first frame.
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const largeText = fontScale >= LARGE_TEXT_SCALE;
  const [listWidth, setListWidth] = useState<number | null>(null);
  const rowWidth = listWidth ?? windowWidth - space.xl * 2;
  const tags = supersetTags(exercises);
  // Keys that survive a reorder: the exercise id, plus its occurrence, for a
  // lift that appears twice.
  const seen = new Map<string, number>();
  const keys = exercises.map((ex) => {
    const n = (seen.get(ex.exerciseId) ?? 0) + 1;
    seen.set(ex.exerciseId, n);
    return `${ex.exerciseId}#${n}`;
  });
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= exercises.length) return;
    haptics.tap();
    onMove(from, to);
  };

  return (
    <BottomSheet native detents={[0.6, 1]} visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <GestureHandlerRootView style={styles.ghRoot}>
        {/* A visible way out (v3 QA item 6): the grabber was the only one.
            Each move applies as it lands, so this is Done, not Save. */}
        <SheetHeader
          title={t('train.reorderExercises')}
          trailing={{ label: t('common.done'), onPress: onClose, testID: 'reorder-done' }}
        />
        <Animated.ScrollView nestedScrollEnabled ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xl }}>
          <Text style={styles.sheetHint}>{t('train.reorderHint')}</Text>
          <View style={{ marginTop: space.md }} onLayout={(e) => setListWidth(Math.floor(e.nativeEvent.layout.width))}>
            <Sortable.Flex
              customHandle
              scrollableRef={scrollRef}
              flexDirection="column"
              gap={0}
              onDragEnd={({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) => move(fromIndex, toIndex)}
            >
              {exercises.map((ex, i) => {
                const tag = tags[i];
                const style = ex.logStyle ?? 'weight-reps';
                const logged = ex.sets.filter((s) => isLoggedSet(s, style)).length;
                const done = exerciseIsFullyDone(ex);
                const canUp = moveBlockAware(exercises, i, -1).newIndex !== i;
                const canDown = moveBlockAware(exercises, i, 1).newIndex !== i;
                const arrow = (dir: 'up' | 'down', can: boolean) => (
                  <Touchable
                    style={[ARROW_BTN, !can && { opacity: 0.3 }]}
                    onPress={() => move(i, dir === 'up' ? i - 1 : i + 1)}
                    disabled={!can}
                    accessibilityLabel={`${t(dir === 'up' ? 'train.moveUp' : 'train.moveDown')}, ${ex.name}`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    testID={`reorder-${dir}-${i}`}
                  >
                    <Ionicons name={dir === 'up' ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
                  </Touchable>
                );
                const count = done ? (
                  <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
                ) : ex.sets.length > 0 ? (
                  <Text style={styles.histSub}>{`${logged}/${ex.sets.length}`}</Text>
                ) : null;
                const arrows = exercises.length > 1 ? (
                  <View style={{ flexDirection: 'row' }}>
                    {arrow('up', canUp)}
                    {arrow('down', canDown)}
                  </View>
                ) : null;
                const handle = (
                  <Sortable.Handle>
                    <View style={styles.tplDragHandle}>
                      <Ionicons name="reorder-two-outline" size={22} color={colors.faint} />
                    </View>
                  </Sortable.Handle>
                );
                const name = (
                  <View style={{ flex: 1 }}>
                    {tag ? <Text style={styles.supersetTag}>{t('train.superset.tag', { label: tag })}</Text> : null}
                    <Text style={styles.exName} numberOfLines={2} maxFontSizeMultiplier={NAME_FONT_CAP} testID={`reorder-name-${i}`}>{ex.name}</Text>
                  </View>
                );
                return (
                  <View
                    key={keys[i]}
                    style={[styles.tplExCard, styles.tplExTop, { width: rowWidth, alignItems: 'center' }, largeText && ROW_STACKED, tag ? styles.supersetRail : null]}
                    accessible
                    accessibilityLabel={`${tag ? `${t('train.superset.tag', { label: tag })}, ` : ''}${ex.name}, ${t('train.setCountA11y', { done: logged, total: ex.sets.length })}`}
                    accessibilityActions={[
                      // Only when it moves something: a superset moves as a block.
                      ...(canUp ? [{ name: 'moveUp', label: t('train.moveUp') }] : []),
                      ...(canDown ? [{ name: 'moveDown', label: t('train.moveDown') }] : []),
                    ]}
                    onAccessibilityAction={(e) => {
                      if (e.nativeEvent.actionName === 'moveUp') move(i, i - 1);
                      if (e.nativeEvent.actionName === 'moveDown') move(i, i + 1);
                    }}
                    testID={`reorder-row-${i}`}
                  >
                    {largeText ? (
                      <>
                        <View style={ROW_LINE}>
                          {handle}
                          {name}
                        </View>
                        <View style={ROW_TAIL} testID={`reorder-tail-${i}`}>
                          {count}
                          {arrows}
                        </View>
                      </>
                    ) : (
                      <>
                        {handle}
                        {name}
                        {count}
                        {arrows}
                      </>
                    )}
                  </View>
                );
              })}
            </Sortable.Flex>
          </View>
        </Animated.ScrollView>
      </GestureHandlerRootView>
    </BottomSheet>
  );
});
