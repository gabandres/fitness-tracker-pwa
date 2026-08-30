import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useT } from '@/i18n';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import * as haptics from '@/lib/haptics';
import { enterUp, PressScale } from '@/lib/motion';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * "Add reaching your goal weight to your milestones?" — the human in the loop
 * that `goal-reached` needs (#110).
 *
 * ## Why a question exists at all
 *
 * `users/{uid}/dailyWeights/{dateKey}` is `{ weight }` with **no `source`**, so
 * a hand-typed weigh-in and one auto-imported from Apple Health or Health
 * Connect are byte-identical. `goalReached()` in core demands manual
 * provenance, which today's schema simply cannot show — and the guard is not
 * negotiable, because `useHealthAutoImport` re-imports on every foreground and
 * one stray 158 lb reading has already moved this project's measured
 * maintenance from 2,741 to 1,619 kcal.
 *
 * The alternative was adding `source` to `dailyWeights`. That is a
 * `firestore.rules` change on a collection the FROZEN web app also writes, and
 * `hasOnly` validates the merged document — so getting it wrong starts
 * rejecting the web's weigh-ins. A cross-frontend rules deploy under a freeze,
 * for one milestone. **The person answering is cheaper and more honest.**
 *
 * ## What this must not become
 *
 * It is a **question**, never a celebration. Nothing here congratulates before
 * the user answers, and nothing names a number — no "you lost 14 lb", no
 * "goal weight reached!". Weight-magnitude praise is the eating-disorder-
 * adjacent half that #110 dropped `first-5-lb` and `four-weeks-on-target` to
 * avoid; re-introducing it in the copy would undo that decision quietly.
 *
 * ## Asking twice is worse than never asking
 *
 * Declining is remembered per device (AsyncStorage, via the same
 * `useDismissedStub` the Trends stubs use) — no profile field, no rules change.
 * Accepting writes the milestone, and `newlyEarned` then filters it on every
 * device forever, so a "yes" syncs and a "no" does not. That asymmetry is
 * deliberate and it is the right way round: the cost of a declined prompt
 * reappearing once on a second device is one tap, where a re-asked
 * congratulation on the device you already refused it on is the pressure this
 * whole feature was permitted on condition of avoiding.
 */
export function GoalMilestonePrompt({
  visible,
  onConfirm,
}: {
  /** True only when the fitted trend has crossed the user's own goal AND the
   *  milestone is not already on record. The caller owns both halves. */
  visible: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const [declined, decline] = useDismissedStub('milestones.goal.declined');

  if (!visible || declined) return null;

  return (
    <Animated.View entering={enterUp(0)} style={styles.card} testID="goal-milestone-prompt">
      <Text style={styles.title}>{t('milestones.goalAsk')}</Text>
      <View style={styles.row}>
        <PressScale
          style={styles.primary}
          testID="goal-milestone-add"
          accessibilityRole="button"
          onPress={() => {
            haptics.tap();
            onConfirm();
          }}
        >
          <Text style={styles.primaryText}>{t('milestones.goalAdd')}</Text>
        </PressScale>
        <PressScale
          style={styles.secondary}
          testID="goal-milestone-decline"
          accessibilityRole="button"
          onPress={() => {
            haptics.tap();
            decline();
          }}
        >
          <Text style={styles.secondaryText}>{t('milestones.goalDecline')}</Text>
        </PressScale>
      </View>
    </Animated.View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    // Manrope — never paired with `fontWeight` (ADR-0014).
    title: { fontSize: font.body, fontFamily: type.heading, color: colors.ink, lineHeight: 24 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    primary: {
      backgroundColor: colors.ink,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    primaryText: { fontSize: font.small, color: colors.onInk, fontWeight: '700' },
    secondary: { paddingHorizontal: space.md, paddingVertical: space.sm },
    secondaryText: { fontSize: font.small, color: colors.muted },
  });
