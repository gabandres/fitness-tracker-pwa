import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { WHATS_NEW_VERSION, getWhatsNewSeen, markWhatsNewSeen } from '@/lib/whatsNew';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Whether this banner has anything to say.
 *
 * Exported so `useTodayNudge` can rank it against the other Nudges without
 * rendering it — the mobile twin of the web banner's `whatsNewVisible()`.
 */
export function useWhatsNewVisible(): boolean {
  const [show, setShow] = useState(visible);
  useEffect(() => {
    listeners.add(setShow);
    // Read once per process; every later render is served from the cache so a
    // second caller (`useTodayNudge`) cannot disagree with the banner about
    // whether the slot is taken.
    if (visible == null) {
      void getWhatsNewSeen().then((seen) => publish(seen !== WHATS_NEW_VERSION));
    } else {
      setShow(visible);
    }
    return () => {
      listeners.delete(setShow);
    };
  }, []);
  return show === true;
}

/**
 * Module-level, because two components ask the same question.
 *
 * The banner renders it and `useTodayNudge` ranks it, and if those two held
 * separate `useState` copies then dismissing the banner would hide the card
 * while the gate still believed the slot was occupied — a Nudge slot held by
 * nothing.
 */
let visible: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

function publish(next: boolean): void {
  visible = next;
  for (const l of listeners) l(next);
}

/** Mark it seen and hide it everywhere at once. */
export async function dismissWhatsNew(): Promise<void> {
  publish(false);
  await markWhatsNewSeen();
}

/** One-time "what's new" card on Today. Shows until dismissed, then the seen
 *  version is stored (AsyncStorage) so it stays hidden until WHATS_NEW_VERSION
 *  is bumped. Renders nothing while loading, once dismissed, or while a
 *  higher-priority Nudge holds the single slot (`suppressed`). */
export function WhatsNewBanner({ suppressed = false }: { suppressed?: boolean }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const show = useWhatsNewVisible();

  if (!show || suppressed) return null;

  return (
    <View style={styles.card} testID="whats-new">
      <View style={styles.left}>
        <View style={styles.dot} />
        <View style={styles.textCol}>
          <Text style={styles.title}>{t('whatsNew.title')}</Text>
          <Text style={styles.body}>{t('whatsNew.body')}</Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => {
          haptics.tap();
          void dismissWhatsNew();
        }}
        hitSlop={10}
        testID="whats-new-dismiss"
        accessibilityRole="button"
        accessibilityLabel={t('common.dismiss')}
      >
        <Ionicons name="close" size={20} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  left: { flexDirection: 'row', gap: space.md, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 5 },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: font.small, color: colors.ink, fontWeight: '800' },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
});
