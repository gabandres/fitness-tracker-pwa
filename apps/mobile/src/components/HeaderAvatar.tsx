import { router } from 'expo-router';
import { Image, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font } from '@/theme';

/** Initials from a display name or email — "Ana Ruiz" → "AR", "e2e@x" → "E2". */
function initials(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  if (!s) return '?';
  const at = s.indexOf('@');
  const base = at > 0 ? s.slice(0, at) : s;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

/**
 * Account avatar that doubles as the Settings entry point, shown top-right on
 * every primary screen so Settings is always one tap away (parity with the web
 * header). Renders the provider profile photo (Google today; Microsoft/Apple
 * when those populate photoURL) and falls back to initials.
 */
export function HeaderAvatar() {
  const { user } = useAuth();
  const styles = useThemedStyles(createStyles);
  const photo = user?.photoURL ?? null;
  const label = user?.displayName || user?.email || null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/settings')}
      testID="settings-open"
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Settings"
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.img} />
      ) : (
        <Text style={styles.initials}>{initials(label)}</Text>
      )}
    </TouchableOpacity>
  );
}

const SIZE = 34;
// `flexShrink: 0` on both faces is load-bearing, not defensive tidiness. This
// sits last in a `space-between` header row, so when that row overflows it is
// the avatar that gets squeezed — and it is the ONLY entry point to Settings on
// every primary screen. Measured on a OnePlus 8T (360dp) 2026-09-04: the Today
// header needed 1,200px of a 1,080px screen and the avatar rendered 54px wide
// against its declared 102px, clipped by the screen edge with the header's own
// 24dp right padding consumed entirely. A control must never be what gives.
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  img: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 1, borderColor: colors.line, flexShrink: 0 },
  initials: {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: font.small,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: SIZE,
  },
});
