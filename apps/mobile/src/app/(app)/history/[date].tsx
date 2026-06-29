import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type DailyLog, localDateKey, parseYmd, summarizeDay } from '@macrolog/core';
import { useHistory } from '@/hooks/useHistory';
import { colors, font, radius, space } from '@/theme';

export default function DayDetail() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const dateKey = String(date);
  const router = useRouter();
  const { loading, logs, weights } = useHistory();

  const summary = summarizeDay(dateKey, logs, weights);
  const dayLogs = logs
    .filter((l) => localDateKey(l.date) === dateKey && l.calories > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

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
            <Total label="Calories" value={summary.totalCalories.toLocaleString()} />
            <Total label="Protein" value={`${summary.totalProtein}g`} />
            <Total label="Carbs" value={`${summary.totalCarbs}g`} />
            <Total label="Fat" value={`${summary.totalFat}g`} />
          </View>
          {summary.weightLb != null ? (
            <Text style={styles.weight}>Weight: {summary.weightLb} lb</Text>
          ) : null}

          <Text style={styles.sectionTitle}>Entries</Text>
          {dayLogs.length === 0 ? (
            <Text style={styles.empty}>No food entries this day.</Text>
          ) : (
            <View style={styles.list}>
              {dayLogs.map((log) => (
                <View key={log.id} style={styles.entry}>
                  <View style={styles.entryMain}>
                    <Text style={styles.entryLabel}>{log.mealLabel || 'Entry'}</Text>
                    <Text style={styles.entryMacros}>{macroLine(log)}</Text>
                  </View>
                  <Text style={styles.entryKcal}>{log.calories.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function macroLine(log: DailyLog): string {
  const parts: string[] = [];
  if (log.protein != null) parts.push(`P ${log.protein}g`);
  if (log.carbs != null) parts.push(`C ${log.carbs}g`);
  if (log.fat != null) parts.push(`F ${log.fat}g`);
  if (log.mealType) parts.push(log.mealType);
  return parts.join(' · ') || '—';
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
});
