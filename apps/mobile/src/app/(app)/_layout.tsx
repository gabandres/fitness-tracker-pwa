import { useEffect, useRef, useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmHost } from '@/components/ConfirmSheet';
import { LogSpeedDial } from '@/components/LogSpeedDial';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useAutoApplyOta } from '@/lib/app-update';
import { useOtaPushListener, useRegisterPushToken } from '@/lib/push-token';
import { loadTourSeen, shouldAutoOpenTour, useTourHeld } from '@/lib/tour';
import { getWhatsNewSeen, markWhatsNewSeen, shouldAutoOpenWhatsNew } from '@/lib/whatsNew';
import { useHealthAutoImport } from '@/lib/health-sync';
import { hydrateActiveWorkout, useActiveWorkout } from '@/lib/active-workout-signal';
import { useOuraAutoImport } from '@/lib/oura';
import { track } from '@/lib/analytics';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/** The four tab destinations, in bar order. History is deliberately NOT here
 *  (ADR-0014): it's a lookup surface, reached from Today's calendar icon. */
const TAB_ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  index: { outline: 'today-outline', filled: 'today' },
  train: { outline: 'barbell-outline', filled: 'barbell' },
  trends: { outline: 'trending-up-outline', filled: 'trending-up' },
  body: { outline: 'body-outline', filled: 'body' },
};
const LEFT_TABS = ['index', 'train'];
const RIGHT_TABS = ['trends', 'body'];

/**
 * expo-router 57 vendored react-navigation and dropped its `@react-navigation/*`
 * dependencies, so `BottomTabBarProps` is no longer importable from there. Derive
 * the props from what `<Tabs>` actually hands its `tabBar` — that stays correct
 * across expo-router patches, where a deep import into `expo-router/build/…`
 * would not.
 */
type AppTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * Custom tab bar: 4 destinations split around the raised coral **Log
 * button** — the one-thumb log action from anywhere. It navigates to Today
 * with an `openAdd` nonce; Today opens the EntrySheet, so every log ends
 * with the hero ring re-sweeping to the new total (the built-in
 * celebration).
 */
