import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  ActionSheetIOS,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { CONTEXT_MENUS, ContextMenu } from '@/components/ContextMenu';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeOut,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { type DailyLog, type MealGroup, type MealSlot, type MealType, groupByMealSlot } from '@macrolog/core';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import { capitalizeFirst } from '@/i18n/grammar';
import * as haptics from '@/lib/haptics';
import { enterUp, PressScale, springLayout } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatNumber, formatTime } from '@/lib/date-format';

/** Text scale from which a row puts its kcal under the label (review A1): at
 *  1.35× "Grilled chicken with rice" and "1,050 kcal" no longer share a line
 *  at 360dp, and the label was what got squeezed to a column of fragments. */
const STACK_AT_FONT_SCALE = 1.35;
/** Rows past this index enter together — a 20-row day staggered at 40 ms each
 *  finished its cascade most of a second after the screen was usable (V6). */
const MAX_STAGGER = 6;
/** The swipe action's resting width (the reveal), and the drag past which a
 *  release COMMITS instead of revealing — the Mail/Reminders full swipe. */
const SWIPE_ACTION_W = 96;
const FULL_SWIPE = 168;
/** The four slots a diary always shows when it can add to them (U3). `other`
 *  appears only when a row is filed there — it is where untagged rows land,
 *  not a meal anyone sets out to log. */
const ADD_SLOTS: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** Lifts the 32dp "+ Add" pill to a 48dp target; vertical only, its row has
 *  the slot name beside it. */
const SLOT_ADD_SLOP = { top: 8, bottom: 8 } as const;
/**
 * How long a context-menu action that PRESENTS something (the editor, the
 * meal picker) waits for the menu to finish closing. `onSelected` fires while
 * UIKit is still dismissing the menu, and presenting a sheet into that
 * transition can be dropped; the preview's own tap already waits for
 * `onPreviewTappedAnimationCompleted` (Today re-score, bug 7). An action that
 * only writes (save preset, delete) runs at once.
 */
export const MENU_DISMISS_MS = 300;
/** Text scale the context-menu preview grows to, and the cap on its text: the
 *  preview's size is fixed up front (UIKit asks before it renders), so the
 *  text must not outgrow the box it was given (Today re-score, bug 6). */
const PREVIEW_MAX_SCALE = 1.3;

/** The meals a row can be moved to: the four slots, minus the one it is in.
 *  Exported for test. */
export function moveTargets(log: Pick<DailyLog, 'mealType'>): MealType[] {
  return ADD_SLOTS.filter((s) => s !== log.mealType);
}

/**
 * The cascade index each group's first row starts at — computed BEFORE the
 * render's map rather than with a `row++` inside it. The counter mutated a
 * variable captured by the map's callback, which the React Compiler cannot
 * model, so it skipped this component entirely (review #1). Exported for test.
 */
export function groupStartIndexes(groups: readonly Pick<MealGroup, 'entries'>[]): number[] {
  const starts: number[] = [];
  let next = 0;
  for (const g of groups) {
    starts.push(next);
    next += g.entries.length;
  }
  return starts;
}

/**
 * The slot groups the list draws. Without an add affordance it is exactly
 * `groupByMealSlot` (only slots with rows). With one, the four meal slots are
 * always present — an empty Lunch is a row with a "+ Add", which is the empty
 * state now (U3) — and `other` joins when it has rows. Exported for test.
 */
export function diarySlots(logs: DailyLog[], withEmpty: boolean): MealGroup[] {
  const groups = groupByMealSlot(logs);
  if (!withEmpty) return groups;
  const bySlot = new Map(groups.map((g) => [g.slot, g]));
  const out: MealGroup[] = ADD_SLOTS.map((slot) => bySlot.get(slot) ?? { slot, entries: [], totalCalories: 0 });
  const other = bySlot.get('other');
  if (other) out.push(other);
  return out;
}

const SLOT_KEY: Record<MealSlot, I18nKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
  other: 'meal.other',
};

