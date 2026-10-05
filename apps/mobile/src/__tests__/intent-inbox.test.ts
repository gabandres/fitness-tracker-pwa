/**
 * The intent inbox's JS reader: the parser, and what happens with and without
 * the native module.
 *
 * The inbox is how a Live Activity button or a Siri phrase hands its outcome to
 * the app (`targets/_shared/IntentInbox.swift`). Swift cannot run here, so this
 * pins the half that can: malformed entries are dropped rather than guessed at
 * (a guessed instant would end a fast at the wrong time), and a binary with no
 * module — Android, Expo Go, an older iOS build reached by an OTA — reads as
 * "nothing pending" instead of throwing.
 */

const mockTake = jest.fn<Promise<string>, [string[]]>();
const mockPeek = jest.fn<Promise<string>, [string[]]>();
const mockRemove = jest.fn();
const mockAddListener = jest.fn((_event: string, _listener: () => void) => ({ remove: mockRemove }));
let mockNativePresent = true;

jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    mockNativePresent && name === 'IntentInbox'
      ? { take: mockTake, peek: mockPeek, addListener: mockAddListener }
      : null,
}));

function load() {
  let mod!: typeof import('../../modules/intent-inbox');
  jest.isolateModules(() => {
    mod = require('../../modules/intent-inbox');
  });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNativePresent = true;
});

describe('parseIntentInbox', () => {
  const { parseIntentInbox } = load();

  it('reads every kind a writer posts', () => {
    const raw = JSON.stringify([
      { kind: 'rest', atMs: 10, endsAtMs: 90_000 },
      { kind: 'rest', atMs: 11, endsAtMs: 0 },
      { kind: 'fastEnd', atMs: 12, startedAtMs: 1_000, endedAtMs: 2_000 },
      { kind: 'fastStart', atMs: 13 },
      { kind: 'fastStop', atMs: 14 },
      { kind: 'weight', atMs: 15, value: 82.5 },
      { kind: 'weight', atMs: 16 },
    ]);
    expect(parseIntentInbox(raw)).toEqual([
      { kind: 'rest', atMs: 10, endsAtMs: 90_000 },
      { kind: 'rest', atMs: 11, endsAtMs: 0 },
      { kind: 'fastEnd', atMs: 12, startedAtMs: 1_000, endedAtMs: 2_000 },
      { kind: 'fastStart', atMs: 13 },
      { kind: 'fastStop', atMs: 14 },
      { kind: 'weight', atMs: 15, value: 82.5 },
      { kind: 'weight', atMs: 16 },
    ]);
  });

  it('drops what it cannot apply safely, rather than guessing', () => {
    const raw = JSON.stringify([
      { kind: 'fastEnd', atMs: 12, startedAtMs: 0, endedAtMs: 2_000 }, // no fast named
      { kind: 'fastEnd', atMs: 12, startedAtMs: 1_000 }, // no end instant
      { kind: 'rest', atMs: 10 }, // no deadline
      { kind: 'rest', atMs: 10, endsAtMs: -5 },
      { kind: 'fastStart' }, // no instant at all
      { kind: 'mystery', atMs: 1 },
      null,
      'nope',
    ]);
    expect(parseIntentInbox(raw)).toEqual([]);
  });

  it('treats a zero or negative weight as "no number", not as a weight', () => {
    expect(parseIntentInbox(JSON.stringify([{ kind: 'weight', atMs: 1, value: 0 }]))).toEqual([
      { kind: 'weight', atMs: 1 },
    ]);
  });

  it('survives garbage', () => {
    expect(parseIntentInbox('not json')).toEqual([]);
    expect(parseIntentInbox('{"kind":"rest"}')).toEqual([]);
  });
});

describe('take / peek / subscribe', () => {
  it('asks native for exactly the kinds given and parses the answer', async () => {
    mockTake.mockResolvedValue(JSON.stringify([{ kind: 'fastStart', atMs: 5 }]));
    const { takeIntentInbox } = load();
    await expect(takeIntentInbox(['fastStart', 'weight'])).resolves.toEqual([{ kind: 'fastStart', atMs: 5 }]);
    expect(mockTake).toHaveBeenCalledWith(['fastStart', 'weight']);
  });

  it('peek reads without taking', async () => {
    mockPeek.mockResolvedValue('[]');
    const { peekIntentInbox } = load();
    await expect(peekIntentInbox(['fastEnd'])).resolves.toEqual([]);
    expect(mockPeek).toHaveBeenCalledWith(['fastEnd']);
    expect(mockTake).not.toHaveBeenCalled();
  });

  it('never rejects, even when native does', async () => {
    mockTake.mockRejectedValue(new Error('boom'));
    const { takeIntentInbox } = load();
    await expect(takeIntentInbox(['rest'])).resolves.toEqual([]);
  });

  it('forwards the doorbell and unsubscribes cleanly', () => {
    const { subscribeIntentInbox } = load();
    const listener = jest.fn();
    const off = subscribeIntentInbox(listener);
    expect(mockAddListener).toHaveBeenCalledWith('onChange', listener);
    off();
    expect(mockRemove).toHaveBeenCalled();
  });

  it('is inert with no native module (Android, Expo Go, an older iOS binary)', async () => {
    mockNativePresent = false;
    const mod = load();
    expect(mod.isIntentInboxAvailable).toBe(false);
    await expect(mod.takeIntentInbox(['rest'])).resolves.toEqual([]);
    await expect(mod.peekIntentInbox(['fastEnd'])).resolves.toEqual([]);
    expect(() => mod.subscribeIntentInbox(() => {})()).not.toThrow();
  });
});
