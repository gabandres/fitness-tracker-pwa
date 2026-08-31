import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WATER_MAX_FLOZ, clampWaterFlOz, fastHoursParts } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { type HabitMetric, TRENDS_HABIT_TAB_KEY, habitColor } from '@/lib/habit-identity';
import type { DailyActivity } from '@/lib/ledger';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { setPersistedTab } from '@/hooks/usePersistedTab';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

interface Props {
  water: number;
  sleep: number | null;
  /** Today's imported activity, or undefined when Health isn't connected. */
  activity?: DailyActivity;
  fastStartedAt: Date | null;
  onAddWater: (flOz: number) => void;
  onSetSleep: (hours: number) => void;
  onStartFast: () => void;
  onBreakFast: () => void;
  /** Open the fasting editor: correct a running fast's start, edit the one
   *  that ended today, or log one nobody timed. Optional so a caller that has
   *  no editor still renders. */
  onEditFast?: () => void;
  /**
   * Total hours of the fasts that ENDED today, or null when none did.
   *
   * Today used to say only "Not fasting", which is true and was still the
   * wrong thing to show: a user who logged a completed fast from this very row
   * got no acknowledgement anywhere on the screen, concluded it had not saved,
   * and logged it again — landing on an overlap warning against their own
   * record. Reported from a device with a screenshot. A row that reports one
   * state of a two-state thing is a row that lies by omission.
   */
  fastedTodayHours?: number | null;
}

/**
 * Formats elapsed time as `14h 03m`, `42m`, or "just started".
 *
 * ## Why it is not simply `Xh YYm`
 *
 * It used to be, and it read as broken. Flooring to whole minutes means a fast
 * in its first 60 seconds renders a literal **`0h 00m`**, and the row only
 * re-renders every 30s — so someone who has just tapped Start sees a zero that
 * sits there. Reported from a device 2026-08-08, next to a Dynamic Island
 * counting `0:05`, which is what made the mismatch obvious: the system timer
 * ticks seconds while this one floors to minutes.
 *
 * The fix is presentational on purpose. Matching the island's granularity would
 * mean a one-second interval on the Today screen for a number nobody watches
 * that closely, and this app should not spend battery to look busy.
 *
 * `0h 42m` is also just noise — under an hour the hours field carries nothing.
 */
function elapsedLabel(since: Date, now: number, t: TFn): string {
  const mins = Math.max(0, Math.floor((now - since.getTime()) / 60000));
  if (mins < 1) return t('metrics.fastJustStarted');
  if (mins < 60) return t('metrics.fastMinutes', { m: String(mins) });
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * What the fasting row says, in the three states it actually has.
 *
 * The third one — not fasting now, but a fast ended today — was missing, and
 * that omission is what made the feature read as broken: "Not fasting" is a
 * true sentence that erases a record the user just created. Today's total is
 * `completedFastHours`, so it follows the same end-day attribution as History
 * and Trends and cannot disagree with them.
 */
function fastingValue(since: Date | null, todayHours: number | null | undefined, t: TFn): string {
  if (since) return elapsedLabel(since, Date.now(), t);
  if (todayHours != null && todayHours > 0) {
    const parts = fastHoursParts(todayHours);
    return t('metrics.fastedToday', { h: String(parts.hours), m: String(parts.minutes) });
  }
  return t('metrics.notFasting');
}

/** What the shortcut's accessibility label says, per habit. Full phrases per
 *  metric rather than one key with a `{metric}` var, because the three locales
 *  do not agree on word order or gender for a composed phrase. */
const HABIT_SHORTCUT_LABEL: Record<HabitMetric, I18nKey> = {
  sleep: 'metrics.sleepTrend',
  fasting: 'metrics.fastingTrend',
  water: 'metrics.waterTrend',
};

/**
 * The Today → Trends shortcut a user asked for in as many words: *"Instead of
 * taping Trends > and scrolling … can we make somewhat a shortcut from
 * 'Today', I tap the icon and quickly goes to Trends and the appropriate
 * graph?"* (in-app feedback, 2026-08-30).
 *
 * A DEDICATED chip leading the row, not the row itself — every habit row's
 * label/value area is already an edit affordance (fasting → the fast editor,
 * water → the exact-amount sheet) and the right side holds the daily actions.
 * A shortcut sharing either would get hit by accident, the same reasoning that
 * split the fasting row's value from its timer button. The chip is the one
 * element on the row drawn in the habit's identity colour, and the Trends
 * Habits strip marks each face with a dot in the same colour — colour is the
 * thread that says these are the same thing.
 *
 * Lands on the right face by writing the strip's persisted tab BEFORE
 * navigating (`setPersistedTab` seeds the module memo, so the face paints on
 * the first frame), then `router.replace` — a pushed tab route stacks a second
 * screen over the tab bar, the same trap the Trends stub rows already avoid.
 * If the face has no card yet the strip omits it and Trends falls back to the
 * stub row, which explains itself — still the right landing.
 *
 * Touch target: 32dp chip + 6dp hitSlop = 44pt, and the 12dp `leadGroup` gap
 * keeps the slop clear of the edit affordance beside it.
 */
function HabitShortcut({ metric }: { metric: HabitMetric }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <PressScale
      scaleTo={0.88}
      style={styles.habitChip}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t(HABIT_SHORTCUT_LABEL[metric])}
      accessibilityHint={t('metrics.trendHint')}
      testID={`metric-trends-${metric}`}
      onPress={() => {
        haptics.tap();
        setPersistedTab(TRENDS_HABIT_TAB_KEY, metric);
        router.replace('/(app)/trends');
      }}
    >
      <Ionicons name="trending-up" size={16} color={habitColor(colors, metric)} />
    </PressScale>
  );
}

