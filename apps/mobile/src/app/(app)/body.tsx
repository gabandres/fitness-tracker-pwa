import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { type Measurement, parseYmd } from '@macrolog/core';
import { useBody } from '@/hooks/useBody';
import { usePhotos } from '@/hooks/usePhotos';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "−0.8 lb/wk" / "+0.3 lb/wk" / "Holding steady" near zero. */
function trendLabel(slopeLbPerWeek: number): string {
  if (Math.abs(slopeLbPerWeek) < 0.1) return 'Holding steady';
  const sign = slopeLbPerWeek < 0 ? '−' : '+';
  return `${sign}${Math.abs(slopeLbPerWeek).toFixed(1)} lb/wk`;
}

/** "Goal ~Jul 6" from a projected date key. */
function goalEtaLabel(dateKey: string): string {
  return `~${parseYmd(dateKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export default function Body() {
  const {
    loading,
    error,
    currentWeight,
    todayWeight,
    weighIns,
    setWeight,
    measurements,
    bodyFat,
    bodyFatGap,
    addMeasurement,
    deleteMeasurement,
    projection,
  } = useBody();
  const photos = usePhotos();
  const [open, setOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);

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

          {projection ? (
            <View style={styles.trendCard} testID="trend-card">
              <View style={styles.trendRow}>
                <Text style={styles.trendLabel}>Trend</Text>
                <Text style={styles.trendValue}>{trendLabel(projection.slopeLbPerWeek)}</Text>
              </View>
              {projection.goalDateKey ? (
                <View style={styles.trendRow}>
                  <Text style={styles.trendLabel}>Goal pace</Text>
                  <Text style={styles.trendValue}>{goalEtaLabel(projection.goalDateKey)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.bfCard} testID="bodyfat-card">
            <View>
              <Text style={styles.bfLabel}>Body fat</Text>
              <Text style={styles.bfHint}>
                {bodyFat != null
                  ? 'U.S. Navy estimate'
                  : bodyFatGap === 'profile'
                    ? 'Set sex + height in onboarding'
                    : 'Add a waist + neck measurement'}
              </Text>
            </View>
            <Text style={styles.bfValue} testID="bodyfat-value">{bodyFat != null ? `${bodyFat}%` : '—'}</Text>
          </View>

          <View style={styles.measureHeader}>
            <Text style={styles.sectionTitle}>Measurements</Text>
            <TouchableOpacity onPress={() => setMeasureOpen(true)} testID="add-measurement" hitSlop={8}>
              <Text style={styles.addLink}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {measurements.length === 0 ? (
            <Text style={styles.empty}>No measurements yet. Tape your waist + neck (inches) to estimate body fat.</Text>
          ) : (
            <View style={styles.list}>
              {measurements.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.row}
                  testID={`measurement-${m.id}`}
                  onLongPress={() => m.id && deleteMeasurement(m.id)}
                >
                  <Text style={styles.rowDate}>{m.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
                  <Text style={styles.rowMeasure}>{measureLine(m)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.measureHeader}>
            <Text style={styles.sectionTitle}>Progress photos</Text>
            <TouchableOpacity
              onPress={() => photos.addPhoto(currentWeight ?? undefined)}
              disabled={photos.uploading}
              testID="add-photo"
              hitSlop={8}
            >
              <Text style={[styles.addLink, photos.uploading && styles.addLinkDisabled]}>
                {photos.uploading ? 'Uploading…' : '+ Add'}
              </Text>
            </TouchableOpacity>
          </View>
          {photos.photos.length === 0 ? (
            <Text style={styles.empty}>No photos yet. Add one to track visible progress over time.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {photos.photos.map((p) =>
                p.url ? (
                  <Pressable
                    key={p.dateKey}
                    onLongPress={() => photos.deletePhoto(p.dateKey)}
                    testID={`photo-${p.dateKey}`}
                  >
                    <Image source={{ uri: p.url }} style={styles.photo} />
                    <Text style={styles.photoDate}>
                      {p.takenAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                  </Pressable>
                ) : null,
              )}
            </ScrollView>
          )}

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
          haptics.success();
          setOpen(false);
        }}
      />

      <MeasurementModal
        visible={measureOpen}
        onClose={() => setMeasureOpen(false)}
        onSave={async (entry) => {
          await addMeasurement(entry);
          haptics.success();
          setMeasureOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function measureLine(m: Measurement): string {
  const parts: string[] = [];
  if (m.waist != null) parts.push(`W ${m.waist}`);
  if (m.neck != null) parts.push(`N ${m.neck}`);
  if (m.hip != null) parts.push(`H ${m.hip}`);
  if (m.chest != null) parts.push(`Ch ${m.chest}`);
  if (m.bicep != null) parts.push(`B ${m.bicep}`);
  return parts.join(' · ') || '—';
}

type MeasureKey = 'waist' | 'neck' | 'hip' | 'chest' | 'bicep';
const MEASURE_FIELDS: { key: MeasureKey; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'neck', label: 'Neck' },
  { key: 'hip', label: 'Hip' },
  { key: 'chest', label: 'Chest' },
  { key: 'bicep', label: 'Bicep' },
];

function MeasurementModal({
  visible,
  onSave,
  onClose,
}: {
  visible: boolean;
  onSave: (entry: Omit<Measurement, 'id' | 'date'>) => Promise<void> | void;
  onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setVals({});
      setBusy(false);
    }
  }, [visible]);

  function parse(s: string): number | undefined {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  const entry = MEASURE_FIELDS.reduce<Record<string, number>>((acc, f) => {
    const n = parse(vals[f.key] ?? '');
    if (n != null) acc[f.key] = n;
    return acc;
  }, {});
  const valid = Object.keys(entry).length > 0;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave(entry as Omit<Measurement, 'id' | 'date'>);
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
          <Text style={styles.sheetTitle}>Add measurement</Text>
          <Text style={styles.sheetHint}>Inches. Waist + neck (and hip for women) drive the body-fat estimate.</Text>
          <View style={styles.measureGrid}>
            {MEASURE_FIELDS.map((f) => (
              <View key={f.key} style={styles.measureField}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={vals[f.key] ?? ''}
                  onChangeText={(t) => setVals((v) => ({ ...v, [f.key]: t }))}
                  testID={`measure-${f.key}`}
                />
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.save, !valid && styles.saveDisabled]}
            onPress={save}
            disabled={!valid || busy}
            testID="measure-save"
          >
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  trendCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    marginTop: space.md,
  },
  trendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs },
  trendLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  trendValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink, marginTop: space.md },
  empty: { fontSize: font.small, color: colors.muted },
  bfCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    marginTop: space.md,
  },
  bfLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  bfHint: { fontSize: font.tiny, color: colors.faint, marginTop: 2 },
  bfValue: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  measureHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md },
  addLink: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  addLinkDisabled: { color: colors.faint },
  photoRow: { gap: space.sm, paddingVertical: space.xs },
  photo: { width: 120, height: 160, borderRadius: radius.md, backgroundColor: colors.line },
  photoDate: { fontSize: font.tiny, color: colors.muted, marginTop: 4, textAlign: 'center' },
  rowMeasure: { fontSize: font.small, fontWeight: '600', color: colors.ink },
  sheetHint: { fontSize: font.small, color: colors.muted, marginBottom: space.md },
  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  measureField: { width: '47%', gap: space.xs },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
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
