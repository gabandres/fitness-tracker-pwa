import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { useT } from '@/i18n';
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
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user, reloadUser, resendVerification, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function onResend() {
    if (resending || resent) return;
    setError(null);
    setResending(true);
    try {
      await resendVerification();
      setResent(true);
    } catch {
      setError(t('verify.resendFailed'));
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
            style={[styles.secondary, (resending || resent) && styles.busy]}
            onPress={onResend}
            disabled={resending || resent}
            testID="verify-resend"
          >
            <Text style={styles.secondaryText}>
              {resending ? t('verify.resending') : resent ? `✓ ${t('verify.resent')}` : t('verify.resend')}
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
