import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { trackSubs } from '@/lib/sub-debug';

type Unsub = () => void;

/**
 * The subscription POLICY every reading hook was hand-rolling.
 *
 * `useToday`, `useTrain`, `useHistory` and the rest are separate hooks on
 * purpose — each opens and owns its own `onSnapshot` channels and ADR-0016 says
 * to keep it that way. **This is not a shared subscription cache, a context, or
 * a shared listener.** Nothing here calls `subscribe*`; every caller still
 * constructs its own, and the concurrent-listener count is unchanged.
 *
 * What moved is the glue that sat around those calls, which is where the drift
 * was. Thirteen hooks each re-decided: focus-gate or mount-gate; wrap in
 * `trackSubs` or not; honour `meta.fromCache` or not; settle the spinner on the
 * first answer or only on a server one; pass an `onError`, swallow it, or pass
 * none at all. Four of those five decisions have already been a shipped bug —
 * a permanent listener behind a blurred tab, an untracked unsub array, an empty
 * offline snapshot written through as real data (three publishes, see
 * `useCachedState`), and a seed calorie target rendered forever after a failed
 * listener. None of them is visible at the call site that gets it wrong.
 *
 * So the policy is stated once, here, and a caller states only what is
 * genuinely its own: which channels, under which gate, and where each snapshot
 * lands. This is exactly what `useLogWrites` did for the write side.
 *
 * ## Provenance is not optional and not inferred
 *
 * Firestore runs memory-only in this app (RN has no IndexedDB), so an offline
 * listener fires immediately with an EMPTY result carrying `fromCache: true`.
 * That is the absence of an answer. Every channel's `apply` therefore receives
 * `{ authoritative }` as a second argument: a `useCachedState` setter reads it
 * (and must, or it poisons the disk cache for the next cold start), a plain
 * `useState` setter ignores the extra argument, and neither call site can
 * forget to pass it because this module passes it.
 */
export type ReadyPolicy =
  /** Only a server answer marks this channel answered. An offline listener's
   *  immediate cache hit is not an answer, so the spinner stays up. */
  | 'server'
  /** Any answer marks it — server, cache, present or genuinely absent. What a
   *  channel wants when requiring a server answer would hang a cold-cache
   *  offline start. */
  | 'any'
  /** This channel never gates readiness. It still delivers and still honours
   *  provenance; it just is not something the screen waits for. */
  | 'none';

/** Fed to a channel when the feed opens. */
interface FeedRuntime {
  mark: (key: string) => void;
  fail: (e: unknown) => void;
}

/** A channel descriptor. Opaque — build one with {@link feedChannel}. */
export interface LedgerChannel<K extends string = string> {
  readonly key: K;
  readonly settles: ReadyPolicy;
  /** @internal */
  readonly attach: (rt: FeedRuntime) => Unsub;
}

export interface FeedChannelSpec<T, K extends string> {
  /** Names this channel in `answered`. One per subscription. */
  key: K;
  /**
   * Open the subscription and return its unsub — the ONE line that stays the
   * caller's (ADR-0016). Hand `deliver` and `fail` straight to the `subscribe*`
   * helper. **Omitting `fail` is how a channel swallows its errors**, which
   * several deliberately do; say why at the call site.
   */
  open: (
    deliver: (value: T, meta?: { fromCache: boolean }) => void,
    fail: (e: unknown) => void,
  ) => Unsub;
  /** Where the snapshot lands. The second argument is the provenance a
   *  `useCachedState` setter needs; a `useState` setter simply ignores it. */
  apply: (value: T, provenance: { authoritative: boolean }) => void;
  /** Default `'any'`. */
  settles?: ReadyPolicy;
}

export function feedChannel<T, const K extends string>(
  spec: FeedChannelSpec<T, K>,
): LedgerChannel<K> {
  const settles = spec.settles ?? 'any';
  return {
    key: spec.key,
    settles,
    attach: ({ mark, fail }) =>
      spec.open((value, meta) => {
        const authoritative = !meta?.fromCache;
        spec.apply(value, { authoritative });
        if (settles === 'any' || (settles === 'server' && authoritative)) mark(spec.key);
      }, fail),
  };
}

/**
 * Narrow a `catch`/`onError` value to an `Error`.
 *
 * Exported because the same three tokens were written eight times in `useTrain`
 * alone, once per write verb, each with its own fallback string — and a
 * rejection that reaches Sentry as a non-Error arrives with no stack frames and
 * no screen name (IGNIA-MOBILE-6).
 */
export function asError(e: unknown, fallback: string): Error {
  return e instanceof Error ? e : new Error(fallback);
}

