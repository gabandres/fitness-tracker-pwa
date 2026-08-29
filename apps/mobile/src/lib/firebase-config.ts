/**
 * Firebase client config, split out of `firebase.ts` so it can be read WITHOUT
 * initialising Firebase.
 *
 * `firebase.ts` calls `initializeApp` and `initializeAuth` at module scope, and
 * `initializeAuth` reads the persisted session from AsyncStorage exactly once.
 * `session-restore.ts` has to write that session *before* it is read, so it
 * cannot import `firebase.ts` at all — importing it is what starts the clock.
 *
 * Same Firebase project as the PWA. This is public client config, not a secret
 * (ADR-0002).
 */
export const firebaseConfig = {
  projectId: 'fitness-tracker-gb-1775407101',
  appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
  storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
  apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
  authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
  messagingSenderId: '647810616435',
} as const;

/**
 * Where Firebase's React Native persistence keeps the session.
 *
 * Rebuilt from this build's own config rather than carried in a payload: a blob
 * restored from another device embeds whatever key that install used, and
 * writing there would put the session somewhere Firebase never looks.
 */
export const FIREBASE_AUTH_STORAGE_KEY = `firebase:authUser:${firebaseConfig.apiKey}:[DEFAULT]`;
