import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
import { exerciseIsFullyDone } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { isLoggedSet, type SessionExercise } from '@/lib/workout';
import { space } from '@/theme';
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
 * touch gesture), the same two verbs the per-exercise menu keeps.
 */
export function ReorderExercisesSheet({
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
  // width to fill the sheet (the template editor's finding).
  const { width: windowWidth } = useWindowDimensions();
  const rowWidth = windowWidth - space.xl * 2;
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
        <Animated.ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xl }}>
          <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.reorderExercises')}</Text>
          <Text style={styles.sheetHint}>{t('train.reorderHint')}</Text>
          <View style={{ marginTop: space.md }}>
            <Sortable.Flex
              customHandle
              scrollableRef={scrollRef}
              flexDirection="column"
              gap={0}
              onDragEnd={({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) => move(fromIndex, toIndex)}
            >
              {exercises.map((ex, i) => {
                const style = ex.logStyle ?? 'weight-reps';
                const logged = ex.sets.filter((s) => isLoggedSet(s, style)).length;
                const done = exerciseIsFullyDone(ex);
                return (
                  <View
                    key={keys[i]}
                    style={[styles.tplExCard, styles.tplExTop, { width: rowWidth, alignItems: 'center' }]}
                    accessible
                    accessibilityLabel={`${ex.name}, ${t('train.setCountA11y', { done: logged, total: ex.sets.length })}`}
                    accessibilityActions={[
                      ...(i > 0 ? [{ name: 'moveUp', label: t('train.moveUp') }] : []),
                      ...(i < exercises.length - 1 ? [{ name: 'moveDown', label: t('train.moveDown') }] : []),
                    ]}
                    onAccessibilityAction={(e) => {
                      if (e.nativeEvent.actionName === 'moveUp') move(i, i - 1);
                      if (e.nativeEvent.actionName === 'moveDown') move(i, i + 1);
                    }}
                    testID={`reorder-row-${i}`}
                  >
                    <Sortable.Handle>
                      <View style={styles.tplDragHandle}>
                        <Ionicons name="reorder-two-outline" size={22} color={colors.faint} />
                      </View>
                    </Sortable.Handle>
                    <Text style={[styles.exName, { flex: 1 }]} numberOfLines={1}>{ex.name}</Text>
                    {done ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
                    ) : ex.sets.length > 0 ? (
                      <Text style={styles.histSub}>{`${logged}/${ex.sets.length}`}</Text>
                    ) : null}
                  </View>
                );
              })}
            </Sortable.Flex>
          </View>
        </Animated.ScrollView>
      </GestureHandlerRootView>
    </BottomSheet>
  );
}
