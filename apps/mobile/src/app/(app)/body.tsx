import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseYmd } from '@macrolog/core';
import { useBody } from '@/hooks/useBody';
import { colors, font, radius, space } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function Body() {
  const { loading, error, currentWeight, todayWeight, weighIns, setWeight } = useBody();
  const [open, setOpen] = useState(false);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Body</Text>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>Couldn't load your weight history.</Text> : null}

          <View style={styles.hero}>
            <Text style={styles.heroValue} testID="current-weight">
              {currentWeight != null ? `${currentWeight}` : '—'}
            </Text>
            <Text style={styles.heroUnit}>lb</Text>
          </View>
          <Text style={styles.heroCaption}>
            {todayWeight != null ? "Today's weigh-in" : 'Most recent weight'}
          </Text>

          <TouchableOpacity style={styles.logBtn} onPress={() => setOpen(true)} testID="log-weight">
            <Text style={styles.logBtnText}>{todayWeight != null ? 'Update today’s weight' : 'Log weight'}</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>History</Text>
          {weighIns.length === 0 ? (
            <Text style={styles.empty}>No weigh-ins yet.</Text>
          ) : (
            <View style={styles.list}>
              {weighIns.map((w) => (
                <View key={w.dateKey} style={styles.row} testID={`weighin-${w.dateKey}`}>
                  <Text style={styles.rowDate}>{dayLabel(w.dateKey)}</Text>
                  <Text style={styles.rowWeight}>{w.weight} lb</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <WeightModal
        visible={open}
        initial={todayWeight}
        onClose={() => setOpen(false)}
        onSave={async (w) => {
          await setWeight(w);
          setOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function WeightModal({
  visible,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: number | null;
  onSave: (weight: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setValue(initial != null ? String(initial) : '');
      setBusy(false);
    }
  }, [visible, initial]);

  const n = Number(value.trim());
  const valid = value.trim() !== '' && Number.isFinite(n) && n > 0 && n < 1500;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave(n);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Log weight</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={value}
              onChangeText={setValue}
              autoFocus
              testID="weight-input"
              onSubmitEditing={save}
            />
            <Text style={styles.inputUnit}>lb</Text>
          </View>
          <TouchableOpacity
            style={[styles.save, !valid && styles.saveDisabled]}
            onPress={save}
            disabled={!valid || busy}
            testID="weight-save"
          >
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.lg },
  heroValue: { fontSize: 56, fontWeight: '800', color: colors.ink, lineHeight: 60 },
  heroUnit: { fontSize: font.h2, color: colors.muted, marginBottom: space.sm },
  heroCaption: { textAlign: 'center', color: colors.muted, fontSize: font.small },
  logBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginTop: space.md,
  },
  logBtnText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink, marginTop: space.md },
  empty: { fontSize: font.body, color: colors.muted },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowDate: { fontSize: font.body, color: colors.muted },
  rowWeight: { fontSize: font.body, fontWeight: '700', color: colors.ink },
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
