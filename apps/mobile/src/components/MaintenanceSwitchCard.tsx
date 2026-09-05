import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useT } from '@/i18n';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import * as haptics from '@/lib/haptics';
import { enterUp, PressScale } from '@/lib/motion';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * "Switch to maintenance?" — the one tap that follows reaching the goal
 * (retention lever 7; `maintenance-mode.ts` in core carries the argument).
 *
 * ## Why it sits under the milestone prompt, and only after it
 *
 * Reaching the goal used to change nothing: `goal-reached` went on record and
 * the target chain kept prescribing the deficit, because the pace and the
 * direction are only ever written by the onboarding wizard. Settings → Edit
 * goals reruns the whole wizard; this writes the same "maintain" outcome in
 * one tap, at the moment the trend crosses the line, where the goal and the
 * number it was measured against already live.
 *
 * It renders only once the milestone is ON RECORD — the person has already
 * said "yes, this is mine" — so an auto-imported weigh-in cannot walk a user
 * onto maintenance by itself. Same provenance argument as
 * `GoalMilestonePrompt`, inherited rather than restated.
 *
 * ## What this must not become
 *
 * A question, not a celebration: no number, no "you did it". Declining is
 * remembered per device, the same way the milestone prompt remembers it, and
 * the wizard remains the way back in either direction.
 */
export function MaintenanceSwitchCard({
  visible,
  onSwitch,
}: {
  /** True only when the trend has crossed the goal, `goal-reached` is on
   *  record, and the profile is not already maintaining. The caller owns all
   *  three. */
  visible: boolean;
  /** Writes the switch. Resolves when the profile update has been sent. */
  onSwitch: () => Promise<void>;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const [declined, decline] = useDismissedStub('maintenance.switch.declined');
  const [busy, setBusy] = useState(false);

  if (!visible || declined) return null;

  return (
    <Animated.View entering={enterUp(0)} style={styles.card} testID="maintenance-switch-card">
      <Text style={styles.title}>{t('maintenance.switchAsk')}</Text>
      <Text style={styles.body}>{t('maintenance.switchBody')}</Text>
      <View style={styles.row}>
        <PressScale
          style={[styles.primary, busy ? styles.primaryBusy : null]}
          testID="maintenance-switch-yes"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            if (busy) return;
            haptics.tap();
            setBusy(true);
            // The profile listener re-renders the caller with `goalDirection:
            // 'maintain'`, which hides this card; `busy` only guards the double
            // tap in between. A failed write re-enables the button — the user
            // can try again, and nothing else depends on the outcome.
            void onSwitch().finally(() => setBusy(false));
          }}
        >
          <Text style={styles.primaryText}>{t('maintenance.switchYes')}</Text>
        </PressScale>
        <PressScale
          style={styles.secondary}
          testID="maintenance-switch-no"
          accessibilityRole="button"
          onPress={() => {
            haptics.tap();
            decline();
          }}
        >
          <Text style={styles.secondaryText}>{t('maintenance.switchNo')}</Text>
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
    body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    primary: {
      backgroundColor: colors.ink,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    primaryBusy: { opacity: 0.6 },
    primaryText: { fontSize: font.small, color: colors.onInk, fontWeight: '700' },
    secondary: { paddingHorizontal: space.md, paddingVertical: space.sm },
    secondaryText: { fontSize: font.small, color: colors.muted },
  });
