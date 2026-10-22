import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { clearOfflineCache, peekCache, writeCache } from '@/lib/offline-cache';

/**
 * The cold-start preload (2026-10-21).
 *
 * `onAuthStateChanged` waits on a token refresh and an account lookup (~771 ms
 * on the LG G6), and every reading hook keyed its disk paint on `user?.uid` —
 * so Today could not even START reading its cache until auth answered. The
 * provider now reads Firebase's persisted session at MOUNT, warms that uid's
 * first-paint slices into memory, and exposes it as `paintUid`. What it must
 * NOT do is route on it early: `sessionUid` / `initializing` keep their grace
 * period, and the real auth event replaces `paintUid` whatever it says.
 */

let mockAuthCb: ((u: unknown) => void) | null = null;
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => {
    mockAuthCb = cb;
    return () => {};
  },
  GoogleAuthProvider: class {},
  OAuthProvider: class {},
  EmailAuthProvider: class {},
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-auth-session', () => ({
  exchangeCodeAsync: jest.fn(),
  makeRedirectUri: () => 'ignia://auth',
  useAuthRequest: () => [null, null, jest.fn()],
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'n' }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-updates', () => ({ reloadAsync: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ auth: {}, functions: {} }));
jest.mock('@/lib/ledger', () => ({
  ensureProfile: jest.fn(() => Promise.resolve()),
  subscribeProfile: jest.fn(() => () => {}),
}));
jest.mock('@/lib/appleSignin', () => ({ registerAppleRefreshToken: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn(), captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('@/lib/google-signin-errors', () => ({ isGoogleInternalError: () => false }));
jest.mock('@/lib/quick-add', () => ({ clearQuickAdd: jest.fn() }));
jest.mock('@/lib/pending-body', () => ({ clearPendingBody: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ clearTapeReminder: jest.fn(() => Promise.resolve()) }));
const mockReadSession = jest.fn();
jest.mock('@/lib/persisted-session', () => ({
  readPersistedSession: () => mockReadSession(),
  clearRehydrateRetry: jest.fn(() => Promise.resolve()),
  reconcileNullVerdict: jest.fn(() => Promise.resolve('signed-out')),
}));
jest.mock('@/lib/session-restore', () => ({
  clearStoredSession: jest.fn(),
  restoreSessionIfNeeded: jest.fn(() => Promise.resolve('none')),
  saveSessionForRestore: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/analytics', () => ({
  discardAnalytics: jest.fn(),
  flush: jest.fn(),
  setAnalyticsUser: jest.fn(),
  track: jest.fn(),
}));
jest.mock('@/lib/deleteAccount', () => ({ deleteAccountForever: jest.fn(), runAccountDeletion: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ resetConnectivity: jest.fn() }));
jest.mock('@/lib/widget', () => ({ clearWidget: jest.fn() }));
jest.mock('@/lib/active-workout-signal', () => ({ clearActiveWorkoutSignal: jest.fn() }));

import { AuthProvider, useAuth } from '@/lib/auth';

let seen: ReturnType<typeof useAuth> | null = null;
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    seen = auth;
  });
  return <Text>{auth.paintUid ?? 'none'}</Text>;
}

/** A cold process: the slices on disk, nothing in memory. */
async function seedDisk(uid: string) {
  writeCache(uid, 'logs', [{ id: 'a', calories: 300, date: new Date(2026, 9, 21) }]);
  writeCache(uid, 'profile', { profileCompleted: true });
  await new Promise((r) => setTimeout(r, 600));
  const disk = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  await clearOfflineCache();
  await AsyncStorage.multiSet(disk.map(([k, v]) => [k, v ?? '']));
}

beforeEach(async () => {
  mockAuthCb = null;
  seen = null;
  mockReadSession.mockReset();
  await clearOfflineCache();
  await AsyncStorage.clear();
});

it('warms the persisted user’s cache and sets paintUid at mount — without routing on it', async () => {
  await seedDisk('u1');
  mockReadSession.mockResolvedValue({ uid: 'u1', emailVerified: true });
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(seen?.paintUid).toBe('u1'));
  await waitFor(() => expect(peekCache('u1', 'logs')).not.toBeNull());
  expect(peekCache<{ date: Date }[]>('u1', 'logs')?.[0].date).toBeInstanceOf(Date);
  // Auth has not answered and the grace period has not run out: nothing about
  // ROUTING moved.
  expect(seen?.user).toBeNull();
  expect(seen?.sessionUid).toBeNull();
  expect(seen?.sessionPresumed).toBe(false);
  expect(seen?.initializing).toBe(true);

  await act(async () => mockAuthCb?.({ uid: 'u1', emailVerified: true, getIdTokenResult: () => Promise.resolve({ claims: {} }) }));
  expect(seen?.paintUid).toBe('u1');
  expect(seen?.user).not.toBeNull();
});

it('the real verdict wins: signed out clears paintUid', async () => {
  mockReadSession.mockResolvedValue({ uid: 'u1', emailVerified: true });
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(seen?.paintUid).toBe('u1'));
  await act(async () => {
    mockAuthCb?.(null);
    await new Promise((r) => setTimeout(r, 0));
  });
  await waitFor(() => expect(seen?.paintUid).toBeNull());
});

it('an answer that lands before the disk read is not overridden by it', async () => {
  let release: (v: unknown) => void = () => {};
  mockReadSession.mockReturnValue(new Promise((r) => (release = r)));
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => {
    mockAuthCb?.(null);
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => release({ uid: 'u1', emailVerified: true }));
  expect(seen?.paintUid).toBeNull();
  expect(peekCache('u1', 'logs')).toBeNull();
});
