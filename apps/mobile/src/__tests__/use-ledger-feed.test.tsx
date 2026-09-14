import { act, renderHook } from '@testing-library/react-native';

/**
 * `useLedgerFeed` — the subscription policy thirteen hooks used to each
 * re-decide.
 *
 * Every case here is a decision that has already shipped wrong somewhere in
 * this app: a listener held awake behind a blurred tab, an unsub array nothing
 * tore down, an offline listener's EMPTY `fromCache: true` snapshot treated as
 * real data (three publishes, see `cached-state-provenance.test.ts`), and a
 * rejected listener whose error reached Sentry with no stack frames because
 * nobody narrowed it. The module exists so those are answered once; these tests
 * are what stops the answers drifting back.
 */

/** Drives the focus gate. Flipped by a test, then re-read on the next render. */
const mockFocus = { focused: true };
/** What `trackSubs` was handed, so the labelling is assertable. */
const mockTracked: { label: string; count: number }[] = [];

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    const focused = mockFocus.focused;
    React.useEffect(() => {
      if (!focused) return;
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb, focused]);
  },
}));

jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (label: string, unsubs: (() => void)[]) => {
    mockTracked.push({ label, count: unsubs.length });
    return () => unsubs.forEach((u) => u());
  },
}));

import { asError, feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';

type Deliver = (value: string[], meta?: { fromCache: boolean }) => void;
type Fail = (e: unknown) => void;

/** A stand-in for one `subscribe*` helper: records what it was handed so a test
 *  can push a snapshot or an error through it, and counts its own teardown. */
function stubChannel() {
  const calls: { deliver: Deliver; fail: Fail }[] = [];
  const unsub = jest.fn();
  return {
    calls,
    unsub,
    /** The newest open cycle's callbacks. */
    get live() {
      return calls[calls.length - 1];
    },
    open: (deliver: Deliver, fail: Fail) => {
      calls.push({ deliver, fail });
      return unsub;
    },
  };
}

beforeEach(() => {
  mockFocus.focused = true;
  mockTracked.length = 0;
});

describe('useLedgerFeed gating', () => {
  it('a focus-gated feed opens nothing until the screen is focused', async () => {
    mockFocus.focused = false;
    const ch = stubChannel();
    const applied: string[][] = [];
    const { rerender } = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Today',
        gate: 'focus',
        channels: () => [
          feedChannel({ key: 'logs', open: ch.open, apply: (v: string[]) => applied.push(v) }),
        ],
        deps: [],
      }),
    );
    expect(ch.calls).toHaveLength(0);

    mockFocus.focused = true;
    await act(async () => rerender({}));
    expect(ch.calls).toHaveLength(1);
    expect(mockTracked).toEqual([{ label: 'Today', count: 1 }]);
  });

  it('a mount-gated feed opens with no focus at all — background sync may depend on it', async () => {
    mockFocus.focused = false;
    const ch = stubChannel();
    await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'History',
        gate: 'mount',
        channels: () => [feedChannel({ key: 'logs', open: ch.open, apply: () => {} })],
        deps: [],
      }),
    );
    expect(ch.calls).toHaveLength(1);
    expect(mockTracked).toEqual([{ label: 'History', count: 1 }]);
  });

  it('opens nothing without a uid, and nothing when disabled', async () => {
    const ch = stubChannel();
    const feed = (uid: string | undefined, enabled: boolean) => () =>
      useLedgerFeed({
        uid,
        label: 'Day',
        gate: 'focus',
        enabled,
        channels: () =>
          uid ? [feedChannel({ key: 'fasts', open: ch.open, apply: () => {} })] : [],
        deps: [uid],
      });

    const anon = await renderHook(feed(undefined, true));
    expect(ch.calls).toHaveLength(0);
    expect(anon.result.current.ready).toBe(false);

    const off = await renderHook(feed('u1', false));
    expect(ch.calls).toHaveLength(0);
    expect(off.result.current.ready).toBe(false);
  });

  it('tears every channel down on blur and on unmount', async () => {
    const a = stubChannel();
    const b = stubChannel();
    const { rerender, unmount } = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Train',
        gate: 'focus',
        channels: () => [
          feedChannel({ key: 'a', open: a.open, apply: () => {} }),
          feedChannel({ key: 'b', open: b.open, apply: () => {} }),
        ],
        deps: [],
      }),
    );
    expect(mockTracked).toEqual([{ label: 'Train', count: 2 }]);

    mockFocus.focused = false;
    await act(async () => rerender({}));
    expect(a.unsub).toHaveBeenCalledTimes(1);
    expect(b.unsub).toHaveBeenCalledTimes(1);

    mockFocus.focused = true;
    await act(async () => rerender({}));
    expect(a.calls).toHaveLength(2);
    await act(async () => unmount());
    expect(a.unsub).toHaveBeenCalledTimes(2);
    expect(b.unsub).toHaveBeenCalledTimes(2);
  });

  it('runs onOpen once per cycle and drops a resolve that lands after teardown', async () => {
    const ch = stubChannel();
    const late: string[] = [];
    let release: (() => void) | null = null;
    const { rerender } = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Train',
        gate: 'focus',
        onOpen: ({ uid, alive }) => {
          release = () => {
            if (alive()) late.push(uid);
          };
        },
        channels: () => [feedChannel({ key: 'a', open: ch.open, apply: () => {} })],
        deps: [],
      }),
    );
    const whileOpen = release!;
    mockFocus.focused = false;
    await act(async () => rerender({}));
    whileOpen();
    expect(late).toEqual([]);
  });
});

