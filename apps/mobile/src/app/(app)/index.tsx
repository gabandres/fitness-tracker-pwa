import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureAndShare } from '@/lib/shareCapture';
import type { DailyLog, LogEntry } from '@macrolog/core';
import { DailyMetrics } from '@/components/DailyMetrics';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { EntrySheet } from '@/components/EntrySheet';
import { MacroRing } from '@/components/MacroRing';
import { MealEntries } from '@/components/MealEntries';
import { ShareCard } from '@/components/ShareCard';
import { WhatsNewBanner } from '@/components/WhatsNewBanner';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useToday } from '@/hooks/useToday';
import { colors, font, radius, space } from '@/theme';

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function Today() {
  const t = useT();
  const {
    loading,
    error,
    summary,
    targets,
    todayLogs,
    presets,
    recentEntries,
    addEntry,
    updateEntry,
    deleteEntry,
    addPreset,
    deletePreset,
    customFoods,
    addCustomFood,
    deleteCustomFood,
    hideRecent,
    unitSystem,
    water,
    sleep,
    setWater,
    setSleep,
    fastStartedAt,
    startFast,
    breakFast,
    streak,
    repeatYesterday,
    shareStats,
  } = useToday();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const shareRef = useRef<View>(null);

  async function onShare() {
    haptics.tap();
    try {
      await captureAndShare(shareRef, t('today.shareCard'));
    } catch {
      /* capture/share failed or user dismissed — no-op */
    }
  }

  async function onRepeatYesterday() {
    if (repeating) return;
    haptics.tap();
    setRepeating(true);
    try {
      await repeatYesterday();
      haptics.success();
    } finally {
      setRepeating(false);
    }
  }
  const [editing, setEditing] = useState<DailyLog | null>(null);

  const calTarget = targets.calorieTarget || 0;
  const calConsumed = summary.totalCalories;
  const calRemaining = calTarget - calConsumed;
  const protConsumed = summary.totalProtein;
  const protTarget = targets.proteinTarget || 0;

  function openAdd() {
    haptics.tap();
    setEditing(null);
    setSheetOpen(true);
  }
  function openEdit(log: DailyLog) {
    setEditing(log);
    setSheetOpen(true);
  }
  async function onSave(entry: LogEntry) {
    if (editing?.id) await updateEntry(editing.id, entry);
    else await addEntry(entry);
    haptics.success();
  }
  async function onDelete() {
    if (editing?.id) await deleteEntry(editing.id);
    haptics.success();
    setSheetOpen(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('nav.today')}</Text>
          <Text style={styles.date}>{todayLabel()}</Text>
        </View>
        <View style={styles.headerRight}>
          {streak > 0 ? (
            <View style={styles.streakChip} testID="streak-chip">
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={styles.streakNum}>{streak}</Text>
            </View>
          ) : null}
          <TouchableOpacity onPress={onShare} testID="share-progress" hitSlop={10}>
            <Ionicons name="share-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <HeaderAvatar />
        </View>
      </View>

      {/* Off-screen capture target for the share card (native share only). */}
      <View style={styles.shareCapture} pointerEvents="none">
        <View ref={shareRef} collapsable={false}>
          <ShareCard stats={shareStats} />
        </View>
      </View>

      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>{t('today.loadErr')}</Text> : null}

          <WhatsNewBanner />

          <View style={styles.rings}>
            <MacroRing
              testID="calorie-ring"
              progress={calTarget ? calConsumed / calTarget : 0}
              color={calRemaining < 0 ? colors.danger : colors.ring}
              value={Math.abs(calRemaining).toLocaleString()}
              label={t('today.kcal')}
              sub={calRemaining < 0 ? t('today.over') : t('today.left')}
            />
            <MacroRing
              testID="protein-ring"
              progress={protTarget ? protConsumed / protTarget : 0}
              color={colors.protein}
              value={`${protConsumed}g`}
              label={t('today.protein')}
              sub={`/ ${protTarget}g`}
            />
          </View>

          <View style={styles.statsRow}>
            <Stat label={t('today.calories')} value={`${calConsumed.toLocaleString()} / ${calTarget.toLocaleString()}`} />
            <Stat label={t('today.carbs')} value={`${summary.totalCarbs}g`} />
            <Stat label={t('today.fat')} value={`${summary.totalFat}g`} />
          </View>

          <DailyMetrics
            water={water}
            sleep={sleep}
            fastStartedAt={fastStartedAt}
            onAddWater={setWater}
            onSetSleep={setSleep}
            onStartFast={startFast}
            onBreakFast={breakFast}
          />

          <Text style={styles.sectionTitle}>{t('today.entries')}</Text>
          {todayLogs.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('today.emptyTitle')}</Text>
              <Text style={styles.emptyHint}>{t('today.emptyHint')}</Text>
              <TouchableOpacity
                style={[styles.repeatBtn, repeating && styles.repeatBtnDisabled]}
                onPress={onRepeatYesterday}
                disabled={repeating}
                testID="repeat-yesterday"
              >
                <Ionicons name="refresh" size={15} color={colors.ink} />
                <Text style={styles.repeatText}>
                  {repeating ? t('common.saving') : t('today.repeatYesterday')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <MealEntries logs={todayLogs} onPress={openEdit} />
          )}
          <View style={{ height: 96 }} />
        </ScrollView>
      )}

      <TouchableOpacity style={styles.fab} onPress={openAdd} testID="add-food" accessibilityLabel="Add food">
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      <EntrySheet
        visible={sheetOpen}
        editing={editing}
        onSave={onSave}
        onDelete={editing ? onDelete : undefined}
        onClose={() => setSheetOpen(false)}
        presets={presets}
        recentEntries={recentEntries}
        onSavePreset={addPreset}
        onDeletePreset={deletePreset}
        onHideRecent={hideRecent}
        customFoods={customFoods}
        onSaveCustomFood={addCustomFood}
        onDeleteCustomFood={deleteCustomFood}
        unitSystem={unitSystem}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  date: { fontSize: font.body, color: colors.muted, marginTop: 2 },
  body: { paddingHorizontal: space.xl, gap: space.lg },
  error: { color: colors.danger, fontSize: font.small },
  rings: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  statLabel: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink },
  empty: { alignItems: 'center', paddingVertical: space.xl, gap: space.xs },
  emptyText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  emptyHint: { fontSize: font.small, color: colors.faint },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  shareCapture: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  streakFlame: { fontSize: font.small },
  streakNum: { fontSize: font.small, fontWeight: '800', color: colors.ink },
  repeatBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm, borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  repeatBtnDisabled: { opacity: 0.5 },
  repeatText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  list: { gap: space.sm },
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
  },
  entryMain: { flex: 1, gap: 2 },
  entryLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  entryMacros: { fontSize: font.small, color: colors.muted },
  entryKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink, marginLeft: space.md },
  fab: {
    position: 'absolute',
    right: space.xl,
    bottom: space.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
});
