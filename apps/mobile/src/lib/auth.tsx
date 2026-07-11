import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
// NATIVE module: `@react-native-google-signin/google-signin` registers the
// `RNGoogleSignin` TurboModule, which does NOT exist in Expo Go. A static
// top-level import evaluates that binding at bundle load and hard-crashes Expo
// Go (`Invariant Violation: RNGoogleSignin could not be found`) before any
// isExpoGo guard runs. So import TYPES only (fully erased at build — no runtime
// load) and require the runtime module lazily, exclusively inside the
// dev-build-only code paths below (`loadGoogleSignin`).
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');
let googleSigninModule: GoogleSigninModule | null = null;
function loadGoogleSignin(): GoogleSigninModule {
  // Callers MUST gate on `!isExpoGo` first — in Expo Go this require throws.
  if (!googleSigninModule) {
    googleSigninModule = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
  }
  return googleSigninModule;
}
import { exchangeCodeAsync, makeRedirectUri, useAuthRequest } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  OAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth';
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Profile } from '@macrolog/core';
import { auth } from './firebase';
import { ensureProfile, subscribeProfile } from './ledger';

// Required for the web-OAuth popup/redirect to resolve when the app
// regains focus after the Google consent screen.
WebBrowser.maybeCompleteAuthSession();

/** A coded error so the sign-in screen can show a specific message. */
export class GoogleSignInError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Coded error for the Apple flow, same contract as GoogleSignInError. */
export class AppleSignInError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Coded error for the Microsoft flow, same contract as GoogleSignInError. */
export class MicrosoftSignInError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Coded hint the sign-in screen maps to "use <provider> instead". Thrown when
 * an email/password attempt collides with an account that is actually owned by
 * a federated provider (Google/Apple) and has no password credential — the
 * exact dead-end a Google-only user hits (signup → email-already-in-use,
 * signin → invalid-credential). Mirrors the web `pendingLink` intent, minus the
 * auto-link step: pointing the user at their real provider resolves the loop.
 */
export class AuthHintError extends Error {
  constructor(readonly code: 'use-google' | 'use-apple') {
    super(code);
  }
}

/**
 * Probes which provider owns `email` after a password collision so the UI can
 * point the user at the right button.
 *
 * IMPORTANT: Firebase email-enumeration protection (on by default for newer
 * projects) makes `fetchSignInMethodsForEmail` return an EMPTY array regardless
 * of the truth, so a `null` result is expected and common — callers MUST fall
 * back to a generic "use the buttons below" message, never treat null as
 * "no such account".
 */
async function providerHintForEmail(email: string): Promise<'use-google' | 'use-apple' | null> {
  try {
    const methods = await fetchSignInMethodsForEmail(auth, email.trim());
    if (methods.includes('google.com')) return 'use-google';
    if (methods.includes('apple.com')) return 'use-apple';
  } catch {
    // Enumeration protection / offline — fall back to generic guidance.
  }
  return null;
}

// Microsoft (Azure AD v2.0) endpoints. `common` = the app registration is
// multi-tenant + personal accounts (mirrors the PWA's Firebase Microsoft
// provider, client 80eaaf29…). The token endpoint returns the id_token
// Firebase's OAuthProvider('microsoft.com') credential needs.
const MS_TENANT = 'common';
const msDiscovery = {
  authorizationEndpoint: `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`,
};
const microsoftAuth = (Constants.expoConfig?.extra as { microsoftAuth?: { clientId?: string } } | undefined)
  ?.microsoftAuth;
const msClientId = microsoftAuth?.clientId;
const hasRealMsClientId =
  typeof msClientId === 'string' && msClientId.length > 0 && !msClientId.startsWith('REPLACE_WITH');

// Public OAuth client IDs (safe to commit — ADR-0002). Filled per build via
// app.json → expo.extra.googleAuth. Still placeholders until a dev build is
// wired; see GOOGLE_SIGNIN.md.
const googleAuth = (Constants.expoConfig?.extra as { googleAuth?: GoogleAuthConfig } | undefined)
  ?.googleAuth;
interface GoogleAuthConfig {
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
}

