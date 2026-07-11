# 0016 — Mobile per-hook Firestore subscriptions are intentional (no shared subscription seam)

Date: 2026-07-11
Status: accepted

## Context

Every architecture review of the Expo app re-surfaces the same "smell":
each per-tab hook (`useToday`, `useHistory`, `useBody`, `useDailyTargets`,
`useTrends`) independently `onSnapshot`-subscribes to overlapping Firestore
collections (`users/{uid}` profile, `dailyWeights`, `dailyLogs`, `presets`,
`customFoods`). The `subscribe*` helpers live in
[`apps/mobile/src/lib/ledger.ts`](../../apps/mobile/src/lib/ledger.ts). On
paper this reads as a 3–4× listener amplifier on hot collections, and since
the owner is explicitly GCP/Firestore-cost-averse, the "collapse it behind
one shared, reference-counted subscription cache" refactor keeps getting
proposed (most recently arch-review candidate F, 2026-07-11).

This ADR settles it so it stops being re-litigated.

The premise the refactor assumes — many *simultaneous* live listeners on the
same collection — does not hold at runtime. Two existing mechanisms already
bound it:

1. **Focus-gating.** Every hook subscribes inside `useFocusEffect`, not
   `useEffect`. A blurred tab tears its listeners down; only the *visible*
   tab holds live `onSnapshot` channels. The dev-only `trackSubs` counter
   ([`src/lib/sub-debug.ts`](../../apps/mobile/src/lib/sub-debug.ts))
   confirms the concurrent total hovers ~3–7 and *falls* on tab blur rather
   than climbing monotonically.
2. **No screen co-mounts two of these hooks.** Each screen consumes exactly
   one (`index`→`useToday`, `trends`→`useTrends`, `body`→`useBody`,
   `settings`→`useDailyTargets`, `history`→`useHistory`). So a given
   collection is never subscribed 3–4× *at the same time*; the overlap is
   only ever *sequential* — navigating Today→Trends→Body re-reads `profile`
   once per visit.

The one genuine cost, then, is those sequential re-reads across navigation,
which Firestore's on-device persistence already partially absorbs from local
cache.

## Decision

**Keep the per-hook subscription model. Do not build a shared subscription
seam / reference-counted listener cache.** F is closed as **won't-do**.

- Each hook remains self-contained: it owns its subscriptions, its state,
  and its focus-gated lifecycle. The same collection being subscribed from
  more than one hook is deliberate, not a leak.
- The mitigation that makes this cheap — focus-gating via `useFocusEffect`
  plus `trackSubs` — is load-bearing and must be preserved: new hooks
  subscribe inside `useFocusEffect` and wrap their unsub array in
  `trackSubs`, so the concurrent-listener bound continues to hold.

## Alternatives considered

- **Shared, reference-counted subscription cache** (one `onSnapshot` per
  collection, fanned out to N subscribers, behind the same `useProfile()`-style
  interface): the "correct-looking" dedup. Rejected because the live
  multiplier it removes does not exist (focus-gating + no co-mounting), it
  contradicts the documented per-hook precedent, and it introduces a
  ref-count/unmount lifecycle layer whose leaks would ship silently — the
  Expo app has **no unit-test runner**, so a listener leak has nothing to
  catch it. Net: real complexity and risk to reclaim only sequential
  re-reads that persistence already softens.
- **Single shared context** holding all collections: same lifecycle risk,
  plus it couples unrelated tabs and forces every collection live whenever
  any consumer mounts — strictly worse for cost than focus-gated per-hook.

## Consequences

- The per-hook precedent in [`CLAUDE.md`](../../CLAUDE.md) ("Mobile app data
  layer") stands and now cites this ADR as its rationale; future reviews
  that flag the duplication should be closed against this record rather than
  re-opened.
- The cost lever is **focus-gating**, not deduplication. If mobile read
  costs ever become a measured problem, revisit *that* (e.g. coarser windows,
  fewer hot collections) before reaching for a shared cache.
- If a future screen ever does co-mount two of these hooks (making the
  overlap simultaneous, not sequential), that specific case — not the whole
  model — is the trigger to reconsider, and this ADR should be revisited then.
