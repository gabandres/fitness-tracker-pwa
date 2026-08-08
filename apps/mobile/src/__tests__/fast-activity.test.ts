import { parseFastActivityStatus } from '../../modules/fasting-live-activity';
import { reconcileFastActivity } from '@/lib/fast-activity';

/**
 * The JS half of the fasting Live Activity (N3): the status parser and the
 * reconciler.
 *
 * The reconciler is where the feature's one non-obvious decision lives — it
 * compares iOS against Firestore on every foreground instead of reacting to
 * start/break — because iOS ends an Activity at the 8-hour mark and the user can
 * swipe it away, and neither event is observable from JS. Getting that branching
 * wrong is invisible on a device until a fast has been running for hours, which
 * is exactly the kind of thing that should not need a device to check.
 */

const mockStart = jest.fn();
const mockEnd = jest.fn();
const mockStatus = jest.fn();

jest.mock('../../modules/fasting-live-activity', () => ({
  ...jest.requireActual('../../modules/fasting-live-activity'),
  startFastActivity: (...args: unknown[]) => mockStart(...args),
  endFastActivity: (...args: unknown[]) => mockEnd(...args),
  getFastActivityStatus: (...args: unknown[]) => mockStatus(...args),
}));

const FAST_START = new Date('2026-08-08T02:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockStart.mockResolvedValue(null);
  mockEnd.mockResolvedValue(null);
});

describe('parseFastActivityStatus', () => {
  it('parses a running activity back into its attributes', () => {
    expect(parseFastActivityStatus(`running:${FAST_START.getTime()}:es-PR`)).toEqual({
      state: 'running',
      startedAtMs: FAST_START.getTime(),
      locale: 'es-PR',
    });
  });

  it.each(['stopped', 'disabled', 'unsupported', 'unavailable'])('passes %s through', (raw) => {
    expect(parseFastActivityStatus(raw)).toEqual({ state: raw });
  });

  it('treats an unknown word as unavailable rather than guessing', () => {
    expect(parseFastActivityStatus('somethingelse')).toEqual({ state: 'unavailable' });
  });

  it('treats a malformed running payload as stopped, so the caller re-arms', () => {
    // Reading it as "running" would leave a broken Lock Screen alone forever;
    // reading it as "stopped" costs one redundant request.
    expect(parseFastActivityStatus('running::en')).toEqual({ state: 'stopped' });
    expect(parseFastActivityStatus('running:abc:en')).toEqual({ state: 'stopped' });
  });
});

describe('reconcileFastActivity', () => {
  it('arms a fast that has no activity — the 8-hour re-arm', async () => {
    mockStatus.mockResolvedValue({ state: 'stopped' });
    await reconcileFastActivity(FAST_START, 'en');
    // Armed with the fast's TRUE start, never `now`: this is what makes a
    // re-armed timer show 9:04 instead of restarting at 0:00.
    expect(mockStart).toHaveBeenCalledWith(FAST_START, 'en');
  });

  it('leaves an activity alone when it already shows this fast', async () => {
    mockStatus.mockResolvedValue({
      state: 'running',
      startedAtMs: FAST_START.getTime(),
      locale: 'en',
    });
    await reconcileFastActivity(FAST_START, 'en');
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('replaces an activity counting from a different fast', async () => {
    // The web PWA writes the same `fastStartedAt`, so a fast can be broken and
    // restarted while this app is closed. Nothing else would ever correct it.
    mockStatus.mockResolvedValue({
      state: 'running',
      startedAtMs: FAST_START.getTime() - 3_600_000,
      locale: 'en',
    });
    await reconcileFastActivity(FAST_START, 'en');
    expect(mockStart).toHaveBeenCalledWith(FAST_START, 'en');
  });

  it('replaces an activity armed in the other locale', async () => {
    // Attributes are immutable, so a language change can only be applied by
    // replacing the Activity.
    mockStatus.mockResolvedValue({
      state: 'running',
      startedAtMs: FAST_START.getTime(),
      locale: 'en',
    });
    await reconcileFastActivity(FAST_START, 'es-PR');
    expect(mockStart).toHaveBeenCalledWith(FAST_START, 'es-PR');
  });

  it('ends the activity when the fast is over', async () => {
    mockStatus.mockResolvedValue({
      state: 'running',
      startedAtMs: FAST_START.getTime(),
      locale: 'en',
    });
    await reconcileFastActivity(null, 'en');
    expect(mockEnd).toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does nothing at all when not fasting and nothing is running', async () => {
    mockStatus.mockResolvedValue({ state: 'stopped' });
    await reconcileFastActivity(null, 'en');
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('honours the user turning Live Activities off, silently', async () => {
    mockStatus.mockResolvedValue({ state: 'disabled' });
    await reconcileFastActivity(FAST_START, 'en');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'unsupported'])(
    'is inert on %s — Android, Expo Go, web, or iOS below 16.1',
    async (state) => {
      mockStatus.mockResolvedValue({ state });
      await reconcileFastActivity(FAST_START, 'en');
      await reconcileFastActivity(null, 'en');
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockEnd).not.toHaveBeenCalled();
    },
  );
});
