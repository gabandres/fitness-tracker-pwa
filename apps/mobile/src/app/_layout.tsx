// Subpath imports, not the package barrel: the barrel re-exports all seven
// weights and Metro bundles every .ttf behind them, so importing two shipped
// eight. Same trap as `@expo/vector-icons` — see the perf-budget commit.
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { useFonts } from '@expo-google-fonts/manrope/useFonts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useNavigationContainerRef, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { LogBox, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useIsOffline } from '@/lib/connectivity';
import { assessRoute, shouldShowSplash } from '@/lib/onboarding-gate';
import { DETAIL_ROUTES, reconcileRootRoutes } from '@/lib/root-stack';
import { setSplashVisible } from '@/lib/splash-state';
import { BrandLoader } from '@/components/BrandLoader';
import { type I18nKey, I18nProvider, useT } from '@/i18n';
import { Sentry } from '@/lib/sentry';
import { ThemeProvider, useTheme } from '@/lib/theme-context';
import { ToastProvider } from '@/components/Toast';
import { sheetOptions } from '@/lib/sheet-options';
import { font, space, type } from '@/theme';

// Silence Expo Go's expo-notifications warnings: we use LOCAL notifications
// (which work in Expo Go); remote push is deferred to a dev build (ADR-0015),
// so these "not fully supported in Expo Go" notices are expected, not bugs.
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  '`expo-notifications` functionality is not fully supported in Expo Go',
]);

/**
 * How long the splash stays wordless before it admits it is waiting on
 * something. Past this the user has been looking at a logo long enough to
 * wonder whether the app is dead (#83) — and the honest answer costs one line.
 */
const SPLASH_EXPLAIN_AFTER_MS = 5000;

/** Full-screen branded loading overlay while auth/profile/fonts settle, on
 *  the active theme's canvas so the handoff has no color flash. */
function Splash() {
  const { colors } = useTheme();
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SPLASH_EXPLAIN_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <View style={[styles.splash, { backgroundColor: colors.paper }]}>
      <BrandLoader />
      {/* Deliberately no Retry button. The only recovery from here is a
          restart, and a restart does not help when the cause is that the
          network is not answering — so a button would promise a fix it cannot
          deliver. Saying what is happening is the part that was missing. */}
      {slow ? (
        <Text style={[styles.splashNote, { color: colors.muted }]}>{t('splash.stillConnecting')}</Text>
      ) : null}
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

/**
 * The detail routes that wear the shared native header, with their titles and
 * the testID their cold-open back button carries (Maestro taps these).
 *
 * One header for every pushed screen (S21-9): Coach and Milestones drew their
 * own chevron + centred title, Connected apps had a native large title, and
 * Settings, the targets screens and Feedback were hidden tabs with a drawn
 * header. Now each is the system header — the platform's back button with its
 * swipe and long-press history, the iOS 26 glass, a centred title on iOS and a
 * leading one on Android — set ONCE here so they cannot drift apart again.
 */
const HEADER_SCREENS: { name: string; titleKey: I18nKey; backTestID: string }[] = [
  { name: 'settings', titleKey: 'nav.settings', backTestID: 'settings-back' },
  { name: 'daily-targets', titleKey: 'targets.title', backTestID: 'targets-back' },
  { name: 'refine-targets', titleKey: 'refine.title', backTestID: 'refine-back' },
  { name: 'feedback', titleKey: 'feedback.title', backTestID: 'feedback-back' },
  { name: 'coach', titleKey: 'coach.title', backTestID: 'coach-back' },
  { name: 'milestones', titleKey: 'milestones.title', backTestID: 'milestones-back' },
  { name: 'connected-apps', titleKey: 'connected.title', backTestID: 'connected-apps-back' },
];

/**
 * The back button for a detail screen opened COLD (`ignia://coach`, a
 * notification) with nothing beneath it — the native header shows no back
 * button then, and the screen would be a dead end. Goes to Today.
 */
function OrphanBack({ testID }: { testID: string }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.replace('/(app)')}
      hitSlop={10}
      style={styles.orphanBack}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      testID={testID}
    >
      <Ionicons name="chevron-back" size={26} color={colors.ink} />
    </TouchableOpacity>
  );
}

/** Redirects between the authed tab group and the sign-in screen as auth
 *  state settles. The `(app)` group holds every signed-in surface. */
