import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { colors, font, radius, space } from '@/theme';

// Phase 2 placeholder home — proves auth + custom claims. Replaced by the
// real Today screen (macro rings + entries) in Phase 3.
export default function Today() {
  const { user, isPro, signOut } = useAuth();
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.body}>
        <Text style={styles.title}>Today</Text>
        <Text style={styles.email} testID="signed-in-email">
          {user?.email ?? '—'}
        </Text>
        {isPro ? (
          <View style={styles.proPill} testID="pro-badge">
            <Text style={styles.proText}>PRO</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.signout} onPress={signOut} testID="signout">
          <Text style={styles.signoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  email: { fontSize: font.body, color: colors.muted },
  proPill: {
    backgroundColor: colors.good,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    marginTop: space.xs,
  },
  proText: { color: colors.white, fontWeight: '800', fontSize: font.tiny, letterSpacing: 1 },
  signout: {
    marginTop: space.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  signoutText: { color: colors.ink, fontSize: font.body, fontWeight: '600' },
});
