import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogSpeedDial } from '@/components/LogSpeedDial';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useHealthAutoImport } from '@/lib/health-sync';
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
 * Custom tab bar: 4 destinations split around the raised coral **Log
 * button** — the one-thumb log action from anywhere. It navigates to Today
 * with an `openAdd` nonce; Today opens the EntrySheet, so every log ends
 * with the hero ring re-sweeping to the new total (the built-in
 * celebration).
 */
function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  function tab(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return null;
    const { options } = descriptors[route.key];
    const focused = state.index === state.routes.indexOf(route);
    const icons = TAB_ICONS[name];
    const label = typeof options.title === 'string' ? options.title : name;
    return (
      <PressScale
        key={route.key}
        style={styles.tab}
        scaleTo={0.9}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        testID={`tab-${name}`}
        onPress={() => {
          haptics.tap();
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
      >
        <Ionicons name={focused ? icons.filled : icons.outline} size={23} color={focused ? colors.ink : colors.faint} />
        <Text style={[styles.tabLabel, { color: focused ? colors.ink : colors.faint }]}>{label}</Text>
      </PressScale>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {LEFT_TABS.map(tab)}
      <LogSpeedDial />
      {RIGHT_TABS.map(tab)}
    </View>
  );
}

export default function AppTabsLayout() {
  const t = useT();
  const { user } = useAuth();
  // Pull weight/sleep/water from Apple Health / Health Connect on app-open and
  // every foreground (no-op unless the user connected Health in Settings).
  useHealthAutoImport(user?.uid);
  return (
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
    </Tabs>
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
  });
}
