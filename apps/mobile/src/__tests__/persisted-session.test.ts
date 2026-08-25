import { parsePersistedSession } from '@/lib/persisted-session';

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
