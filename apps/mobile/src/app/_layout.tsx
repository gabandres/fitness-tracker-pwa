// Subpath imports, not the package barrel: the barrel re-exports all seven
// weights and Metro bundles every .ttf behind them, so importing two shipped
// eight. Same trap as `@expo/vector-icons` — see the perf-budget commit.
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { useFonts } from '@expo-google-fonts/manrope/useFonts';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { LogBox, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useIsOffline } from '@/lib/connectivity';
import { assessRoute, shouldShowSplash } from '@/lib/onboarding-gate';
import { BrandLoader } from '@/components/BrandLoader';
import { I18nProvider } from '@/i18n';
import { Sentry } from '@/lib/sentry';
import { ThemeProvider, useTheme } from '@/lib/theme-context';

// Silence Expo Go's expo-notifications warnings: we use LOCAL notifications
// (which work in Expo Go); remote push is deferred to a dev build (ADR-0015),
// so these "not fully supported in Expo Go" notices are expected, not bugs.
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  '`expo-notifications` functionality is not fully supported in Expo Go',
]);

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

/**
 * How long the gate will hold the splash waiting for a profile the server has
 * not sent, before it concludes the server is not going to send one.
 *
 * Sized against the two real numbers around it: `connectivity.ts` needs 4 s of
 * cache-only snapshots to admit it is offline, and Firestore's own backoff can
 * take longer than that to produce any snapshot at all. 8 s is comfortably past
 * both and still an order of magnitude under the 30–40 s hangs measured in #79.
 */
const GATE_MAX_WAIT_MS = 8000;

/** True once `waiting` has been continuously true for {@link GATE_MAX_WAIT_MS}. */
function useGaveUpWaiting(waiting: boolean): boolean {
  const [gaveUp, setGaveUp] = useState(false);
  // Reset DURING RENDER rather than in an effect (React's documented "adjusting
  // state when a prop changes" pattern). An effect would be a second render
  // pass, and worse, a later wait would inherit the previous one's verdict and
  // give up instantly instead of starting its own clock.
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (wasWaiting !== waiting) {
    setWasWaiting(waiting);
    setGaveUp(false);
  }
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setGaveUp(true), GATE_MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  return gaveUp;
}

/** Redirects between the authed tab group and the sign-in screen as auth
 *  state settles. The `(app)` group holds every signed-in surface. */
function AuthGate({ fontsReady }: { fontsReady: boolean }) {
  const { user, initializing, profile, profileLoading, profileConfirmed, emailVerified } = useAuth();
  const offline = useIsOffline();
  const segments = useSegments();
  const router = useRouter();

  // One `assessRoute` call feeding both the navigation and the splash — they
  // are the same question and used to be asked twice, which is how they drifted
  // apart in the first place.
  const serverGaveUp = useGaveUpWaiting(!!user && (profileLoading || !profileConfirmed));
  // `'app'` when there is nobody to route: signed out (or unverified) there is
  // no profile to wait for, and letting `assessRoute` answer `'wait'` off a null
  // profile would pin the splash over the sign-in screen.
  const decision =
    user && emailVerified ? assessRoute({ profile, profileConfirmed, offline, serverGaveUp }) : 'app';

  useEffect(() => {
    if (initializing) return;
    const route = segments[0];
    const inApp = route === '(app)';
    const onOnboarding = route === 'onboarding';
    const onVerify = route === 'verify-email';
    // The guided tour is a root route so it can take the whole screen — inside
    // the tab layout the bar and the raised + button overlapped its footer and
    // clipped its last row.
    const onTour = route === 'tour';

    if (!user) {
      if (inApp || onOnboarding || onVerify || onTour) router.replace('/sign-in');
      return;
    }
    // Email/password signups must verify before they can write anything
    // (firestore.rules gate every create/update on email_verified). Federated
    // providers return verified emails, so they fall straight through. Once
    // verified, the routing below (which sees onVerify as neither inApp nor
    // onOnboarding) sends them to onboarding or the app.
    if (!emailVerified) {
      if (!onVerify) router.replace('/verify-email');
      return;
    }
    // Signed in and verified. Where to go is decided by `assessRoute`, which
    // carries the reasoning and is tested on its own — this effect only
    // performs the navigation.
    //
    // There used to be a `if (profileLoading) return;` above this line. It was
    // redundant *and* harmful: `profileLoading` is true exactly when
    // `matchedProfile` is null, which is exactly when `profile` is null and
    // `profileConfirmed` is false — the state `assessRoute`'s first branch
    // already handles. All the short-circuit did was reach that state's verdict
    // *without* the offline/timeout escape, so an unanswered profile pinned the
    // gate open forever (#79).
    if (decision === 'wait') return;
    if (decision === 'onboarding') {
      if (!onOnboarding) router.replace('/onboarding');
      return;
    }
    // Completed users live in (app); leave them on /onboarding when they open
    // it deliberately (Settings → Edit goals / redo).
    if (!inApp && !onOnboarding && !onTour) router.replace('/(app)');
  }, [user, initializing, emailVerified, decision, segments, router]);

  // Always mount <Slot/> so the navigator exists when the redirect effect
  // fires; cover it with the splash while auth/profile/fonts settle.
  const gateSettled = !initializing && fontsReady && decision !== 'wait';

  // The latch, and the reasoning behind it, live in `onboarding-gate.ts` so the
  // decision can be tested without a router, a navigator or a Firebase session
  // — same split as `assessRoute`.
  const uid = user?.uid ?? null;
  const [settledUid, setSettledUid] = useState<string | null>(null);
  // Latched during render, not in an effect: an effect runs a frame later, and
  // that frame is exactly when a flap would slip a full-screen overlay in. The
  // assignment is idempotent for a given (uid, gateSettled), so a double render
  // computes the same thing.
  const nextSettledUid = !uid ? null : gateSettled ? uid : settledUid;
  if (nextSettledUid !== settledUid) setSettledUid(nextSettledUid);
  const showSplash = shouldShowSplash({ gateSettled, uid, settledUid: nextSettledUid });
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
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    // Sit above the tab bar's raised Log FAB (zIndex 30 / elevation) so the
    // branded loader fully covers it instead of the "+" peeking through.
    zIndex: 100,
    elevation: 100,
  },
});

function RootLayout() {
  // Display faces only (ADR-0014); body text stays system. If loading ever
  // errors (bad asset on an OTA update), ship system fonts over a blank app.
  const [fontsLoaded, fontsError] = useFonts({ Manrope_700Bold, Manrope_800ExtraBold });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
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
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// `Sentry.wrap` installs the error boundary and touch/navigation breadcrumbs
// around the whole tree. It is a no-op when Sentry.init() never ran (no DSN).
export default Sentry.wrap(RootLayout);