export interface LedgerFeedOptions<K extends string> {
  uid: string | undefined;
  /** Screen name for the dev listener counter (`trackSubs`). Use the surface
   *  the hook belongs to, so a leak names itself in the console. */
  label: string;
  /**
   * `'focus'` is the ADR-0016 default and what bounds the per-hook duplication:
   * a blurred tab tears its listeners down. `'mount'` is for the hooks that
   * must keep answering while something else holds the screen — it is a real
   * choice with a real cost, so it is stated, never defaulted.
   */
  gate: 'focus' | 'mount';
  /** The caller's own `subscribe*` calls. Return `[]` when there is nothing to
   *  subscribe (no uid) — a feed with no channels is never `ready`. */
  channels: () => readonly LedgerChannel<K>[];
  /** Dependencies of `channels`, exactly as the `useCallback` they replace. */
  deps: readonly unknown[];
  /** Default true. False keeps the feed closed without unmounting the caller. */
  enabled?: boolean;
  /**
   * Clear `error`/`failed` on every re-open, making a refocus a retry.
   * Default false: an error that already released the spinner must not put it
   * back. Only a hook whose readiness is *blocked* by a standing error wants
   * this, or a transient failure strands the screen forever.
   */
  retryOnOpen?: boolean;
  /**
   * One-shot work per open cycle — a `get*` read that must not become a
   * listener. `alive()` is false after teardown, so a late resolve is dropped.
   */
  onOpen?: (ctx: { uid: string; alive: () => boolean; fail: (e: unknown) => void }) => void;
  /** Tap listener failures into an error slot the caller already owns (a hook
   *  that records write failures in the same one). The feed still tracks its
   *  own `error` either way. */
  onError?: (e: Error) => void;
}

export interface LedgerFeed<K extends string> {
  /** Per channel: has an answer of the kind that channel accepts arrived?
   *  A `settles: 'none'` channel stays false — it is not tracked. */
  answered: Readonly<Record<K, boolean>>;
  /** Every readiness-bearing channel has answered. */
  ready: boolean;
  /** The last error a channel reported, narrowed. */
  error: Error | null;
  /** A channel errored. Distinct from `error` so a spinner can end on a
   *  failure without the caller having to treat "no error yet" as "loading". */
  failed: boolean;
}

interface FeedState {
  /** The account these marks belong to. */
  uid: string | undefined;
  marks: Record<string, boolean>;
  error: Error | null;
  failed: boolean;
}

const NO_MARKS: Record<string, boolean> = Object.freeze({});

export function useLedgerFeed<K extends string>(opts: LedgerFeedOptions<K>): LedgerFeed<K> {
  const { uid, label, gate, enabled = true, retryOnOpen = false } = opts;
  // The caller's `deps` are its own — this is the `useCallback` dep array every
  // migrated hook already carried, moved one level up rather than invented.
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps
  const channels = useMemo(opts.channels, opts.deps);

  // Held in refs so a caller need not memoize them; both are read only inside
  // an open cycle, where the latest closure is the right one. Synced in an
  // effect declared BEFORE the two gates, so it has always run by the time a
  // cycle opens in the same commit.
  const onOpenRef = useRef(opts.onOpen);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onOpenRef.current = opts.onOpen;
    onErrorRef.current = opts.onError;
  });

  const [raw, setRaw] = useState<FeedState>(() => ({
    uid,
    marks: {},
    error: null,
    failed: false,
  }));

  // Readiness is keyed to the ACCOUNT, not to the subscription cycle. Resetting
  // it on every refocus would flip `ready` false for a frame and flash a "—"
  // over a number the user was already looking at; Firestore answers a refocus
  // from its own cache anyway. A different uid is a different question, so that
  // does reset.
  const fresh = raw.uid !== uid;
  const marks = fresh ? NO_MARKS : raw.marks;
  const error = fresh ? null : raw.error;
  const failed = fresh ? false : raw.failed;

  const open = useCallback(() => {
    if (!uid || !enabled) return;
    let alive = true;
    /** Carry marks across a re-open of the SAME account; drop them otherwise. */
    const rebase = (p: FeedState): FeedState =>
      p.uid === uid ? p : { uid, marks: {}, error: null, failed: false };

    if (retryOnOpen) {
      setRaw((p) => {
        const b = rebase(p);
        return b.error == null && !b.failed ? b : { ...b, error: null, failed: false };
      });
    }

    const rt: FeedRuntime = {
      mark: (key) =>
        setRaw((p) => {
          const b = rebase(p);
          return b.marks[key] ? b : { ...b, marks: { ...b.marks, [key]: true } };
        }),
      fail: (e) => {
        const err = asError(e, `${label}: subscription failed`);
        onErrorRef.current?.(err);
        setRaw((p) => ({ ...rebase(p), error: err, failed: true }));
      },
    };

    const unsubs = channels.map((c) => c.attach(rt));
    onOpenRef.current?.({ uid, alive: () => alive, fail: rt.fail });
    const stop = trackSubs(label, unsubs);
    return () => {
      alive = false;
      stop();
    };
  }, [uid, enabled, label, retryOnOpen, channels]);

  // Both gates are wired unconditionally — hooks cannot be called by branch —
  // and the one that does not match returns without opening anything.
  useFocusEffect(useCallback(() => (gate === 'focus' ? open() : undefined), [gate, open]));
  // Opening a listener IS the "subscribe to an external system" case the rule
  // below exempts; the only synchronous setState in `open` is `retryOnOpen`.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => (gate === 'mount' ? open() : undefined), [gate, open]);

  const ready = useMemo(
    () => channels.length > 0 && channels.every((c) => c.settles === 'none' || marks[c.key]),
    [channels, marks],
  );

  return { answered: marks as Record<K, boolean>, ready, error, failed };
}
