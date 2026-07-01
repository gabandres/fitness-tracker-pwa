import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { BrandLoader } from '@/components/BrandLoader';
import { I18nProvider } from '@/i18n';
import { colors } from '@/theme';

/** Full-screen branded loading overlay while auth/profile settle. Same warm
 *  canvas as the native splash so the handoff has no color flash. */
function Splash() {
  return (
    <View style={styles.splash}>
      <BrandLoader />
    </View>
  );
}

/** Redirects between the authed tab group and the sign-in screen as auth
 *  state settles. The `(app)` group holds every signed-in surface. */
function AuthGate() {
  const { user, initializing, profile, profileLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    const route = segments[0];
    const inApp = route === '(app)';
    const onOnboarding = route === 'onboarding';

    if (!user) {
      if (inApp || onOnboarding) router.replace('/sign-in');
      return;
    }
    // Signed in — wait for the profile before choosing onboarding vs app.
    if (profileLoading) return;
    const needsOnboarding = !profile?.profileCompleted;
    if (needsOnboarding && !onOnboarding) {
      router.replace('/onboarding');
    } else if (!needsOnboarding && !inApp && !onOnboarding) {
      // Completed users live in (app); leave them on /onboarding when they
      // open it deliberately (Settings → Edit goals / redo).
      router.replace('/(app)');
    }
  }, [user, initializing, profile, profileLoading, segments, router]);

  // Always mount <Slot/> so the navigator exists when the redirect effect
  // fires; cover it with the splash while auth/profile settle.
  const showSplash = initializing || (!!user && profileLoading);
  return (
    <>
      <Slot />
      {showSplash ? <Splash /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthProvider>
          <I18nProvider>
            <AuthGate />
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
