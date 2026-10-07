import { useEffect, useRef, useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { announce } from '@/lib/a11y';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmHost } from '@/components/ConfirmSheet';
import { LogSpeedDial } from '@/components/LogSpeedDial';
import { ActiveWorkoutPill } from '@/components/train/ActiveWorkoutPill';
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
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';
import { useWorkoutIntentRouter } from '@/hooks/useStartNextWorkoutIntent';
import { sweepOrphans } from '@/lib/rest-timer-activity';
import { GLASS_BAR_HEIGHT, GLASS_TAB_BAR, TAB_PILL_ALPHA, glassBarGap, withAlpha } from '@/lib/glass';
import { ACCESSIBILITY_FONT_SCALE, RelayoutBoundary, useRelayoutGeneration } from '@/lib/font-scale';

/** The glass material, loaded only where it is drawn (iOS 26). */
const GlassBackground = GLASS_TAB_BAR
  ? (require('expo-glass-effect') as typeof import('expo-glass-effect')).GlassView
  : null;

/** The four tab destinations, in bar order. History is deliberately NOT here
 *  (ADR-0014): it's a lookup surface, reached from Today's calendar icon —
 *  and since 2026-10-04 a root stack route, not a hidden tab (review P1). */
const TAB_ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  index: { outline: 'today-outline', filled: 'today' },
  train: { outline: 'barbell-outline', filled: 'barbell' },
  trends: { outline: 'trending-up-outline', filled: 'trending-up' },
  body: { outline: 'body-outline', filled: 'body' },
};
const LEFT_TABS = ['index', 'train'];
const RIGHT_TABS = ['trends', 'body'];
const TAB_ROUTES = [...LEFT_TABS, ...RIGHT_TABS];

/** Tab labels grow with Dynamic Type this far (S21: was 1.2, which left the
 *  bar's words smaller than the body text from the second Larger Text step).
 *  Four labels and the raised + share ~360dp, so past ~1.2× the long ones
 *  ("Entrenar", "Tendências") would ellipsize — they shrink to fit their cell
 *  instead (`TAB_LABEL_MIN_FIT`), which keeps the whole word. Each tab also
 *  offers the large-content viewer (review A2). */
const TAB_LABEL_MAX_SCALE = 1.4;
/** How far a long label may shrink to fit its cell before it would ellipsize. */
const TAB_LABEL_MIN_FIT = 0.75;
/** At accessibility sizes a label cannot be both legible and inside a ~70dp
 *  cell, so the bar shows larger icons alone — what the system tab bar does —
 *  and the name stays on each tab's accessibility label, spoken and shown in
 *  the large-content viewer. */
const TAB_ICON_SIZE = 23;
const TAB_ICON_SIZE_LARGE = 28;

/** Material 3's active indicator — the pill behind the focused tab's icon —
 *  on Android only. iOS's tab bar marks the focused tab by tint and a filled
 *  glyph alone, which this bar already does on both. */
