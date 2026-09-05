import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearRehydrateRetry,
  nullVerdictAction,
  parsePersistedSession,
  reconcileNullVerdict,
} from '@/lib/persisted-session';

/**
 * #83 — the gate reads Firebase's own persisted session off disk rather than
 * waiting ~8.7 s for `onAuthStateChanged` to validate a token over a network
 * that is not answering.
 *
 * The blob is the SDK's shape, not ours, so these pin exactly what we depend
 * on and — more importantly — that every malformed form degrades to `null`,
 * which means "wait for Firebase like we always did" rather than "routed
 * somewhere wrong".
 */
describe('parsePersistedSession', () => {
  it('reads the uid and the verified flag', () => {
    expect(
      parsePersistedSession(JSON.stringify({ uid: 'abc123', emailVerified: true, extra: 'ignored' })),
    ).toEqual({ uid: 'abc123', emailVerified: true });
  });

  it('treats a MISSING emailVerified as NOT verified', () => {
    // The dangerous direction: guessing `true` would route an unverified
    // signup into the app, where every write then fails the rules'
    // email_verified gate and the user sees saves silently not happening.
    expect(parsePersistedSession(JSON.stringify({ uid: 'abc123' }))).toEqual({
      uid: 'abc123',
      emailVerified: false,
    });
  });

  it('does not accept a truthy non-true emailVerified', () => {
    expect(parsePersistedSession(JSON.stringify({ uid: 'a', emailVerified: 'yes' }))?.emailVerified).toBe(
      false,
    );
  });

  it.each([
    ['no stored key', null],
    ['empty string', ''],
    ['not JSON', '{not json'],
    ['JSON that is not an object', '"a string"'],
    ['null literal', 'null'],
    ['object with no uid', '{"emailVerified":true}'],
    ['uid of the wrong type', '{"uid":12345}'],
    ['empty uid', '{"uid":""}'],
  ])('returns null for %s — the gate then just waits', (_label, raw) => {
    expect(parsePersistedSession(raw)).toBeNull();
  });
});

/**
 * A null auth verdict that the disk contradicts (the post-OTA sign-in flash).
 *
 * Firebase removes its persisted session before it announces a sign-out, so
 * "null verdict, blob still on disk" is a session it failed to read, not one
 * it rejected. The app answers that with ONE reload; these pin the decision
 * and, above all, that it can never loop and never engages on a real sign-out.
 */
describe('nullVerdictAction', () => {
  it('a null verdict with nothing on disk is a plain sign-out', () => {
    expect(nullVerdictAction({ sessionOnDisk: false, alreadyRetried: false })).toBe('signed-out');
  });

  it('a null verdict with a session on disk earns one reload', () => {
    expect(nullVerdictAction({ sessionOnDisk: true, alreadyRetried: false })).toBe('reload');
  });

  it('never reloads twice — a persistent failure degrades to the sign-in screen', () => {
    expect(nullVerdictAction({ sessionOnDisk: true, alreadyRetried: true })).toBe('signed-out');
  });
});

describe('reconcileNullVerdict', () => {
  const AUTH_KEY = 'firebase:authUser:testkey:[DEFAULT]';

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is a sign-out when Firebase has already removed its blob', async () => {
    expect(await reconcileNullVerdict()).toBe('signed-out');
  });

  it('reloads once, then treats the same contradiction as a sign-out', async () => {
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify({ uid: 'u1', emailVerified: true }));
    expect(await reconcileNullVerdict()).toBe('reload');
    // The guard is armed BEFORE the reload happens, so even a reload that
    // immediately reproduces the failure cannot spin.
    expect(await reconcileNullVerdict()).toBe('signed-out');
  });

  it('re-arms after Firebase produces a user again', async () => {
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify({ uid: 'u1', emailVerified: true }));
    expect(await reconcileNullVerdict()).toBe('reload');
    await clearRehydrateRetry();
    expect(await reconcileNullVerdict()).toBe('reload');
  });

  it('a corrupt blob is not a session — it waits for Firebase, and a null is a sign-out', async () => {
    await AsyncStorage.setItem(AUTH_KEY, '{not json');
    expect(await reconcileNullVerdict()).toBe('signed-out');
  });
});
