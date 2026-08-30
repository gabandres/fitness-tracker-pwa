import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MilestoneKey } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/** At most this many titles render; the rest are counted and live in the
 *  archive. Sized from the real first-run case rather than a guess — see the
 *  backfill note below. */
const MAX_VISIBLE = 3;

const DISMISS_KEY = 'milestones.note.dismissedDay';

/**
 * Remember that today's note was dismissed — and only today's.
 *
 * Stores the DAY KEY rather than a boolean, so the latch clears itself
 * tomorrow. A permanent flag would silence every future milestone, and one
 * key per dismissed day would accumulate forever; one key holding the last
 * dismissed day does neither.
 */
function useDismissedForDay(dayKey: string): [boolean, () => void] {
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(DISMISS_KEY)
      .then((v) => {
        if (alive) setDay(v);
      })
      // A cache that cannot be read is not an error worth surfacing: the note
      // simply renders, which is a correct screen.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDay(dayKey);
    // Fire and forget — the note is already gone on screen, and a failed write
    // costs one dismissal, never a wrong render.
    void AsyncStorage.setItem(DISMISS_KEY, dayKey).catch(() => {});
  }, [dayKey]);

  return [day === dayKey, dismiss];
}

/**
 * "Recorded today" — the one moment a milestone gets on Today.
 *
 * ## It is a state readout, not a Nudge — and being dismissable does not change that
 *
 * Today shows at most one Nudge (`useTodayNudge`, UX_AUDIT §S14 TD1), and that
 * ranking exists so an update banner is never buried. This row sits outside the
 * queue, and the first version of it earned that by having no dismiss control at
 * all. **That was the wrong reading of the rule.** `CONTEXT.md` defines a Nudge
 * as a *promotional or optional prompt* — what's-new, refine, push-enable,
 * install. A record of something you already did promotes nothing and asks for
 * nothing; offering to clear it does not make it an advert. The Trends stub rows
 * are the standing precedent: dismissable, and deliberately not Nudges.
 *
 * ## Why it needs the dismiss, which only a device showed
 *
 * **The first run backfills.** Every milestone an account has ever earned is
 * recorded the day the feature arrives, so an existing user's first note is not
 * one line — it is four, and for a hundred-day streak up to eight. The owner's
 * own screenshot showed four stacked above the fold on Today, with no way to
 * clear them for the rest of the day. A quiet record that occupies half the
 * screen is neither quiet nor a record.
 *
 * So: at most {@link MAX_VISIBLE} titles, the remainder counted, the whole label
 * tappable through to the archive, and an × that clears it for **today only**.
 * Tomorrow's milestone gets its own note.
 *
 * ## Why there is no icon
 *
 * Typographic by decision. A trophy glyph is the visual shorthand of exactly the
 * gamified trackers `README.md` defines this product against. The accent rule
 * carries the emphasis; the eyebrow carries the label.
 *
 * Titles use `type.heading` (Manrope) and therefore set NO `fontWeight` —
 * pairing the two is the ADR-0014 rule that silently renders the wrong face.
 */
export function MilestoneNote({
  keys,
  dayKey,
  onOpen,
}: {
  keys: readonly MilestoneKey[];
  /** Today's day key under the user's boundary — scopes the dismissal. */
  dayKey: string;
  onOpen: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [dismissed, dismiss] = useDismissedForDay(dayKey);

  // Almost every day. Rendering an empty shell would be a permanent fixture
  // announcing that nothing happened.
  if (keys.length === 0 || dismissed) return null;

  const shown = keys.slice(0, MAX_VISIBLE);
  const extra = keys.length - shown.length;

  return (
    <Animated.View entering={enterUp(0)} style={styles.card} testID="milestone-note">
      <View style={styles.rule} />
      <PressScale
        style={styles.body}
        testID="milestone-note-open"
        accessibilityRole="button"
        accessibilityLabel={t('milestones.title')}
        onPress={() => {
          haptics.tap();
          onOpen();
        }}
      >
        <Text style={styles.eyebrow}>{t('milestones.today')}</Text>
        {/* More than one can land on the same day — a first fast on the day a
            streak ticks over, and on the first run, everything at once. */}
        {shown.map((k) => (
          <Text key={k} style={styles.title}>
            {t(`milestones.${k}` as I18nKey)}
          </Text>
        ))}
        {extra > 0 ? (
          <Text style={styles.more}>{t('milestones.more', { n: String(extra) })}</Text>
        ) : null}
      </PressScale>
      {/* Dismiss sits OUTSIDE the navigating pressable — nesting one touchable
          in another makes which one fired depend on a few pixels, and these two
          actions are opposites. Same shape as the Trends stub rows. */}
      <PressScale
        style={styles.dismiss}
        testID="milestone-note-dismiss"
        accessibilityRole="button"
        accessibilityLabel={t('common.dismiss')}
        onPress={() => {
          haptics.tap();
          dismiss();
        }}
      >
        <Ionicons name="close" size={16} color={colors.faint} />
      </PressScale>
    </Animated.View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      paddingVertical: space.md,
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
    // `flex: 1` so the dismiss stays inside the card's padding rather than
    // being shoved against the edge by the label's intrinsic width — the
    // device-only bug the Trends stub row already hit once.
    body: { flex: 1, gap: 2, paddingLeft: space.md, paddingRight: space.sm },
    eyebrow: {
      fontSize: font.tiny,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.accent,
      fontWeight: '700',
    },
    // Manrope — no `fontWeight` here on purpose (ADR-0014).
    title: { fontSize: font.body, fontFamily: type.heading, color: colors.ink },
    more: { fontSize: font.small, color: colors.muted, marginTop: 2 },
    // Generous padding, small glyph — a one-way action beside a navigating one.
    dismiss: { paddingLeft: space.sm, paddingRight: space.md, paddingVertical: space.xs },
  });
