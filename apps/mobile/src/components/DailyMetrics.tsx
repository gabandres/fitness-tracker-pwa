import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

interface Props {
  water: number;
  sleep: number | null;
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
export function DailyMetrics({ water, sleep, fastStartedAt, onAddWater, onSetSleep, onStartFast, onBreakFast }: Props) {
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
          <Text style={styles.label}>Fasting</Text>
          <Text style={styles.value}>
            {fastStartedAt ? elapsedLabel(fastStartedAt, Date.now()) : 'Not fasting'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.action, fastStartedAt && styles.actionStop]}
          onPress={() => {
            haptics.tap();
            fastStartedAt ? onBreakFast() : onStartFast();
          }}
          testID="fast-toggle"
        >
          <Text style={[styles.actionText, fastStartedAt && styles.actionTextStop]}>
            {fastStartedAt ? 'End' : 'Start fast'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {/* Water */}
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.label}>Water</Text>
          <Text style={styles.value}>{water} fl oz</Text>
        </View>
        <View style={styles.waterBtns}>
          {water > 0 ? (
            <TouchableOpacity style={styles.pill} onPress={() => { haptics.tap(); onAddWater(Math.max(0, water - 8)); }} testID="water-minus">
              <Text style={styles.pillText}>−8</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.pill} onPress={() => { haptics.tap(); onAddWater(water + 8); }} testID="water-plus-8">
            <Text style={styles.pillText}>+8</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pill} onPress={() => { haptics.tap(); onAddWater(water + 16); }} testID="water-plus-16">
            <Text style={styles.pillText}>+16</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Sleep */}
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.label}>Sleep</Text>
          <Text style={styles.value}>{sleep != null ? `${sleep}h` : '—'}</Text>
        </View>
        <TouchableOpacity style={styles.action} onPress={() => setSleepOpen(true)} testID="sleep-open">
          <Text style={styles.actionText}>{sleep != null ? 'Edit' : 'Log'}</Text>
        </TouchableOpacity>
      </View>

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
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) setValue(initial != null ? String(initial) : '');
  }, [visible, initial]);

  const n = Number(value.trim());
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 24;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Hours slept</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={value}
              onChangeText={setValue}
              autoFocus
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
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
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
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  pillText: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
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
    backgroundColor: colors.white,
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
  saveText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
});
