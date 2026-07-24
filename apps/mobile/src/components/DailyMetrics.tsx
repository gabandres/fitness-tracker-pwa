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
import { useT } from '@/i18n';
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

/** Formats elapsed ms as "14h 03m" (or "0h 42m"). */
function elapsedLabel(since: Date, now: number): string {
  const mins = Math.max(0, Math.floor((now - since.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Today's daily-metric strip: fasting timer, water quick-add, sleep. The
 *  fasting row re-renders every 30s while a fast is running so the elapsed
 *  clock stays live without a global timer. */
export function DailyMetrics({ water, sleep, activity, fastStartedAt, onAddWater, onSetSleep, onStartFast, onBreakFast }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const [sleepOpen, setSleepOpen] = useState(false);
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
            {fastStartedAt ? elapsedLabel(fastStartedAt, Date.now()) : t('metrics.notFasting')}
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

      {/* Water */}
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.label}>{t('metrics.water')}</Text>
          <Text style={[styles.value, styles.waterValue]}>{water} fl oz</Text>
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
