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
  type AuthCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  unlink as fbUnlink,
  updateProfile,
} from 'firebase/auth';
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { httpsCallable } from 'firebase/functions';
import type { Profile } from '@macrolog/core';
import type { Locale } from '@/i18n/registry';
import { LinkError, type LinkableProvider, type PendingLink } from './link-error';
export { LinkError } from './link-error';
export type { LinkableProvider, PendingLink } from './link-error';
import { auth, functions } from './firebase';
import { ensureProfile, subscribeProfile } from './ledger';
import { registerAppleRefreshToken } from './appleSignin';
import { addBreadcrumb, captureError, setSentryUser } from './sentry';
import { clearQuickAdd } from './quick-add';
import { clearOfflineCache, readCache, writeCache } from './offline-cache';
import { flush as flushAnalytics, setAnalyticsUser, track } from './analytics';
import { resetConnectivity } from './connectivity';
import { clearWidget } from './widget';

// Required for the web-OAuth popup/redirect to resolve when the app
// regains focus after the Google consent screen.
WebBrowser.maybeCompleteAuthSession();

/**
 * A coded error so the sign-in screen can show a specific message.
 *
 * `detail` is set ONLY when we could not classify the failure. Sentry sees the
 * unclassified ones too (`captureError` below), but `detail` is what a remote
 * tester can read back off their own screen without anyone opening a dashboard.
 * The sign-in screen appends it to the message.
 */
