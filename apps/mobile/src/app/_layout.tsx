import { Manrope_700Bold, Manrope_800ExtraBold, useFonts } from '@expo-google-fonts/manrope';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { BrandLoader } from '@/components/BrandLoader';
import { I18nProvider } from '@/i18n';
import { ThemeProvider, useTheme } from '@/lib/theme-context';

/** Full-screen branded loading overlay while auth/profile/fonts settle, on
 *  the active theme's canvas so the handoff has no color flash. */
function Splash() {
  const { colors } = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: colors.paper }]}>
      <BrandLoader />
    </View>
  );
}

/** Redirects between the authed tab group and the sign-in screen as auth
 *  state settles. The `(app)` group holds every signed-in surface. */
function AuthGate({ fontsReady }: { fontsReady: boolean }) {
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
  // fires; cover it with the splash while auth/profile/fonts settle.
  const showSplash = initializing || (!!user && profileLoading) || !fontsReady;
  return (
    <>
      <Slot />
      {showSplash ? <Splash /> : null}
    </>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function RootLayout() {
  // Display faces only (ADR-0014); body text stays system. If loading ever
  // errors (bad asset on an OTA update), ship system fonts over a blank app.
  const [fontsLoaded, fontsError] = useFonts({ Manrope_700Bold, Manrope_800ExtraBold });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <AuthProvider>
            <I18nProvider>
              <AuthGate fontsReady={fontsLoaded || !!fontsError} />
            </I18nProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
