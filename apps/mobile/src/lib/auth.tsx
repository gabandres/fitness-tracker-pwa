import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleAuthProvider,
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
import { auth } from './firebase';

// Required for the web-OAuth popup/redirect to resolve when the app
// regains focus after the Google consent screen.
WebBrowser.maybeCompleteAuthSession();

/** A coded error so the sign-in screen can show a specific message. */
export class GoogleSignInError extends Error {
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

interface AuthState {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
  /** True until the first onAuthStateChanged fires (avoids a sign-in flash). */
  initializing: boolean;
  /** True when the user's custom claims grant Pro (Stripe `stripeRole:paid`
   *  or any future entitlement source). */
  isPro: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Launches the Google OAuth flow and signs in to Firebase with the
   *  returned id token. Throws GoogleSignInError on cancel/unavailable. */
  signInWithGoogle: () => Promise<void>;
  /** False in Expo Go or until the OAuth request is ready — drives the
   *  button's enabled state. */
  googleAvailable: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isPro, setIsPro] = useState(false);

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

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      isPro,
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
      signOut: () => fbSignOut(auth),
    }),
    [user, initializing, isPro, googleAvailable, request, promptAsync],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