type MenuIcon = 'create-outline' | 'flash-outline' | 'swap-vertical-outline' | 'copy-outline' | 'trash-outline';

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
  onPickSlot,
  moveOptions,
  onCopyToToday,
}: {
  log: DailyLog;
  onPress: (log: DailyLog) => void;
  onSavePreset?: (log: DailyLog) => void;
  onDelete?: (log: DailyLog) => void;
  onMenu?: (log: DailyLog, remove: () => void) => void;
  /** Ask which meal to move the row to (absent: the row cannot move). */
  onPickSlot?: (log: DailyLog, remove: () => void) => void;
  /** The meals this row can move to, as one-tap choices — iOS shows them as a
   *  submenu inside the row's context menu (round-3 review). */
  moveOptions?: { slot: MealType; title: string; run: () => void }[];
  onCopyToToday?: (log: DailyLog) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_AT_FONT_SCALE;
  const swipeRef = useRef<SwipeableMethods>(null);
  // Which side's full swipe is armed. Written from the UI thread through
  // `scheduleOnRN` as the drag crosses `FULL_SWIPE`, read on release — never
  // during render.
  const armed = useRef<'delete' | 'preset' | null>(null);
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
    ...(onPickSlot ? [{ name: 'move', label: t('entry.moveTo') }] : []),
    ...(onCopyToToday ? [{ name: 'copyToday', label: t('entry.copyToToday') }] : []),
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
      case 'move':
        onPickSlot?.(log, remove);
        break;
      case 'copyToday':
        onCopyToToday?.(log);
        break;
      case 'delete':
        if (onDelete) remove();
        break;
    }
  }

  // iOS: the system context menu (`UIContextMenuInteraction`) with a preview
  // card, the gesture Reminders, Mail and Health use on a row. Tapping the
  // preview opens the editor. Elsewhere: the long-press menu below.
  const contextMenu = CONTEXT_MENUS;

  const a11y = {
    accessibilityLabel: [t('today.entryA11y', { label, n: kcal }), sub, log.note].filter(Boolean).join(', '),
    accessibilityActions: actions,
    onAccessibilityAction: onAction,
  };

  const row = (
    <PressScale
      scaleTo={0.98}
      style={[styles.entry, stacked && styles.entryStacked]}
      onPress={() => onPress(log)}
      // Long-press opens the row's menu — the platform convention (an iOS
      // action sheet, a Material bottom menu) — rather than silently saving a
      // preset, which was a gesture nobody could discover or predict.
      onLongPress={
        !contextMenu && (canSavePreset || onDelete || onPickSlot || onCopyToToday)
          ? () => {
              haptics.tap();
              onMenu?.(log, remove);
            }
          : undefined
      }
      accessibilityRole="button"
      {...a11y}
      testID={`entry-${log.id}`}
    >
      <View style={[styles.entryMain, stacked && styles.entryMainStacked]}>
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
      <Text style={[styles.entryKcal, stacked && styles.entryKcalStacked]}>
        {kcal}
        <Text style={styles.entryUnit}> {t('today.kcal')}</Text>
      </Text>
    </PressScale>
  );

  // The two actions that present something wait out the menu's dismissal
  // (`MENU_DISMISS_MS`); the rest only write, and run at once.
  const afterMenu = (run: () => void) => () => {
    setTimeout(run, MENU_DISMISS_MS);
  };
  const body = contextMenu ? (
    <ContextMenu
      title={label}
      preview={<EntryPreview log={log} />}
      previewSize={{ width: PREVIEW_WIDTH, height: previewHeight(log, fontScale) }}
      onPreviewPress={() => onPress(log)}
      actions={[
        { key: 'edit', title: t('entry.editTitle'), icon: 'pencil', onPress: afterMenu(() => onPress(log)) },
        ...(canSavePreset
          ? [{ key: 'preset', title: t('entry.savePresetShort'), icon: 'bolt', onPress: () => onSavePreset?.(log) }]
          : []),
        ...(moveOptions?.length
          ? [{
              key: 'move',
              title: t('entry.moveTo'),
              icon: 'arrow.up.arrow.down',
              children: moveOptions.map((m) => ({ key: m.slot, title: m.title, onPress: m.run })),
            }]
          : []),
        ...(onCopyToToday
          ? [{ key: 'copy', title: t('entry.copyToToday'), icon: 'doc.on.doc', onPress: () => onCopyToToday(log) }]
          : []),
        ...(onDelete ? [{ key: 'delete', title: t('entry.delete'), icon: 'trash', destructive: true, onPress: remove }] : []),
      ]}
    >
      {row}
    </ContextMenu>
  ) : (
    row
  );

  if (!onDelete && !canSavePreset) return body;
  const savePreset = () => {
    swipeRef.current?.close();
    onSavePreset?.(log);
  };
  // Swipe left to delete, swipe right to save to Quick add — the Mail /
  // Reminders pair (review P9). A SHORT swipe reveals the action and a tap
  // runs it, so a sideways scroll still cannot remove a meal on its own. A
  // LONG swipe (past `FULL_SWIPE`, with a selection tick as it arms) runs it
  // on release, because Today's delete is fire-then-Undo: the full swipe is
  // one gesture from done and one tap from reversed. The action is labelled
  // in words, not just an icon — a trash can alone was the only cue.
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1}
      rightThreshold={40}
      leftThreshold={40}
      overshootRight={!!onDelete}
      overshootLeft={canSavePreset}
      onSwipeableWillOpen={() => {
        const run = armed.current;
        armed.current = null;
        if (run === 'delete') remove();
        else if (run === 'preset') savePreset();
      }}
      renderRightActions={
        onDelete
          ? (_progress, translation) => (
              <SwipeAction
                side="right"
                translation={translation}
                label={t('entry.delete')}
                icon="trash-outline"
                color={colors.danger}
                onArm={(on) => {
                  armed.current = on ? 'delete' : null;
                  if (on) haptics.selection();
                }}
                onPress={remove}
                testID={`entry-swipe-delete-${log.id}`}
              />
            )
          : undefined
      }
      renderLeftActions={
        canSavePreset
          ? (_progress, translation) => (
              <SwipeAction
                side="left"
                translation={translation}
                label={t('entry.swipeQuickAdd')}
                a11yLabel={t('entry.saveQuickAddA11y')}
                icon="flash-outline"
                color={colors.tealSolid}
                onArm={(on) => {
                  armed.current = on ? 'preset' : null;
                  if (on) haptics.selection();
                }}
                onPress={savePreset}
                testID={`entry-swipe-preset-${log.id}`}
              />
            )
          : undefined
      }
    >
      {body}
    </ReanimatedSwipeable>
  );
}

