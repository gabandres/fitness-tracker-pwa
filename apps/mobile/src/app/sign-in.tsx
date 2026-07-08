import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/BrandMark';
import { GoogleIcon, MicrosoftIcon } from '@/components/BrandIcons';
import { useAuth } from '@/lib/auth';
import { type I18nKey, type TFn, useT } from '@/i18n';
import { enterUp } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

export default function SignIn() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  const {
    signIn,
    signUp,
    resetPassword,
    signInWithGoogle,
    googleAvailable,
    signInWithApple,
    appleAvailable,
    signInWithMicrosoft,
    microsoftAvailable,
  } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [msBusy, setMsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mirrors the PWA sign-up rule (Firebase also enforces the project policy
  // server-side): ≥10 chars with at least one letter and one digit. Broken out
  // so the sign-up checklist can show each requirement's state live.
  const reqLen = password.length >= 10;
  const reqLetter = /[A-Za-z]/.test(password);
  const reqNum = /\d/.test(password);
  const strongPassword = reqLen && reqLetter && reqNum;

  async function onSubmit() {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (mode === 'signup') {
      if (!firstName.trim()) {
        setError(t('signIn.errName'));
        return;
      }
      if (!strongPassword) {
        setError(t('signIn.passwordHint'));
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signUp(email, password, `${firstName.trim()} ${lastName.trim()}`.trim());
      } else {
        await signIn(email, password);
      }
      // Navigation handled by the root AuthGate once auth state flips.
    } catch (e: unknown) {
      setError(t(errorKey(e)));
      setBusy(false);
    }
  }

  async function onReset() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError(t('signIn.errInvalidEmail'));
      return;
    }
    try {
      await resetPassword(email);
      setNotice(t('signIn.resetSent'));
    } catch (e: unknown) {
      setError(t(errorKey(e)));
    }
  }

  function changeMode(next: 'signin' | 'signup') {
    if (next === mode) return;
    setError(null);
    setNotice(null);
    setMode(next);
  }

  async function onGoogle() {
    if (googleBusy) return;
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // AuthGate navigates once auth state flips.
    } catch (e: unknown) {
      setError(t(errorKey(e)));
    } finally {
      setGoogleBusy(false);
    }
  }

  async function onMicrosoft() {
    if (msBusy) return;
    setError(null);
    setMsBusy(true);
    try {
      await signInWithMicrosoft();
      // AuthGate navigates once auth state flips.
    } catch (e: unknown) {
      setError(t(errorKey(e)));
    } finally {
      setMsBusy(false);
    }
  }

  async function onApple() {
    setError(null);
    try {
      await signInWithApple();
      // AuthGate navigates once auth state flips.
    } catch (e: unknown) {
      setError(t(errorKey(e)));
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        {/* Tap anywhere off a field to dismiss the keyboard. */}
        <Pressable style={styles.fill} onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.body}>
          <Animated.View style={styles.hero} entering={enterUp(0)}>
            <BrandMark />
          </Animated.View>
          <Animated.Text style={styles.brand} entering={enterUp(1)}>
            Ignia
          </Animated.Text>
          <Animated.Text style={styles.tagline} entering={enterUp(2)}>
            {t(mode === 'signup' ? 'signIn.taglineSignup' : 'signIn.tagline')}
          </Animated.Text>

          <Animated.View style={styles.form} entering={enterUp(3)}>
            <ModeSwitch mode={mode} onChange={changeMode} styles={styles} colors={colors} t={t} />

            {mode === 'signup' ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.nameRow}>
                <TextInput
                  style={[styles.input, styles.nameInput]}
                  placeholder={t('signIn.firstName')}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="words"
                  textContentType="givenName"
                  value={firstName}
                  onChangeText={setFirstName}
                  testID="firstName"
                />
                <TextInput
                  style={[styles.input, styles.nameInput]}
                  placeholder={t('signIn.lastName')}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="words"
                  textContentType="familyName"
                  value={lastName}
                  onChangeText={setLastName}
                  testID="lastName"
                />
              </Animated.View>
            ) : null}

            <TextInput
              style={styles.input}
              placeholder={t('signIn.email')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              testID="email"
            />

            <View style={styles.pwWrap}>
              <TextInput
                style={[styles.input, styles.pwInput]}
                placeholder={t('signIn.password')}
                placeholderTextColor={colors.faint}
                secureTextEntry={!showPassword}
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                testID="password"
                onSubmitEditing={onSubmit}
              />
              <TouchableOpacity
                style={styles.eye}
                onPress={() => setShowPassword((s) => !s)}
                hitSlop={8}
                testID="toggle-password"
                accessibilityLabel={t(showPassword ? 'signIn.hidePassword' : 'signIn.showPassword')}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.muted}
                />
              </TouchableOpacity>
            </View>

            {mode === 'signup' ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.checklist}>
                <ReqRow met={reqLen} label={t('signIn.reqLen')} styles={styles} colors={colors} />
                <ReqRow met={reqLetter} label={t('signIn.reqLetter')} styles={styles} colors={colors} />
                <ReqRow met={reqNum} label={t('signIn.reqNum')} styles={styles} colors={colors} />
              </Animated.View>
            ) : null}

            {error ? (
              <Text style={styles.error} testID="signin-error">
                {error}
              </Text>
            ) : null}
            {notice ? (
              <Text style={styles.notice} testID="signin-notice">
                {notice}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.button, busy && styles.buttonBusy]}
              onPress={onSubmit}
              disabled={busy}
              testID="signin-submit"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.onInk} />
              ) : (
                <Text style={styles.buttonText}>
                  {t(mode === 'signup' ? 'signIn.createAccount' : 'signIn.submit')}
                </Text>
              )}
            </TouchableOpacity>

            {mode === 'signin' ? (
              <TouchableOpacity onPress={onReset} style={styles.forgot} testID="signin-forgot">
                <Text style={styles.forgotText}>{t('signIn.forgot')}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('common.or')}</Text>
              <View style={styles.dividerLine} />
            </View>

            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={radius.md}
                style={styles.appleButton}
                onPress={onApple}
              />
            ) : null}

            <TouchableOpacity
              style={[styles.googleButton, (googleBusy || !googleAvailable) && styles.buttonBusy]}
              onPress={onGoogle}
              disabled={googleBusy}
              testID="signin-google"
              accessibilityRole="button"
            >
              {googleBusy ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <>
                  <GoogleIcon size={18} />
                  <Text style={styles.googleButtonText}>{t('signIn.google')}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Microsoft OFF for v1 (Firebase JS SDK can't validate an external
                microsoft.com credential) — gated by MICROSOFT_ENABLED in auth. */}
            {microsoftAvailable ? (
              <TouchableOpacity
                style={[styles.googleButton, msBusy && styles.buttonBusy]}
                onPress={onMicrosoft}
                disabled={msBusy}
                testID="signin-microsoft"
                accessibilityRole="button"
              >
                {msBusy ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <>
                    <MicrosoftIcon size={16} />
                    <Text style={styles.googleButtonText}>{t('signIn.microsoft')}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

          </Animated.View>
        </View>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorKey(e: unknown): I18nKey {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'use-google') return 'signIn.errUseGoogle';
  if (code === 'use-apple') return 'signIn.errUseApple';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'signIn.errWrong';
  }
  if (code.includes('invalid-email')) return 'signIn.errInvalidEmail';
  if (code.includes('too-many-requests')) return 'signIn.errTooMany';
  if (code.includes('email-already-in-use')) return 'signIn.errEmailInUse';
  if (code.includes('weak-password') || code.includes('password-does-not-meet')) {
    return 'signIn.errWeakPassword';
  }
  if (code.includes('network')) return 'signIn.errNetwork';
  if (code === 'expo-go') return 'signIn.errExpoGo';
  if (code === 'cancelled') return 'signIn.errCancelled';
  if (code.includes('account-exists-with-different-credential')) return 'signIn.errDiffMethod';
  return 'signIn.errGeneric';
}

type Styles = ReturnType<typeof createStyles>;

/** Segmented Sign in / Sign up control with a sliding ink highlight. */
function ModeSwitch({
  mode,
  onChange,
  styles,
  t,
}: {
  mode: 'signin' | 'signup';
  onChange: (m: 'signin' | 'signup') => void;
  styles: Styles;
  colors: Theme['colors'];
  t: TFn;
}) {
  const [w, setW] = useState(0);
  const seg = (w - 8) / 2; // track padding is 4 each side
  const x = useSharedValue(mode === 'signup' ? 1 : 0);
  useEffect(() => {
    x.value = withTiming(mode === 'signup' ? 1 : 0, { duration: 220 });
  }, [mode, x]);
  const highlight = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * seg }] }));
  return (
    <View style={styles.switchTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? <Animated.View style={[styles.switchHl, { width: seg }, highlight]} /> : null}
      <Pressable style={styles.switchSeg} onPress={() => onChange('signin')} testID="switch-signin">
        <Text style={[styles.switchText, mode === 'signin' && styles.switchTextOn]}>
          {t('signIn.tabSignIn')}
        </Text>
      </Pressable>
      <Pressable style={styles.switchSeg} onPress={() => onChange('signup')} testID="switch-signup">
        <Text style={[styles.switchText, mode === 'signup' && styles.switchTextOn]}>
          {t('signIn.tabSignUp')}
        </Text>
      </Pressable>
    </View>
  );
}

