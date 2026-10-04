import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  ActionSheetIOS,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeOut } from 'react-native-reanimated';
import { type DailyLog, type MealSlot, groupByMealSlot } from '@macrolog/core';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { enterUp, PressScale, springLayout } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatNumber, formatTime } from '@/lib/date-format';

const SLOT_KEY: Record<MealSlot, I18nKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
  other: 'meal.other',
};

function timeOf(d: Date, locale: Locale): string {
  return formatTime(d, locale);
}

/** `30 g protein · 40 g carbs`, not `P 30g · C 40g`: the single-letter codes
 *  are jargon a first-time user has to decode and a screen reader spells out
 *  as letters (S18-17). Localized, since "carbs" is not "carbos" is not
 *  "carbo". */
function macroLine(log: DailyLog, t: TFn): string {
  const parts: string[] = [];
  if (log.protein != null) parts.push(t('entry.proteinAmount', { n: log.protein }));
  if (log.carbs != null) parts.push(t('entry.carbsAmount', { n: log.carbs }));
  if (log.fat != null) parts.push(t('entry.fatAmount', { n: log.fat }));
  return parts.join(' · ');
}

/**
 * One diary row.
 *
 * ## Every gesture has a spoken twin
 *
 * Long-press (save as preset) and swipe (delete) are invisible to VoiceOver and
 * TalkBack, so until 2026-10-04 a screen-reader user could only ever open the
 * editor. `accessibilityActions` puts all three on the rotor / actions menu,
 * each present exactly when its gesture is — a "Save preset" on an unlabelled
 * row would be an action that silently does nothing (`savePresetFromLog`
 * returns early without a name).
 *
 * The label is set rather than left to the children because the children read
 * "Oatmeal, 8:00 AM · 30 g protein, 300" — a bare number with no unit, last.
 */
