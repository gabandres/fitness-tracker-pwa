import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font } from '@/theme';

// Placeholder — built out in Phase 4.
export default function History() {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.body}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.muted}>Coming in Phase 4</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  muted: { fontSize: font.body, color: colors.muted },
});