const TAB_INDICATOR = Platform.OS === 'android';

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
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  // (The History day detail's "no second + over my own" spacer, UX_AUDIT
  // S16-3, went with History's move to the root stack: no tab bar is drawn
  // over a pushed route at all.)
  // A workout left open is invisible from every tab but Train — and the raised
  // Log button actively pulls you to Today mid-session. One dot, from a signal
  // that opens no listener (`active-workout-signal.ts`).
  const workout = useActiveWorkout();
  const iconsOnly = useWindowDimensions().fontScale >= ACCESSIBILITY_FONT_SCALE;
  // iOS 26: a Liquid Glass capsule floating over the content, the way the
  // system tab bar sits (owner-approved 2026-10-05). The content runs under
  // it — every tab pads by `TAB_SCROLL_BAND`. Only on the four tabs: Settings,
  // the targets screens and Feedback were hidden routes in this navigator
  // until S21-1, none padded for a floating bar, and it covered their Save /
  // Send / Delete account (Impeccable native audit, 2026-10-05). They are
  // root stack routes now; the check stays so a route added here later gets
  // the opaque bar until it pads for the capsule. Elsewhere: the opaque bar.
  const current = state.routes[state.index]?.name;
  const floating = GLASS_TAB_BAR && current != null && TAB_ROUTES.includes(current);

  function tab(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return null;
    const { options } = descriptors[route.key];
    const focused = state.index === state.routes.indexOf(route);
    const icons = TAB_ICONS[name];
    const label = typeof options.title === 'string' ? options.title : name;
    const inProgress = name === 'train' && workout.active;
    const spoken = inProgress ? `${label}, ${t('train.inProgress')}` : label;
    return (
      <PressScale
        key={route.key}
        style={styles.tab}
        scaleTo={0.9}
        // Borderless (overrides PressScale's bounded one): a bounded ripple on
        // a cell this wide reads as a stripe.
        android_ripple={{ color: 'rgba(128, 128, 128, 0.22)', borderless: true, radius: 32 }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={spoken}
        accessibilityShowsLargeContentViewer
        accessibilityLargeContentTitle={label}
        testID={`tab-${name}`}
        // No haptic: switching tabs is navigation, and neither platform's own
        // tab bar buzzes for it (review P6).
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          // Re-tapping the tab you are on scrolls it to the top (Today wires
          // `useScrollToTop` to this same event). A sighted user sees the jump;
          // a screen-reader user is told (review A9).
          if (focused && !event.defaultPrevented) announce(t('a11y.scrolledToTop', { screen: label }));
        }}
      >
        {/* On the glass capsule the focused tab sits on its own opaque
            capsule, as iOS 26's tab bar draws it: glass takes its tone from
            what scrolls under it, and an `ink` glyph over the dark hero card
            vanished in light mode (S21 QA). Static — nothing to animate, so
            nothing for Reduce Motion to stop. */}
        <View
          style={floating ? [styles.glassItem, focused && styles.glassItemOn] : styles.plainItem}
          testID={floating && focused ? `tab-${name}-selected-pill` : undefined}
        >
          {/* The pill is drawn behind the icon on Android (`TAB_INDICATOR`,
              Today re-score, Platform); the dot stays pinned to the glyph. */}
          <View style={TAB_INDICATOR ? [styles.indicator, focused && styles.indicatorOn] : undefined}>
            <View>
              <Ionicons
                name={focused ? icons.filled : icons.outline}
                size={iconsOnly ? TAB_ICON_SIZE_LARGE : TAB_ICON_SIZE}
                color={focused ? colors.ink : colors.faint}
              />
              {inProgress ? <View style={styles.tabDot} testID="tab-train-active" /> : null}
            </View>
          </View>
          {iconsOnly ? null : (
            <Text
              style={[styles.tabLabel, { color: focused ? colors.ink : colors.faint }]}
              maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={TAB_LABEL_MIN_FIT}
            >
              {label}
            </Text>
          )}
        </View>
      </PressScale>
    );
  }

  // A workout left running is one tap from every tab but its own (Train
  // review U11) — the dot on the Train icon says it exists, this says how long
  // and takes you back.
  const onTrain = current === 'train';
  return (
    <View style={floating ? styles.floatWrap : undefined} pointerEvents="box-none">
      {!onTrain && workout.active ? (
        <View style={styles.pillSlot}>
          <ActiveWorkoutPill onResume={() => navigation.navigate('train')} />
        </View>
      ) : null}
      {/* `tablist` is what makes the four `tab` roles a group: VoiceOver says
          "tab, 1 of 4" only inside one, and TalkBack announces the bar (review #8). */}
      <View
        style={
          floating
            ? [styles.barGlass, { marginBottom: glassBarGap(insets.bottom) }]
            : [styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]
        }
        accessibilityRole="tablist"
      >
        {floating && GlassBackground ? (
          <GlassBackground
            style={styles.glass}
            glassEffectStyle="regular"
            colorScheme={scheme}
            isInteractive
          />
        ) : null}
        {LEFT_TABS.map(tab)}
        <LogSpeedDial />
        {RIGHT_TABS.map(tab)}
      </View>
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
  // Font-scale relayout (`lib/font-scale.ts`): each tab's content re-keys on
  // this, below the navigator, so the selected tab survives. Train holds off
  // while a workout runs — a remount would cancel the live rest timer.
  const relayout = useRelayoutGeneration();
  const workoutActive = useActiveWorkout().active;
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
  // A "Start my next workout" waiting from Siri sends the user to Train.
  useWorkoutIntentRouter();
  // A rest countdown left on the Lock Screen by a killed session is ended.
  useEffect(() => {
    void sweepOrphans();
  }, []);
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
  // `ToastProvider` is in the root layout since S20: the native sheet route
  // sits on the root stack, above this navigator, and hosts toasts too.
  return (
    <>
    <Tabs
      screenOptions={{ headerShown: false }}
      screenLayout={({ route, navigation, children }) => (
        <RelayoutBoundary
          generation={relayout}
          hold={route.name === 'train' && workoutActive}
          focused={navigation.isFocused()}
        >
          {children}
        </RelayoutBoundary>
      )}
      tabBar={(props) => <AppTabBar key={relayout} {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.today') }} />
      <Tabs.Screen name="train" options={{ title: t('nav.train') }} />
      <Tabs.Screen name="trends" options={{ title: t('nav.trends') }} />
      <Tabs.Screen name="body" options={{ title: t('nav.body') }} />
      {/* No hidden tabs. Coach, Milestones, History — and since S21-1
          Settings, Daily targets, Refine targets and Feedback — are root
          stack routes pushed over this navigator (UX_AUDIT S18-14, Today
          review P1, `lib/root-stack.ts`), so the tab bar and the raised +
          never cover them, swipe-back works, and back returns to the screen
          that opened them instead of the tab navigator's first route. */}
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
    floatWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    barGlass: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: space.lg,
      minHeight: GLASS_BAR_HEIGHT,
      borderRadius: 32,
      paddingHorizontal: space.sm,
    },
    // Behind the tabs, the capsule's own shape. Not `overflow: hidden` on the
    // bar: that would clip the raised + .
    glass: { ...StyleSheet.absoluteFill, borderRadius: 32 },
    // Clears the raised Log button, which stands ~26dp proud of the bar.
    pillSlot: { paddingBottom: 30 },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 2 },
    plainItem: { alignItems: 'center', gap: 2 },
    // The selected capsule's box is on every glass tab, so the focused one
    // does not shift its neighbours; only the fill marks it.
    glassItem: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      alignSelf: 'stretch',
      marginHorizontal: 2,
      paddingVertical: space.xs,
      borderRadius: 999,
    },
    // `paper` near-opaque: `ink` on it is ≥ 12:1 in both themes whatever the
    // glass shows (`theme-contrast.test.ts`).
    glassItemOn: { backgroundColor: withAlpha(colors.paper, TAB_PILL_ALPHA) },
    tabLabel: { fontSize: font.tiny, fontWeight: '600' },
    // 56×30 rather than M3's 64×32: a cell is ~71dp wide at 360dp, and the
    // pill must not touch its neighbour's. `line` is the palette's quiet fill
    // that still reads on the canvas in both themes.
    // `transparent` at rest is load-bearing on Android (Fabric): a view whose
    // background first appears on a later render drew it with square corners
    // — the pill was round only right after a mount, then a hard rectangle
    // after any tab switch (Android emulator QA, 2026-10-06).
    indicator: {
      width: 56,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    indicatorOn: { backgroundColor: colors.line },
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
