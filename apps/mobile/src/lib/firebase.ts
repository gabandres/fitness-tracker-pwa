import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  getAuth,
  // @ts-expect-error — getReactNativePersistence is exported by firebase/auth
  // but omitted from the web type surface; it exists in the RN entrypoint.
  getReactNativePersistence,
  initializeAuth,
} from 'firebase/auth';
import { type Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { type Functions, connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { type FirebaseStorage, connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectAuthEmulator, onIdTokenChanged } from 'firebase/auth';

// Same Firebase project as the PWA (see src/environments/environment.ts).
// This is public client config, not a secret (ADR-0002).
const firebaseConfig = {
  projectId: 'fitness-tracker-gb-1775407101',
  appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
  storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
  apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
  authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
  messagingSenderId: '647810616435',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// On native, the Firebase JS SDK has no default persistence, so auth state
// is lost on reload unless we wire AsyncStorage. initializeAuth must run
// exactly once; fall back to getAuth on web / hot-reload re-entry.
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

const db: Firestore = getFirestore(app);
// Callables default to us-central1 — same region the PWA uses (getFunctions()
// with no arg in app.config.ts), so searchFoods/getFoodDetail resolve.
const functions: Functions = getFunctions(app);
const storage: FirebaseStorage = getStorage(app);

// OPT-IN local dev against the Firebase Emulator Suite. Unlike the web app
// (which auto-uses emulators in dev), mobile stays opt-in: Expo Go on a
// physical device can't reach the dev machine's `localhost`, so you must both
// enable it and point it at your machine's LAN IP:
//   EXPO_PUBLIC_USE_EMULATORS=1 EXPO_PUBLIC_EMULATOR_HOST=192.168.x.y npx expo start
// On the web target / a simulator on the same machine, `localhost` is fine.
if (__DEV__ && process.env.EXPO_PUBLIC_USE_EMULATORS === '1') {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || 'localhost';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}

/**
 * The two config values a native quick-add needs to reach Firestore on its own
 * (ADR-0020): an iOS App Intent exchanges the user's refresh token at
 * `securetoken.googleapis.com` and then writes over the Firestore REST API.
 *
 * Re-exported from here rather than retyped in Swift so this file stays the one
 * place either value is written. Both are public client config, not secrets — the
 * API key grants nothing without the refresh token, and the rules scope every
 * write regardless.
 */
export const NATIVE_REST_CONFIG = {
  apiKey: firebaseConfig.apiKey,
  projectId: firebaseConfig.projectId,
} as const;

/**
 * Re-run `fn` whenever the session's ID token changes — sign-in, refresh, and
 * sign-out. Returns an unsubscribe.
 *
 * Wrapped here rather than imported from `firebase/auth` at the call site so
 * this file stays the app's single point of contact with the Auth SDK. That is
 * not only tidiness: every suite in `src/__tests__` mocks `@/lib/firebase`, and
 * a bare `firebase/auth` import in a module they exercise drags untranspiled
 * ESM into jest and fails the whole suite at parse time — which is exactly what
 * happened when `quick-add.ts` imported it directly.
 *
 * `onIdTokenChanged`, not `onAuthStateChanged`: the latter does not fire on a
 * token refresh, and that refresh is the event `watchQuickAddCredentials`
 * exists to catch.
 */
export function onSessionTokenChanged(fn: () => void): () => void {
  return onIdTokenChanged(auth, () => fn());
}

export { app, auth, db, functions, storage };
