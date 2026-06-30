import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useT } from '@/i18n';
import { colors } from '@/theme';

export default function AppTabsLayout() {
  const t = useT();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.today'),
          tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('nav.history'),
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="train"
        options={{
          title: t('nav.train'),
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: t('nav.trends'),
          tabBarIcon: ({ color, size }) => <Ionicons name="trending-up-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="body"
        options={{
          title: t('nav.body'),
          tabBarIcon: ({ color, size }) => <Ionicons name="body-outline" color={color} size={size} />,
        }}
      />
      {/* Reachable via the Today header gear; hidden from the tab bar. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