describe('useLedgerFeed provenance', () => {
  /** One `settles: 'server'` channel, as Today's logs and Train's sessions are. */
  async function renderServerGated() {
    const ch = stubChannel();
    const applied: { value: string[]; authoritative: boolean }[] = [];
    const hook = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Today',
        gate: 'focus',
        channels: () => [
          feedChannel({
            key: 'logs',
            settles: 'server',
            open: ch.open,
            apply: (value: string[], provenance) =>
              applied.push({ value, authoritative: provenance.authoritative }),
          }),
        ],
        deps: [],
      }),
    );
    return { ch, applied, hook };
  }

  it('a cache answer is applied as NOT authoritative and does not settle readiness', async () => {
    const { ch, applied, hook } = await renderServerGated();
    // Exactly what an offline listener does: fires immediately, empty, cached.
    await act(async () => ch.live.deliver([], { fromCache: true }));

    expect(applied).toEqual([{ value: [], authoritative: false }]);
    expect(hook.result.current.answered.logs).toBeFalsy();
    expect(hook.result.current.ready).toBe(false);
  });

  it('a server answer settles it, and is applied as authoritative', async () => {
    const { ch, applied, hook } = await renderServerGated();
    await act(async () => ch.live.deliver(['a'], { fromCache: false }));

    expect(applied).toEqual([{ value: ['a'], authoritative: true }]);
    expect(hook.result.current.ready).toBe(true);
  });

  it('a channel with no meta at all is authoritative — the older helpers pass none', async () => {
    const { ch, applied } = await renderServerGated();
    await act(async () => ch.live.deliver(['a']));
    expect(applied).toEqual([{ value: ['a'], authoritative: true }]);
  });

  it("settles: 'any' accepts a cache answer — requiring a server one hangs a cold offline start", async () => {
    const ch = stubChannel();
    const hook = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Today',
        gate: 'focus',
        channels: () => [
          feedChannel({ key: 'profile', settles: 'any', open: ch.open, apply: () => {} }),
        ],
        deps: [],
      }),
    );
    await act(async () => ch.live.deliver([], { fromCache: true }));
    expect(hook.result.current.answered.profile).toBe(true);
    expect(hook.result.current.ready).toBe(true);
  });

  it("settles: 'none' still delivers with provenance but never gates the spinner", async () => {
    const gate = stubChannel();
    const extra = stubChannel();
    const applied: boolean[] = [];
    const hook = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Today',
        gate: 'focus',
        channels: () => [
          feedChannel({ key: 'logs', settles: 'server', open: gate.open, apply: () => {} }),
          feedChannel({
            key: 'weights',
            settles: 'none',
            open: extra.open,
            apply: (_v: string[], p) => applied.push(p.authoritative),
          }),
        ],
        deps: [],
      }),
    );
    await act(async () => extra.live.deliver([], { fromCache: true }));
    expect(applied).toEqual([false]);
    expect(hook.result.current.answered.weights).toBeFalsy();
    expect(hook.result.current.ready).toBe(false);

    await act(async () => gate.live.deliver(['a']));
    expect(hook.result.current.ready).toBe(true);
  });

  it('readiness is keyed to the account, so a refocus does not flash it false', async () => {
    const ch = stubChannel();
    const hook = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Body',
        gate: 'focus',
        channels: () => [feedChannel({ key: 'm', open: ch.open, apply: () => {} })],
        deps: [],
      }),
    );
    await act(async () => ch.live.deliver(['a']));
    expect(hook.result.current.ready).toBe(true);

    mockFocus.focused = false;
    await act(async () => hook.rerender({}));
    mockFocus.focused = true;
    await act(async () => hook.rerender({}));
    expect(hook.result.current.ready).toBe(true);
  });
});