export class GoogleSignInError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Squash an unknown native error into one short, readable line. */
function describeNativeError(e: unknown): string {
  const code = (e as { code?: string | number })?.code;
  const name = (e as { name?: string })?.name;
  const message = (e as { message?: string })?.message ?? String(e);
  return `${code ?? name ?? 'no-code'} · ${message}`.replace(/\s+/g, ' ').slice(0, 180);
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

/** Maps a Firebase error onto a LinkError. Anything unrecognised stays
 *  `failed` WITH its native code attached, so an unmapped case is still
 *  diagnosable from a screenshot rather than collapsing to "try again". */
function toLinkError(e: unknown): LinkError {
  if (e instanceof LinkError) return e;
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('provider-already-linked')) return new LinkError('already-linked');
  // Both codes mean "this Google/Apple identity is already its own account".
  if (code.includes('credential-already-in-use') || code.includes('email-already-in-use')) {
    return new LinkError('credential-in-use');
  }
  if (code.includes('requires-recent-login')) return new LinkError('requires-recent-login');
  return new LinkError('failed', describeNativeError(e));
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

/**
 * Sends the email-verification link through our own `sendVerificationEmail`
 * callable instead of the SDK's `sendEmailVerification`.
 *
 * Same reasoning as `resetPassword` below — Firebase's built-in sender ships
 * from `noreply@<project>.firebaseapp.com`, which cannot be DMARC-aligned with
 * ignia.fit — and it matters more here, because verification is the signup
 * wall: mail that lands in junk is a user who never reaches the app at all.
 * That was reported on 2026-08-14.
 *
 * The usual fix, pointing Firebase Auth at a custom SMTP relay, is NOT
 * available on this project: every write to the Auth email config is refused
 * with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` while email-enumeration protection
 * is enabled, and that protection is worth more than the setting.
 *
 * The callable reads the address from the auth token, so there is nothing to
 * pass and nothing a caller can spoof.
 */
async function sendOwnedVerificationEmail(locale?: Locale): Promise<void> {
  const call = httpsCallable<{ locale: string }, { ok: true; alreadyVerified?: boolean }>(
    functions,
    'sendVerificationEmail',
  );
  await call({ locale: locale ?? 'en' });
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

/**
 * Runs the native Google picker and returns a Firebase credential.
 *
 * Split out of `signInWithGoogle` so the SAME flow can either start a session
 * (`signInWithCredential`) or attach Google to the session you already have
 * (`linkWithCredential`). `where` only tags the Sentry breadcrumbs, so a
 * failure while linking is distinguishable from one while signing in.
 */
async function acquireGoogleCredential(where: 'signInWithGoogle' | 'linkGoogle'): Promise<AuthCredential> {
  if (isExpoGo || !hasRealClientId) throw new GoogleSignInError('expo-go');
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = loadGoogleSignin();
  let idToken: string | null;
  try {
    // Breadcrumbs pin down WHICH step failed — "play services ok" present but
    // "picker returned" missing means the account picker itself blew up, which
    // reads very differently from a Firebase rejection.
    addBreadcrumb('google: start');
    // Native account picker: Play Services (Android) / Google SDK (iOS).
    // Returns the id_token in-process — no browser round-trip, so the old
    // redirect/custom-URI-scheme failures are structurally impossible.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    addBreadcrumb('google: play services ok');
    const response = await GoogleSignin.signIn();
    addBreadcrumb('google: picker returned', { success: isSuccessResponse(response) });
    // A non-success response means the user dismissed the picker.
    if (!isSuccessResponse(response)) throw new GoogleSignInError('cancelled');
    idToken = response.data.idToken;
  } catch (e) {
    if (e instanceof GoogleSignInError) throw e;
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) {
        throw new GoogleSignInError('cancelled');
      }
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new GoogleSignInError('play-services');
      }
    }
    // iOS: GIDSignIn presents its consent screen in Safari / an
    // ASWebAuthenticationSession, and when the OS refuses to open one it
    // reports a bare `com.google.GIDSignIn` code -1 (kGIDSignInErrorCodeUnknown)
    // whose only distinguishing feature is the message. There is nothing wrong
    // with the build — Sentry IGNIA-MOBILE-5 came from iOS 26.6 with the
    // `iosUrlScheme` plugin config correct and the same binary signing other
    // testers in — so it is a device condition (Safari disabled by Screen Time
    // / MDM, or no default browser). Match on the message, because the code is
    // the SDK's catch-all and matching on it alone would swallow real failures.
    if (/unable to open safari|cannot open|no browser/i.test(String((e as { message?: string })?.message ?? ''))) {
      throw new GoogleSignInError('browser');
    }
    // Anything else is unclassified, and the two that matter here look
    // identical to the user: DEVELOPER_ERROR (code 10) = the build's signing
    // cert / client ID doesn't match what Google has, and NoCredentialException
    // = no usable Google account on the device. Carry the native code through
    // instead of flattening both to "please try again", which is what made this
    // undiagnosable.
    console.warn('[google-signin] unclassified failure', e);
    captureError(e, {
      where: `${where}.picker`,
      extra: {
        nativeCode: (e as { code?: string | number })?.code ?? null,
        // Which client IDs this build was configured with — a mismatch between
        // these and what Google has registered for the install's signing cert
        // is the classic DEVELOPER_ERROR.
        webClientId: googleAuth?.webClientId ?? null,
        hasIosClientId: Boolean(googleAuth?.iosClientId),
      },
    });
    throw new GoogleSignInError('failed', describeNativeError(e));
  }
  if (!idToken) {
    // The picker succeeded but handed back no id_token — a configuration
    // symptom (wrong/missing webClientId), not a user action.
    captureError(new Error('google: success response without idToken'), {
      where: `${where}.noToken`,
      extra: { webClientId: googleAuth?.webClientId ?? null },
    });
    throw new GoogleSignInError('no-token');
  }
  return GoogleAuthProvider.credential(idToken);
}

/**
 * Runs Sign in with Apple and returns the Firebase credential plus Apple's
 * one-time authorization code (needed server-side to revoke the token on
 * account deletion — Apple guideline 5.1.1(v)).
 *
 * NOTE for the linking path: with **Hide My Email**, Apple returns a
 * `@privaterelay.appleid.com` address, which will not match the email on a
 * password account. That is exactly why linking has to be reachable from
 * Settings — the sign-in collision this repo already handles never fires for a
 * relay address; Firebase just makes a second, unrelated account.
 */
