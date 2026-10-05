/**
 * The rest-timer Live Activity's JS seam (Train review item 20): what reaches
 * the native module, and how a Lock Screen "+30 s" / "Skip" is turned back into
 * something the in-app rest bar can do.
 *
 * The second half is where the feature's non-obvious decisions live — which
 * Lock Screen actions belong to THIS rest, and the race where the app's own
 * tick closed a rest a beat before the drain saw the lifter's +30 s — and none
 * of it needs a device to check.
 */

const mockStart = jest.fn(async (..._a: unknown[]) => null);
const mockUpdate = jest.fn(async (..._a: unknown[]) => null);
const mockEnd = jest.fn(async () => null);
const mockStatus = jest.fn(async () => 'stopped');

jest.mock('../../modules/rest-timer-activity', () => ({
  startRestActivity: (...a: unknown[]) => mockStart(...a),
  updateRestActivity: (...a: unknown[]) => mockUpdate(...a),
  endRestActivity: () => mockEnd(),
  getRestActivityStatus: () => mockStatus(),
}));

import {
  REST_ACTION_MAX_AGE_MS,
  __currentRestActivity,
  __resetRestActivity,
  applyRestInboxAction,
  end,
  reconcileWithNative,
  start,
  update,
} from '@/lib/rest-timer-activity';

const T0 = 1_759_600_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  __resetRestActivity();
});

describe('the app → Lock Screen direction', () => {
  it('start hands the absolute deadline, the exercise and the locale to native', () => {
    start(T0 + 90_000, 'Bench', 'es-PR', T0);
    expect(mockStart).toHaveBeenCalledWith(T0 + 90_000, 'Bench', 'es-PR');
    expect(__currentRestActivity()).toEqual({ endsAt: T0 + 90_000, exerciseName: 'Bench', startedAt: T0, locale: 'es-PR' });
  });

  it('update moves the deadline only while a rest is showing', () => {
    update(T0);
    expect(mockUpdate).not.toHaveBeenCalled();
    start(T0 + 60_000, 'Squat', 'en', T0);
    update(T0 + 90_000);
    expect(mockUpdate).toHaveBeenCalledWith(T0 + 90_000);
    expect(__currentRestActivity()?.endsAt).toBe(T0 + 90_000);
  });

  it('end ALWAYS reaches native, even when the seam remembers no rest (re-score bug 2)', () => {
    // After a JS restart `current` is gone but the Lock Screen face is not; an
    // end that returned early on a null `current` left it there for 8 hours.
    end();
    expect(mockEnd).toHaveBeenCalledTimes(1);
    start(T0 + 60_000, 'Row', 'en', T0);
    end();
    expect(mockEnd).toHaveBeenCalledTimes(2);
    expect(__currentRestActivity()).toBeNull();
  });
});

describe('reconcileWithNative — an Activity that outlived a JS restart', () => {
  beforeEach(() => mockStatus.mockReset());

  it('re-adopts a running rest and says how long is left', async () => {
    mockStatus.mockResolvedValue(`running:${T0 + 45_000}`);
    const out = await reconcileWithNative('Bench', 'es-PR', T0);
    expect(out).toEqual({ type: 'restore', endsAt: T0 + 45_000, seconds: 45 });
    expect(__currentRestActivity()).toEqual({ endsAt: T0 + 45_000, exerciseName: 'Bench', startedAt: T0, locale: 'es-PR' });
    // Native already shows it; nothing is re-requested.
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('after which the Lock Screen buttons apply again', async () => {
    mockStatus.mockResolvedValue(`running:${T0 + 45_000}`);
    await reconcileWithNative('Bench', 'en', T0);
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 + 1_000, endsAtMs: T0 + 75_000 }, T0 + 2_000))
      .toEqual({ type: 'retarget', endsAt: T0 + 75_000, seconds: 73 });
  });

  it('clears a stale "Rest over" face nobody else would', async () => {
    mockStatus.mockResolvedValue(`running:${T0 - 5_000}`);
    expect(await reconcileWithNative('Bench', 'en', T0)).toBeNull();
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(__currentRestActivity()).toBeNull();
  });

  it('does nothing when no Activity is up, or the module is absent', async () => {
    for (const status of ['stopped', 'disabled', 'unsupported', 'unavailable']) {
      mockStatus.mockResolvedValue(status);
      expect(await reconcileWithNative('Bench', 'en', T0)).toBeNull();
    }
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('leaves a rest this runtime already knows about alone', async () => {
    start(T0 + 90_000, 'Squat', 'en', T0);
    mockStatus.mockResolvedValue(`running:${T0 + 30_000}`);
    expect(await reconcileWithNative('Bench', 'en', T0)).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(__currentRestActivity()?.endsAt).toBe(T0 + 90_000);
  });
});

describe('applyRestInboxAction — the Lock Screen → app direction', () => {
  it('Skip stops a running rest, and does not echo anything back to native', () => {
    start(T0 + 90_000, 'Bench', 'en', T0);
    jest.clearAllMocks();
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 + 10_000, endsAtMs: 0 }, T0 + 12_000)).toEqual({ type: 'skip' });
    expect(__currentRestActivity()).toBeNull();
    // The button already ended the Activity; a second end would race it.
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('+30 s retargets the running rest to the deadline the button set', () => {
    start(T0 + 90_000, 'Bench', 'en', T0);
    jest.clearAllMocks();
    const out = applyRestInboxAction({ kind: 'rest', atMs: T0 + 20_000, endsAtMs: T0 + 120_000 }, T0 + 30_000);
    expect(out).toEqual({ type: 'retarget', endsAt: T0 + 120_000, seconds: 90 });
    expect(__currentRestActivity()?.endsAt).toBe(T0 + 120_000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('ignores an action from an EARLIER rest', () => {
    start(T0 + 90_000, 'Bench', 'en', T0);
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 - 1, endsAtMs: 0 }, T0 + 1_000)).toBeNull();
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 - 1, endsAtMs: T0 + 200_000 }, T0 + 1_000)).toBeNull();
    expect(__currentRestActivity()?.endsAt).toBe(T0 + 90_000);
  });

  it('a deadline already in the past changes nothing', () => {
    start(T0 + 90_000, 'Bench', 'en', T0);
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0 + 1_000, endsAtMs: T0 + 5_000 }, T0 + 10_000)).toBeNull();
  });

  it('Skip with no rest running is nothing', () => {
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0, endsAtMs: 0 }, T0)).toBeNull();
  });

  it('RESUMES when the app had already closed the rest the lifter just extended', () => {
    // The phone sat locked past the deadline; the app's own tick ended the rest
    // (and the Activity) on unlock, a beat before the drain saw the +30 s.
    start(T0 + 60_000, 'Deadlift', 'pt-BR', T0);
    end();
    const out = applyRestInboxAction({ kind: 'rest', atMs: T0 + 70_000, endsAtMs: T0 + 100_000 }, T0 + 72_000);
    expect(out).toEqual({ type: 'resume', endsAt: T0 + 100_000, seconds: 28, exerciseName: 'Deadlift', locale: 'pt-BR' });
  });

  it('but never resumes from a stale note left by some earlier workout', () => {
    start(T0 + 60_000, 'Deadlift', 'en', T0);
    end();
    const late = T0 + REST_ACTION_MAX_AGE_MS + 1;
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0, endsAtMs: late + 30_000 }, late)).toBeNull();
  });

  it('and never resumes when this session never started a rest', () => {
    expect(applyRestInboxAction({ kind: 'rest', atMs: T0, endsAtMs: T0 + 30_000 }, T0 + 1)).toBeNull();
  });
});