// Expo Go cannot complete a native OAuth redirect (no stable scheme, the
// auth proxy is gone), and placeholder IDs aren't real clients. Both gate
// the button off so it degrades to a clear message instead of a dead popup.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const hasRealClientId = Object.values(googleAuth ?? {}).some(
  (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('REPLACE_WITH'),
);

// Sign in with Apple is iOS-only and needs the native module + entitlement,
// which stock Expo Go lacks — gated like Google. Apple guideline 4.8 REQUIRES
// this because the app also offers Google sign-in.
const appleSignInAvailable = Platform.OS === 'ios' && !isExpoGo;

interface AuthState {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
  /** True until the first onAuthStateChanged fires (avoids a sign-in flash). */
  initializing: boolean;
  /** True when the user's custom claims grant Pro (Stripe `stripeRole:paid`
   *  or any future entitlement source). */
  isPro: boolean;
  /** The user's profile doc, or null when signed out / not yet loaded. */
  profile: Profile | null;
  /** True until the first profile snapshot arrives — gates the onboarding
   *  redirect so we don't flash it before the doc loads. */
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Creates a new email/password account and signs in. Sets the Firebase Auth
   *  displayName when provided, and sends a (best-effort) verification email.
   *  Firebase enforces the project password policy. */
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  /** Sends a password-reset email to `email`. */
  resetPassword: (email: string) => Promise<void>;
  /** Launches the Google OAuth flow and signs in to Firebase with the
   *  returned id token. Throws GoogleSignInError on cancel/unavailable. */
  signInWithGoogle: () => Promise<void>;
  /** False in Expo Go or until the OAuth request is ready — drives the
   *  button's enabled state. */
  googleAvailable: boolean;
  /** Launches Sign in with Apple and signs in to Firebase with the returned
   *  identity token. Throws AppleSignInError on cancel/unavailable. */
  signInWithApple: () => Promise<void>;
  /** iOS-only and unavailable in Expo Go — drives whether the Apple button
   *  renders at all. */
  appleAvailable: boolean;
  /** Launches the Microsoft (Azure AD) OAuth flow and signs in to Firebase
   *  with the returned id token. Throws MicrosoftSignInError on cancel/etc. */
  signInWithMicrosoft: () => Promise<void>;
  /** False in Expo Go or until the OAuth request is ready — drives the
   *  Microsoft button's enabled state. */
  microsoftAvailable: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isPro, setIsPro] = useState(false);
  // Profile is keyed by uid so "loaded for the current user" is derivable
  // synchronously — no effect-set flag that lags a render behind `user` and
  // briefly makes a signed-in user look un-onboarded.
  const [profileEntry, setProfileEntry] = useState<{ uid: string; profile: Profile | null } | null>(
    null,
  );

  // Native Google Sign-In (Play Services on Android / the Google SDK on iOS).
  // No browser, no redirect, no custom-URI-scheme — configure once, then
  // signIn() hands back the id_token directly. This replaces the old
  // expo-auth-session browser flow, whose redirect back into the app failed on
  // device (the "invalid_request / doesn't return to Today" bug). Guarded off
  // in Expo Go (native module absent) and until real client IDs are present.
  useEffect(() => {
    if (isExpoGo || !hasRealClientId) return;
    const { GoogleSignin } = loadGoogleSignin();
    GoogleSignin.configure({
      // The WEB client ID is what mints the id_token Firebase validates (it's
      // the token's audience) on BOTH platforms; iosClientId targets the iOS
      // OAuth client. Android uses the SHA-1-matched client automatically.
      webClientId: googleAuth?.webClientId,
      iosClientId: googleAuth?.iosClientId,
    });
  }, []);

  const googleAvailable = !isExpoGo && hasRealClientId;

  // Microsoft (generic OIDC, unlike Apple): the IdP echoes the nonce UNHASHED
  // into the id_token, and Firebase compares its `rawNonce` to that claim
  // directly (no SHA-256). So use ONE raw value for both the auth request and
  // the credential — hashing it Apple-style made them mismatch → invalid_credential.
  const [msNonce, setMsNonce] = useState<string | null>(null);
  useEffect(() => {
    setMsNonce(`${Crypto.randomUUID()}${Crypto.randomUUID()}`);
  }, []);

  // Microsoft OAuth request (generic AuthSession — no dedicated provider). The
  // redirect must be registered on the Azure app under "Mobile and desktop
  // applications"; see MICROSOFT_SIGNIN.md. Gated off in Expo Go like Google.
  const msRedirectUri = makeRedirectUri({ scheme: 'ignia', path: 'auth' });
  const [msRequest, , msPromptAsync] = useAuthRequest(
    {
      clientId: msClientId ?? '',
      scopes: ['openid', 'profile', 'email'],
      redirectUri: msRedirectUri,
      extraParams: { prompt: 'select_account', ...(msNonce ? { nonce: msNonce } : {}) },
    },
    msDiscovery,
  );
  // Microsoft is OFF for v1. The Firebase JS SDK can't validate an external
  // microsoft.com credential (brokered-OAuth: popup/redirect only), and the
  // only workaround — a custom OIDC provider (`oidc.microsoft`) — requires a
  // paid Identity Platform (GCIP) upgrade. Code + the `oidc.microsoft` wiring
  // are kept; to revisit: enable GCIP, recreate the OIDC provider, flip this true.
  const MICROSOFT_ENABLED = false;
  const microsoftAvailable =
    MICROSOFT_ENABLED && !isExpoGo && hasRealMsClientId && !!msRequest && !!msNonce;

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Create users/{uid} on first sign-in if it doesn't exist yet, so a
        // mobile-first new user has a profile doc for onboarding to update.
        // Best-effort: a failure here surfaces later as a save error, not a
        // dead sign-in. Runs before the profile subscription resolves.
        try {
          await ensureProfile(u.uid);
        } catch (e) {
          console.warn('ensureProfile failed', e);
        }
        try {
          const token = await u.getIdTokenResult();
          // Mirrors the PWA's SubscriptionService: Pro = stripeRole "paid".
          setIsPro(token.claims['stripeRole'] === 'paid' || token.claims['pro'] === true);
        } catch {
          setIsPro(false);
        }
      } else {
        setIsPro(false);
      }
      setInitializing(false);
    });
  }, []);

  // Live profile subscription, shared app-wide so the gate can route to
  // onboarding and Settings can read goals/units off one listener.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setProfileEntry(null);
      return;
    }
    return subscribeProfile(
      uid,
      (p) => setProfileEntry({ uid, profile: p }),
      () => setProfileEntry({ uid, profile: null }),
    );
  }, [user?.uid]);

  // Only trust the profile when it belongs to the current user; until then
  // the gate must treat it as still loading.
  const matchedProfile = profileEntry && user && profileEntry.uid === user.uid ? profileEntry : null;
  const profile = matchedProfile ? matchedProfile.profile : null;
  const profileLoading = !!user && !matchedProfile;

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      isPro,
      profile,
      profileLoading,
      googleAvailable,
      signIn: async (email, password) => {
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (e) {
          // A Google/Apple-only account has no password credential, so this
          // comes back invalid-credential/wrong-password even though the email
          // exists. Probe the owning provider and steer the user there instead
          // of the dead-end "wrong email or password".
          const code = (e as { code?: string })?.code ?? '';
          if (
            code.includes('invalid-credential') ||
            code.includes('wrong-password') ||
            code.includes('user-not-found')
          ) {
            const hint = await providerHintForEmail(email);
            if (hint) throw new AuthHintError(hint);
          }
          throw e;
        }
      },
      signUp: async (email, password, displayName) => {
        let cred;
        try {
          cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        } catch (e) {
          // Email already owned — if by a federated provider, route the user to
          // that provider rather than telling them to "sign in instead" (which
          // fails: they never set a password).
          if ((e as { code?: string })?.code === 'auth/email-already-in-use') {
            const hint = await providerHintForEmail(email);
            if (hint) throw new AuthHintError(hint);
          }
          throw e;
        }
        // Set displayName before the profile subscription resolves so greetings
        // have a name on first render. Best-effort — never fail the sign-up.
        const name = displayName?.trim();
        if (name) {
          try {
            await updateProfile(cred.user, { displayName: name });
          } catch (e) {
            console.warn('updateProfile(displayName) failed', e);
          }
        }
        try {
          await sendEmailVerification(cred.user);
        } catch (e) {
          console.warn('sendEmailVerification failed', e);
        }
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email.trim());
      },
      signInWithGoogle: async () => {
        if (isExpoGo || !hasRealClientId) throw new GoogleSignInError('expo-go');
        const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = loadGoogleSignin();
        let idToken: string | null;
        try {
          // Native account picker: Play Services (Android) / Google SDK (iOS).
          // Returns the id_token in-process — no browser round-trip, so the old
          // redirect/custom-URI-scheme failures are structurally impossible.
          await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
          const response = await GoogleSignin.signIn();
          // A non-success response means the user dismissed the picker.
          if (!isSuccessResponse(response)) throw new GoogleSignInError('cancelled');
          idToken = response.data.idToken;
        } catch (e) {
          if (e instanceof GoogleSignInError) throw e;
          if (
            isErrorWithCode(e) &&
            (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)
          ) {
            throw new GoogleSignInError('cancelled');
          }
          throw new GoogleSignInError('failed');
        }
        if (!idToken) throw new GoogleSignInError('no-token');
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      },
      appleAvailable: appleSignInAvailable,
      signInWithApple: async () => {
        if (!appleSignInAvailable) throw new AppleSignInError('expo-go');
        // Apple requires a nonce; Firebase verifies the raw nonce against the
        // SHA-256 hash we hand to Apple, so send the hash and keep the raw.
        const rawNonce = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
        const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({
            // PII minimization: only request EMAIL. We never read
            // `credential.fullName`, so requesting FULL_NAME would collect
            // a real name we don't use (and would populate the Firebase Auth
            // displayName). Email alone is enough to create the account.
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashedNonce,
          });
        } catch (e) {
          if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
            throw new AppleSignInError('cancelled');
          }
          throw new AppleSignInError('failed');
        }
        if (!credential.identityToken) throw new AppleSignInError('no-token');
        const fbCredential = new OAuthProvider('apple.com').credential({
          idToken: credential.identityToken,
          rawNonce,
        });
        await signInWithCredential(auth, fbCredential);
      },
      microsoftAvailable,
      signInWithMicrosoft: async () => {
        if (isExpoGo || !hasRealMsClientId) throw new MicrosoftSignInError('expo-go');
        if (!msRequest) throw new MicrosoftSignInError('not-ready');
        const result = await msPromptAsync();
        if (result.type === 'cancel' || result.type === 'dismiss') {
          throw new MicrosoftSignInError('cancelled');
        }
        if (result.type !== 'success') throw new MicrosoftSignInError('failed');
        // Same code-exchange shape as Google: promptAsync resolves with the raw
        // authorization CODE; exchange it (with the PKCE verifier) for the
        // id_token Firebase's microsoft.com credential validates.
        const code = result.params?.code;
        if (!code) throw new MicrosoftSignInError('no-token');
        const token = await exchangeCodeAsync(
          {
            clientId: msClientId ?? '',
            code,
            redirectUri: msRedirectUri,
            extraParams: msRequest.codeVerifier ? { code_verifier: msRequest.codeVerifier } : {},
          },
          msDiscovery,
        );
        const idToken = token.idToken;
        if (!idToken) throw new MicrosoftSignInError('no-token');
        // rawNonce lets Firebase match the SHA-256 nonce baked into the id_token.
        // Custom OIDC provider (not microsoft.com): Firebase validates this
        // id_token against the configured issuer's JWKS, matching rawNonce.
        const fbCredential = new OAuthProvider('oidc.microsoft').credential({
          idToken,
          rawNonce: msNonce ?? undefined,
        });
        try {
          await signInWithCredential(auth, fbCredential);
        } catch (e) {
          // Surface the real Firebase code in Metro logs for diagnosis (the UI
          // maps it to a friendly message).
          console.warn('[microsoft] signInWithCredential failed:', (e as { code?: string })?.code, (e as Error)?.message);
          throw e;
        }
      },
      signOut: () => fbSignOut(auth),
    }),
    [
      user,
      initializing,
      isPro,
      profile,
      profileLoading,
      googleAvailable,
      microsoftAvailable,
      msRequest,
      msPromptAsync,
      msRedirectUri,
      msNonce,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