async function acquireAppleCredential(): Promise<{
  credential: AuthCredential;
  authorizationCode: string | null;
}> {
  if (!appleSignInAvailable) throw new AppleSignInError('expo-go');
  // Apple requires a nonce; Firebase verifies the raw nonce against the
  // SHA-256 hash we hand to Apple, so send the hash and keep the raw.
  const rawNonce = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let appleCredential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    appleCredential = await AppleAuthentication.signInAsync({
      // PII minimization: only request EMAIL. We never read
      // `credential.fullName`, so requesting FULL_NAME would collect a real
      // name we don't use (and would populate the Firebase Auth displayName).
      // Email alone is enough to create the account.
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
      throw new AppleSignInError('cancelled');
    }
    throw new AppleSignInError('failed');
  }
  if (!appleCredential.identityToken) throw new AppleSignInError('no-token');
  return {
    credential: new OAuthProvider('apple.com').credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    }),
    authorizationCode: appleCredential.authorizationCode ?? null,
  };
}

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
  /** True only once the SERVER has answered about this user's profile. The
   *  onboarding gate must not fire without it — see the field's definition. */
  profileConfirmed: boolean;
  /** Whether the signed-in user's email is verified. Email/password signups
   *  start false; federated providers (Google/Apple) return verified emails.
   *  Firestore rules block all writes until this is true, so the gate routes
   *  unverified users to the verify-email screen. */
  emailVerified: boolean;
  /** Reloads the Firebase user, force-refreshes the ID token so the rules see
   *  the new `email_verified` claim, bootstraps the profile doc that the
   *  unverified create was rejected for, and returns whether it's now verified. */
  reloadUser: () => Promise<boolean>;
  /** Re-sends the verification email to the current user. `locale` picks the
   *  language, and is supplied by the caller for the same reason
   *  `resetPassword` needs it — see the note there. */
  resendVerification: (locale?: Locale) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Creates a new email/password account and signs in. Sets the Firebase Auth
   *  displayName when provided, and sends a (best-effort) verification email.
   *  Firebase enforces the project password policy. */
  signUp: (
    email: string,
    password: string,
    displayName?: string,
    locale?: Locale,
  ) => Promise<void>;
  /** Sends a password-reset email to `email`. */
  /** `locale` picks the language of the reset email. The caller supplies it
   *  because `I18nProvider` mounts inside this provider (it reads the signed-in
   *  profile), so the locale is not readable from here. */
  resetPassword: (email: string, locale?: Locale) => Promise<void>;
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

  // ---- Account linking (Settings → Sign-in methods) -----------------------
  /** Provider IDs currently attached to the signed-in account, e.g.
   *  `['password', 'google.com']`. Drives the connected/not-connected state of
   *  each row; empty when signed out. */
  linkedProviders: readonly LinkableProvider[];
  /** Attaches a provider to the CURRENT account, after running that provider's
   *  native flow. Throws LinkError; `credential-in-use` means that identity is
   *  already a separate Ignia account and cannot be attached without merging. */
  linkProvider: (provider: Exclude<LinkableProvider, 'password'>) => Promise<void>;
  /** Adds an email/password credential to a federated-only account, so the user
   *  can also sign in with a password. Uses the account's own email. */
  linkPassword: (password: string) => Promise<void>;
  /** Detaches a provider. Refuses to remove the last one — an account with no
   *  sign-in method is unreachable, and Firebase would happily allow it. */
  unlinkProvider: (provider: LinkableProvider) => Promise<void>;
  /** Set when a federated sign-in collided with an existing account. The
   *  sign-in screen shows "you already have an account — sign in to connect
   *  <provider>"; the next successful sign-in with the same email links it. */
  pendingLink: PendingLink | null;
  /** User backed out of the link prompt — drop the captured credential. */
  clearPendingLink: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isPro, setIsPro] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  // Profile is keyed by uid so "loaded for the current user" is derivable
  // synchronously — no effect-set flag that lags a render behind `user` and
  // briefly makes a signed-in user look un-onboarded.
  const [profileEntry, setProfileEntry] = useState<{ uid: string; profile: Profile | null; confirmed: boolean } | null>(
    null,
  );

  // Collision state. The credential lives in a ref, not state: it is not
  // rendered, it must survive re-renders without causing one, and keeping it
  // out of React state keeps it out of any devtools serialization of the tree.
  const pendingCredentialRef = useRef<AuthCredential | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);

  function clearPendingLink() {
    pendingCredentialRef.current = null;
    setPendingLink(null);
  }

  /**
   * If `e` is the "this email is already an account under another provider"
   * error, keep the credential so the next successful sign-in with the SAME
   * email can attach it. Returns nothing — the caller still rethrows, because
   * the sign-in attempt genuinely did fail.
   */
  function capturePendingLink(e: unknown, attemptedProvider: LinkableProvider): void {
    const code = (e as { code?: string })?.code ?? '';
    if (!code.includes('account-exists-with-different-credential')) return;
    const email = (e as { customData?: { email?: string } })?.customData?.email;
    if (!email) return;
    // Firebase attaches the rejected credential to the error; without it there
    // is nothing to link later, so don't advertise a prompt we can't honour.
    const credential =
      attemptedProvider === 'google.com'
        ? GoogleAuthProvider.credentialFromError(e as never)
        : OAuthProvider.credentialFromError(e as never);
    if (!credential) return;
    pendingCredentialRef.current = credential;
    setPendingLink({ email, attemptedProvider });
  }

  /**
   * Called after any successful sign-in. Attaches a credential captured during
   * an earlier collision — but only when the account that just signed in owns
   * the same email, otherwise the user switched accounts mid-flow and linking
   * would bolt a stranger's Google identity onto this account.
   */
  async function completeLinkIfPending(signedIn: User): Promise<void> {
    const credential = pendingCredentialRef.current;
    if (!credential) return;
    const target = pendingLink;
    if (!target || target.email.toLowerCase() !== (signedIn.email ?? '').toLowerCase()) {
      clearPendingLink();
      return;
    }
    try {
      await linkWithCredential(signedIn, credential);
      setUser(auth.currentUser);
    } catch (e) {
      // The user IS signed in at this point, so a failed link is a degraded
      // outcome, not a failed sign-in — never rethrow into the sign-in path.
      console.warn('completeLinkIfPending failed', e);
      captureError(e, { where: 'auth.completeLinkIfPending' });
    } finally {
      clearPendingLink();
    }
  }

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
      setEmailVerified(u?.emailVerified ?? false);
      // uid only — never the email (PII minimization). A uid resolves to a
      // person in the Firebase console on the rare occasion we need it.
      setSentryUser(u?.uid ?? null);
      // Same event, same reason: counts have to be addressed to an account, so
      // nothing is recorded until one exists. `setAnalyticsUser` starts the
      // flush timer and the background listener on the way in.
      setAnalyticsUser(u?.uid ?? null);
      if (u) {
        // Create users/{uid} on first sign-in if it doesn't exist yet, so a
        // mobile-first new user has a profile doc for onboarding to update.
        // Best-effort: a failure here surfaces later as a save error, not a
        // dead sign-in. Runs before the profile subscription resolves.
        //
        // Only attempt it once verified — the rules reject a create from an
        // unverified user, so for an email/password signup the doc is created
        // later by reloadUser() the moment verification completes.
        if (u.emailVerified) {
          try {
            await ensureProfile(u.uid);
          } catch (e) {
            console.warn('ensureProfile failed', e);
          }
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
  //
  // `confirmed` records whether the SERVER has answered, and it is the field
  // the onboarding gate turns on — see `profileConfirmed` below.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setProfileEntry(null);
      return;
    }
    let live = false;
    // Paint from the last online session while the listener reconnects. Same
    // store `useToday` writes (`offline-cache.ts`), so on a cold start with no
    // network the app still knows who this user is and what their targets are.
    void readCache<Profile>(uid, 'profile').then((cached) => {
      if (live || !cached) return;
      setProfileEntry({ uid, profile: cached, confirmed: false });
    });
    return subscribeProfile(
      uid,
      (p, meta) => {
        // A cache-only snapshot reporting NO profile is not evidence of
        // anything — this app has no Firestore persistence, so that is simply
        // what an offline cold start looks like. Ignore it and keep whatever
        // the disk cache gave us; the gate below refuses to act on it either.
        if (!p && meta.fromCache) return;
        live = true;
        if (p) writeCache(uid, 'profile', p);
        setProfileEntry({ uid, profile: p, confirmed: !meta.fromCache });
      },
      () => {
        live = true;
        setProfileEntry({ uid, profile: null, confirmed: false });
      },
    );
  }, [user?.uid]);

  // Only trust the profile when it belongs to the current user; until then
  // the gate must treat it as still loading.
  const matchedProfile = profileEntry && user && profileEntry.uid === user.uid ? profileEntry : null;
  const profile = matchedProfile ? matchedProfile.profile : null;
  const profileLoading = !!user && !matchedProfile;
  /**
   * Whether the profile came from the SERVER, rather than from disk or from an
   * empty offline cache.
   *
   * The routing gate may only send an existing account to onboarding on the
   * strength of this. Without it, opening the app with no signal looked
   * identical to having never onboarded, and finishing the form would overwrite
   * the user's real targets, goal and weight — data loss caused by a network
   * condition.
   */
  const profileConfirmed = !!matchedProfile && matchedProfile.confirmed;

  /**
   * Runs the Microsoft OAuth dance and returns the Firebase credential.
   * Lives inside the provider (unlike its Google/Apple siblings) because the
   * request object and prompt come from `useAuthRequest` hooks.
   */
  async function acquireMicrosoftCredential(): Promise<AuthCredential> {
    if (isExpoGo || !hasRealMsClientId) throw new MicrosoftSignInError('expo-go');
    if (!msRequest) throw new MicrosoftSignInError('not-ready');
    const result = await msPromptAsync();
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new MicrosoftSignInError('cancelled');
    }
    if (result.type !== 'success') throw new MicrosoftSignInError('failed');
    // Same code-exchange shape as Google: promptAsync resolves with the raw
    // authorization CODE; exchange it (with the PKCE verifier) for the id_token
    // Firebase's credential validates.
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
    return new OAuthProvider('oidc.microsoft').credential({
      idToken,
      rawNonce: msNonce ?? undefined,
    });
  }

  /**
   * Which sign-in methods the current account has. Read off `providerData`,
   * which is Firebase's own list and therefore the only source that stays
   * honest after a link or unlink.
   *
   * `password` appears in providerData as its own entry, so no special-casing
   * is needed — but note that an account can hold `password` while its email is
   * unverified, and the verify-email gate is a separate concern from this list.
   */
  const linkedProviders = useMemo<readonly LinkableProvider[]>(
    () =>
      (user?.providerData ?? [])
        .map((p) => p.providerId)
        .filter((id): id is LinkableProvider =>
          id === 'password' || id === 'google.com' || id === 'apple.com' || id === 'oidc.microsoft',
        ),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      isPro,
      profile,
      profileLoading,
      profileConfirmed,
      emailVerified,
      reloadUser: async () => {
        const u = auth.currentUser;
        if (!u) return false;
        await u.reload();
        const fresh = auth.currentUser;
        const verified = fresh?.emailVerified ?? false;
        if (verified && fresh) {
          // Force a new ID token so the Firestore rules see email_verified:true
          // on the very next write (the cached token still says false).
          try {
            await fresh.getIdToken(true);
          } catch {
            // Non-fatal — the token refreshes on its own within the hour.
          }
          // The profile-doc create was rejected while unverified; now it passes.
          try {
            await ensureProfile(fresh.uid);
          } catch (e) {
            console.warn('ensureProfile failed', e);
          }
          setUser(fresh);
        }
        setEmailVerified(verified);
        return verified;
      },
      resendVerification: async (locale) => {
        const u = auth.currentUser;
        if (!u) throw new Error('no-user');
        await sendOwnedVerificationEmail(locale);
      },
      googleAvailable,
      signIn: async (email, password) => {
        try {
          const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
          // This is the second half of the collision flow: the user tapped
          // Google/Apple, got bounced because the email is password-owned, and
          // has now proved ownership. Attach the credential they came with.
          await completeLinkIfPending(cred.user);
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
      signUp: async (email, password, displayName, locale) => {
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
        // Recorded here rather than at form submit: an account has to exist
        // before a count can be addressed to it, and a failed attempt is not a
        // signup. `onAuthStateChanged` has already bound the uid by this point.
        //
        // Email/password only. A first-time Google/Apple sign-in is
        // indistinguishable from a returning one without `getAdditionalUserInfo`
        // on every federated path, and `onboarding_complete` — which every new
        // account passes through exactly once — answers the funnel question
        // without that. So `signup` under-counts federated arrivals ON PURPOSE;
        // read it against `onboarding_complete`, never as a total.
        track('signup');
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
          await sendOwnedVerificationEmail(locale);
        } catch (e) {
          console.warn('sendVerificationEmail failed', e);
        }
      },
      // Routed through our own callable instead of Firebase's client SDK:
      // Firebase sends from `noreply@<project>.firebaseapp.com`, which is
      // unaligned with ignia.fit (fails DMARC) and unbrandable. The callable
      // mints the same action link server-side and delivers it via Resend.
      // It answers ok for any well-formed address, present or not, so this
      // cannot report "no account with that email" — that was an enumeration
      // oracle, and the UI already showed a neutral confirmation either way.
      resetPassword: async (email, locale) => {
        const call = httpsCallable<{ email: string; locale: string }, { ok: true }>(
          functions,
          'sendPasswordReset',
        );
        await call({ email: email.trim(), locale: locale ?? 'en' });
      },
      signInWithGoogle: async () => {
        const credential = await acquireGoogleCredential('signInWithGoogle');
        try {
          const result = await signInWithCredential(auth, credential);
          await completeLinkIfPending(result.user);
        } catch (e) {
          // Rethrow Firebase's own coded errors untouched — the screen maps
          // account-exists-with-different-credential and friends by code. Only
          // annotate, so an unmapped one (user-disabled, operation-not-allowed,
          // internal-error) still reaches us with its code attached.
          capturePendingLink(e, 'google.com');
          console.warn('[google-signin] signInWithCredential failed', e);
          captureError(e, {
            where: 'signInWithGoogle.firebase',
            extra: { firebaseCode: (e as { code?: string })?.code ?? null },
          });
          throw new GoogleSignInError(
            (e as { code?: string })?.code ?? 'failed',
            describeNativeError(e),
          );
        }
      },
      appleAvailable: appleSignInAvailable,
      signInWithApple: async () => {
        const { credential, authorizationCode } = await acquireAppleCredential();
        try {
          const result = await signInWithCredential(auth, credential);
          await completeLinkIfPending(result.user);
        } catch (e) {
          capturePendingLink(e, 'apple.com');
          throw e;
        }
        // Hand Apple's auth code to the server so deletion can revoke the token
        // later (5.1.1(v)). Fire-and-forget — never block sign-in on this.
        if (authorizationCode) {
          registerAppleRefreshToken(authorizationCode).catch((e: unknown) =>
            console.warn('apple refresh-token register failed', e),
          );
        }
      },
      // ---- Account linking --------------------------------------------------
      linkedProviders,
      linkProvider: async (provider) => {
        const u = auth.currentUser;
        if (!u) throw new LinkError('no-user');
        if (linkedProviders.includes(provider)) throw new LinkError('already-linked');
        let credential: AuthCredential;
        let appleAuthorizationCode: string | null = null;
        try {
          if (provider === 'google.com') {
            credential = await acquireGoogleCredential('linkGoogle');
          } else if (provider === 'apple.com') {
            const acquired = await acquireAppleCredential();
            credential = acquired.credential;
            appleAuthorizationCode = acquired.authorizationCode;
          } else {
            if (!microsoftAvailable) throw new LinkError('unavailable');
            credential = await acquireMicrosoftCredential();
          }
        } catch (e) {
          // The provider flows throw their own coded errors; a user-cancelled
          // picker is not a failure worth an alert.
          const code = (e as { code?: string })?.code ?? '';
          if (code === 'cancelled') throw new LinkError('cancelled');
          if (code === 'expo-go' || code === 'play-services') throw new LinkError('unavailable');
          throw toLinkError(e);
        }
        try {
          await linkWithCredential(u, credential);
        } catch (e) {
          throw toLinkError(e);
        }
        // Apple deletion revocation needs the code regardless of whether Apple
        // arrived via sign-in or linking.
        if (appleAuthorizationCode) {
          registerAppleRefreshToken(appleAuthorizationCode).catch((e: unknown) =>
            console.warn('apple refresh-token register failed', e),
          );
        }
        // providerData is a snapshot on the User object, so re-read it or the
        // row the user just connected keeps rendering as "not connected".
        await u.reload();
        setUser(auth.currentUser);
      },
      linkPassword: async (password) => {
        const u = auth.currentUser;
        if (!u) throw new LinkError('no-user');
        const email = u.email;
        // A federated account always has an email here; Apple relay addresses
        // included (they are real, deliverable addresses).
        if (!email) throw new LinkError('failed', 'no-email');
        try {
          await linkWithCredential(u, EmailAuthProvider.credential(email, password));
        } catch (e) {
          throw toLinkError(e);
        }
        await u.reload();
        setUser(auth.currentUser);
      },
      unlinkProvider: async (provider) => {
        const u = auth.currentUser;
        if (!u) throw new LinkError('no-user');
        // Firebase will cheerfully strip the only provider and leave an account
        // nobody can sign into again. Refuse before that call, not after.
        if (linkedProviders.length <= 1) throw new LinkError('last-provider');
        try {
          await fbUnlink(u, provider);
        } catch (e) {
          throw toLinkError(e);
        }
        await u.reload();
        setUser(auth.currentUser);
      },
      pendingLink,
      clearPendingLink,
      // ---- end account linking ---------------------------------------------
      microsoftAvailable,
      signInWithMicrosoft: async () => {
        const fbCredential = await acquireMicrosoftCredential();
        try {
          const result = await signInWithCredential(auth, fbCredential);
          await completeLinkIfPending(result.user);
        } catch (e) {
          capturePendingLink(e, 'oidc.microsoft');
          // Surface the real Firebase code in Metro logs for diagnosis (the UI
          // maps it to a friendly message).
          console.warn('[microsoft] signInWithCredential failed:', (e as { code?: string })?.code, (e as Error)?.message);
          throw e;
        }
      },
      // Blank the home-screen widget before dropping the session — its
      // snapshot lives outside the app sandbox (iOS App Group) and would
      // otherwise keep the previous account's numbers on the home screen.
      signOut: async () => {
        await clearWidget();
        // Same obligation, different store: the parked quick-add queue holds
        // what this account ate, addressed to its uid, and the slot list names
        // its presets. Both are dropped before the session is, for the reason
        // above (ADR-0020). `clearQuickAdd` never throws, so it cannot strand
        // the sign-out.
        await clearQuickAdd();
        // And the read cache — the third store holding this account's food off
        // the network. Namespaced by uid, so the risk it removes is not the next
        // account seeing it but this one's day surviving on a shared or sold
        // phone after the session is gone.
        // Counts belong to whoever was signed in when they happened, so the
        // buffer is written out before the uid it is addressed to disappears.
        await flushAnalytics();
        setAnalyticsUser(null);
        await clearOfflineCache(user?.uid);
        resetConnectivity();
        await fbSignOut(auth);
      },
    }),
    [
      user,
      initializing,
      isPro,
      profile,
      profileLoading,
      profileConfirmed,
      emailVerified,
      googleAvailable,
      microsoftAvailable,
      msRequest,
      msPromptAsync,
      msRedirectUri,
      msNonce,
      // Both are read inside the linking closures — omit them and
      // completeLinkIfPending compares against a stale pendingLink, and the
      // last-provider guard reads a stale provider list.
      linkedProviders,
      pendingLink,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
