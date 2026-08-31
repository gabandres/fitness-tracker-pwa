import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type DailyLog,
  type Fast,
  type LogEntry,
  fastHoursParts,
  fastLengthHours,
  formatBodyWeight,
  dayKeyAt,
  parseYmd,
  summarizeDay,
} from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { EntrySheet } from '@/components/EntrySheet';
import { FastSheet, type FastSheetMode } from '@/components/FastSheet';
import { MealEntries } from '@/components/MealEntries';
import { useDayFasts } from '@/hooks/useDayFasts';
import { useHistory } from '@/hooks/useHistory';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatDate, formatNumber, formatTime } from '@/lib/date-format';

export default function DayDetail() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dateKey = String(date);
  const router = useRouter();
  const { loading, logs, weights, presets, customFoods, boundary, addEntry, updateEntry, deleteEntry, addPreset, deletePreset, addCustomFood, deleteCustomFood } = useHistory();
  const unitSystem = useUnitSystem();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DailyLog | null>(null);
  // Fasting is its own listener rather than a widening of `useHistory`
  // (ADR-0016): the day list needs a few days EITHER SIDE of this one so the
  // editor can see the neighbours a proposed interval might collide with, and
  // `useHistory`'s window is a different shape entirely.
  const {
    dayFasts,
    fasts,
    addFast,
    updateFast,
    deleteFast,
  } = useDayFasts(dateKey, boundary);
  const [fastSheet, setFastSheet] = useState<{ mode: FastSheetMode; fast: Fast | null } | null>(null);

  const summary = summarizeDay(dateKey, logs, weights, boundary);
  const dayLogs = logs
    .filter((l) => dayKeyAt(l.date, boundary) === dateKey && l.calories > 0)
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

  /** Where a hand-logged fast is anchored when there is nothing to copy.
   *  Local noon on the day being viewed: a fast that ends around midday and
   *  started the evening before is the ordinary shape, so the prefill lands one
   *  nudge away from what most people mean instead of at a day boundary. */
  function noonOfDay(): Date {
    const d = parseYmd(dateKey);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function confirmDeleteFast(fast: Fast) {
    confirm({
      title: t('fast.deleteTitle'),
      body: t('fast.deleteBody'),
      confirmText: t('common.remove'),
      destructive: true,
      onConfirm: () => {
        if (fast.id) void deleteFast(fast.id);
        setFastSheet(null);
      },
    });
  }

  const title = formatDate(parseYmd(dateKey), locale, {
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
            <Total label={t('today.calories')} value={formatNumber(summary.totalCalories, locale)} />
            <Total label={t('history.protein')} value={`${summary.totalProtein}g`} />
            <Total label={t('today.carbs')} value={`${summary.totalCarbs}g`} />
            <Total label={t('today.fat')} value={`${summary.totalFat}g`} />
          </View>
          {summary.weightLb != null ? (
            <Text style={styles.weight}>
              {t('history.weight')}: {formatBodyWeight(summary.weightLb, unitSystem)}
            </Text>
          ) : null}

          <Text style={styles.sectionTitle}>{t('today.entries')}</Text>
          {dayLogs.length === 0 ? (
            <Text style={styles.empty}>{t('history.noEntries')}</Text>
          ) : (
            <MealEntries logs={dayLogs} onPress={openEdit} />
          )}

          {/* Fasting. Below the meals because meals are what this screen is
              for, and a fast is the thing you come back to CORRECT — the case
              ADR-0032 decision 3 exists for. The rows are the fasts that ENDED
              on this day, which is the same attribution the headline number
              uses; an overnight fast therefore appears on the day it was
              broken and on no other, so editing it is unambiguous. */}
          <View style={styles.fastHead}>
            <Text style={styles.sectionTitle}>{t('fast.sectionTitle')}</Text>
            <TouchableOpacity
              onPress={() => {
                haptics.tap();
                setFastSheet({ mode: 'add', fast: null });
              }}
              hitSlop={10}
              accessibilityRole="button"
              testID="fast-add"
            >
              <Text style={styles.fastAdd}>{t('fast.add')}</Text>
            </TouchableOpacity>
          </View>
          {dayFasts.length === 0 ? (
            <Text style={styles.empty}>{t('fast.none')}</Text>
          ) : (
            <View style={styles.list}>
              {dayFasts.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.entry}
                  onPress={() => {
                    haptics.tap();
                    setFastSheet({ mode: 'edit', fast: f });
                  }}
                  accessibilityRole="button"
                  accessibilityHint={t('fast.editHint')}
                  testID={`fast-row-${f.id}`}
                >
                  <View style={styles.entryMain}>
                    <Text style={styles.entryLabel}>
                      {t('fast.length', {
                        h: formatNumber(fastHoursParts(fastLengthHours(f)).hours, locale),
                        m: formatNumber(fastHoursParts(fastLengthHours(f)).minutes, locale),
                      })}
                    </Text>
                    <Text style={styles.entryMacros}>
                      {t('fast.range', {
                        from: formatTime(f.startedAt, locale),
                        to: formatTime(f.endedAt, locale),
                      })}
                      {/* The source is shown only when it is `manual`. A timer
                          fast needs no label — it is the default story — and
                          tagging both would be noise on every row. */}
                      {f.source === 'manual' ? ` · ${t('fast.byHand')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {!loading ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={openAdd}
          testID="add-food-day"
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('log.manual')}
        >
          <Ionicons name="add" size={28} color={colors.onInk} />
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
        customFoods={customFoods}
        onSaveCustomFood={addCustomFood}
        onDeleteCustomFood={deleteCustomFood}
      />

      <FastSheet
        visible={fastSheet != null}
        mode={fastSheet?.mode ?? 'add'}
        editing={fastSheet?.fast ?? null}
        // The WHOLE window, not `dayFasts` — the neighbour a new interval is
        // most likely to collide with is the fast that ended yesterday.
        fasts={fasts}
        anchorEnd={noonOfDay()}
        onSave={async (startedAt, endedAt) => {
          if (fastSheet?.mode === 'edit' && fastSheet.fast?.id) {
            await updateFast(fastSheet.fast.id, startedAt, endedAt);
          } else {
            await addFast(startedAt, endedAt);
          }
        }}
        onDelete={
          fastSheet?.mode === 'edit' && fastSheet.fast
            ? () => confirmDeleteFast(fastSheet.fast as Fast)
            : undefined
        }
        onClose={() => setFastSheet(null)}
      />
    </SafeAreaView>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.total}>
      <Text style={styles.totalValue}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
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
  fastHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  fastAdd: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
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
