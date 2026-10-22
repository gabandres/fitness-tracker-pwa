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

## Amendment 2 — 2026-10-22: a blur no longer closes a tab's listeners

The owner reported lag on every tab press (Today, Train, Trends, Body). It was
measured, not reasoned about this time: a Release build (Hermes, the shipped
OTA's JS) on an iOS 26 simulator, QA account, with React's profiling renderer,
a frame-gap sampler on the JS thread, and a timestamp on every listener open
and snapshot. Each tab press committed the new screen in ~11 ms, then the tab
re-opened its whole listener set and **the JS thread froze for 120–160 ms**
while the SDK re-ran each query against its cache and the `subscribe*`
helpers converted the result; the server's answers cost up to 173 ms more.
React's own render time in that window was 1–10 ms. Train, the one tab
without the 400-row logs query, stalled 27 ms. Closing the add sheet refocused
Today, so every save re-opened Today's 16 listeners too.

**Change:** `useLedgerFeed`'s `'focus'` gate now opens a screen's listeners on
its FIRST focus and holds them until it unmounts. `onOpen` (one-shot reads,
some of them retries) still runs on every focus, and a feed whose listener
errored is re-opened on refocus, which is what a visit used to give it.
`useReminderSync`'s three listeners moved to mount scope the same way; a focus
re-plans from what they last delivered.

Measured on the same setup, before → after:

| | before | after |
|---|---|---|
| Revisit Train / Trends / Body / Today — JS stall total | 27 / 347 / 181 / 133 ms | 58 / 87 / 85 / 0 ms |
| Longest single stall on a tab switch | 173 ms | 38 ms |
| Saving an entry (two runs) | 531 / 390 ms, longest 284 | 109 / 96 ms, longest 46 |

The Mac is faster than a phone and the QA account is lighter than a real
history, so the phone numbers are larger in both columns; the ratio is the
finding.

**What this gives up**, from the Context above: "only the visible tab holds
live channels". A visited tab now keeps its listeners while it stays mounted,
so the concurrent count after visiting all four tabs is the sum of their
sets. Identical queries still share one server target (the 2026-10-21
amendment), a held listener receives only changes (a re-opened one re-read
from cache every visit, and from the server after 30 minutes away), and a
frozen tab (`freezeOnBlur`) does not render the snapshots it receives until it
is shown. A save with every tab mounted was measured above at 96–109 ms,
against 390–531 ms under the old gating, which re-opened Today on the sheet's
close. The per-hook model itself is unchanged: each hook still opens and owns
its own channels, and nothing is shared.

## Amendment 3 — 2026-10-22: measured on the owner's data; the SDK's string comparator

Amendment 2's numbers came from the QA account (79 days). The owner's account
was then copied into a synthetic test account (`perf-test@ignia.fit`, 1,772
documents, everything but `reports`, with no push token, webhook key or
public-profile fields) and the same Release-build harness re-run. Before →
after, still on a Mac simulator:

| Owner's data | before (focus gate) | amendment 2 | + comparator patch |
|---|---|---|---|
| Revisit Today / Trends / Body / Train | ~590 / ~885 / ~605 / ~180 ms | 24 / ~117 / ~115 / 83 ms | ~12 / ~58 / ~105 / ~50 ms |
| First visit after cold start, Trends / Body | ~1,150 / ~900 ms | same | ~630 / ~480 ms |
| Saving an entry | ~1,100 ms | ~215 ms | ~130 ms |

The first-visit stall was not React and not the `subscribe*` callbacks (each
measured ≤ 30 ms). It was inside the Firestore SDK, processing the server's
first answer for queries new to the session: a Time Profiler trace showed the
JS thread pegged in interpreted code under async microtasks, with `Map.forEach`,
`Array.sort` and per-character `charAt` work, and Hermes counted ~70 MB
allocated in that 2.5 s window (GC itself was 20 ms). The SDK compares every
document key through `__PRIVATE_compareUtf8Strings`, a `charAt` loop; keys here
share a ~45-character prefix (`users/<uid>/<collection>/`). Patching in a fast
path, the engine's native comparison for strings with no surrogate code units,
where UTF-16 order provably equals UTF-8 byte order, halved first visits.
firebase 12.19 / `@firebase/firestore` 4.17.2, the newest release, still has
the loop, so it is carried as `patches/@firebase+firestore+<version>.patch`
(`patch-package`, root `postinstall`), and
`firestore-utf8-compare-patch.test.ts` fails if an upgrade drops it or if its
order ever differs from UTF-8 bytes or from the original loop.

What is left on a first visit (~0.5 s at Mac speed) is the rest of the SDK's
processing of those first answers.

## Amendment 4 — 2026-10-22: equal path segments skip the comparison

The first-visit stall left after amendment 3 was profiled in Node (the
Firestore SDK's JS is the same; V8 names every function, which Hermes in a
Release build cannot): Trends' first-visit queries replayed against the
`perf-test` copy of the owner's data, with Today's listeners already open. The
time was still document-key comparison — not one hot caller but every sorted
tree the SDK keeps (target mappings, reference sets, limbo checks), each
`insert`/`remove` walking `users / <uid> / <collection> / <id>` segment by
segment, with two `isNumericId` scans and a UTF-8 compare per segment even
though the first three segments of every key in a collection are equal.

The patch adds `if (e === t) return 0;` at the top of
`BasePath.compareSegments` — equal segments compare 0 on both of its branches,
so no order changes (`firestore-utf8-compare-patch.test.ts` pins it). Node:
comparator self-time ~45 → ~15 ms. Release build on the simulator, owner's
data, three cold launches each, before → after:

| first visit | Train | Trends | Body |
|---|---|---|---|
| JS stall, mean | 207 → 172 ms | 602 → 463 ms | 473 → 365 ms |
| longest single stall | ~80 → ~87 ms | ~380 → ~246 ms | ~200 → ~158 ms |

What remains is the SDK applying the server's first answer for queries new to
the session. Short of reading fewer documents, the next lever is prefetching
those queries in idle time after launch — not taken: it moves the same work
rather than removing it, and costs a full read of each tab's queries on every
launch whether or not the tab is opened.