/**
 * One side's swipe action. It widens with the drag so the colour always fills
 * what the row has uncovered, and reports — once per crossing, from the UI
 * thread — whether the drag is past the full-swipe point.
 *
 * Its resting width is what the swipeable measures as the open position (it
 * measures at the START of a drag, when the translation is at rest), so the
 * widening never moves where a short swipe settles.
 */
function SwipeAction({
  side,
  translation,
  label,
  a11yLabel,
  icon,
  color,
  onArm,
  onPress,
  testID,
}: {
  side: 'left' | 'right';
  translation: SharedValue<number>;
  label: string;
  a11yLabel?: string;
  icon: 'trash-outline' | 'flash-outline';
  color: string;
  onArm: (armed: boolean) => void;
  onPress: () => void;
  testID: string;
}) {
  const styles = useThemedStyles(createStyles);
  const sign = side === 'right' ? -1 : 1;
  useAnimatedReaction(
    () => translation.value * sign > FULL_SWIPE,
    (past, prev) => {
      if (prev !== null && past !== prev) scheduleOnRN(onArm, past);
    },
  );
  const fill = useAnimatedStyle(() => ({
    width: Math.max(SWIPE_ACTION_W, translation.value * sign),
  }));
  return (
    <Animated.View
      style={[styles.swipeAction, { backgroundColor: color }, side === 'right' ? styles.swipeRight : styles.swipeLeft, fill]}
    >
      <TouchableOpacity
        style={styles.swipeActionBtn}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel ?? label}
        testID={testID}
      >
        {/* White, not `onInk`: on the danger and teal fills `onInk` goes dark
            in the dark theme. ConfirmSheet's destructive button does the same. */}
        <Ionicons name={icon} size={20} color="#ffffff" />
        <Text style={styles.swipeActionText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const PREVIEW_WIDTH = 320;
/**
 * The preview's height, sized for the text it will draw: 176pt (+44 for a
 * note) at 1×, grown with the text scale up to `PREVIEW_MAX_SCALE` — the same
 * cap the preview's text carries, so the two cannot disagree. It was fixed,
 * and at a large Dynamic Type the h1 calories and the macro row clipped off
 * the bottom of the card. Exported for test.
 */
export function previewHeight(log: Pick<DailyLog, 'note'>, fontScale = 1): number {
  const scale = Math.min(Math.max(fontScale, 1), PREVIEW_MAX_SCALE);
  return Math.round((176 + (log.note ? 44 : 0)) * scale);
}

/**
 * The context-menu preview: the row, opened up — the full name, the calories
 * large, every macro as its own figure, the time and the note. It is what the
 * user would see in the editor, without opening it.
 */
function EntryPreview({ log }: { log: DailyLog }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const macros: { key: string; label: string; value: number | undefined | null }[] = [
    { key: 'p', label: t('history.protein'), value: log.protein },
    { key: 'c', label: t('today.carbs'), value: log.carbs },
    { key: 'f', label: t('today.fat'), value: log.fat },
  ];
  return (
    <View style={styles.preview}>
      <Text style={styles.previewTime} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>{timeOf(log.date, locale)}</Text>
      <Text style={styles.previewLabel} numberOfLines={2} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
        {log.mealLabel || t('today.entry')}
      </Text>
      <Text style={styles.previewKcal} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
        {formatNumber(log.calories, locale)}
        <Text style={styles.previewUnit}> {t('today.kcal')}</Text>
      </Text>
      <View style={styles.previewMacros}>
        {macros.map((m) => (
          <View key={m.key} style={styles.previewMacro}>
            {/* The localized gram figure, like every other one in the app —
                a literal "g" here was the one hardcoded unit left. */}
            <Text style={styles.previewMacroValue} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
              {m.value != null ? t('unit.grams', { n: formatNumber(m.value, locale) }) : '—'}
            </Text>
            <Text style={styles.previewMacroLabel} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>{m.label}</Text>
          </View>
        ))}
      </View>
      {log.note ? (
        <Text style={styles.previewNote} numberOfLines={2} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
          {log.note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The day's food entries, grouped into meal slots (breakfast → lunch → dinner
 * → snack → other) with per-slot calorie subtotals and a per-entry log time.
 * When every entry is untagged (single `other` group) the slot header is
 * suppressed so it reads as a plain list. Tapping a row calls `onPress`.
 *
 * With `onAddToSlot` it is a DIARY (UX_AUDIT Today review U3): the four meal
 * headers are always there, each with its own "+ Add" that opens the sheet
 * with that meal already chosen. An empty day is four headers waiting to be
 * filled — the structure is the empty state, where it used to be a hint
 * pointing at a button somewhere else.
 */
export function MealEntries({
  logs,
  onPress,
  onSavePreset,
  onDelete,
  onAddToSlot,
  onMove,
  onCopyToToday,
}: {
  logs: DailyLog[];
  onPress: (log: DailyLog) => void;
  /** Start an add in this meal slot — turns on the always-present headers. */
  onAddToSlot?: (slot: MealType) => void;
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
  /**
   * Move a row to another meal of the same day — "Move to…" in the row's menu
   * and its screen-reader action, then a pick of the meal (Today re-score,
   * Usability: MyFitnessPal, Cronometer and MacroFactor all have it). The
   * caller writes it and owns the Undo.
   */
  onMove?: (log: DailyLog, slot: MealType) => void;
  /** Log this row again now — "Copy to today", offered on past days only. */
  onCopyToToday?: (log: DailyLog) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { scheme, colors } = useTheme();
  const groups = diarySlots(logs, !!onAddToSlot);
  const starts = groupStartIndexes(groups);
  // Android's menu target; iOS presents the system action sheet directly.
  // `picking`: the same sheet, showing the meals a "Move to…" can go to.
  const [menu, setMenu] = useState<{ log: DailyLog; remove: () => void; picking?: boolean } | null>(null);

  /** "Move to…": which meal. iOS asks with the system action sheet (the
   *  context menu has closed by now — see `MENU_DISMISS_MS`); Android turns
   *  its row menu into the list of meals. */
  function pickSlot(log: DailyLog, remove: () => void) {
    if (!onMove) return;
    const targets = moveTargets(log);
    if (Platform.OS !== 'ios') {
      setMenu({ log, remove, picking: true });
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t('entry.moveToTitle'),
        options: [...targets.map((s) => capitalizeFirst(t(SLOT_KEY[s]), locale)), t('common.cancel')],
        cancelButtonIndex: targets.length,
        userInterfaceStyle: scheme,
      },
      (i) => {
        const slot = targets[i];
        if (slot) onMove(log, slot);
      },
    );
  }

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

  /** Edit always; Save preset for a named row; Move and Copy where the screen
   *  offers them; Delete where the screen allows. */
  function menuItems(log: DailyLog, remove: () => void) {
    const items: { key: string; label: string; icon: MenuIcon; run: () => void; danger?: boolean }[] = [
      { key: 'edit', label: t('entry.editTitle'), icon: 'create-outline', run: () => onPress(log) },
    ];
    if (onSavePreset && log.mealLabel?.trim()) {
      items.push({ key: 'preset', label: t('entry.savePresetShort'), icon: 'flash-outline', run: () => onSavePreset(log) });
    }
    if (onMove) items.push({ key: 'move', label: t('entry.moveTo'), icon: 'swap-vertical-outline', run: () => pickSlot(log, remove) });
    if (onCopyToToday) items.push({ key: 'copy', label: t('entry.copyToToday'), icon: 'copy-outline', run: () => onCopyToToday(log) });
    if (onDelete) items.push({ key: 'delete', label: t('entry.delete'), icon: 'trash-outline', run: remove, danger: true });
    return items;
  }
  const showHeaders = !!onAddToSlot || groups.length > 1 || (groups[0]?.slot !== 'other');

  // Rows fade+rise in with a stagger (index counted across groups so the
  // whole list reads as one cascade, capped at MAX_STAGGER), spring into
  // place when a sibling is added/removed, and fade out on delete.
  return (
    <View style={styles.wrap}>
      {groups.map((g, gi) => {
        // Sentence case in every locale — `textTransform: 'capitalize'` made
        // pt-BR's "café da manhã" read "Café Da Manhã" (review #3).
        const slotName = capitalizeFirst(t(SLOT_KEY[g.slot]), locale);
        const total = `${formatNumber(g.totalCalories, locale)} ${t('today.kcal')}`;
        const addable = !!onAddToSlot && g.slot !== 'other';
        return (
        <View key={g.slot} style={styles.group}>
          {showHeaders ? (
            <View style={styles.slotHead}>
              {/* One heading node, "Breakfast, 450 kcal" — two text nodes made
                  a rotor stop on the name and a second, unlabelled stop on a
                  bare number (review A3). An empty slot says so instead of
                  "0 kcal". */}
              <View
                style={styles.slotTitle}
                accessible
                accessibilityRole="header"
                accessibilityLabel={g.entries.length ? `${slotName}, ${total}` : `${slotName}, ${t('today.slotEmpty')}`}
              >
                <Text style={styles.slotLabel}>{slotName}</Text>
                {g.entries.length ? <Text style={styles.slotTotal}>{total}</Text> : null}
              </View>
              {addable ? (
                <PressScale
                  scaleTo={0.92}
                  style={styles.slotAdd}
                  hitSlop={SLOT_ADD_SLOP}
                  onPress={() => {
                    haptics.tap();
                    onAddToSlot?.(g.slot as MealType);
                  }}
                  accessibilityRole="button"
                  // The slot's own word, lower-case, inside the phrase — then
                  // sentence-cased as a whole ("Add to lunch", "Cena: añadir").
                  accessibilityLabel={capitalizeFirst(t('today.addToSlotA11y', { slot: t(SLOT_KEY[g.slot]) }), locale)}
                  testID={`slot-add-${g.slot}`}
                >
                  <Ionicons name="add" size={16} color={colors.accent} />
                  <Text style={styles.slotAddText} maxFontSizeMultiplier={1.3}>
                    {t('today.addToSlot')}
                  </Text>
                </PressScale>
              ) : null}
            </View>
          ) : null}
          {g.entries.map((log, i) => (
            <Animated.View
              key={log.id}
              entering={enterUp(Math.min(starts[gi] + i, MAX_STAGGER))}
              exiting={FadeOut}
              layout={springLayout}
            >
              <EntryRow
                log={log}
                onPress={onPress}
                onSavePreset={onSavePreset}
                onDelete={onDelete}
                onMenu={openMenu}
                onPickSlot={onMove ? pickSlot : undefined}
                moveOptions={
                  onMove
                    ? moveTargets(log).map((slot) => ({
                        slot,
                        title: capitalizeFirst(t(SLOT_KEY[slot]), locale),
                        run: () => onMove(log, slot),
                      }))
                    : undefined
                }
                onCopyToToday={onCopyToToday}
              />
            </Animated.View>
          ))}
        </View>
        );
      })}
      {Platform.OS !== 'ios' ? (
        // `overlays={false}`: the menu closes in the same tap that runs its
        // item, so anything it raised (a toast, a confirm) must go to the
        // screen's hosts, not to this sheet's, which unmount with it.
        <BottomSheet visible={menu != null} onClose={() => setMenu(null)} overlays={false}>
          {menu?.picking ? (
            <View style={styles.menu}>
              <Text style={styles.menuTitle} accessibilityRole="header" numberOfLines={1}>
                {t('entry.moveToTitle')}
              </Text>
              {moveTargets(menu.log).map((slot) => (
                <TouchableOpacity
                  key={slot}
                  style={styles.menuItem}
                  onPress={() => {
                    setMenu(null);
                    onMove?.(menu.log, slot);
                  }}
                  accessibilityRole="button"
                  testID={`entry-move-${slot}`}
                >
                  <Ionicons name="restaurant-outline" size={20} color={colors.ink} />
                  <Text style={styles.menuText}>{capitalizeFirst(t(SLOT_KEY[slot]), locale)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : menu ? (
            <View style={styles.menu}>
              <Text style={styles.menuTitle} accessibilityRole="header" numberOfLines={1}>
                {menu.log.mealLabel || t('today.entry')}
              </Text>
              {menuItems(menu.log, menu.remove).map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={styles.menuItem}
                  onPress={() => {
                    // "Move to…" keeps the sheet up and turns it into the
                    // list of meals; everything else closes it.
                    if (item.key !== 'move') setMenu(null);
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
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingHorizontal: space.xs, minHeight: 32 },
  // Name and subtotal read as one line that may wrap at large text; the add
  // pill keeps its size beside it.
  slotTitle: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm },
  slotLabel: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  slotTotal: { fontSize: font.small, color: colors.faint, fontWeight: '600' },
  slotAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  slotAddText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
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
  // Large text: label block over the kcal, both full width (STACK_AT_FONT_SCALE).
  entryStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xs },
  entryMain: { flex: 1, gap: 2 },
  entryMainStacked: { flex: 0, alignSelf: 'stretch' },
  entryLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  entryMacros: { fontSize: font.small, color: colors.muted },
  entryNote: { fontSize: font.small, color: colors.faint, fontStyle: 'italic' },
  entryKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink, marginLeft: space.md },
  entryKcalStacked: { marginLeft: 0 },
  entryUnit: { fontSize: font.small, fontWeight: '500', color: colors.muted },
  preview: { flex: 1, backgroundColor: colors.paper, padding: space.xl, gap: space.xs },
  previewTime: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  previewLabel: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  previewKcal: { fontSize: font.h1, fontWeight: '800', color: colors.ink, marginTop: space.xs },
  previewUnit: { fontSize: font.body, fontWeight: '600', color: colors.muted },
  previewMacros: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  previewMacro: { gap: 2 },
  previewMacroValue: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  previewMacroLabel: { fontSize: font.small, color: colors.muted },
  previewNote: { fontSize: font.small, color: colors.faint, fontStyle: 'italic', marginTop: space.sm },
  menu: { gap: space.xs, paddingBottom: space.sm },
  menuTitle: { fontSize: font.h3, fontWeight: '800', color: colors.ink, marginBottom: space.xs },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.xs },
  menuText: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  menuDanger: { fontSize: font.body, fontWeight: '600', color: colors.danger },
  // Swipe reveals behind a row, at this row's radius. The label hugs the
  // row's edge on each side, so it travels with the finger on a long swipe.
  swipeAction: { borderRadius: radius.md, justifyContent: 'center', overflow: 'hidden' },
  swipeRight: { alignItems: 'flex-start' },
  swipeLeft: { alignItems: 'flex-end' },
  swipeActionBtn: {
    width: SWIPE_ACTION_W,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: space.xs,
  },
  swipeActionText: { fontSize: font.tiny, fontWeight: '700', color: '#ffffff' },
});
