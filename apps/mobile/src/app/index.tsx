import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { computeKcal } from '@macrolog/core';
import { colors, font, space } from '@/theme';

// Phase 1 boot probe: a value computed by the shared @macrolog/core package
// proves the monorepo resolves end-to-end through Metro. Replaced by the real
// Today screen in Phase 3.
export default function Today() {
  const demoTarget = computeKcal(180, 'lose');
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.title}>Macro Log</Text>
        <Text style={styles.subtitle}>shared core online · demo target ≈ {demoTarget} kcal</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: font.body, color: colors.muted },
});