/** Today's daily-metric strip: fasting timer, water quick-add, sleep. The
 *  fasting row re-renders every 30s while a fast is running so the elapsed
 *  clock stays live without a global timer. */
export function DailyMetrics({ water, sleep, activity, fastStartedAt, onAddWater, onSetSleep, onStartFast, onBreakFast, onEditFast, fastedTodayHours }: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [sleepOpen, setSleepOpen] = useState(false);
  const [waterOpen, setWaterOpen] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!fastStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [fastStartedAt]);

  return (
    <View style={styles.card}>
      {/* Fasting. The VALUE is the way in to the editor and the button stays
          the timer — the same split the Water row below uses, and for the same
          reason: starting and ending a fast is the daily action, correcting one
          is a rare repair, and a repair that shares a control with the common
          action gets hit by accident. The pencil is what says the number is
          touchable at all; without it this row looks inert. */}
      <View style={styles.row}>
        <View style={styles.leadGroup}>
          <HabitShortcut metric="fasting" />
          <PressScale
            scaleTo={onEditFast ? 0.96 : 1}
            style={styles.left}
            onPress={onEditFast ? () => { haptics.tap(); onEditFast(); } : undefined}
            disabled={!onEditFast}
            accessibilityRole={onEditFast ? 'button' : undefined}
            accessibilityLabel={t('metrics.fasting')}
            accessibilityHint={t('fast.editHint')}
            testID="fast-open"
          >
            <Text style={styles.label}>{t('metrics.fasting')}</Text>
            <View style={styles.waterValueRow}>
              <Text style={styles.value}>{fastingValue(fastStartedAt, fastedTodayHours, t)}</Text>
              {onEditFast ? <Ionicons name="pencil" size={12} color={colors.faint} /> : null}
            </View>
          </PressScale>
        </View>
        <PressScale
          scaleTo={0.92}
          style={[styles.action, fastStartedAt ? styles.actionStop : null]}
          onPress={() => {
            haptics.tap();
            fastStartedAt ? onBreakFast() : onStartFast();
          }}
          testID="fast-toggle"
        >
          <Text style={[styles.actionText, fastStartedAt && styles.actionTextStop]}>
            {fastStartedAt ? t('metrics.end') : t('metrics.startFast')}
          </Text>
        </PressScale>
      </View>

      <View style={styles.divider} />

      {/* Water. The quick pills are the fast path and stay; the VALUE is the
          way in to an exact amount. A user asked for this in as many words —
          "solo se pueden anotar las opciones q estan puestas … no hay un opcion
          customizada cmo poner 5oz" (2026-08-22, in-app feedback) — and he was
          right: +8/+16/+24 cover the common glass and nothing else. Same shape
          as the Sleep row directly below, so it is one interaction to learn
          rather than two. */}
      <View style={styles.row}>
        <View style={styles.leadGroup}>
          <HabitShortcut metric="water" />
          <PressScale
            scaleTo={0.96}
            style={styles.left}
            onPress={() => { haptics.tap(); setWaterOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={t('water.title')}
            accessibilityHint={t('water.amount')}
            testID="water-open"
          >
            <Text style={styles.label}>{t('metrics.water')}</Text>
            <View style={styles.waterValueRow}>
              <Text style={[styles.value, styles.waterValue]}>{water} fl oz</Text>
              <Ionicons name="pencil" size={12} color={colors.faint} />
            </View>
          </PressScale>
        </View>
        <View style={styles.waterBtns}>
          {water > 0 ? (
            <PressScale scaleTo={0.88} style={styles.pill} onPress={() => { haptics.tap(); onAddWater(Math.max(0, water - 8)); }} testID="water-minus">
              <Text style={styles.pillText}>−8</Text>
            </PressScale>
          ) : null}
          <PressScale scaleTo={0.88} style={styles.pill} onPress={() => { haptics.tap(); onAddWater(water + 8); }} testID="water-plus-8">
            <Text style={styles.pillText}>+8</Text>
          </PressScale>
          <PressScale scaleTo={0.88} style={styles.pill} onPress={() => { haptics.tap(); onAddWater(water + 16); }} testID="water-plus-16">
            <Text style={styles.pillText}>+16</Text>
          </PressScale>
          <PressScale scaleTo={0.88} style={styles.pill} onPress={() => { haptics.tap(); onAddWater(water + 24); }} testID="water-plus-24">
            <Text style={styles.pillText}>+24</Text>
          </PressScale>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Sleep */}
      <View style={styles.row}>
        <View style={styles.leadGroup}>
          <HabitShortcut metric="sleep" />
          <View style={styles.left}>
            <Text style={styles.label}>{t('metrics.sleep')}</Text>
            <Text style={styles.value}>{sleep != null ? `${sleep}h` : '—'}</Text>
          </View>
        </View>
        <PressScale scaleTo={0.92} style={styles.action} onPress={() => { haptics.tap(); setSleepOpen(true); }} testID="sleep-open">
          <Text style={styles.actionText}>{sleep != null ? t('metrics.edit') : t('metrics.log')}</Text>
        </PressScale>
      </View>

      {/* Activity — imported from Apple Health / Health Connect, so there's no
          action button: the app can't produce these and never writes them back.
          The whole row is hidden unless a value actually arrived, so anyone
          without Health connected sees no permanently-empty strip. */}
      {activity && (activity.steps != null || activity.activeKcal != null) ? (
        <>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.left}>
              <Text style={styles.label}>{t('metrics.activity')}</Text>
              <Text style={styles.value} testID="activity-value">
                {[
                  activity.steps != null ? t('metrics.steps', { n: formatNumber(activity.steps, locale) }) : null,
                  activity.activeKcal != null
                    ? t('metrics.activeKcal', { n: formatNumber(activity.activeKcal, locale) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      <WaterModal
        visible={waterOpen}
        current={water}
        onClose={() => setWaterOpen(false)}
        onSave={(next) => {
          onAddWater(next);
          haptics.success();
          setWaterOpen(false);
        }}
      />

      <SleepModal
        visible={sleepOpen}
        initial={sleep}
        onClose={() => setSleepOpen(false)}
        onSave={(h) => {
          onSetSleep(h);
          haptics.success();
          setSleepOpen(false);
        }}
      />
    </View>
  );
}

/**
 * Water entry.
 *
 * ## What a user asked for, and what that does NOT mean
 *
 * *"no hay un opcion customizada cmo poner 5oz"* (in-app feedback,
 * 2026-08-22). The row's pills answer "I drank a glass"; this answers "I drank
 * five ounces". That is the whole requirement.
 *
 * **The first build of this sheet had a segmented Add/Set control, a row of
 * quick chips, and the field — three ways to choose a number stacked above one
 * another, for logging water.** It was rebuilt the same day: the chips
 * duplicated the +8/+16/+24 already on the row two inches above, the segmented
 * pair implied the two modes were equally likely when one is a daily action and
 * the other is a rare repair, and on a 360dp screen the extra rows pushed Save
 * under the keyboard. Adding controls because they are easy to add is how a
 * one-field sheet becomes a form.
 *
 * What is left is a field, the total it will produce, and one quiet way out to
 * the rare case. `Add` is the default and never carries state between opens —
 * a common action must not depend on what was done last time.
 */
function WaterModal({
  visible,
  current,
  onSave,
  onClose,
}: {
  visible: boolean;
  current: number;
  onSave: (nextTotal: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const inputRef = useDeferredFocus(visible);
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) {
      setMode('add');
      setValue('');
    }
  }, [visible]);

  const n = Number(value.trim());
  const parsed = value.trim() !== '' && Number.isFinite(n) && n >= 0;
  const nextTotal = parsed ? Math.round(mode === 'add' ? current + n : n) : current;
  const over = nextTotal > WATER_MAX_FLOZ;
  const valid = parsed && !over;

  function toggleMode() {
    haptics.tap();
    const next = mode === 'add' ? 'set' : 'add';
    setMode(next);
    // Set total starts from what is on screen, so correcting 16 to 15 is one
    // keystroke. Add stays empty — prefilling it would read as "add 16 more".
    setValue(next === 'set' ? String(current) : '');
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
            {/* The mode switch lives in the TITLE ROW and not under Save,
                because the keyboard opens with the sheet: anything below the
                primary button is behind it, and a rare path nobody can see is
                a rare path nobody uses. Costs no height. */}
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>
                {t(mode === 'add' ? 'water.addTitle' : 'water.setTitle')}
              </Text>
              <TouchableOpacity onPress={toggleMode} hitSlop={10} testID="water-mode-toggle">
                <Text style={styles.sheetLink}>
                  {t(mode === 'add' ? 'water.switchToSet' : 'water.switchToAdd')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="5"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                value={value}
                onChangeText={setValue}
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={() => valid && onSave(clampWaterFlOz(nextTotal))}
                accessibilityLabel={t(mode === 'add' ? 'water.addTitle' : 'water.setTitle')}
                testID="water-input"
              />
              <Text style={styles.inputUnit}>{t('water.unit')}</Text>
            </View>

            {/* The total is what is actually being changed, so the total is
                what this line shows — which is why nobody has to do the sum. */}
            <Text
              style={[styles.sheetNote, over && styles.sheetNoteBad]}
              testID="water-preview"
            >
              {over
                ? t('water.tooMuch', { n: WATER_MAX_FLOZ })
                : mode === 'set'
                  ? t('water.setHint')
                  : parsed
                    ? t('water.preview', { from: current, to: nextTotal })
                    : t('water.today', { n: current })}
            </Text>

            <TouchableOpacity
              style={[styles.save, !valid && styles.saveDisabled]}
              onPress={() => valid && onSave(clampWaterFlOz(nextTotal))}
              disabled={!valid}
              testID="water-save"
            >
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </TouchableOpacity>
    </BottomSheet>
  );
}

function SleepModal({
  visible,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: number | null;
  onSave: (hours: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const inputRef = useDeferredFocus(visible);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) setValue(initial != null ? String(initial) : '');
  }, [visible, initial]);

  const n = Number(value.trim());
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 24;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>{t('metrics.hoursSlept')}</Text>
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="8"
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
          value={value}
          // Prefilled with last night's value, so the first keystroke must
          // REPLACE it rather than append to it — 7 becoming 78 is not an
          // edit anybody meant. Same rule as the water and weight sheets.
          selectTextOnFocus
          returnKeyType="done"
          onChangeText={setValue}
          onSubmitEditing={() => valid && onSave(n)}
          accessibilityLabel={t('metrics.hoursSlept')}
          testID="sleep-input"
        />
        <Text style={styles.inputUnit}>h</Text>
      </View>
      <TouchableOpacity
        style={[styles.save, !valid && styles.saveDisabled]}
        onPress={() => valid && onSave(n)}
        disabled={!valid}
        testID="sleep-save"
      >
        <Text style={styles.saveText}>{t('common.save')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    ...shadow.e1,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
  left: { gap: 2 },
  // The habit chip + the row's label/value, as one leading cluster. The 12dp
  // gap is load-bearing: the chip carries 6dp of hitSlop on each side, so the
  // gap keeps its 44pt target clear of the edit affordance beside it.
  leadGroup: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1 },
  // The Trends shortcut. A bordered circle so it reads as a BUTTON, distinct
  // from the pencil (which marks the value as editable); the identity-coloured
  // glyph inside is the only colour the row adds — an accent, not a repaint.
  habitChip: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  label: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.line },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  actionStop: { borderColor: colors.danger },
  actionText: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  actionTextStop: { color: colors.danger },
  waterBtns: { flexDirection: 'row', gap: space.xs },
  waterValueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sheetNote: { fontSize: font.small, color: colors.muted, marginTop: space.xs, textAlign: 'center' },
  sheetNoteBad: { color: colors.danger },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  // Muted and small on purpose: it is a way out, not a second primary action.
  sheetLink: { fontSize: font.small, color: colors.muted, textDecorationLine: 'underline' },
  waterValue: { color: colors.teal },
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.tealSoft,
    backgroundColor: colors.tealSoft,
  },
  pillText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  // NB: no backdrop / sheetWrap / sheet / handle styles here any more. Water
  // and Sleep render inside the shared `<BottomSheet>`, which owns all four —
  // and owns the two behaviours this file's hand-rolled copy never had: a
  // backdrop that fades IN PLACE (RN's `animationType="slide"` slides the dim
  // rectangle up the screen with the panel, which is the "weird backdrop" the
  // meal EntrySheet was rebuilt to avoid) and drag-to-dismiss on the handle.
  // The keyboard-grows padding moves with it.
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.md },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: font.h2,
    color: colors.ink,
  },
  inputUnit: { fontSize: font.h3, color: colors.muted },
  save: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.lg },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
