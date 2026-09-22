import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { useLocale, useT } from '@/i18n';
import { enterUp } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/** Email-verification gate for email/password signups (parity with the web
 *  app's verify screen). The rules block every write until the email is
 *  verified, so this stands between sign-up and onboarding. Federated providers
 *  return verified emails and never land here. The root AuthGate mounts this
 *  whenever a signed-in user is not yet verified, and routes onward the moment
 *  reloadUser() reports success. */
export default function VerifyEmail() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user, reloadUser, resendVerification, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  // A COOLDOWN, not a latch. `resent` was a one-way boolean: the first
  // successful resend disabled the button for the life of the screen, so if
  // that second mail was also lost the only way out of the verification wall
  // was to force-quit or sign out — from the one screen standing between
  // sign-up and the product. The RATE_LIMITED branch below had already worked
  // out the right shape ("the button stays enabled, because a minute later it
  // will work"); the success path just never adopted it. Found 2026-09-22.
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  // The branded ignia.fit/auth/action page verifies the email in the browser
  // and its "Open Ignia" deep-links back here — so re-check on foreground,
  // making the return itself enough to resume onboarding. Quiet on failure:
  // the manual button owns the error copy, and a network blip on foreground
  // must not paint an error over a screen the user did nothing on.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      reloadUser()
        .then((verified) => {
          // The AuthGate observes emailVerified flipping true and navigates.
          if (verified) haptics.success();
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [reloadUser]);

  async function onCheck() {
    if (checking) return;
    setError(null);
    setChecking(true);
    try {
      const verified = await reloadUser();
      if (verified) {
        haptics.success();
        // The AuthGate observes emailVerified flipping true and navigates.
      } else {
        setError(t('verify.notYet'));
      }
    } catch {
      setError(t('verify.checkFailed'));
    } finally {
      setChecking(false);
    }
  }

  /** Firebase throttles link generation tightly; a minute matches it. */
  const RESEND_COOLDOWN_MS = 60_000;
  const cooldownLeft =
    resentAt == null ? 0 : Math.max(0, Math.ceil((resentAt + RESEND_COOLDOWN_MS - now) / 1000));

  useEffect(() => {
    if (resentAt == null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resentAt + RESEND_COOLDOWN_MS) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resentAt]);

  async function onResend() {
    if (resending || cooldownLeft > 0) return;
    setError(null);
    setResending(true);
    try {
      await resendVerification(locale);
      setResentAt(Date.now());
    } catch (e) {
      // `RATE_LIMITED` is not a failure. Firebase Auth throttles link
      // generation far tighter than our own per-uid budget, so tapping Resend
      // seconds after the automatic sign-up send lands here with an email
      // already on its way (production, 2026-09-14). "Couldn't resend" would
      // be false, and "try again" is the one instruction that keeps it
      // failing — so this case gets its own copy. The button stays enabled,
      // because a minute later it will work.
      const code = (e as { details?: { code?: string } } | null)?.details?.code;
      setError(t(code === 'RATE_LIMITED' ? 'verify.resendTooSoon' : 'verify.resendFailed'));
    } finally {
      setResending(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Animated.View style={styles.hero} entering={enterUp(0)}>
          <BrandMark />
        </Animated.View>
        <Animated.Text style={styles.section} entering={enterUp(1)}>
          {t('verify.section')}
        </Animated.Text>
        <Animated.Text style={styles.title} entering={enterUp(2)}>
          {t('verify.title')}
        </Animated.Text>

        <Animated.View style={styles.card} entering={enterUp(3)}>
          <Text style={styles.body1}>
            {t('verify.bodyPrefix')}
            <Text style={styles.email}>{user?.email ?? ''}</Text>
            {t('verify.bodySuffix')}
          </Text>
          <Text style={styles.hint}>{t('verify.hint')}</Text>

          {error ? (
            <Text style={styles.error} testID="verify-error">
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.primary, checking && styles.busy]}
            onPress={onCheck}
            disabled={checking}
            testID="verify-check"
          >
            {checking ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.primaryText}>{t('verify.checkNow')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondary, (resending || cooldownLeft > 0) && styles.busy]}
            onPress={onResend}
            disabled={resending || cooldownLeft > 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: resending || cooldownLeft > 0 }}
            testID="verify-resend"
          >
            <Text style={styles.secondaryText}>
              {resending
                ? t('verify.resending')
                : cooldownLeft > 0
                  ? `✓ ${t('verify.resentWait', { n: String(cooldownLeft) })}`
                  : t('verify.resend')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghost} onPress={signOut} testID="verify-signout">
            <Text style={styles.ghostText}>{t('verify.signOut')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    body: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: space.xl,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    hero: { alignItems: 'center', marginBottom: space.lg },
    section: {
      fontSize: font.small,
      color: colors.accent,
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: 1,
      fontWeight: '700',
    },
    title: {
      fontFamily: type.display,
      fontSize: font.h1,
      color: colors.ink,
      textAlign: 'center',
      marginTop: space.xs,
      marginBottom: space.xl,
    },
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.lg,
      padding: space.xl,
      gap: space.md,
    },
    body1: { fontSize: font.body, color: colors.muted, lineHeight: font.body * 1.5 },
    email: { color: colors.ink, fontWeight: '700' },
    hint: { fontSize: font.small, color: colors.faint, lineHeight: font.small * 1.5 },
    error: { color: colors.danger, fontSize: font.small },
    primary: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
      marginTop: space.xs,
    },
    primaryText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    secondary: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
    },
    secondaryText: { color: colors.ink, fontSize: font.body, fontWeight: '700' },
    busy: { opacity: 0.7 },
    ghost: { alignItems: 'center', paddingVertical: space.sm },
    ghostText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  });
