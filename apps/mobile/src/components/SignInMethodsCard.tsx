import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinkError, type LinkableProvider, useAuth } from '@/lib/auth';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * "Sign-in methods" — connect Google / Apple / a password to the account you
 * are ALREADY signed into.
 *
 * Why this exists separately from the sign-in screen's collision handling:
 * that path only fires when the provider hands back the same email the account
 * already has. Apple's **Hide My Email** returns a `@privaterelay.appleid.com`
 * address, so it never collides — Firebase just creates a second, unrelated
 * account. Linking from inside a session is the only mechanism that covers it.
 */
export function SignInMethodsCard() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { user, linkedProviders, linkProvider, linkPassword, unlinkProvider, appleAvailable } =
    useAuth();
  const [busy, setBusy] = useState<LinkableProvider | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');

  if (!user) return null;

  const hasPassword = linkedProviders.includes('password');
  const isLast = linkedProviders.length <= 1;

  function reportLinkError(e: unknown) {
    const code = e instanceof LinkError ? e.code : 'failed';
    // A cancelled picker is a decision, not a failure — say nothing.
    if (code === 'cancelled') return;
    const key: I18nKey =
      code === 'credential-in-use'
        ? 'signInMethods.errInUse'
        : code === 'already-linked'
          ? 'signInMethods.errAlready'
          : code === 'requires-recent-login'
            ? 'signInMethods.errStale'
            : code === 'last-provider'
              ? 'signInMethods.errLast'
              : code === 'unavailable'
                ? 'signInMethods.errUnavailable'
                : 'signInMethods.errGeneric';
    Alert.alert(t('signInMethods.errTitle'), t(key));
  }

  async function connect(provider: Exclude<LinkableProvider, 'password'>) {
    setBusy(provider);
    try {
      await linkProvider(provider);
      haptics.success();
    } catch (e) {
      reportLinkError(e);
    } finally {
      setBusy(null);
    }
  }

  function confirmDisconnect(provider: LinkableProvider, label: string) {
    Alert.alert(
      t('signInMethods.disconnectTitle'),
      t('signInMethods.disconnectBody', { provider: label }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('signInMethods.disconnect'),
          style: 'destructive',
          onPress: async () => {
            setBusy(provider);
            try {
              await unlinkProvider(provider);
            } catch (e) {
              reportLinkError(e);
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  async function submitPassword() {
    setBusy('password');
    try {
      await linkPassword(password);
      setPassword('');
      setPasswordOpen(false);
      haptics.success();
    } catch (e) {
      reportLinkError(e);
    } finally {
      setBusy(null);
    }
  }

  function renderRow(
    provider: Exclude<LinkableProvider, 'password'>,
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
  ) {
    const connected = linkedProviders.includes(provider);
    const working = busy === provider;
    return (
      <View style={styles.row} key={provider}>
        <Ionicons name={icon} size={18} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowSub}>
            {connected ? t('signInMethods.connected') : t('signInMethods.notConnected')}
          </Text>
        </View>
        {working ? (
          <ActivityIndicator />
        ) : connected ? (
          <TouchableOpacity
            onPress={() => confirmDisconnect(provider, label)}
            disabled={isLast}
            testID={`signin-methods-disconnect-${provider}`}
          >
            <Text style={[styles.action, isLast && styles.actionDisabled]}>
              {t('signInMethods.disconnect')}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => connect(provider)}
            testID={`signin-methods-connect-${provider}`}
          >
            <Text style={styles.action}>{t('signInMethods.connect')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <>
      <Text style={styles.section}>{t('signInMethods.section')}</Text>
      <View style={styles.card}>
        {/* Says what linking DOES before offering it — connecting a second
            method is meaningless to most people until you say it's the same
            account either way. */}
        <Text style={styles.explainer}>{t('signInMethods.explainer')}</Text>

        {renderRow('google.com', 'Google', 'logo-google')}
        {/* Apple sign-in is iOS-only (and absent in Expo Go), so the row would
            be a dead button anywhere else. */}
        {appleAvailable && Platform.OS === 'ios'
          ? renderRow('apple.com', 'Apple', 'logo-apple')
          : null}

        <View style={styles.row}>
          <Ionicons name="mail-outline" size={18} style={styles.rowIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('signInMethods.password')}</Text>
            <Text style={styles.rowSub}>
              {hasPassword ? t('signInMethods.connected') : t('signInMethods.notConnected')}
            </Text>
          </View>
          {busy === 'password' ? (
            <ActivityIndicator />
          ) : hasPassword ? (
            <TouchableOpacity
              onPress={() => confirmDisconnect('password', t('signInMethods.password'))}
              disabled={isLast}
              testID="signin-methods-disconnect-password"
            >
              <Text style={[styles.action, isLast && styles.actionDisabled]}>
                {t('signInMethods.disconnect')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setPasswordOpen((v) => !v)}
              testID="signin-methods-add-password"
            >
              <Text style={styles.action}>{t('signInMethods.connect')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {passwordOpen && !hasPassword ? (
          <View style={styles.passwordBox}>
            <Text style={styles.rowSub}>
              {t('signInMethods.passwordHint', { email: user.email ?? '' })}
            </Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder={t('signInMethods.passwordPlaceholder')}
              testID="signin-methods-password-input"
            />
            <TouchableOpacity
              style={[styles.submit, password.length === 0 && styles.submitDisabled]}
              disabled={password.length === 0 || busy === 'password'}
              onPress={submitPassword}
              testID="signin-methods-password-submit"
            >
              <Text style={styles.submitText}>{t('signInMethods.savePassword')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isLast ? <Text style={styles.lastNote}>{t('signInMethods.lastNote')}</Text> : null}
      </View>
    </>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    section: {
      fontSize: font.small,
      color: colors.muted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: space.lg,
      marginBottom: space.xs,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      padding: space.lg,
      gap: space.md,
    },
    explainer: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.5 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    rowIcon: { color: colors.muted },
    rowLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    rowSub: { fontSize: font.small, color: colors.faint, marginTop: 2 },
    action: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
    actionDisabled: { color: colors.faint },
    passwordBox: { gap: space.sm },
    input: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      backgroundColor: colors.inputBg,
      color: colors.ink,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      fontSize: font.body,
    },
    submit: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.sm,
      alignItems: 'center',
    },
    submitDisabled: { opacity: 0.4 },
    submitText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
    lastNote: { fontSize: font.tiny, color: colors.faint, lineHeight: font.tiny * 1.5 },
  });
