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

## Amendment — 2026-09-14: the glue moved, the subscriptions did not

The decision above is unchanged. This records what a later refactor *is*, so
it is not mistaken for the shared cache this ADR closes.

[`apps/mobile/src/hooks/useLedgerFeed.ts`](../../apps/mobile/src/hooks/useLedgerFeed.ts)
now owns the **policy** that sat around every hook's `subscribe*` calls:
focus-vs-mount gating, the `trackSubs` wrapping, snapshot provenance
(`meta.fromCache`), readiness settling and error narrowing. Nine hooks pass
their own channels into it.

**It is not a subscription seam.** Nothing is cached, shared or
reference-counted; each hook still constructs and owns its own `subscribe*`
calls, inside its own channels, and the concurrent-listener count is
unchanged — which is the quantity this ADR is actually about. The listener
model is untouched; only the five decisions each hook was re-making around it
moved. `useLogWrites` had already made the same argument for the **write**
side after that glue drifted between Today and History.

This *strengthens* the mitigation the Decision calls load-bearing: focus-gating
and `trackSubs` are now the module's default rather than something each new
hook has to remember, so the concurrent-listener bound no longer depends on a
convention being followed by hand.

Two corrections to the record above, both from drift rather than from a
decision:

- **"The Expo app has no unit-test runner" is no longer true.** It runs Jest —
  98 suites / 802 tests as of this amendment, including 18 covering the
  subscription policy itself. That was load-bearing in *Alternatives
  considered* ("a listener leak has nothing to catch it"), and it is worth
  re-reading with that premise removed if a shared cache is ever argued again.
  The rest of the rejection — that the live multiplier does not exist — is
  unaffected and still decides it.
- The hook list is older than the app: `useDailyTargets` and `useTrends` are
  named above, and the current set that subscribes is thirteen hooks. Four of
  them subscribe on **mount**, not focus (`useMilestones`, `useReminderSync`,
  `useWeeklyReport`, `useWidgetSync`); each has a reason and each kept its
  gating through the refactor, but the Decision's "new hooks subscribe inside
  `useFocusEffect`" reads as universal and is not.

## Amendment — 2026-10-21: the co-mount premise was wrong; the decision stands

The Context above rests on two factual claims, and a 2026-10-21 performance
audit of Today measured both as false:

- **"No screen co-mounts two of these hooks."** Today mounts `useToday`,
  `useReminderSync`, `useRecalibration` (which ran `useCoreSnapshot`),
  `useTargetHistory`, `useMilestones` and `useDayFasts`, under the app-wide
  profile listener in `AuthProvider`. The overlap is simultaneous, not only
  sequential.
- **"The concurrent total hovers ~3–7."** Focused, Today held **21 JS
  listeners over 14 distinct queries**: the 400-row logs window three times,
  the profile three times, the WHOLE `dailyWeights` collection three times, the
  60-session window twice, and whole `dailyWater` / `dailySleep` /
  `dailyActivity` collections for one key each.

The *Consequences* section names this as the trigger to revisit — "if a future
screen ever does co-mount two of these hooks … that specific case, not the
whole model". It was revisited, and **the decision is unchanged**, because the
cost turned out not to be the one a shared cache removes:

- **Network and billing: ~0.** The Firestore SDK already shares ONE server
  target between identical queries in a client, so three listeners on the logs
  window are one watch stream and one read bill. A reference-counted cache
  would dedupe what the SDK already dedupes.
- **JS work: all of it.** Each listener converts its own snapshot. Every focus
  re-opened all 21; each first answer was a new array identical to what was on
  screen, re-rendering Today about ten times and re-serializing each slice to
  AsyncStorage, and one added meal re-ran `toDailyLog` over 400 rows per logs
  listener.

So the fix went where the cost was, inside the per-hook model:

- `onChangedData` (`lib/ledger.ts`) converts only the documents `docChanges()`
  names and carries unchanged rows over by identity.
- `useCachedState` skips both the re-render and the write-through when a
  delivery is structurally equal to what is shown / stored; `useStableState`
  gives the uncached channels the same skip.
- The unbounded reads Today did not need were bounded: water, sleep and activity
  are single-day document listeners (sleep's two listeners became one); weights
  are a window starting at the oldest log row (`useTargetWeights` — exact, not
  approximate, by the argument at `weightsWindowStart`) in `useToday` and
  `useRecalibration`, and the newest weigh-in alone in `useReminderSync`;
  `useRecalibration` reads the profile from the auth context instead of opening
  a third profile listener.

After it, focused Today holds **19 listeners over 14 queries**, none of them a
whole collection, and a refocus whose data did not change renders nothing.
The 60-session window was left unbounded on purpose: with streak-freeze on for
everyone in v1, sessions carry a lifter's streak past the log window, and a
date bound would cut it (see the comment in `useToday`).

Read the Decision with the premise corrected: **the per-hook model is kept
because duplicate listeners are cheap on the network and the JS cost is
removable per listener — not because the duplication does not happen.** If a
shared cache is argued again, it has to beat `onChangedData` plus the equality
skip on JS cost, since there is no network cost left for it to win on.