function AppTabBar({ state, descriptors, navigation }: AppTabBarProps) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // The History day detail has its own add-to-this-day FAB; drawing the global
  // add-to-TODAY dial beside it put two different "+" buttons on one screen
  // (UX_AUDIT S16-3). A flex spacer keeps the four tabs in place.
  const segments = useSegments();
  const onDayDetail = segments[segments.length - 1] === '[date]';
  // A workout left open is invisible from every tab but Train — and the raised
  // Log button actively pulls you to Today mid-session. One dot, from a signal
  // that opens no listener (`active-workout-signal.ts`).
  const workout = useActiveWorkout();

  function tab(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return null;
    const { options } = descriptors[route.key];
    const focused = state.index === state.routes.indexOf(route);
    const icons = TAB_ICONS[name];
    const label = typeof options.title === 'string' ? options.title : name;
    const inProgress = name === 'train' && workout.active;
    return (
      <PressScale
        key={route.key}
        style={styles.tab}
        scaleTo={0.9}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={inProgress ? `${label}, ${t('train.inProgress')}` : label}
        testID={`tab-${name}`}
        onPress={() => {
          haptics.tap();
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
      >
        <View>
          <Ionicons name={focused ? icons.filled : icons.outline} size={23} color={focused ? colors.ink : colors.faint} />
          {inProgress ? <View style={styles.tabDot} testID="tab-train-active" /> : null}
        </View>
        <Text style={[styles.tabLabel, { color: focused ? colors.ink : colors.faint }]}>{label}</Text>
      </PressScale>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {LEFT_TABS.map(tab)}
      {onDayDetail ? <View style={{ flex: 1 }} /> : <LogSpeedDial />}
      {RIGHT_TABS.map(tab)}
    </View>
  );
}

/**
 * Open the guided tour once, for anyone who has not seen it on this device.
 *
 * Mounted here rather than at the end of onboarding on purpose: a
 * first-run-only tour would reach every FUTURE user and miss the one who asked
 * for it, who already has an account. `shouldAutoOpenTour` holds the rest of
 * the reasoning and is tested on its own; this hook only performs the
 * navigation.
 */
function useTourOnce() {
  const { profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [seen, setSeen] = useState<boolean | null>(null);
  const held = useTourHeld();
  const navigated = useRef(false);

  useEffect(() => {
    void loadTourSeen().then(setSeen);
  }, []);

  useEffect(() => {
    if (navigated.current) return;
    const open = shouldAutoOpenTour({
      seen,
      profileCompleted: profile?.profileCompleted === true,
      // segments is ['(app)', <screen>] inside this layout; the tab root has
      // no second segment, so treat that as 'index'.
      route: segments[0] === '(app)' ? (segments[1] ?? 'index') : segments[0],
      held,
    });
    if (!open) return;
    navigated.current = true;
    router.push('/tour');
  }, [seen, profile?.profileCompleted, segments, router, held]);
}

/**
 * Open What's New once per release, on the first Today after an update lands.
 * `shouldAutoOpenWhatsNew` holds the reasoning (and the fresh-install rule)
 * and is tested on its own; this hook reads the two flags and navigates. It
 * sits after `useTourOnce` on purpose: the tour flag it reads is false until
 * the tour has been through, so a first-run user meets the tour today and
 * the next release's notes another day.
 */
function useWhatsNewOnce() {
  const { profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  const [tourSeen, setTourSeen] = useState<boolean | null>(null);
  const held = useTourHeld();
  const decided = useRef(false);

  useEffect(() => {
    void getWhatsNewSeen().then(setSeen, () => setSeen(null));
    void loadTourSeen().then(setTourSeen);
  }, []);

  useEffect(() => {
    if (decided.current) return;
    const verdict = shouldAutoOpenWhatsNew({
      seen,
      profileCompleted: profile?.profileCompleted === true,
      route: segments[0] === '(app)' ? (segments[1] ?? 'index') : segments[0],
      tourSeen,
      held,
    });
    if (verdict === 'none') return;
    decided.current = true;
    if (verdict === 'mark') {
      void markWhatsNewSeen();
      return;
    }
    router.push('/whats-new');
  }, [seen, tourSeen, profile?.profileCompleted, segments, router, held]);
}

export default function AppTabsLayout() {
  const t = useT();
  const { user } = useAuth();
  useTourOnce();
  useWhatsNewOnce();
  // Pull weight/sleep/water from Apple Health / Health Connect on app-open and
  // every foreground (no-op unless the user connected Health in Settings).
  useHealthAutoImport(user?.uid);
  // Oura imports itself on foreground too — an import you have to ask for is
  // one most people ask for once. Throttled and silent; see the hook.
  useOuraAutoImport(user?.uid);
  // Apply a downloaded OTA bundle on its own — at cold start, or on the next
  // foreground for one that arrived mid-session. Mounted here rather than in
  // UpdateBanner so it does not depend on Today being the visible tab.
  useAutoApplyOta();
  // Push-token registration + the silent OTA pre-download listener (#114).
  // Both are inert on today's binaries (no FCM config / push entitlement /
  // background modes) and silently no-op — see push-token.ts.
  useRegisterPushToken(user?.uid);
  useOtaPushListener();
  // One `app_open` per mount of the authed shell, which is once per cold start
  // — not per foreground. Counting foregrounds would make a user who checks
  // their rings at every red light look like ten users, and the question this
  // answers is retention: how many DAYS did someone come back on.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !user?.uid) return;
    opened.current = true;
    track('app_open');
  }, [user?.uid]);
  // Restore the "workout open" dot before Train has ever mounted — quitting
  // mid-workout and reopening on Today is exactly the case the dot is for.
  // A HINT only; `useTrain` overwrites it with the truth on load, and it
  // never overwrites a live value (see the module).
  useEffect(() => {
    void hydrateActiveWorkout(user?.uid);
  }, [user?.uid]);
  return (
    <>
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: t('nav.today') }} />
      <Tabs.Screen name="train" options={{ title: t('nav.train') }} />
      <Tabs.Screen name="trends" options={{ title: t('nav.trends') }} />
      <Tabs.Screen name="body" options={{ title: t('nav.body') }} />
      {/* Routes without a tab button: */}
      {/* History — reached via the Today header calendar icon (ADR-0014). */}
      <Tabs.Screen name="history" options={{ href: null }} />
      {/* Reachable via the Today header avatar; hidden from the tab bar. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      {/* Reachable via Trends → Ask the Coach; hidden from the tab bar. */}
      <Tabs.Screen name="coach" options={{ href: null }} />
      {/* Reachable via Settings → Refine targets; hidden from the tab bar. */}
      <Tabs.Screen name="refine-targets" options={{ href: null }} />
      {/* Meal-photo scan (ADR-0015) — reached via the center camera button. */}
      <Tabs.Screen name="scan" options={{ href: null }} />
      {/* Reachable via Settings → Daily targets; hidden from the tab bar. */}
      <Tabs.Screen name="daily-targets" options={{ href: null }} />
      {/* Reachable via Settings → Send feedback and the What's-new card. */}
      <Tabs.Screen name="feedback" options={{ href: null }} />
    </Tabs>
    {/* Branded confirm dialogs (UX_AUDIT S16-10) — one host for every
        `confirm()` call in the authed shell. */}
    <ConfirmHost />
    </>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.paper,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: space.sm,
      paddingHorizontal: space.sm,
    },
    tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
    tabLabel: { fontSize: font.tiny, fontWeight: '600' },
    // Sits on the icon, not beside the label: the label is already the widest
    // thing in the cell and a dot after it reads as punctuation.
    tabDot: {
      position: 'absolute',
      top: -1,
      right: -3,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
      borderWidth: 1.5,
      borderColor: colors.paper,
    },
  });
}
