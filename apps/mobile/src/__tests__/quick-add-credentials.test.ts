import { Platform } from 'react-native';

/**
 * The iOS credential envelope's lifecycle (ADR-0020).
 *
 * This covers exactly one bug, because that bug was invisible everywhere else.
 *
 * `syncQuickAddCredentials` refuses to write an envelope while
 * `user.refreshToken` is empty — correctly, since an empty envelope makes an
 * intent report a failure instead of "sign in again" — and **clears** the
 * existing one instead. It used to be called from an effect keyed on the
 * **uid**. `onAuthStateChanged` sets the uid the instant a session is restored
 * from disk, and the refresh token is not populated yet at that instant, so the
 * envelope was cleared and nothing ever re-ran: the uid was already set and
 * never changed again.
 *
 * Downstream, `QuickAdd.log` returns `.signedOut` and `LogQuickAddSlotIntent`
 * returns a bare `.result()` with no dialog — so a widget tap did *nothing at
 * all*. No row, no error, no moved number, nothing in Sentry. It was reported
 * from a device on 2026-08-08 as "when I click on preset from the widget,
 * nothing happens", against code whose Siri path had been proven working on
 * hardware three builds earlier. It is session-dependent, which is why it passed
 * device QA once and failed later.
 *
 * The fix is `watchQuickAddCredentials`, which listens to `onIdTokenChanged`
 * rather than to the uid — that event also fires on the token refresh, which is
 * the transition that was being missed.
 */

const mockSet = jest.fn<Promise<void>, [unknown]>();
const mockClear = jest.fn<Promise<void>, []>();

const mockAuth: {
  user: { uid: string; refreshToken: string } | null;
  listener: ((u: unknown) => void) | null;
} = { user: null, listener: null };

jest.mock('../../modules/quick-add-credentials', () => ({
  setQuickAddCredentials: (c: unknown) => mockSet(c),
  clearQuickAddCredentials: () => mockClear(),
}));

jest.mock('../../modules/quick-add-tile', () => ({ setTileState: jest.fn() }));
jest.mock('@/lib/ledger', () => ({ addLogWithId: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportNutrition: jest.fn() }));
jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    get() {
      return undefined;
    }
    set() {}
    static reloadWidget() {}
  },
}));

jest.mock('@/lib/firebase', () => ({
  db: {},
  NATIVE_REST_CONFIG: { apiKey: 'test-key', projectId: 'test-project' },
  auth: {
    get currentUser() {
      return mockAuth.user;
    },
  },
  onSessionTokenChanged: (cb: () => void) => {
    mockAuth.listener = cb;
    return () => {
      mockAuth.listener = null;
    };
  },
}));

// Imported after the mocks are registered.
import { syncQuickAddCredentials, watchQuickAddCredentials } from '@/lib/quick-add';

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

/** What the SDK looks like the instant a session is restored from disk. */
const RESTORING = { uid: 'u1', refreshToken: '' };
/** What it looks like once the first token refresh has landed. */
const READY = { uid: 'u1', refreshToken: 'rt-abc' };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = null;
  mockAuth.listener = null;
  mockSet.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
  setPlatform('ios');
});

describe('syncQuickAddCredentials', () => {
  it('writes the envelope for a session that has a refresh token', async () => {
    mockAuth.user = READY;
    await syncQuickAddCredentials();
    expect(mockSet).toHaveBeenCalledWith({
      refreshToken: 'rt-abc',
      uid: 'u1',
      apiKey: 'test-key',
      projectId: 'test-project',
    });
  });

  it('clears rather than writing an empty envelope mid-restore', async () => {
    mockAuth.user = RESTORING;
    await syncQuickAddCredentials();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalled();
  });

  it('clears on sign-out — the envelope is the one thing that can still write', async () => {
    mockAuth.user = null;
    await syncQuickAddCredentials();
    expect(mockClear).toHaveBeenCalled();
  });

  it('is a no-op on Android, which needs no bare credential', async () => {
    setPlatform('android');
    mockAuth.user = READY;
    await syncQuickAddCredentials();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe('watchQuickAddCredentials', () => {
  it('RE-WRITES the envelope when the token arrives after the uid', async () => {
    // The regression. Keyed on the uid, the second event below never happened
    // and the envelope stayed cleared for the whole session — every widget tap
    // silently doing nothing.
    watchQuickAddCredentials();

    mockAuth.user = RESTORING;
    mockAuth.listener?.(RESTORING);
    await Promise.resolve();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalled();

    mockAuth.user = READY;
    mockAuth.listener?.(READY);
    await Promise.resolve();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'rt-abc' }));
  });

  it('clears on the sign-out event', async () => {
    watchQuickAddCredentials();
    mockAuth.user = READY;
    mockAuth.listener?.(READY);
    await Promise.resolve();
    mockSet.mockClear();

    mockAuth.user = null;
    mockAuth.listener?.(null);
    await Promise.resolve();
    expect(mockClear).toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('unsubscribes, so a remount does not stack listeners', () => {
    const unsub = watchQuickAddCredentials();
    expect(mockAuth.listener).not.toBeNull();
    unsub();
    expect(mockAuth.listener).toBeNull();
  });

  it('subscribes to nothing on Android', () => {
    setPlatform('android');
    watchQuickAddCredentials();
    expect(mockAuth.listener).toBeNull();
  });
});
