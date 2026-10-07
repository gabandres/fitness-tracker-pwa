import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { BrandMark } from '@/components/BrandMark';
import { GoogleIcon, MicrosoftIcon } from '@/components/BrandIcons';
import { WelcomeIntro } from '@/components/WelcomeIntro';
import { useAuth } from '@/lib/auth';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import { enterUp } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';

/** Mirrors the Identity Platform policy the checklist below enforces, so the
 *  iOS strong-password generator proposes one that the server will accept. */
const PASSWORD_RULES = 'minlength: 10; required: lower; required: upper; required: digit;';

/**
 * Two steps: the welcome intro, then the form.
 *
 * The intro is a STATE here rather than a route (Callbook's shape): it needs no
 * persisted "seen" flag, no change to `AuthGate`'s routing, and a returning
 * signed-out user meeting it again is not a defect. Its CTA lands the form in
 * sign-UP mode — a brand-new install is the one case where that default is
 * right — and the link under it lands in sign-in mode for everyone else.
 */
/** The form's scroller: plain on iOS (see the comment where it is used),
 *  keyboard-aware on Android. */
const FormScroll = Platform.OS === 'android' ? KeyboardAwareScrollView : ScrollView;

export default function SignIn() {
  const t = useT();
  const locale = useLocale();
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
    pendingLink,
    clearPendingLink,
  } = useAuth();
  const [step, setStep] = useState<'intro' | 'form'>('intro');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [msBusy, setMsBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the error came from decides where it renders: a Google/Apple failure
  // under the provider buttons that raised it, a password one by the submit
  // button. One slot at the bottom left a provider error below the fold once
  // the providers moved to the top (S21 #6).
  const [errorFrom, setErrorFrom] = useState<'password' | 'federated'>('password');
  const [notice, setNotice] = useState<string | null>(null);

  // MUST mirror the Identity Platform password policy exactly (ENFORCE, min 10,
  // requires upper + lower + numeric). It previously checked only "a letter",
  // so `password12` lit every checkmark green and was then rejected server-side
  // — the silent sign-up failure testers hit. Verify with:
  //   GET identitytoolkit.googleapis.com/admin/v2/projects/{project}/config
  const reqLen = password.length >= 10;
  const reqUpper = /[A-Z]/.test(password);
  const reqLower = /[a-z]/.test(password);
  const reqNum = /\d/.test(password);
  const strongPassword = reqLen && reqUpper && reqLower && reqNum;

  async function onSubmit() {
    if (busy) return;
    setErrorFrom('password');
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
        await signUp(email, password, `${firstName.trim()} ${lastName.trim()}`.trim(), locale);
      } else {
        await signIn(email, password);
      }
      // Navigation handled by the root AuthGate once auth state flips.
    } catch (e: unknown) {
      setError(errorMessage(e, t, 'password'));
      setBusy(false);
    }
  }

  async function onReset() {
    // Guarded like the federated buttons: repeated taps sent several reset
    // emails and quickly hit `resource-exhausted`.
    if (resetBusy) return;
    setErrorFrom('password');
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError(t('signIn.errInvalidEmail'));
      return;
    }
    setResetBusy(true);
    try {
      await resetPassword(email, locale);
      setNotice(t('signIn.resetSent'));
    } catch (e: unknown) {
      setError(errorMessage(e, t, 'password'));
    } finally {
      setResetBusy(false);
    }
  }

  function changeMode(next: 'signin' | 'signup') {
    if (next === mode) return;
    setError(null);
    setNotice(null);
    // The prompt says "sign in below and we'll link it" — meaningless once the
    // user has switched to Sign up, and it used to outlive the mode switch and
    // go on hiding every error raised there.
    clearPendingLink();
    setMode(next);
  }

  function failFederated(e: unknown): void {
    setErrorFrom('federated');
    setError(errorMessage(e, t, 'federated'));
  }

  async function onGoogle() {
    if (googleBusy) return;
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // AuthGate navigates once auth state flips.
    } catch (e: unknown) {
      if (!isPendingLinkCollision(e)) failFederated(e);
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
      if (!isPendingLinkCollision(e)) failFederated(e);
    } finally {
      setMsBusy(false);
    }
  }

  async function onApple() {
    if (appleBusy) return;
    setError(null);
    setAppleBusy(true);
    try {
      await signInWithApple();
      // AuthGate navigates once auth state flips.
    } catch (e: unknown) {
      if (!isPendingLinkCollision(e)) failFederated(e);
    } finally {
      setAppleBusy(false);
    }
  }

  if (step === 'intro') {
    return (
      <WelcomeIntro
        onContinue={(next) => {
          setMode(next);
          setStep('form');
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* Scrolls rather than clips: on a tall-content pass (sign-up shows the
          name row + password checklist) a centered non-scrolling flex box cut
          the Google button off the bottom on iPad — App Review 4 (Design),
          submission 5ba1c7f5. `automaticallyAdjustKeyboardInsets` replaces the
          old KeyboardAvoidingView (see the mobile-modal keyboard convention).
          Taps on empty space still dismiss the keyboard via keyboardShouldPersistTaps.
          `automaticallyAdjustKeyboardInsets` is iOS-only, and under
          <KeyboardProvider> Android no longer resizes the window for the IME —
          so on Android the email and password fields sat behind the keyboard
          (emulator, 2026-10-06, once the providers moved above the form). There
          the ScrollView is keyboard-controller's KeyboardAwareScrollView, which
          scrolls the focused field above the keyboard. */}
      <FormScroll
        bottomOffset={space.lg}
        style={styles.fill}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.body}>
          <Animated.View style={styles.hero} entering={enterUp(0)}>
            <BrandMark />
          </Animated.View>
          <Animated.Text style={styles.brand} entering={enterUp(1)} accessibilityRole="header">
            Ignia
          </Animated.Text>
          <Animated.Text style={styles.tagline} entering={enterUp(2)}>
            {t(mode === 'signup' ? 'signIn.taglineSignup' : 'signIn.tagline')}
          </Animated.Text>

          <Animated.View style={styles.form} entering={enterUp(3)}>
            <ModeSwitch mode={mode} onChange={changeMode} styles={styles} colors={colors} t={t} />

            {/* Providers FIRST, in both modes (S21 #6). On sign-up they used
                to come after four fields and the password checklist — below
                the fold on a 360×720 phone, so the one-tap path was the one
                nobody saw. Platform norm: Apple first on iOS (it only renders
                there), then Google, then "or" and the email form. */}
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  mode === 'signup'
                    ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                    : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                }
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
              accessibilityState={{ disabled: googleBusy, busy: googleBusy }}
              accessibilityLabel={t('signIn.google')}
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
                accessibilityState={{ disabled: msBusy, busy: msBusy }}
                accessibilityLabel={t('signIn.microsoft')}
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

            {error && errorFrom === 'federated' ? <ErrorText text={error} styles={styles} /> : null}

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('common.or')}</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Collision prompt. The provider handed back an email that is
                already a password account, so the credential is parked in the
                auth context — signing in below attaches it automatically. This
                has to outrank the raw error text, which only says "that email
                already uses a different sign-in method" and leaves the user
                with nowhere to go. It sits ABOVE the fields it points at
                ("sign in below") since the providers moved to the top. */}
            {pendingLink ? (
              <Text style={styles.notice} testID="signin-pending-link">
                {t('signIn.linkPrompt', { email: pendingLink.email })}
              </Text>
            ) : null}

            {mode === 'signup' ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.nameRow}>
                <TextInput
                  style={[styles.input, styles.nameInput]}
                  placeholder={t('signIn.firstName')}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="words"
                  textContentType="givenName"
                  autoComplete="given-name"
                  value={firstName}
                  onChangeText={setFirstName}
                  accessibilityLabel={t('signIn.firstName')}
                  testID="firstName"
                />
                <TextInput
                  style={[styles.input, styles.nameInput]}
                  placeholder={t('signIn.lastName')}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="words"
                  textContentType="familyName"
                  autoComplete="family-name"
                  value={lastName}
                  onChangeText={setLastName}
                  accessibilityLabel={t('signIn.lastName')}
                  testID="lastName"
                />
              </Animated.View>
            ) : null}

            {/* `username` (iOS) is what pairs this field with the password
                below for Keychain save/fill — the email IS the account name;
                `email` is the Android autofill hint. */}
            <TextInput
              style={styles.input}
              placeholder={t('signIn.email')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel={t('signIn.email')}
              testID="email"
            />

            <View style={styles.pwWrap}>
              {/* Sign-up offers a NEW password (iOS strong-password
                  suggestion, Android "new password" autofill); sign-in asks
                  for the saved one. One `password` type for both meant iOS
                  offered to fill an old password into account creation. */}
              <TextInput
                style={[styles.input, styles.pwInput]}
                placeholder={t('signIn.password')}
                placeholderTextColor={colors.faint}
                secureTextEntry={!showPassword}
                textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                passwordRules={mode === 'signup' ? PASSWORD_RULES : undefined}
                value={password}
                onChangeText={setPassword}
                accessibilityLabel={t('signIn.password')}
                testID="password"
                onSubmitEditing={onSubmit}
              />
              <TouchableOpacity
                style={styles.eye}
                onPress={() => setShowPassword((s) => !s)}
                hitSlop={8}
                testID="toggle-password"
                accessibilityRole="button"
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
                <ReqRow met={reqUpper} label={t('signIn.reqUpper')} styles={styles} colors={colors} />
                <ReqRow met={reqLower} label={t('signIn.reqLower')} styles={styles} colors={colors} />
                <ReqRow met={reqNum} label={t('signIn.reqNum')} styles={styles} colors={colors} />
              </Animated.View>
            ) : null}

            {/* Its OWN slot, not the `else` of the link prompt. As a ternary,
                one collision silenced the error line for the rest of the
                session: the user followed the prompt, typed the wrong
                password, and nothing changed on screen — and the same went for
                every local validation, so a blank name on Sign up looked like
                an inert button. Found 2026-09-22. */}
            {error && errorFrom === 'password' ? <ErrorText text={error} styles={styles} /> : null}
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
              accessibilityState={{ disabled: busy, busy }}
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
              <TouchableOpacity
                onPress={onReset}
                style={styles.forgot}
                disabled={resetBusy}
                testID="signin-forgot"
                accessibilityRole="button"
                accessibilityState={{ disabled: resetBusy, busy: resetBusy }}
              >
                <Text style={styles.forgotText}>{t('signIn.forgot')}</Text>
              </TouchableOpacity>
            ) : null}

          </Animated.View>
        </View>
      </FormScroll>
    </SafeAreaView>
  );
}

