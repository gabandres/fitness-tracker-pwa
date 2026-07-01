import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type DailyLog, type LogEntry, localDateKey, parseYmd, summarizeDay } from '@macrolog/core';
import { EntrySheet } from '@/components/EntrySheet';
import { MealEntries } from '@/components/MealEntries';
import { useHistory } from '@/hooks/useHistory';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

export default function DayDetail() {
  const t = useT();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dateKey = String(date);
  const router = useRouter();
  const { loading, logs, weights, presets, addEntry, updateEntry, deleteEntry, addPreset, deletePreset } = useHistory();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DailyLog | null>(null);

  const summary = summarizeDay(dateKey, logs, weights);
  const dayLogs = logs
    .filter((l) => localDateKey(l.date) === dateKey && l.calories > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  function openAdd() {
    haptics.tap();
    setEditing(null);
    setSheetOpen(true);
  }
  function openEdit(log: DailyLog) {
    haptics.tap();
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

  const title = parseYmd(dateKey).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} testID="back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.totals}>
            <Total label={t('today.calories')} value={summary.totalCalories.toLocaleString()} />
            <Total label={t('history.protein')} value={`${summary.totalProtein}g`} />
            <Total label={t('today.carbs')} value={`${summary.totalCarbs}g`} />
            <Total label={t('today.fat')} value={`${summary.totalFat}g`} />
          </View>
          {summary.weightLb != null ? (
            <Text style={styles.weight}>{t('history.weight')}: {summary.weightLb} lb</Text>
          ) : null}

          <Text style={styles.sectionTitle}>{t('today.entries')}</Text>
          {dayLogs.length === 0 ? (
            <Text style={styles.empty}>{t('history.noEntries')}</Text>
          ) : (
            <MealEntries logs={dayLogs} onPress={openEdit} />
          )}
        </ScrollView>
      )}

      {!loading ? (
        <TouchableOpacity style={styles.fab} onPress={openAdd} testID="add-food-day" activeOpacity={0.85}>
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>
      ) : null}

      <EntrySheet
        visible={sheetOpen}
        editing={editing}
        dateKey={dateKey}
        presets={presets}
        onSave={onSave}
        onDelete={editing ? onDelete : undefined}
        onClose={() => setSheetOpen(false)}
        onSavePreset={addPreset}
        onDeletePreset={deletePreset}
      />
    </SafeAreaView>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalValue}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: font.h3, fontWeight: '700', color: colors.ink },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.lg },
  totals: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  total: { alignItems: 'center', flex: 1 },
  totalValue: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  totalLabel: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  weight: { fontSize: font.body, color: colors.muted },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink },
  empty: { fontSize: font.body, color: colors.muted },
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
    width: 56,
    height: 56,
    borderRadius: 28,
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
