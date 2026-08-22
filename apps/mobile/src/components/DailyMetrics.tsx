import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WATER_MAX_FLOZ, clampWaterFlOz } from '@macrolog/core';
import { type TFn, useT } from '@/i18n';
import type { DailyActivity } from '@/lib/ledger';
import * as haptics from '@/lib/haptics';
import Reanimated from 'react-native-reanimated';
import { PressScale } from '@/lib/motion';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useKeyboardSheetPadding, useKeyboardSheetStyle } from '@/lib/use-keyboard-sheet-style';
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

/** Today's daily-metric strip: fasting timer, water quick-add, sleep. The
 *  fasting row re-renders every 30s while a fast is running so the elapsed
 *  clock stays live without a global timer. */
export function DailyMetrics({ water, sleep, activity, fastStartedAt, onAddWater, onSetSleep, onStartFast, onBreakFast }: Props) {
  const t = useT();
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
      {/* Fasting */}
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.label}>{t('metrics.fasting')}</Text>
          <Text style={styles.value}>
            {fastStartedAt ? elapsedLabel(fastStartedAt, Date.now(), t) : t('metrics.notFasting')}
          </Text>
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
        <View style={styles.left}>
          <Text style={styles.label}>{t('metrics.sleep')}</Text>
          <Text style={styles.value}>{sleep != null ? `${sleep}h` : '—'}</Text>
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
                  activity.steps != null ? t('metrics.steps', { n: activity.steps.toLocaleString() }) : null,
                  activity.activeKcal != null
                    ? t('metrics.activeKcal', { n: activity.activeKcal.toLocaleString() })
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
  const keyboardStyle = useKeyboardSheetStyle();
  const sheetPadding = useKeyboardSheetPadding(space.xxl);
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Reanimated.View style={keyboardStyle}>
          <Reanimated.View style={[styles.sheet, sheetPadding]}>
            <View style={styles.handle} />
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
          </Reanimated.View>
        </Reanimated.View>
      </View>
    </Modal>
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
  const keyboardStyle = useKeyboardSheetStyle();
  const sheetPadding = useKeyboardSheetPadding(space.xxl);
  const inputRef = useDeferredFocus(visible);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) setValue(initial != null ? String(initial) : '');
  }, [visible, initial]);

  const n = Number(value.trim());
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 24;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Reanimated.View style={keyboardStyle}>
        <Reanimated.View style={[styles.sheet, sheetPadding]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{t('metrics.hoursSlept')}</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={value}
              onChangeText={setValue}
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
        </Reanimated.View>
        </Reanimated.View>
      </View>
    </Modal>
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
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    // Overridden by `useKeyboardSheetPadding`, which adds the bottom safe-area
    // inset at rest and ramps it back out as the keyboard rises. A bottom sheet
    // renders inside a `Modal`, which fills the physical screen and does NOT
    // respect insets, so a fixed 32 leaves the last rows under a software
    // navigation bar — 48dp on the LG VS988, which clipped the Save button by
    // ~16dp and made it miss taps near its lower edge. Adding it
    // UNCONDITIONALLY was the other half of that bug: with the keyboard open
    // the inset reserves room for a nav bar the keyboard is already covering,
    // which is the empty band that made the sheet look detached from the
    // keyboard on iOS.
    paddingBottom: space.xxl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.md },
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