/** Which button the failure came from — an `invalid-credential` means "wrong
 *  password" only for a password attempt; from a federated flow it's a token
 *  or config problem, and "check your password" sends the user nowhere. */
type ErrSource = 'password' | 'federated';

/**
 * User-facing message for a sign-in failure, with the raw native code appended
 * when we could not classify it. There is no crash reporter here, so that tail
 * is the only way an unclassified failure on a tester's device ever reaches us.
 */
/**
 * The provider handed back an email that already belongs to another method.
 * `capturePendingLink` has parked the credential and the screen renders the
 * link prompt, which says what to do; the raw message only states that the
 * email uses a different sign-in method and leaves the user nowhere. So this
 * one code is suppressed — and ONLY this one. Every other federated failure
 * still reaches the error slot.
 */
function isPendingLinkCollision(e: unknown): boolean {
  return String((e as { code?: string })?.code ?? '').includes(
    'account-exists-with-different-credential',
  );
}

function errorMessage(e: unknown, t: TFn, source: ErrSource = 'password'): string {
  const base = t(errorKey(e, source));
  const detail = (e as { detail?: string })?.detail;
  return detail ? `${base} (${detail})` : base;
}

function errorKey(e: unknown, source: ErrSource = 'password'): I18nKey {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'use-google') return 'signIn.errUseGoogle';
  if (code === 'use-apple') return 'signIn.errUseApple';
  if (code.includes('account-exists-with-different-credential')) return 'signIn.errDiffMethod';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return source === 'password' ? 'signIn.errWrong' : 'signIn.errGeneric';
  }
  if (code.includes('invalid-email')) return 'signIn.errInvalidEmail';
  // `sendPasswordReset` (our callable) rejects a malformed address with
  // invalid-argument and a tripped rate limit with resource-exhausted.
  if (code.includes('invalid-argument')) return 'signIn.errInvalidEmail';
  if (code.includes('too-many-requests') || code.includes('resource-exhausted')) {
    return 'signIn.errTooMany';
  }
  if (code.includes('email-already-in-use')) return 'signIn.errEmailInUse';
  if (code.includes('weak-password') || code.includes('password-does-not-meet')) {
    return 'signIn.errWeakPassword';
  }
  if (code.includes('network')) return 'signIn.errNetwork';
  if (code === 'expo-go') return 'signIn.errExpoGo';
  if (code === 'cancelled') return 'signIn.errCancelled';
  if (code === 'play-services') return 'signIn.errPlayServices';
  if (code === 'browser') return 'signIn.errBrowser';
  return 'signIn.errGeneric';
}