function AuthGate({ fontsReady }: { fontsReady: boolean }) {
  const { sessionUid, sessionPresumed, initializing, profile, profileLoading, profileConfirmed, emailVerified } =
    useAuth();
  const t = useT();
  const { colors } = useTheme();
  // The shared native header (S21-9). `minimal` drops the back title beside
  // the chevron; `headerBackTitle` is still what VoiceOver reads for it —
  // without it the button announces the previous route's NAME ("(app)").
  // Manrope for the title, without a weight (ADR-0014).
  const detailHeader = useMemo(
    () => ({
      headerShown: true,
      animation: 'default' as const,
      gestureEnabled: true,
      headerBackButtonDisplayMode: 'minimal' as const,
      headerBackTitle: t('common.back'),
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.paper },
      headerTintColor: colors.ink,
      headerTitleStyle: { color: colors.ink, fontFamily: type.heading },
    }),
    [t, colors],
  );
  const offline = useIsOffline();
  const segments = useSegments();
  const router = useRouter();

  // One `assessRoute` call feeding both the navigation and the splash — they
  // are the same question and used to be asked twice, which is how they drifted
  // apart in the first place.
  const serverGaveUp = useGaveUpWaiting(!!sessionUid && (profileLoading || !profileConfirmed));
  // `'app'` when there is nobody to route: signed out (or unverified) there is
  // no profile to wait for, and letting `assessRoute` answer `'wait'` off a null
  // profile would pin the splash over the sign-in screen.
  const decision =
    sessionUid && emailVerified
      ? assessRoute({ profile, profileConfirmed, offline, serverGaveUp })
      : 'app';

  useEffect(() => {
    if (initializing) return;
    const route = segments[0];
    // Coach, Milestones, History, Settings and the screens Settings opens are
    // root routes pushed over the tabs (UX_AUDIT S18-14, Today review P1,
    // S21-1) — signed-in surfaces, so they count as "in the app" here.
    // The native sheet route (UX_AUDIT S20) is presented over the tabs too —
    // missing from this list, it was "not in the app" and replaced away the
    // moment it opened.
    const inApp = route === '(app)' || DETAIL_ROUTES.has(route) || route === 'sheet';
    const onOnboarding = route === 'onboarding';
    const onVerify = route === 'verify-email';
    // The guided tour is a root route so it can take the whole screen — inside
    // the tab layout the bar and the raised + button overlapped its footer and
    // clipped its last row.
    const onTour = route === 'tour';
    // What's New is a root route for the same reason.
    const onWhatsNew = route === 'whats-new';

    // `sessionUid`, not `user`: before Firebase answers this may be the session
    // read off disk (#83). Redirecting to /sign-in on a slow network would tell
    // a signed-in user they had been logged out, which is the one outcome worse
    // than waiting. When the real event lands it wins — including when it says
    // signed out, which lands here and redirects properly.
    if (!sessionUid) {
      if (inApp || onOnboarding || onVerify || onTour || onWhatsNew) router.replace('/sign-in');
      return;
    }
    // Email/password signups must verify before they can write anything
    // (firestore.rules gate every create/update on email_verified). Federated
    // providers return verified emails, so they fall straight through. Once
    // verified, the routing below (which sees onVerify as neither inApp nor
    // onOnboarding) sends them to onboarding or the app.
    // A PRESUMED session never routes to verify-email (#83). The flag comes
    // off a disk blob that can be stale — Firebase updates it on reload — and
    // telling an already-verified user to go and verify their email is worse
    // than the second or two it costs to wait for the real answer. Once
    // Firebase has spoken, `sessionPresumed` is false and this behaves exactly
    // as it always did.
    if (!emailVerified && !sessionPresumed) {
      if (!onVerify) router.replace('/verify-email');
      return;
    }
    if (!emailVerified) return;
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
    if (!inApp && !onOnboarding && !onTour && !onWhatsNew) router.replace('/(app)');
  }, [sessionUid, sessionPresumed, initializing, emailVerified, decision, segments, router]);

  // The root is a native stack so Coach and Milestones can push over the tabs
  // with swipe-back (S18-14), but every other root navigation in this app was
  // written for `<Slot>`, whose `replace()` calls leave stale entries a stack
  // would mount. `lib/root-stack.ts` states the rule; this applies it,
  // handing back the same route objects so the survivors stay mounted.
  const rootState = useRootNavigationState();
  const navRef = useNavigationContainerRef();
  useEffect(() => {
    if (!rootState?.routes || rootState.stale) return;
    const keep = reconcileRootRoutes(rootState.routes, rootState.index);
    if (!keep || !navRef.isReady()) return;
    navRef.resetRoot({ ...rootState, routes: keep, index: keep.length - 1 });
  }, [rootState, navRef]);

  /** Header options for one detail route: the shared header, its title, and
   *  a back button of our own only when the stack has nothing beneath it. */
  function headerOptions(name: string) {
    const screen = HEADER_SCREENS.find((s) => s.name === name)!;
    return ({ navigation }: { navigation: { canGoBack: () => boolean } }) => ({
      ...detailHeader,
      title: t(screen.titleKey),
      headerLeft: navigation.canGoBack() ? undefined : () => <OrphanBack testID={screen.backTestID} />,
    });
  }

  // Always mount the stack so the navigator exists when the redirect effect
  // fires; cover it with the splash while auth/profile/fonts settle.
  const gateSettled = !initializing && fontsReady && decision !== 'wait';

  // The latch, and the reasoning behind it, live in `onboarding-gate.ts` so the
  // decision can be tested without a router, a navigator or a Firebase session
  // — same split as `assessRoute`.
  const uid = sessionUid;
  const [settledUid, setSettledUid] = useState<string | null>(null);
  // Latched during render, not in an effect: an effect runs a frame later, and
  // that frame is exactly when a flap would slip a full-screen overlay in. The
  // assignment is idempotent for a given (uid, gateSettled), so a double render
  // computes the same thing.
  const nextSettledUid = !uid ? null : gateSettled ? uid : settledUid;
  if (nextSettledUid !== settledUid) setSettledUid(nextSettledUid);
  const showSplash = shouldShowSplash({ gateSettled, uid, settledUid: nextSettledUid });
  // Tell the welcome intro when the overlay lifts, so its choreography starts
  // in front of the user rather than under the loader (`lib/splash-state.ts`).
  useEffect(() => {
    setSplashVisible(showSplash);
  }, [showSplash]);
  return (
    <>
      {/* `animation: 'none'` + no gesture is the `<Slot>` behaviour every root
          route had until 2026-09-28 (sign-in ⇄ app ⇄ onboarding are `replace`
          swaps, and the tour/what's-new leave with one too). Only the detail
          routes get the native push, the swipe-back and the hardware back —
          that is the whole point of the stack (UX_AUDIT S18-14, S21-1). */}
      <ToastProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }}>
        {/* Written out one per line rather than mapped: `root-stack.test.ts`
            reads this file for a `<Stack.Screen name="…"` per detail route. */}
        <Stack.Screen name="settings" options={headerOptions('settings')} />
        <Stack.Screen name="daily-targets" options={headerOptions('daily-targets')} />
        <Stack.Screen name="refine-targets" options={headerOptions('refine-targets')} />
        <Stack.Screen name="feedback" options={headerOptions('feedback')} />
        <Stack.Screen name="coach" options={headerOptions('coach')} />
        <Stack.Screen name="milestones" options={headerOptions('milestones')} />
        <Stack.Screen name="connected-apps" options={headerOptions('connected-apps')} />
        <Stack.Screen name="history" options={{ animation: 'default', gestureEnabled: true }} />
        {/* Meal-photo scan: a camera takes the whole screen, so it is presented
            as one — no tab bar, no raised + over the viewfinder, a modal's
            slide-up and Android back to leave. */}
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'default', gestureEnabled: false }} />
        {/* `BottomSheet native` (UX_AUDIT S20, `lib/sheet-portal.ts`): the
            system sheet — detents, grabber, swipe-down, Liquid Glass on iOS 26. */}
        <Stack.Screen name="sheet" options={sheetOptions} />
      </Stack>
      </ToastProvider>
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
  // Sits under the loader rather than replacing it: the brand mark is what
  // says "this is still Ignia", the line is what says "and it is still trying".
  splashNote: {
    marginTop: space.lg,
    fontSize: font.small,
  },
  orphanBack: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
});

function RootLayout() {
  // Display faces only (ADR-0014); body text stays system. If loading ever
  // errors (bad asset on an OTA update), ship system fonts over a blank app.
  const [fontsLoaded, fontsError] = useFonts({ Manrope_700Bold, Manrope_800ExtraBold });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* `preload={false}`: the default makes a hidden UITextField take first
          responder at launch to warm the keyboard, and that remote-keyboard
          XPC handshake ran on the main thread — IGNIA-MOBILE-J, a 2 s+ App
          Hang at startup on an iPhone SE (2nd gen), iOS 18, build 64, inside
          `UIResponder.preloadKeyboardIfNeeded`. The warm-up now happens on
          the first real focus, where the user is already waiting for a
          keyboard, instead of blocking a launch they did not ask to type in. */}
      <KeyboardProvider preload={false}>
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
