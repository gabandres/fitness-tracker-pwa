import { useRouter } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';

/**
 * An unverified email is a STATE, not a wall (owner's call, 2026-11-19).
 *
 * Until then an email/password signup met a full-screen "verify your email"
 * screen before onboarding and could do nothing until they left the app, found
 * the mail and came back — 33% of signups ever logged, with a 34-minute median
 * to the first log. Now an unverified account onboards and logs everything;
 * only the AI features that cost money (photo scan, the coach) wait for a
 * confirmed email. The server is the authority on that (it reads the ID
 * token's `email_verified` claim and rejects with `EMAIL_NOT_VERIFIED`); this
 * file is the client's half: a quiet banner, the locked state the two AI
 * screens show, and the hook that decides it.
 *
 * `emailVerified === false`, never `!emailVerified`: `AuthState` always carries
 * a boolean, and a value that says nothing about verification must not lock
 * anything — the safe failure for a client-side check that the server repeats.
 */

/**
 * Re-ask Firebase whether the email is verified — once now, and on every
 * return to the foreground — while `active`. The usual way an email gets
 * verified is in another app (Mail, the browser), and coming back from it is a
 * foreground, not a navigation, so a focus listener alone would miss it.
 *
 * `reloadUser` forces a fresh ID token when the answer is yes (`lib/auth.tsx`),
 * which is what lets the very next AI call carry `email_verified: true`.
 */
function useVerificationRecheck(active: boolean, onVerified?: () => void) {
  const { reloadUser } = useAuth();
  const recheck = useEffectEvent(() => {
    if (!active || !reloadUser) return;
    reloadUser()
      .then((verified) => {
        if (verified) onVerified?.();
      })
      .catch(() => {});
  });
  useEffect(() => {
    if (!active) return;
    recheck();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') recheck();
    });
    return () => sub.remove();
  }, [active]);
}

/**
 * The slim row at the top of Today while the email is unverified.
 *
 * No props: it reads auth itself. Renders nothing signed out, once verified, or
 * while the session is only PRESUMED from disk (#83 — that blob can be stale,
 * and telling a verified user to verify is worse than a second's wait). Not
 * dismissible: it is a state, and it goes away by itself.
 *
 * Accessibility: ONE focus stop. The whole row is the button (role `button`),
 * its label is the sentence and its hint says where it goes; the visible
 * "Verify" is part of the same control, so a screen reader never meets a
 * sentence and a separate unlabelled action.
 */
export function VerifyEmailBanner() {
  const { user, emailVerified, sessionPresumed } = useAuth();
  const t = useT();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const show = !!user && emailVerified === false && !sessionPresumed;
  useVerificationRecheck(show);
  if (!show) return null;
  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={() => {
        haptics.tap();
        router.push('/verify-email');
      }}
      accessibilityRole="button"
      accessibilityLabel={t('verify.bannerText')}
      accessibilityHint={t('verify.bannerHint')}
      testID="verify-banner"
    >
      <Text style={styles.bannerText}>{t('verify.bannerText')}</Text>
      <Text style={styles.bannerAction}>{t('verify.bannerAction')}</Text>
    </TouchableOpacity>
  );
}

/**
 * Whether this user's AI features are locked, and the hook-up for a server
 * refusal.
 *
 * Locked when Firebase says the email is unverified (never for a presumed
 * session), or when the server just refused with `EMAIL_NOT_VERIFIED` — the
 * defence in depth for a client that believed otherwise. `lockFromServer`
 * re-asks Firebase straight away: if the email IS verified the refusal came
 * from a token minted before the click, the reload has just forced a new one,
 * and it resolves `true` so the screen can say "try again" instead of locking.
 * The lock lifts by itself when the email turns verified anywhere — the verify
 * screen, a foreground re-check, this hook's own.
 */
export function useAiLock(): { locked: boolean; lockFromServer: () => Promise<boolean> } {
  const { user, emailVerified, sessionPresumed, reloadUser } = useAuth();
  const [serverLocked, setServerLocked] = useState(false);
  // Lift a server lock the moment verification lands. Adjusted during render
  // (React's "state from a changed prop" pattern), so no frame shows it locked.
  const [seenVerified, setSeenVerified] = useState(emailVerified);
  if (seenVerified !== emailVerified) {
    setSeenVerified(emailVerified);
    if (emailVerified) setServerLocked(false);
  }
  const clientLocked = !!user && emailVerified === false && !sessionPresumed;
  const locked = clientLocked || serverLocked;
  useVerificationRecheck(locked, () => setServerLocked(false));

  function lockFromServer(): Promise<boolean> {
    setServerLocked(true);
    if (!reloadUser) return Promise.resolve(false);
    return reloadUser()
      .then((verified) => {
        if (verified) setServerLocked(false);
        return verified;
      })
      .catch(() => false);
  }

  return { locked, lockFromServer };
}

/**
 * The locked state an AI screen shows in place of its flow: what is locked and
 * why, "Verify email", and the screen's own way out. The way out is the
 * caller's (scan offers the search, the coach goes back), because each screen
 * already knows how it leaves.
 */
export function VerifyEmailLocked({
  title,
  body,
  secondaryLabel,
  onSecondary,
  testID,
}: {
  title: string;
  body: string;
  secondaryLabel: string;
  onSecondary: () => void;
  testID?: string;
}) {
  const t = useT();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.locked} testID={testID}>
      <Text style={styles.lockedTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.lockedBody}>{body}</Text>
      <TouchableOpacity
        style={styles.primary}
        onPress={() => {
          haptics.tap();
          router.push('/verify-email');
        }}
        accessibilityRole="button"
        testID="locked-verify"
      >
        <Text style={styles.primaryText}>{t('verify.lockedCta')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondary}
        onPress={onSecondary}
        accessibilityRole="button"
        testID="locked-secondary"
      >
        <Text style={styles.secondaryText}>{secondaryLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    // Quiet on purpose: a card surface and normal ink, no red. It is a state
    // the user can act on whenever they like, not an error.
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      minHeight: TARGET,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.card,
    },
    bannerText: { flex: 1, fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.4 },
    bannerAction: { fontSize: font.small, color: colors.ink, fontWeight: '700', textDecorationLine: 'underline' },
    locked: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: space.md, paddingVertical: space.xl },
    lockedTitle: { fontFamily: type.heading, fontSize: font.h2, color: colors.ink },
    lockedBody: { fontSize: font.body, color: colors.muted, lineHeight: font.body * 1.5 },
    primary: {
      marginTop: space.sm,
      minHeight: TARGET,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.md,
      paddingVertical: space.md,
      backgroundColor: colors.ink,
    },
    primaryText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
    secondary: {
      minHeight: TARGET,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingVertical: space.md,
      backgroundColor: colors.inputBg,
    },
    secondaryText: { color: colors.ink, fontSize: font.body, fontWeight: '700' },
  });