function EntryRow({
  log,
  onPress,
  onSavePreset,
  onDelete,
  onMenu,
}: {
  log: DailyLog;
  onPress: (log: DailyLog) => void;
  onSavePreset?: (log: DailyLog) => void;
  onDelete?: (log: DailyLog) => void;
  onMenu?: (log: DailyLog, remove: () => void) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const swipeRef = useRef<SwipeableMethods>(null);
  const label = log.mealLabel || t('today.entry');
  const kcal = formatNumber(log.calories, locale);
  const sub = [timeOf(log.date, locale), macroLine(log, t)].filter(Boolean).join('  ·  ');
  const canSavePreset = !!onSavePreset && !!log.mealLabel?.trim();
  const remove = () => {
    swipeRef.current?.close();
    onDelete?.(log);
  };

  const actions = [
    { name: 'activate', label: t('entry.editTitle') },
    ...(canSavePreset ? [{ name: 'savePreset', label: t('entry.savePresetShort') }] : []),
    ...(onDelete ? [{ name: 'delete', label: t('entry.delete') }] : []),
  ];
  function onAction(e: AccessibilityActionEvent) {
    switch (e.nativeEvent.actionName) {
      case 'activate':
        onPress(log);
        break;
      case 'savePreset':
        if (canSavePreset) onSavePreset?.(log);
        break;
      case 'delete':
        if (onDelete) remove();
        break;
    }
  }

  const row = (
    <PressScale
      scaleTo={0.98}
      style={styles.entry}
      onPress={() => onPress(log)}
      // Long-press opens the row's menu — the platform convention (an iOS
      // action sheet, a Material bottom menu) — rather than silently saving a
      // preset, which was a gesture nobody could discover or predict.
      onLongPress={
        canSavePreset || onDelete
          ? () => {
              haptics.tap();
              onMenu?.(log, remove);
            }
          : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={[t('today.entryA11y', { label, n: kcal }), sub, log.note]
        .filter(Boolean)
        .join(', ')}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      testID={`entry-${log.id}`}
    >
      <View style={styles.entryMain}>
        <Text style={styles.entryLabel}>{label}</Text>
        <Text style={styles.entryMacros}>{sub || '—'}</Text>
        {log.note ? (
          <Text style={styles.entryNote} numberOfLines={2} testID={`entry-note-${log.id}`}>
            {log.note}
          </Text>
        ) : null}
      </View>
      {/* The unit is visible now: a bare "300" at the end of a row is a number
          a first-time user has to infer the meaning of. */}
      <Text style={styles.entryKcal}>
        {kcal}
        <Text style={styles.entryUnit}> {t('today.kcal')}</Text>
      </Text>
    </PressScale>
  );

  if (!onDelete) return row;
  // Swipe-left to delete, the same gesture and the same reveal-then-tap rule
  // as a Train set row (see `train.tsx`): the swipe REVEALS, the tap deletes,
  // so a sideways scroll can never remove a meal on its own. Today's delete is
  // fire-then-Undo, so even the tap is one tap from reversed.
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <TouchableOpacity
          style={styles.swipeDelete}
          onPress={() => {
            haptics.tap();
            remove();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('entry.delete')}
          testID={`entry-swipe-delete-${log.id}`}
        >
          {/* White, not `onInk`: on the danger fill `onInk` goes dark in the
              dark theme. ConfirmSheet's destructive button does the same. */}
          <Ionicons name="trash-outline" size={20} color="#ffffff" />
        </TouchableOpacity>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

/**
 * The day's food entries, grouped into meal slots (breakfast → lunch → dinner
 * → snack → other) with per-slot calorie subtotals and a per-entry log time.
 * When every entry is untagged (single `other` group) the slot header is
 * suppressed so it reads as a plain list. Tapping a row calls `onPress`.
 */
export function MealEntries({
  logs,
  onPress,
  onSavePreset,
  onDelete,
}: {
  logs: DailyLog[];
  onPress: (log: DailyLog) => void;
  /**
   * Long-press a logged row to promote it to a quick-add preset.
   *
   * The loop this closes: a food logged four times in a week never became a
   * preset, because "Save as preset" existed only inside the custom-food form —
   * so the widget button and the Quick Settings tile, which both draw from the
   * preset list, stayed empty for exactly the foods the user repeats. The diary
   * is where you notice the repetition, so it should be where you can act on it.
   *
   * Reached through the row's long-press menu (Edit · Save preset · Delete)
   * and its screen-reader action. Optional: read-only surfaces (history) omit
   * it, and a row with nothing but Edit gets no long-press at all.
   */
  onSavePreset?: (log: DailyLog) => void;
  /** Delete a row from the list itself (swipe, or the screen-reader action).
   *  Optional for the same reason as `onSavePreset`; the caller owns the Undo. */
  onDelete?: (log: DailyLog) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { scheme, colors } = useTheme();
  const groups = groupByMealSlot(logs);
  // Android's menu target; iOS presents the system action sheet directly.
  const [menu, setMenu] = useState<{ log: DailyLog; remove: () => void } | null>(null);

  function openMenu(log: DailyLog, remove: () => void) {
    if (Platform.OS !== 'ios') {
      setMenu({ log, remove });
      return;
    }
    const items = menuItems(log, remove);
    const destructive = items.findIndex((i) => i.danger);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: log.mealLabel || t('today.entry'),
        options: [...items.map((i) => i.label), t('common.cancel')],
        cancelButtonIndex: items.length,
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
        userInterfaceStyle: scheme,
      },
      (i) => items[i]?.run(),
    );
  }

  /** Edit always; Save preset for a named row; Delete where the screen allows. */
  function menuItems(log: DailyLog, remove: () => void) {
    const items: { key: string; label: string; icon: 'create-outline' | 'flash-outline' | 'trash-outline'; run: () => void; danger?: boolean }[] = [
      { key: 'edit', label: t('entry.editTitle'), icon: 'create-outline', run: () => onPress(log) },
    ];
    if (onSavePreset && log.mealLabel?.trim()) {
      items.push({ key: 'preset', label: t('entry.savePresetShort'), icon: 'flash-outline', run: () => onSavePreset(log) });
    }
    if (onDelete) items.push({ key: 'delete', label: t('entry.delete'), icon: 'trash-outline', run: remove, danger: true });
    return items;
  }
  const showHeaders = groups.length > 1 || (groups[0]?.slot !== 'other');

  // Rows fade+rise in with a stagger (index counted across groups so the
  // whole list reads as one cascade), spring into place when a sibling is
  // added/removed, and fade out on delete.
  let row = 0;
  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.slot} style={styles.group}>
          {showHeaders ? (
            <View style={styles.slotHead}>
              <Text style={styles.slotLabel}>{t(SLOT_KEY[g.slot])}</Text>
              <Text style={styles.slotTotal}>{formatNumber(g.totalCalories, locale)} {t('today.kcal')}</Text>
            </View>
          ) : null}
          {g.entries.map((log) => (
            <Animated.View key={log.id} entering={enterUp(row++)} exiting={FadeOut} layout={springLayout}>
              <EntryRow
                log={log}
                onPress={onPress}
                onSavePreset={onSavePreset}
                onDelete={onDelete}
                onMenu={openMenu}
              />
            </Animated.View>
          ))}
        </View>
      ))}
      {Platform.OS !== 'ios' ? (
        // `overlays={false}`: the menu closes in the same tap that runs its
        // item, so anything it raised (a toast, a confirm) must go to the
        // screen's hosts, not to this sheet's, which unmount with it.
        <BottomSheet visible={menu != null} onClose={() => setMenu(null)} overlays={false}>
          {menu ? (
            <View style={styles.menu}>
              <Text style={styles.menuTitle} accessibilityRole="header" numberOfLines={1}>
                {menu.log.mealLabel || t('today.entry')}
              </Text>
              {menuItems(menu.log, menu.remove).map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={styles.menuItem}
                  onPress={() => {
                    setMenu(null);
                    item.run();
                  }}
                  accessibilityRole="button"
                  testID={`entry-menu-${item.key}`}
                >
                  <Ionicons name={item.icon} size={20} color={item.danger ? colors.danger : colors.ink} />
                  <Text style={item.danger ? styles.menuDanger : styles.menuText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </BottomSheet>
      ) : null}
    </View>
  );
}

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  wrap: { gap: space.md },
  group: { gap: space.sm },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  slotLabel: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'capitalize' },
  slotTotal: { fontSize: font.small, color: colors.faint, fontWeight: '600' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...shadow.e1,
  },
  entryMain: { flex: 1, gap: 2 },
  entryLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  entryMacros: { fontSize: font.small, color: colors.muted },
  entryNote: { fontSize: font.small, color: colors.faint, fontStyle: 'italic' },
  entryKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink, marginLeft: space.md },
  entryUnit: { fontSize: font.small, fontWeight: '500', color: colors.muted },
  menu: { gap: space.xs, paddingBottom: space.sm },
  menuTitle: { fontSize: font.h3, fontWeight: '800', color: colors.ink, marginBottom: space.xs },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.xs },
  menuText: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  menuDanger: { fontSize: font.body, fontWeight: '600', color: colors.danger },
  // Swipe-left reveal behind a row — Train's `swipeDelete`, at this row's radius.
  swipeDelete: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
});
