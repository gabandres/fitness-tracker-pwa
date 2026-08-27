import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Zero-Tap Sign-In via Block Store (#107).
 *
 * The restore leg cannot be exercised here — it only fires on a genuine
 * Android-to-Android migration, which needs two physical devices. What CAN be
 * pinned is every decision that guards it, and those are the parts where a bug
 * costs a user their account rather than a tap:
 *
 *  - a refresh token is never stored without end-to-end encryption
 *  - a live session is never overwritten
 *  - a failed restore can never loop
 *  - signing out takes the stored credential with it
 */

const mockNative = {
  storeBytes: jest.fn(),
  retrieveBytes: jest.fn(),
  deleteBytes: jest.fn(),
  isE2eeAvailable: jest.fn(),
};

// Mock the module, not `expo`: `isBlockStoreAvailable` is computed at import
// time from `requireOptionalNativeModule`, so stubbing the native bridge after
// the fact leaves it false and every function early-returns.
jest.mock('../../modules/block-store', () => ({
  isBlockStoreAvailable: true,
  BLOCK_STORE_MAX_BYTES: 4096,
  storeBytes: (...a: unknown[]) => mockNative.storeBytes(...a),
  retrieveBytes: (...a: unknown[]) => mockNative.retrieveBytes(...a),
  deleteBytes: (...a: unknown[]) => mockNative.deleteBytes(...a),
  isE2eeAvailable: (...a: unknown[]) => mockNative.isE2eeAvailable(...a),
}));

import {
  clearStoredSession,
  restoreSessionIfNeeded,
  saveSessionForRestore,
  stripAccessToken,
} from '@/lib/session-restore';
import { FIREBASE_AUTH_STORAGE_KEY } from '@/lib/firebase-config';

const BLOB = JSON.stringify({
  uid: 'u1',
  email: 'a@b.c',
  emailVerified: true,
  stsTokenManager: {
    refreshToken: 'REFRESH',
    accessToken: 'a'.repeat(900),
    expirationTime: 1_700_000_000_000,
  },
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNative.storeBytes.mockReset().mockResolvedValue(true);
  mockNative.retrieveBytes.mockReset().mockResolvedValue(null);
  mockNative.deleteBytes.mockReset().mockResolvedValue(true);
  mockNative.isE2eeAvailable.mockReset().mockResolvedValue(true);
});

describe('stripAccessToken', () => {
  it('blanks the access token and keeps the refresh token', () => {
    const out = JSON.parse(stripAccessToken(BLOB)!);
    expect(out.stsTokenManager.refreshToken).toBe('REFRESH');
    expect(out.stsTokenManager.accessToken).toBe('');
    expect(out.uid).toBe('u1');
  });

  it('keeps the payload far below Block Store’s 4 KB ceiling', () => {
    const out = stripAccessToken(BLOB)!;
    // The ID token alone is ~900 bytes of the input. Dropping it is what makes
    // the 4 KB limit a non-issue rather than something to watch.
    expect(new TextEncoder().encode(out).length).toBeLessThan(1024);
  });

  it('refuses a blob with no refresh token — nothing to restore with', () => {
    expect(stripAccessToken(JSON.stringify({ uid: 'u1', stsTokenManager: {} }))).toBeNull();
  });

  it('survives a corrupt blob', () => {
    expect(stripAccessToken('not json')).toBeNull();
  });
});

describe('saveSessionForRestore', () => {
  it('stores the stripped session when the backup is end-to-end encrypted', async () => {
    await AsyncStorage.setItem(FIREBASE_AUTH_STORAGE_KEY, BLOB);
    expect(await saveSessionForRestore()).toBe(true);
    const [, stored] = mockNative.storeBytes.mock.calls[0];
    expect(JSON.parse(stored).stsTokenManager.accessToken).toBe('');
  });

  it('stores NOTHING when the device cannot end-to-end encrypt', async () => {
    // A refresh token backed up under Google's key rather than the user's is a
    // credential we chose not to create. One tap is not worth it.
    mockNative.isE2eeAvailable.mockResolvedValue(false);
    await AsyncStorage.setItem(FIREBASE_AUTH_STORAGE_KEY, BLOB);
    expect(await saveSessionForRestore()).toBe(false);
    expect(mockNative.storeBytes).not.toHaveBeenCalled();
  });

  it('stores nothing when there is no session on disk', async () => {
    expect(await saveSessionForRestore()).toBe(false);
    expect(mockNative.storeBytes).not.toHaveBeenCalled();
  });
});

describe('restoreSessionIfNeeded', () => {
  it('never touches a live session', async () => {
    await AsyncStorage.setItem(FIREBASE_AUTH_STORAGE_KEY, BLOB);
    mockNative.retrieveBytes.mockResolvedValue(JSON.stringify({ uid: 'OTHER' }));
    expect(await restoreSessionIfNeeded()).toBe('already-signed-in');
    expect(await AsyncStorage.getItem(FIREBASE_AUTH_STORAGE_KEY)).toBe(BLOB);
  });

  it('writes the blob under THIS build’s key and asks for a reload', async () => {
    mockNative.retrieveBytes.mockResolvedValue(stripAccessToken(BLOB));
    expect(await restoreSessionIfNeeded()).toBe('restored');
    const written = await AsyncStorage.getItem(FIREBASE_AUTH_STORAGE_KEY);
    expect(JSON.parse(written!).stsTokenManager.refreshToken).toBe('REFRESH');
  });

  it('is one-shot — a second launch does not retry', async () => {
    mockNative.retrieveBytes.mockResolvedValue(stripAccessToken(BLOB));
    expect(await restoreSessionIfNeeded()).toBe('restored');
    await AsyncStorage.removeItem(FIREBASE_AUTH_STORAGE_KEY); // simulate a failed rehydrate
    expect(await restoreSessionIfNeeded()).toBe('already-attempted');
  });

  it('does nothing when no previous device left a payload', async () => {
    expect(await restoreSessionIfNeeded()).toBe('nothing-stored');
  });

  it('ignores a payload with no uid rather than writing junk', async () => {
    mockNative.retrieveBytes.mockResolvedValue(JSON.stringify({ nope: true }));
    expect(await restoreSessionIfNeeded()).toBe('nothing-stored');
    expect(await AsyncStorage.getItem(FIREBASE_AUTH_STORAGE_KEY)).toBeNull();
  });
});

describe('clearStoredSession', () => {
  it('deletes the credential and re-arms the one-shot guard', async () => {
    mockNative.retrieveBytes.mockResolvedValue(stripAccessToken(BLOB));
    await restoreSessionIfNeeded();
    await clearStoredSession();
    expect(mockNative.deleteBytes).toHaveBeenCalled();
    // Re-armed so a later sign-in on a genuinely new device can still restore.
    await AsyncStorage.removeItem(FIREBASE_AUTH_STORAGE_KEY);
    mockNative.retrieveBytes.mockResolvedValue(stripAccessToken(BLOB));
    expect(await restoreSessionIfNeeded()).toBe('restored');
  });
});
