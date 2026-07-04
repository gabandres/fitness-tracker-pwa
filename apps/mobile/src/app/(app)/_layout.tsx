import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme } from '@/lib/theme-context';

/** Tab icon that swaps to its filled variant when active — reads as "lit up"
 *  without a custom tab bar. */
function icon(outline: keyof typeof Ionicons.glyphMap, filled: keyof typeof Ionicons.glyphMap) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} color={color} size={size} />
  );
}

export default function AppTabsLayout() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.line },
      }}
      screenListeners={{ tabPress: () => haptics.tap() }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('nav.today'), tabBarIcon: icon('today-outline', 'today') }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: t('nav.history'), tabBarIcon: icon('calendar-outline', 'calendar') }}
      />
      <Tabs.Screen
        name="train"
        options={{ title: t('nav.train'), tabBarIcon: icon('barbell-outline', 'barbell') }}
      />
      <Tabs.Screen
        name="trends"
        options={{ title: t('nav.trends'), tabBarIcon: icon('trending-up-outline', 'trending-up') }}
      />
      <Tabs.Screen
        name="body"
        options={{ title: t('nav.body'), tabBarIcon: icon('body-outline', 'body') }}
      />
      {/* Reachable via the Today header gear; hidden from the tab bar. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      {/* Reachable via Trends → Ask the Coach; hidden from the tab bar. */}
      <Tabs.Screen name="coach" options={{ href: null }} />
      {/* Reachable via Settings → Refine targets; hidden from the tab bar. */}
      <Tabs.Screen name="refine-targets" options={{ href: null }} />
    </Tabs>
  );
}
