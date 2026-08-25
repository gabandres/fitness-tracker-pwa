# ADR-0030: When does a day start?

- **Status:** **partly built (2026-08-25)** — the core derivation exists and is tested. Nothing is wired to it yet, and there is no setting.
- **Date:** 2026-08-24
- **Touches:** every `dateKey` derivation, the TDEE estimator, fasting, the Health/Oura importers, the widget and the watch

## Context

Ignia has no concept of a day boundary. `dateKey` is the local calendar date at
midnight, derived wherever it is needed, and nothing anywhere is configurable —
grepped and confirmed: there is no `dayStart`, `rolloverHour`, `dayBoundary` or
equivalent in `packages/core` or `apps/mobile`.

That is fine for someone who eats between waking and midnight. It is wrong for
someone who does not, and it is wrong in a way that is easy to miss because
nothing errors.

### What actually breaks

A meal logged at **00:30** lands on tomorrow. That single fact produces four
distinct problems, and only the first is obvious:

1. **The visible one.** Today's ring reads low; tomorrow's reads high. A user
   sees it and can reason about it.
2. **The one that matters.** The measured TDEE estimator consumes a per-day
   intake series. A late meal moves calories out of the day they belong to and
   into the next, so one day reads under-eaten and the next over-eaten. The
   estimator's whole job is fitting intake against a weight trend, and this
   injects a sawtooth into its input that is indistinguishable from real
   behaviour. **This is the app's differentiator being fed distorted data**, and
   the user cannot see it happening.
3. **Streaks.** A day with a 00:30 meal and nothing else counts as logged;
   the day it belonged to counts as missed. The streak is wrong in both
   directions at once.
4. **Fasting.** A fast that spans midnight is already handled by timestamps, but
   any per-day *summary* of fasting inherits the same split.

### Why this is not a settings row

The naive shape — a "my day starts at 3am" stepper — is one number and about
forty call sites. `dateKey` is derived independently in many places, and the
ones that matter are not all in the app:

- **`packages/core`** owns the date helpers and the estimator's day bucketing.
- **The importers** map an external record to a day. Oura already ships its own
  `day` field, which the ring decides and which this ADR must NOT override —
  re-deriving a night's date under a user's custom boundary would move sleep
  the ring already filed correctly.
- **The widget and the watch** compute "today" in Swift/Kotlin, from their own
  clocks, against the App Group snapshot. They would need the boundary too, or
  the phone and the wrist would disagree about what day it is.
- **Firestore rules** validate `dateKey` shape but not its derivation, so
  nothing there breaks — but nothing there helps either.

## The questions this ADR has to answer before any code

1. **What is stored?** An hour offset (`dayStartHour: 0–6`) on the profile is
   the obvious shape. Anything past ~6am starts colliding with breakfast.
2. **Does it rewrite history?** Changing the boundary re-buckets every past
   day. The estimator would see its entire input series shift at once.
   **Proposal: it applies forward only**, and past days keep the boundary they
   were logged under — which means the boundary has to be stored per day, not
   just per profile, or history silently reinterprets itself.
3. **Who owns the derivation?** One function in `packages/core`, taking the
   boundary explicitly, with every call site passing it. The current implicit
   "local midnight" must stop being reachable, or the next new call site will
   quietly use it.
4. **What do the native surfaces do?** The widget and watch either receive the
   boundary in the App Group snapshot or are declared out of scope and pinned
   to midnight — in which case the app and the wrist disagree by up to six
   hours and that has to be a stated, visible consequence rather than a bug
   report waiting to happen.
5. **What does the importer do?** Oura's `day` and HealthKit's sample dates are
   external truths. **Proposal: imported daily totals keep their source's day**
   and only user-logged entries move. That is defensible and it is also a
   seam where two things called "today" now differ.

## Why it is worth doing anyway

Because the failure is silent and it degrades the one number the product is
built on. Every other setting in the app changes what the user sees; this one
changes whether the estimate is right.

And the cohort is not exotic. The owner and the tester are both in Puerto Rico,
where a 9–10pm dinner is ordinary and a midnight snack is not unusual.

## What is explicitly NOT in scope

- A per-meal date override. The entry sheet can already be pointed at another
  day; that is a different feature and it does not fix the estimator.
- Timezone handling. Ignia uses the device's local timezone and this ADR does
  not change that. A travelling user is a separate problem with a separate
  failure mode.

## Recommendation

Build it, but **not as a settings row first**. The order is: the core
derivation and its tests, then the estimator, then the UI. Shipping the toggle
before the derivation is unified would give users a switch that fixes Today and
leaves the estimator wrong — which is the worst of the available outcomes,
because it would look fixed.


## Amendment 1 — the derivation is built, and Q2's answer changed (2026-08-25)

`packages/core/src/day-boundary.ts`, 17 tests. This is deliberately the *only*
thing built: ADR-0030's own recommendation is that shipping the toggle before
the derivation is unified is the worst available outcome, because it fixes Today
and leaves the estimator wrong while looking fixed.

### Q2 — "does it rewrite history?" — answered differently to the proposal

The ADR proposed forward-only and concluded that would force the boundary to be
stored **per day**, "or history silently reinterprets itself". That conclusion
does not hold, and per-day storage is not the cheapest correct answer.

A day boundary is a **temporal setting** — a value with a validity range — so it
is stored as the short list of times it changed:

```ts
type DayBoundary = readonly { from: DateKey; hour: number }[]
```

One profile field, nothing written onto day documents, and past days keep the
boundary they were logged under because the rule that governed them is still on
file. An account that never touches the setting stores an empty list, and
`dayKeyAt(d, MIDNIGHT)` is asserted to equal `localDateKey(d)` at every hour of a
day — which is what lets the ~155 existing call sites migrate without changing
one answer for anybody.

### The transition is not free, and the shape of the cost is now pinned

Moving the boundary 0 → 3 on day D cannot push D's 00:00–03:00 instants back
onto D−1: that day is closed, already estimated, already seen. So **the
changeover window keeps the old rule** and day D runs 27 hours. Lowering the
boundary is the mirror image — the day *before* the change is short (19 hours
for 5 → 2). In both directions the mapping stays a partition of the timeline,
and there is a test that sweeps every hour across a change asserting exactly
that: no instant lost, none counted twice, no earlier day moved.

That partition test earned its place immediately: the first `dayRange` derived a
day's start from the hour in force on that day, which disagreed with `dayKeyAt`
on the changeover day and left an instant outside the range of its own day. The
test caught it before anything consumed it.

### What is NOT done, in the order it should be picked up

1. **Nothing calls it.** `dayKeyAt` has no consumers; `localDateKey` is still
   reachable and still used in ~155 places. Q3 ("the current implicit local
   midnight must stop being reachable") is unaddressed — that is a codemod plus
   a lint rule, not a decision.
2. **The estimator.** The reason this ADR exists. It must bucket intake with
   `dayKeyAt` before any user can move their boundary, or the differentiator is
   fed a step change the first time someone does.
3. **Persistence.** No `ProfileFields` entry, no `firestore.rules` validation, no
   mapper. Rules must be deployed before any client writes the field.
4. **The setting.** Last, and only after 1–3.
5. **Q4 (widget/watch) and Q5 (importers) are still open.** Both are decisions,
   not code, and neither is blocked by anything above.
