import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Touchable } from '@/components/Touchable';
import { useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { useAuth } from '@/lib/auth';
import {
  type OuraLinkOutcome,
  type OuraReturn,
  ouraOutcomeKey,
  redeemOuraReturn,
} from '@/lib/oura';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';

/**
 * `ignia://oura/callback?code=…&state=…` — where `ouraCallback` (the page at
 * the Oura-registered `https://ignia.fit/oura/callback`) sends the browser.
 *
 * Since 2026-10-15 the APP finishes the link: the code is redeemed through the
 * signed-in `completeOuraLink` callable, which refuses a state minted for a
 * different account. On iOS the auth session swallows this URL and
 * `connectOura` redeems it; on Android expo-router also routes the deep link
 * here, and `redeemOuraReturn` shares one call per state so the two paths
 * cannot spend the single-use nonce twice. This screen is also the only path
 * when the session was dismissed before the redirect landed.
 */
export default function OuraCallbackRoute() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const { user } = useAuth();
  const uid = user?.uid;
  const router = useRouter();
  const t = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [outcome, setOutcome] = useState<OuraLinkOutcome | null>(null);

  const code = typeof params.code === 'string' ? params.code : '';
  const state = typeof params.state === 'string' ? params.state : '';
  const error = typeof params.error === 'string' ? params.error : '';

  const leave = () => {
    const r = router as typeof router & { canGoBack?: () => boolean };
    if (typeof r.canGoBack === 'function' && r.canGoBack()) router.back();
    else router.replace('/connected-apps');
  };

  useEffect(() => {
    // The callable needs a real Firebase session, not the presumed one read
    // off disk — wait for it. The auth gate sends a signed-out user to
    // sign-in, so this never waits forever on a live screen.
    if (!uid) return;
    let alive = true;
    const ret: OuraReturn | null = error ? { error } : code && state ? { code, state } : null;
    void redeemOuraReturn(ret).then((o) => {
      if (alive) setOutcome(o);
    });
    return () => {
      alive = false;
    };
  }, [uid, code, state, error]);

  const messageKey = outcome === 'linked' ? 'oura.linked' : ouraOutcomeKey(outcome);

  useEffect(() => {
    if (messageKey) announce(t(messageKey));
  }, [messageKey, t]);

  return (
    <SafeAreaView style={styles.screen} testID="oura-callback">
      <View style={styles.body}>
        <Text style={styles.section}>{t('oura.title')}</Text>
        {outcome === null ? (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.message} testID="oura-callback-pending">{t('oura.linking')}</Text>
          </>
        ) : (
          <>
            <Text style={styles.message} testID="oura-callback-message">
              {messageKey ? t(messageKey) : t('oura.linkFailed')}
            </Text>
            <Touchable
              onPress={leave}
              style={styles.primary}
              accessibilityRole="button"
              testID="oura-callback-done"
            >
              <Text style={styles.primaryText}>{t('common.done')}</Text>
            </Touchable>
          </>
        )}
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
      gap: space.lg,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    section: {
      fontSize: font.small,
      color: colors.accent,
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: 1,
      fontFamily: type.heading,
    },
    message: { fontSize: font.body, color: colors.ink, textAlign: 'center', lineHeight: font.body * 1.5 },
    primary: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      minHeight: TARGET,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: space.md,
    },
    primaryText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
  });