type Styles = ReturnType<typeof createStyles>;

/** The error line. Selectable so a tester can long-press → copy the native
 *  code tail and paste it to us; without a crash reporter that copy is the
 *  whole diagnostic channel. */
function ErrorText({ text, styles }: { text: string; styles: Styles }) {
  return (
    <Text
      selectable
      style={styles.error}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="signin-error"
    >
      {text}
    </Text>
  );
}

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
    // Tab semantics: a screen reader says "Sign up, tab, 2 of 2, selected"
    // instead of reading two loose words (S21 #4).
    <View style={styles.switchTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {w > 0 ? <Animated.View style={[styles.switchHl, { width: seg }, highlight]} /> : null}
      <Pressable
        style={styles.switchSeg}
        onPress={() => onChange('signin')}
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === 'signin' }}
        testID="switch-signin"
      >
        <Text style={[styles.switchText, mode === 'signin' && styles.switchTextOn]}>
          {t('signIn.tabSignIn')}
        </Text>
      </Pressable>
      <Pressable
        style={styles.switchSeg}
        onPress={() => onChange('signup')}
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === 'signup' }}
        testID="switch-signup"
      >
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
  // flexGrow (not flex) keeps the form vertically centred when it fits and lets
  // it scroll when it doesn't — the iPad clipping fix.
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.xl },
  // maxWidth stops the fields spanning a full iPad width.
  body: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space.xl },
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
    // `lineStrong` (3.7:1 light / 3.3:1 dark on inputBg), not `line` (~1.2:1):
    // the edge is what identifies the field (WCAG 1.4.11).
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    // A constrained height (not paddingVertical): iOS UITextView only centers
    // text deterministically when the height is constrained — with auto-height
    // the placeholder mis-aligns on first render and "fixes" itself on reload.
    // `minHeight`, not `height`, since 2026-09-28 (S18-7): a fixed 56 clipped
    // the field at the larger Dynamic Type sizes. At default type the box is
    // still exactly 56, so the centring behaviour above is unchanged.
    minHeight: 56,
    fontSize: font.body,
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: font.small },
  notice: { color: colors.good, fontSize: font.small },
  forgot: { alignSelf: 'center', minHeight: TARGET, justifyContent: 'center', paddingHorizontal: space.md },
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
  switchSeg: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: TARGET, zIndex: 1 },
  switchText: { fontSize: font.small, fontWeight: '700', color: colors.muted },
  switchTextOn: { color: colors.onInk },
  // Name row (sign-up)
  nameRow: { flexDirection: 'row', gap: space.md },
  nameInput: { flex: 1 },
  // Password field with show/hide eye
  pwWrap: { position: 'relative', justifyContent: 'center' },
  pwInput: { paddingRight: 48 },
  eye: { position: 'absolute', right: 0, height: '100%', minWidth: TARGET, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
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
