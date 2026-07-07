import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Google from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  OAuthProvider,
  type User,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
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

  // Builds the OAuth request once the client IDs are present. `request` is
  // null until ready; promptAsync() resolves with the redirect result.
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: googleAuth?.iosClientId,
    androidClientId: googleAuth?.androidClientId,
    webClientId: googleAuth?.webClientId,
  });

  const googleAvailable = !isExpoGo && hasRealClientId && !!request;

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
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      signInWithGoogle: async () => {
        if (isExpoGo || !hasRealClientId) throw new GoogleSignInError('expo-go');
        if (!request) throw new GoogleSignInError('not-ready');
        const result = await promptAsync();
        if (result.type === 'cancel' || result.type === 'dismiss') {
          throw new GoogleSignInError('cancelled');
        }
        if (result.type !== 'success') throw new GoogleSignInError('failed');
        const idToken = result.params?.id_token;
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
      signOut: () => fbSignOut(auth),
    }),
    [user, initializing, isPro, profile, profileLoading, googleAvailable, request, promptAsync],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
