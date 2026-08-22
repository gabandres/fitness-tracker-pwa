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
import { useKeyboardSheetStyle } from '@/lib/use-keyboard-sheet-style';
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
 * Water entry — a quick amount, or a corrected total.
 *
 * ## Why two modes and not one
 *
 * The row's pills already answer "I drank a glass". What a user asked for is
 * the amount that is not a glass: *"no hay un opcion customizada cmo poner
 * 5oz"* (in-app feedback, 2026-08-22). That is an **add** — he drank 5 oz, he
 * did not decide his day totals 5 oz — so Add is the default and the one that
 * opens focused.
 *
 * Set total exists because the pills can only ever go one way per tap and a
 * mis-tap is otherwise repaired by counting backwards. It is a second mode
 * rather than a second sheet because they share every other control, and the
 * segmented pair is the same vocabulary the Daily-targets editor uses.
 *
 * The live `16 → 21 fl oz` line is what makes Add legible without arithmetic:
 * the thing being changed is a total, so the total is what it shows.
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
  const inputRef = useDeferredFocus(visible);
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [value, setValue] = useState('');

  useEffect(() => {
    // Always reopens in Add with an empty field. Carrying the previous mode
    // over would make the common action depend on what was done last time.
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

  function pick(next: 'add' | 'set') {
    haptics.tap();
    setMode(next);
    // Set total starts from what is on screen, so correcting 16 to 15 is one
    // keystroke rather than a retype. Add stays empty — prefilling it would
    // read as "add 16 more".
    setValue(next === 'set' ? String(current) : '');
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Reanimated.View style={keyboardStyle}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{t('water.title')}</Text>

            <View style={styles.segment}>
              {(['add', 'set'] as const).map((m) => {
                const on = mode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.segBtn, on && styles.segBtnOn]}
                    onPress={() => pick(m)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    testID={`water-mode-${m}`}
                  >
                    <Text style={[styles.segText, on && styles.segTextOn]}>
                      {t(m === 'add' ? 'water.modeAdd' : 'water.modeSet')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
                accessibilityLabel={t('water.amount')}
                testID="water-input"
              />
              <Text style={styles.inputUnit}>{t('water.unit')}</Text>
            </View>

            {/* The total, always — it is what is actually being changed. In Add
                mode it previews the result, which is the whole reason a user
                does not have to do the sum in their head. */}
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

            {/* The same amounts the row offers, reachable without closing the
                sheet — they FILL the field rather than committing, so a tap is
                a starting point you can edit, not a decision. */}
            <View style={styles.quickRow}>
              {[8, 12, 16, 24].map((q) => (
                <PressScale
                  key={q}
                  scaleTo={0.9}
                  style={styles.pill}
                  onPress={() => { haptics.tap(); setValue(String(q)); }}
                  accessibilityRole="button"
                  testID={`water-quick-${q}`}
                >
                  <Text style={styles.pillText}>{q}</Text>
                </PressScale>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.save, !valid && styles.saveDisabled]}
              onPress={() => valid && onSave(clampWaterFlOz(nextTotal))}
              disabled={!valid}
              testID="water-save"
            >
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </View>
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
        <View style={styles.sheet}>
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
        </View>
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
  segment: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  segBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  segBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  segTextOn: { color: colors.onInk },
  sheetNote: { fontSize: font.small, color: colors.muted, marginTop: space.xs, textAlign: 'center' },
  sheetNoteBad: { color: colors.danger },
  quickRow: { flexDirection: 'row', gap: space.sm, justifyContent: 'center', marginTop: space.md },
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
