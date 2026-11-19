import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Touchable } from '@/components/Touchable';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { getReminderSettings, setRemindersEnabled } from '@/lib/reminders';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * "Want a nudge at meal times?" on Today (2026-11-19).
 *
 * The ask used to be an onboarding step, before the user had logged anything —
 * and 0 of 43 accounts said yes there. It now waits until there is at least
 * one entry, and asks once per account per device (`reminderAsk.v1.<uid>`,
 * set on either answer). Whether it may claim the screen is
 * `wantsReminderAsk` (`lib/today-gate.ts`); whether it GETS the screen is
 * `useTodayNudge`, where it ranks last.
 *
 * "Turn on reminders" runs the exact path onboarding's reminders step ran:
 * `setRemindersEnabled(true)` — which is where the OS permission prompt is
 * raised, so the system dialog appears only after this in-app yes, and where
 * `reminders_on` is counted. The caller re-plans the schedule after a yes
 * (`onEnabled`), because Today's `useReminderSync` only re-plans when its
 * inputs move and the master switch is not one of them.
 */

export function reminderAskKey(uid: string): string {
  return `reminderAsk.v1.${uid}`;
}

export type ReminderAskPhase = 'ask' | 'denied';

export interface ReminderAsk {
  /** Meal reminders are on — null until the device read lands. */
  remindersOn: boolean | null;
  /** The card was answered on this device — null until read. Stays false
   *  while the card is showing its "denied" line, even though the answer is
   *  already stored, so the line is not yanked away mid-read. */
  answered: boolean | null;
  phase: ReminderAskPhase;
  busy: boolean;
  /** Yes: the onboarding enable path. `onEnabled` runs after an OS yes. */
  enable: (onEnabled?: () => void) => Promise<void>;
  notNow: () => void;
  /** Close the card after the denied line. */
  close: () => void;
}

/** Store the answer. Never throws: a failed write asks again some other day,
 *  which is harmless. */
async function storeAnswered(uid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(reminderAskKey(uid), '1');
  } catch {
    // see above
  }
}

export function useReminderAsk(uid: string | undefined): ReminderAsk {
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<ReminderAskPhase>('ask');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAnswered(null);
    setPhase('ask');
    if (!uid) return;
    let alive = true;
    AsyncStorage.getItem(reminderAskKey(uid))
      .then((v) => alive && setAnswered(v != null))
      // Unreadable: treat as answered — never nag on a broken read.
      .catch(() => alive && setAnswered(true));
    return () => {
      alive = false;
    };
  }, [uid]);

  // Re-read on every focus: the switch can be turned on in Settings, and the
  // card must not then ask for something that is already on.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getReminderSettings()
        .then((r) => alive && setRemindersOn(r.enabled))
        .catch(() => alive && setRemindersOn(null));
      return () => {
        alive = false;
      };
    }, []),
  );

  const enable = useCallback(
    async (onEnabled?: () => void) => {
      if (!uid || busy) return;
      setBusy(true);
      let granted = false;
      try {
        granted = await setRemindersEnabled(true);
      } catch {
        // A failing prompt reads as "not granted" — the honest fallback.
      }
      await storeAnswered(uid);
      setBusy(false);
      if (granted) {
        haptics.success();
        setRemindersOn(true);
        setAnswered(true);
        onEnabled?.();
      } else {
        setPhase('denied');
      }
    },
    [uid, busy],
  );

  const notNow = useCallback(() => {
    if (!uid) return;
    haptics.tap();
    void storeAnswered(uid);
    setAnswered(true);
  }, [uid]);

  const close = useCallback(() => {
    haptics.tap();
    setAnswered(true);
  }, []);

  return { remindersOn, answered, phase, busy, enable, notNow, close };
}

export function ReminderAskCard({
  ask,
  suppressed = false,
  onEnabled,
}: {
  ask: ReminderAsk;
  suppressed?: boolean;
  onEnabled?: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  if (suppressed) return null;

  if (ask.phase === 'denied') {
    return (
      <View style={styles.card} testID="reminder-ask-card" accessibilityLiveRegion="polite">
        <Text style={styles.title} accessibilityRole="header">
          {t('reminderAsk.title')}
        </Text>
        <Text style={styles.body} accessibilityRole="alert" testID="reminder-ask-denied">
          {t('reminderAsk.denied')}
        </Text>
        <View style={styles.actions}>
          <Touchable
            style={styles.secondary}
            onPress={() => {
              haptics.tap();
              void Linking.openSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('scan.openSettings')}
            testID="reminder-ask-open-settings"
          >
            <Text style={styles.secondaryText}>{t('scan.openSettings')}</Text>
          </Touchable>
          <Touchable
            style={styles.textBtn}
            onPress={ask.close}
            accessibilityRole="button"
            accessibilityLabel={t('common.done')}
            testID="reminder-ask-close"
          >
            <Text style={styles.textBtnText}>{t('common.done')}</Text>
          </Touchable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="reminder-ask-card">
      <Text style={styles.title} accessibilityRole="header">
        {t('reminderAsk.title')}
      </Text>
      <Text style={styles.body}>{t('reminderAsk.body')}</Text>
      <View style={styles.actions}>
        {/* Secondary (outlined): Today's one filled button is the + button. */}
        <Touchable
          style={[styles.secondary, ask.busy && styles.busy]}
          disabled={ask.busy}
          onPress={() => {
            haptics.tap();
            void ask.enable(onEnabled);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('reminderAsk.on')}
          accessibilityState={{ disabled: ask.busy, busy: ask.busy }}
          testID="reminder-ask-on"
        >
          <Text style={styles.secondaryText}>{t('reminderAsk.on')}</Text>
        </Touchable>
        <Touchable
          style={styles.textBtn}
          disabled={ask.busy}
          onPress={ask.notNow}
          accessibilityRole="button"
          accessibilityLabel={t('reminderAsk.notNow')}
          testID="reminder-ask-not-now"
        >
          <Text style={styles.textBtnText}>{t('reminderAsk.notNow')}</Text>
        </Touchable>
      </View>
    </View>
  );
}

// The Today card shape (`TargetChangeNotice`'s secondary button), so it reads
// as the same system.
const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      gap: space.xs,
    },
    title: { fontSize: font.body, color: colors.ink, fontWeight: '800' },
    body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
    secondary: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      paddingHorizontal: space.lg,
      minHeight: TARGET,
      justifyContent: 'center',
    },
    secondaryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    busy: { opacity: 0.5 },
    textBtn: { minHeight: TARGET, paddingHorizontal: space.sm, justifyContent: 'center' },
    textBtnText: { fontSize: font.small, fontWeight: '700', color: colors.muted },
  });
