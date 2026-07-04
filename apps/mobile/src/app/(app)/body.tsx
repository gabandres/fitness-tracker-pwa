import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { BottomSheet } from '@/components/BottomSheet';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { Sparkline } from '@/components/Sparkline';
import { useBody } from '@/hooks/useBody';
import { usePhotos } from '@/hooks/usePhotos';
import { type I18nKey, type TFn, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "−0.8 lb/wk" / "+0.3 lb/wk" / "Holding steady" near zero. */
function trendLabel(slopeLbPerWeek: number, t: TFn): string {
  if (Math.abs(slopeLbPerWeek) < 0.1) return t('body.holdingSteady');
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
    weightSeries,
    projectedSeries,
    goalProgress,
  } = useBody();
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const photos = usePhotos();
  const [open, setOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  // Keep the measurements list short as history grows; the rest is one tap away.
  const [showAllMeasures, setShowAllMeasures] = useState(false);
  const MEASURE_PREVIEW = 4;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('nav.body')}</Text>
        <HeaderAvatar />
      </View>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>{t('body.loadErr')}</Text> : null}

          <View style={styles.hero}>
            <Text style={styles.heroValue} testID="current-weight">
              {currentWeight != null ? `${currentWeight}` : '—'}
            </Text>
            <Text style={styles.heroUnit}>lb</Text>
          </View>
          <Text style={styles.heroCaption}>
            {todayWeight != null ? t('body.todayWeighIn') : t('body.recentWeight')}
          </Text>

          {weightSeries.length >= 2 ? (
            <View style={styles.chartWrap} testID="weight-chart">
              <Sparkline values={weightSeries} projection={projectedSeries} width={300} height={64} color={colors.ink} />
            </View>
          ) : null}

          {goalProgress ? (
            <View style={styles.goalCard} testID="goal-card">
              <View style={styles.goalHead}>
                <Text style={styles.goalStart}>{goalProgress.startWeight.toFixed(1)} lb</Text>
                <Text style={styles.goalPct}>{goalProgress.pct}%</Text>
                <Text style={styles.goalEnd}>{goalProgress.goalWeight.toFixed(1)} lb</Text>
              </View>
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${goalProgress.pct}%` }]} />
              </View>
              <Text style={styles.goalRemaining}>
                {goalProgress.remaining > 0
                  ? t('body.goalRemaining', { n: goalProgress.remaining.toFixed(1) })
                  : t('body.goalReached')}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.logBtn} onPress={() => setOpen(true)} testID="log-weight">
            <Text style={styles.logBtnText}>{todayWeight != null ? t('body.updateWeight') : t('body.logWeight')}</Text>
          </TouchableOpacity>

          {projection ? (
            <View style={styles.trendCard} testID="trend-card">
              <View style={styles.trendRow}>
                <Text style={styles.trendLabel}>{t('body.trend')}</Text>
                <Text style={styles.trendValue}>{trendLabel(projection.slopeLbPerWeek, t)}</Text>
              </View>
              {projection.goalDateKey ? (
                <View style={styles.trendRow}>
                  <Text style={styles.trendLabel}>{t('body.goalPace')}</Text>
                  <Text style={styles.trendValue}>{goalEtaLabel(projection.goalDateKey)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.bfCard} testID="bodyfat-card">
            <View>
              <Text style={styles.bfLabel}>{t('body.bodyFat')}</Text>
              <Text style={styles.bfHint}>
                {bodyFat != null
                  ? t('body.navyEstimate')
                  : bodyFatGap === 'profile'
                    ? t('body.bfNeedProfile')
                    : t('body.bfNeedMeasurement')}
              </Text>
            </View>
            <Text style={styles.bfValue} testID="bodyfat-value">{bodyFat != null ? `${bodyFat}%` : '—'}</Text>
          </View>

          <View style={styles.measureHeader}>
            <Text style={styles.sectionTitle}>{t('body.measurements')}</Text>
            <TouchableOpacity onPress={() => setMeasureOpen(true)} testID="add-measurement" hitSlop={8}>
              <Text style={styles.addLink}>{t('body.add')}</Text>
            </TouchableOpacity>
          </View>
          {measurements.length === 0 ? (
            <Text style={styles.empty}>{t('body.noMeasurements')}</Text>
          ) : (
            <View style={styles.list}>
              {(showAllMeasures ? measurements : measurements.slice(0, MEASURE_PREVIEW)).map((m) => (
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
              {measurements.length > MEASURE_PREVIEW ? (
                <TouchableOpacity onPress={() => setShowAllMeasures((v) => !v)} hitSlop={8} style={styles.showMore}>
                  <Text style={styles.addLink}>
                    {showAllMeasures ? t('body.showLess') : `${t('body.showAll')} (${measurements.length})`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          <View style={styles.measureHeader}>
            <Text style={styles.sectionTitle}>{t('body.progressPhotos')}</Text>
            <TouchableOpacity
              onPress={() => photos.addPhoto(currentWeight ?? undefined)}
              disabled={photos.uploading}
              testID="add-photo"
              hitSlop={8}
            >
              <Text style={[styles.addLink, photos.uploading && styles.addLinkDisabled]}>
                {photos.uploading ? t('body.uploading') : t('body.add')}
              </Text>
            </TouchableOpacity>
          </View>
          {photos.photos.length === 0 ? (
            <Text style={styles.empty}>{t('body.noPhotos')}</Text>
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

          <Text style={styles.sectionTitle}>{t('body.history')}</Text>
          {weighIns.length === 0 ? (
            <Text style={styles.empty}>{t('body.noWeighIns')}</Text>
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
const MEASURE_FIELDS: { key: MeasureKey; labelKey: I18nKey }[] = [
  { key: 'waist', labelKey: 'measure.waist' },
  { key: 'neck', labelKey: 'measure.neck' },
  { key: 'hip', labelKey: 'measure.hip' },
  { key: 'chest', labelKey: 'measure.chest' },
  { key: 'bicep', labelKey: 'measure.bicep' },
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
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setVals({});
      setBusy(false);
    }
  }, [visible]);

  function parse(s: string): number | undefined {
    const trimmed = s.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed);
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
    <BottomSheet visible={visible} onClose={onClose}>
          <Text style={styles.sheetTitle}>{t('body.addMeasurement')}</Text>
          <Text style={styles.sheetHint}>{t('body.measureHint')}</Text>
          <View style={styles.measureGrid}>
            {MEASURE_FIELDS.map((f) => (
              <View key={f.key} style={styles.measureField}>
                <Text style={styles.fieldLabel}>{t(f.labelKey)}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={vals[f.key] ?? ''}
                  onChangeText={(text) => setVals((v) => ({ ...v, [f.key]: text }))}
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
            <Text style={styles.saveText}>{t('common.save')}</Text>
          </TouchableOpacity>
    </BottomSheet>
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
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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
    <BottomSheet visible={visible} onClose={onClose}>
          <Text style={styles.sheetTitle}>{t('body.logWeight')}</Text>
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
            <Text style={styles.saveText}>{t('common.save')}</Text>
          </TouchableOpacity>
    </BottomSheet>
  );
}

const createStyles = ({ colors, scheme }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
  showMore: { paddingVertical: space.sm, alignItems: 'center' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.lg },
  heroValue: { fontSize: 56, fontWeight: '800', color: colors.ink, lineHeight: 60 },
  heroUnit: { fontSize: font.h2, color: colors.muted, marginBottom: space.sm },
  heroCaption: { textAlign: 'center', color: colors.muted, fontSize: font.small },
  chartWrap: { alignItems: 'center', marginTop: space.md },
  logBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginTop: space.md,
  },
  logBtnText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
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
  goalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    marginTop: space.md,
    gap: space.sm,
  },
  goalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalStart: { fontSize: font.small, color: colors.muted },
  goalPct: { fontSize: font.body, color: colors.ink, fontWeight: '800' },
  goalEnd: { fontSize: font.small, color: colors.muted },
  goalTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' },
  goalFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  goalRemaining: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
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
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)' },
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