/** One live password-requirement row (checkmark fills as the rule is met). */
function ReqRow({ met, label, styles, colors }: { met: boolean; label: string; styles: Styles; colors: Theme['colors'] }) {
  return (
    <View style={styles.reqRow}>
      <Ionicons name={met ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={met ? colors.good : colors.faint} />
      <Text style={[styles.reqText, met && styles.reqTextMet]}>{label}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  hero: { alignItems: 'center', marginBottom: space.lg },
  brand: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, textAlign: 'center' },
  tagline: {
    fontSize: font.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xs,
    marginBottom: space.xl,
  },
  form: { gap: space.md },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    // Fixed height (not paddingVertical): iOS UITextView only centers text
    // deterministically when the height is constrained — with auto-height the
    // placeholder mis-aligns on first render and "fixes" itself on reload.
    height: 56,
    fontSize: font.body,
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: font.small },
  notice: { color: colors.good, fontSize: font.small },
  forgot: { alignSelf: 'center', paddingVertical: space.xs },
  forgotText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  // Segmented Sign in / Sign up switch
  switchTrack: {
    flexDirection: 'row',
    backgroundColor: colors.inputBg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    marginBottom: space.xs,
  },
  switchHl: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: radius.pill, backgroundColor: colors.ink },
  switchSeg: { flex: 1, alignItems: 'center', paddingVertical: space.sm, zIndex: 1 },
  switchText: { fontSize: font.small, fontWeight: '700', color: colors.muted },
  switchTextOn: { color: colors.onInk },
  // Name row (sign-up)
  nameRow: { flexDirection: 'row', gap: space.md },
  nameInput: { flex: 1 },
  // Password field with show/hide eye
  pwWrap: { position: 'relative', justifyContent: 'center' },
  pwInput: { paddingRight: 48 },
  eye: { position: 'absolute', right: 0, height: '100%', paddingHorizontal: space.md, justifyContent: 'center' },
  // Live password checklist (sign-up)
  checklist: { gap: space.xs, marginTop: -space.xs, paddingHorizontal: space.xs },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reqText: { fontSize: font.small, color: colors.muted },
  reqTextMet: { color: colors.ink },
  button: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginTop: space.sm,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { color: colors.faint, fontSize: font.small },
  appleButton: { height: 52, width: '100%' },
  googleButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.lg,
  },
  googleButtonText: { color: colors.ink, fontSize: font.h3, fontWeight: '700' },
});
