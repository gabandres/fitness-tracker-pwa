import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors } from '@/theme';

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/** Redirects between the authed tab group and the sign-in screen as auth
 *  state settles. The `(app)` group holds every signed-in surface. */
function AuthGate() {
  const { user, initializing } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    const inAppGroup = segments[0] === '(app)';
    if (!user && inAppGroup) {
      router.replace('/sign-in');
    } else if (user && !inAppGroup) {
      router.replace('/(app)');
    }
  }, [user, initializing, segments, router]);

  if (initializing) return <Splash />;
  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
