import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type DaySummary, parseYmd } from '@macrolog/core';
import { useHistory } from '@/hooks/useHistory';
import { colors, font, radius, space } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function HistoryList() {
  const { loading, error, days } = useHistory();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>History</Text>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : days.length === 0 ? (
        <View style={styles.fill}>
          <Text style={styles.emptyText}>No history yet.</Text>
          <Text style={styles.emptyHint}>Logged days will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d) => d.dateKey}
          contentContainerStyle={styles.list}
          ListHeaderComponent={error ? <Text style={styles.error}>Couldn't load history.</Text> : null}
          renderItem={({ item }) => <Row item={item} onPress={() => router.push(`/history/${item.dateKey}`)} />}
        />
      )}
    </SafeAreaView>
  );
}

function Row({ item, onPress }: { item: DaySummary; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`day-${item.dateKey}`}>
      <View style={styles.cardLeft}>
        <Text style={styles.cardDate}>{dayLabel(item.dateKey)}</Text>
        <Text style={styles.cardSub}>
          {item.mealCount} {item.mealCount === 1 ? 'entry' : 'entries'}
          {item.exercised ? '  ·  exercised' : ''}
          {item.weightLb != null ? `  ·  ${item.weightLb} lb` : ''}
        </Text>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.cardKcal}>{item.totalCalories.toLocaleString()}</Text>
        <Text style={styles.cardKcalLabel}>kcal · {item.totalProtein}g P</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  emptyText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  emptyHint: { fontSize: font.small, color: colors.faint },
  error: { color: colors.danger, fontSize: font.small, paddingBottom: space.sm },
  list: { padding: space.xl, gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  cardLeft: { flex: 1, gap: 2 },
  cardDate: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  cardSub: { fontSize: font.small, color: colors.muted },
  cardRight: { alignItems: 'flex-end' },
  cardKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  cardKcalLabel: { fontSize: font.tiny, color: colors.muted },
});
