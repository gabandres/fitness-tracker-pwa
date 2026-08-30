import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { MilestoneKey } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import { enterUp } from '@/lib/motion';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * "Recorded today" — the one moment a milestone gets on Today.
 *
 * ## It is a STATE READOUT, not a Nudge, and that is load-bearing
 *
 * Today shows at most one Nudge, ever (`useTodayNudge`, UX_AUDIT §S14 TD1), and
 * the ranking exists so an update banner is never buried. This row sits outside
 * that queue — and it earns the exemption rather than taking it, by the same
 * test that exempts `OfflineBanner`: **it asks for nothing.** No button, no
 * dismiss control, nothing to resolve.
 *
 * The dismissal question is answered by the clock instead. `useMilestones` only
 * reports keys whose `earnedAt` falls inside the current day, so the row expires
 * on its own at day end. A user who does not open the app that day never sees it
 * — which is correct for a record of something that already happened, and would
 * be wrong for a Nudge. That asymmetry is the proof the classification is honest
 * and not a loophole: had it needed a dismiss control it would belong in
 * `TodayNudge`'s union and be subject to the one-at-a-time rule.
 *
 * ## Why there is no icon
 *
 * Typographic by decision (2026-08-29). A trophy glyph is the visual shorthand of
 * exactly the gamified trackers `README.md` defines this product against, and
 * the positioning word is *editorial*. The accent rule carries the emphasis; an
 * eyebrow carries the label. If it ever reads bare on a device, adding a glyph
 * is one line — removing one from a shipped design is not.
 *
 * Title uses `type.heading` (Manrope) and therefore sets NO `fontWeight` —
 * pairing the two is the ADR-0014 rule that silently renders the wrong face.
 */
export function MilestoneNote({ keys }: { keys: readonly MilestoneKey[] }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);

  // Almost every day. Rendering an empty shell would be a permanent fixture
  // announcing that nothing happened.
  if (keys.length === 0) return null;

  return (
    <Animated.View entering={enterUp(0)} style={styles.card} testID="milestone-note">
      <View style={styles.rule} />
      <View style={styles.col}>
        <Text style={styles.eyebrow}>{t('milestones.today')}</Text>
        {/* More than one can land on the same day — a first fast on the day a
            streak ticks over. They stack rather than competing for one slot. */}
        {keys.map((k) => (
          <Text key={k} style={styles.title}>
            {t(`milestones.${k}` as I18nKey)}
          </Text>
        ))}
      </View>
    </Animated.View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      paddingVertical: space.md,
      paddingRight: space.lg,
      overflow: 'hidden',
    },
    // The whole visual accent: a hairline rule, not a badge. `alignSelf:
    // 'stretch'` rather than a fixed height so it tracks however many titles
    // stack inside.
    rule: {
      width: 3,
      alignSelf: 'stretch',
      backgroundColor: colors.accent,
      borderTopRightRadius: radius.sm,
      borderBottomRightRadius: radius.sm,
    },
    col: { flex: 1, gap: 2, paddingLeft: space.sm },
    eyebrow: {
      fontSize: font.tiny,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.accent,
      fontWeight: '700',
    },
    // Manrope — no `fontWeight` here on purpose (ADR-0014).
    title: { fontSize: font.body, fontFamily: type.heading, color: colors.ink },
  });