describe('useLedgerFeed errors', () => {
  async function renderWithError(retryOnOpen = false) {
    const ch = stubChannel();
    const tapped: Error[] = [];
    const hook = await renderHook(() =>
      useLedgerFeed({
        uid: 'u1',
        label: 'Train',
        gate: 'focus',
        retryOnOpen,
        onError: (e) => tapped.push(e),
        channels: () => [
          feedChannel({ key: 'sessions', settles: 'server', open: ch.open, apply: () => {} }),
        ],
        deps: [],
      }),
    );
    return { ch, tapped, hook };
  }

  it('passes a real Error through untouched and taps it into the caller slot', async () => {
    const { ch, tapped, hook } = await renderWithError();
    const boom = new Error('permission-denied');
    await act(async () => ch.live.fail(boom));

    const feed = hook.result.current;
    expect(feed.error).toBe(boom);
    expect(feed.failed).toBe(true);
    expect(tapped).toEqual([boom]);
  });

  it('narrows a thrown non-Error, so nothing reaches Sentry without a stack', async () => {
    const { ch, hook } = await renderWithError();
    await act(async () => ch.live.fail('offline'));

    const feed = hook.result.current;
    expect(feed.error).toBeInstanceOf(Error);
    expect(feed.error?.message).toContain('Train');
    expect(feed.failed).toBe(true);
  });

  it('`failed` is what releases a spinner — the error does not settle readiness', async () => {
    const { ch, hook } = await renderWithError();
    await act(async () => ch.live.fail(new Error('nope')));
    const feed = hook.result.current;
    expect(feed.ready).toBe(false);
    expect(feed.failed).toBe(true);
  });

  it('keeps a standing error across a refocus by default', async () => {
    const { ch, hook } = await renderWithError(false);
    await act(async () => ch.live.fail(new Error('nope')));
    const h = hook;

    mockFocus.focused = false;
    await act(async () => h.rerender({}));
    mockFocus.focused = true;
    await act(async () => h.rerender({}));
    expect(h.result.current.failed).toBe(true);
  });

  it('retryOnOpen clears it, so a transient failure cannot strand the screen', async () => {
    const { ch, hook } = await renderWithError(true);
    await act(async () => ch.live.fail(new Error('nope')));
    const h = hook;
    expect(h.result.current.failed).toBe(true);

    mockFocus.focused = false;
    await act(async () => h.rerender({}));
    mockFocus.focused = true;
    await act(async () => h.rerender({}));
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.failed).toBe(false);
  });
});

describe('asError', () => {
  it('returns the same instance for an Error, so identity survives to Sentry', () => {
    const e = new Error('x');
    expect(asError(e, 'fallback')).toBe(e);
  });

  it('wraps anything else in the caller-supplied message', () => {
    expect(asError('x', 'Save failed').message).toBe('Save failed');
    expect(asError(undefined, 'Save failed')).toBeInstanceOf(Error);
  });
});
