import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { colors, font, radius, space } from '@/theme';

export default function SignIn() {
  const { signIn, signInWithGoogle, googleAvailable } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // Navigation handled by the root AuthGate once auth state flips.
    } catch (e: unknown) {
      setError(messageFor(e));
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (googleBusy) return;
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // AuthGate navigates once auth state flips.
    } catch (e: unknown) {
      setError(messageFor(e));
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <View style={styles.body}>
          <Text style={styles.brand}>Macro Log</Text>
          <Text style={styles.tagline}>Sign in to your account</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              testID="email"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.faint}
              secureTextEntry
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              testID="password"
              onSubmitEditing={onSubmit}
            />

            {error ? (
              <Text style={styles.error} testID="signin-error">
                {error}
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
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

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
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function messageFor(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Wrong email or password.';
  }
  if (code.includes('invalid-email')) return 'That email looks invalid.';
  if (code.includes('too-many-requests')) return 'Too many attempts — try again later.';
  if (code.includes('network')) return 'Network error — check your connection.';
  if (code === 'expo-go') return 'Google sign-in needs the installed app build (not Expo Go).';
  if (code === 'cancelled') return 'Google sign-in was cancelled.';
  if (code.includes('account-exists-with-different-credential')) {
    return 'That email already uses a different sign-in method.';
  }
  return 'Could not sign in. Please try again.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  brand: { fontSize: font.h1, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  tagline: {
    fontSize: font.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xs,
    marginBottom: space.xl,
  },
  form: { gap: space.md },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: font.small },
  button: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginTop: space.sm,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: font.h3, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { color: colors.faint, fontSize: font.small },
  googleButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  googleButtonText: { color: colors.ink, fontSize: font.h3, fontWeight: '700' },
});
