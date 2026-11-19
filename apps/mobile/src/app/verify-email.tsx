import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { useLocale, useT } from '@/i18n';
import { enterUp } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';

/** Email verification for email/password signups — a screen the user OPENS
 *  (from Today's `VerifyEmailBanner`, or a locked photo scan / coach), not a
 *  wall. Until 2026-11-19 the root AuthGate forced every unverified signup
 *  here before onboarding; now an unverified account onboards and logs
 *  everything, and only the AI features that cost money wait for a confirmed
 *  email. Federated providers return verified emails and never need it.
 *
 *  It has its own way back (Close, top left), and when verification succeeds
 *  it returns the user to where they came from — on a cold open with nothing
 *  beneath it, to Today — instead of re-running the routing from scratch.
 *  `reloadUser()` forces a fresh ID token on success, so the scan or coach
 *  call the user goes back to already carries `email_verified: true`. */
export default function VerifyEmail() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { user, reloadUser, resendVerification, verificationSendFailed, signOut } = useAuth();

  /** Back to where the user opened this from; Today when nothing is beneath
   *  it (a cold deep link). Once: the foreground re-check, the manual check
   *  and the mount check can all report success for the same verification. */
  const left = useRef(false);
  function leave() {
    if (left.current) return;
    left.current = true;
    // `?.`: screen tests hand it a router with replace/back/push only.
    if (router.canGoBack?.()) router.back();
    else router.replace('/(app)');
  }
  function onVerified() {
    haptics.success();
    leave();
  }
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
  // and its "Open Ignia" deep-links back — so re-check on open and on every
  // foreground, making the return itself enough to go back to what the user
  // was doing. Quiet on failure: the manual button owns the error copy, and a
  // network blip on foreground must not paint an error over a screen the user
  // did nothing on. An Effect Event, so a new `reloadUser` identity per auth
  // render does not re-subscribe (and re-check) on every render.
  const quietCheck = useEffectEvent(() => {
    reloadUser()
      .then((verified) => {
        if (verified) onVerified();
      })
      .catch(() => {});
  });
  useEffect(() => {
    quietCheck();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') quietCheck();
    });
    return () => sub.remove();
  }, []);

  async function onCheck() {
    if (checking) return;
    setError(null);
    setChecking(true);
    // Async bodies with `.catch`/`.finally` here and in `onResend`, not try
    // statements: the React Compiler skips a component holding `try/finally`.
    await (async () => {
      const verified = await reloadUser();
      if (verified) {
        onVerified();
      } else {
        setError(t('verify.notYet'));
      }
    })()
      .catch(() => {
        setError(t('verify.checkFailed'));
      })
      .finally(() => {
        setChecking(false);
      });
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
    await (async () => {
      await resendVerification(locale);
      setResentAt(Date.now());
    })()
      .catch((e: unknown) => {
        // `RATE_LIMITED` is not a failure. Firebase Auth throttles link
        // generation far tighter than our own per-uid budget, so tapping Resend
        // seconds after the automatic sign-up send lands here with an email
        // already on its way (production, 2026-09-14). "Couldn't resend" would
        // be false, and "try again" is the one instruction that keeps it
        // failing — so this case gets its own copy. The button stays enabled,
        // because a minute later it will work.
        const code = (e as { details?: { code?: string } } | null)?.details?.code;
        setError(t(code === 'RATE_LIMITED' ? 'verify.resendTooSoon' : 'verify.resendFailed'));
      })
      .finally(() => {
        setResending(false);
      });
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* The way back. This screen used to be a wall with no exit but
          sign-out; it is now opened on purpose, so it closes like any other
          screen the user chose to open. */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.close}
          onPress={leave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          testID="verify-close"
        >
          <Ionicons name="close" size={24} color={colors.ink} />
        </TouchableOpacity>
      </View>
      {/* Scrolls rather than clips (S21 #9): at the largest text sizes the
          title, the card copy and three buttons outgrow a phone, and a
          non-scrolling centred box pushed the buttons off the bottom with no
          way to reach them — on the one screen between sign-up and the app.
          `flexGrow` keeps it centred whenever it does fit. */}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.body}>
        <Animated.View style={styles.hero} entering={enterUp(0)}>
          <BrandMark />
        </Animated.View>
        <Animated.Text style={styles.section} entering={enterUp(1)}>
          {t('verify.section')}
        </Animated.Text>
        <Animated.Text style={styles.title} entering={enterUp(2)} accessibilityRole="header">
          {t('verify.title')}
        </Animated.Text>

        <Animated.View style={styles.card} entering={enterUp(3)}>
          <Text style={styles.body1}>
            {t('verify.bodyPrefix')}
            <Text style={styles.email}>{user?.email ?? ''}</Text>
            {t('verify.bodySuffix')}
          </Text>
          <Text style={styles.hint}>{t('verify.hint')}</Text>
          <Text style={styles.hint}>{t('verify.why')}</Text>

          {/* The sign-up send can fail; then "we sent a link" above is not
              true, and the user is owed that before they wait on it. Shown
              until a resend succeeds (the flag clears) or another message
              takes the slot. */}
          {error || (verificationSendFailed && resentAt == null) ? (
            <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="verify-error">
              {error ?? t('verify.initialSendFailed')}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.primary, checking && styles.busy]}
            onPress={onCheck}
            disabled={checking}
            accessibilityRole="button"
            accessibilityState={{ disabled: checking, busy: checking }}
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
            accessibilityState={{ disabled: resending || cooldownLeft > 0, busy: resending }}
            testID="verify-resend"
          >
            {/* An icon, not the `✓` dingbat it replaced (S18-17): the glyph
                renders as an emoji on some Android keyboards' fonts and reads
                as "check mark" in the middle of the sentence to a screen
                reader — the icon is decorative and hidden from it. */}
            <View style={styles.secondaryRow}>
              {!resending && cooldownLeft > 0 ? (
                <Ionicons
                  name="checkmark"
                  size={16}
                  color={colors.good}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
              <Text style={styles.secondaryText}>
                {resending
                  ? t('verify.resending')
                  : cooldownLeft > 0
                    ? t('verify.resentWait', { n: String(cooldownLeft) })
                    : t('verify.resend')}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghost}
            onPress={() => {
              signOut().catch((e) => captureError(e, { where: 'verifyEmail.signOut' }));
            }}
            accessibilityRole="button"
            testID="verify-signout"
          >
            <Text style={styles.ghostText}>{t('verify.signOut')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    fill: { flex: 1 },
    topBar: { flexDirection: 'row', paddingHorizontal: space.md },
    close: { minWidth: TARGET, minHeight: TARGET, justifyContent: 'center', alignItems: 'center' },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.xl },
    body: {
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
    secondaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    secondaryText: { color: colors.ink, fontSize: font.body, fontWeight: '700' },
    busy: { opacity: 0.7 },
    // A full tap target: it was ~34 pt tall (S21 #4).
    ghost: { alignItems: 'center', justifyContent: 'center', minHeight: TARGET },
    ghostText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  });
