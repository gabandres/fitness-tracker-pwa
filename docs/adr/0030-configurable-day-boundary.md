# ADR-0030: When does a day start?

- **Status:** **IMPLEMENTED and shipped (2026-08-25)** — Android OTA 52 (vc 37) and iOS OTA 26 (build 60, the PUBLIC App Store). All four steps are done: the derivation, the codemod, persistence, and the setting. **Open: Q4 (widget/watch) and Q5 (importers)** — decisions, not code; `npm run check:day-boundary` pins the 12 call sites blocked on them. See Amendments 1–3.
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

## Amendment 2 — Q3 answered, and the estimator now buckets by the boundary (2026-08-25)

Steps 1 and 2 of Amendment 1's list are done. Steps 3 and 4 are not, and the
list below is now machine-checked rather than prose.

### Q3 — "the implicit local midnight must stop being reachable"

`localDateKey` is **gone**, renamed to `calendarDateKey` at all 189 references.
The rename is the answer to Q3, and the reason is that the old name let a call
site avoid the question: "the calendar date" and "the user's day" were the same
function, so nobody ever chose between them. They are different questions, and
the new name only answers one of them.

The rule is stated on `calendarDateKey` and is mechanical: the calendar date is
correct **only when the `Date` was synthesized from a key that is already
settled** — `parseYmd(key)`, or `addDays` off one. Applied to a real wall-clock
instant (`new Date()`, a log's `date`, a HealthKit sample's `endDate`), the
right answer is `dayKeyAt` and the calendar date is a latent bug.

### What was threaded, and what "no user affected" rests on

`packages/core` now takes `boundary` explicitly everywhere the answer is a
user's day: `aggregateByDay` and `calculateTdee` (**the estimator — the reason
this ADR exists**), `summarizeDay` / `summarizeDays`, `computeStreak`,
`mergeDailyWeights`, `recalibrationDigest`, `weeklySummary`, `buildCsv`,
`buildCoachSystemInstruction`, and the weekly-report prompt.

Three window builders were **anchor** bugs rather than bucketing bugs, and they
are the class that would have survived a careless codemod: `trailingDateKeys`,
`isoWeek` and `activityWindowRange` each derived "today" from the calendar date
and then stepped backwards in calendar days. The steps were always right; the
anchor was not. At a 3am boundary, a window built at 01:00 ran a full day ahead
of the day the user was living. They now anchor on `dayKeyAt` and step from
there, which is also why `parseYmd(dayKeyAt(...))` appears in each.

Every one of these defaults to `MIDNIGHT`, under which `dayKeyAt` is
byte-for-byte `calendarDateKey`. That is what let this land with nothing wired:
**all 1,160 core tests passed before and after, unchanged.**

That equivalence is necessary and it is **not** sufficient, so
`day-boundary.consumers.test.ts` asserts the other half — that at a real 3am
boundary each threaded consumer actually *moves*. Without it, a consumer that
quietly kept calling `calendarDateKey` would pass the equivalence test forever
and behave exactly as it did before the ADR: the "looks fixed" outcome this ADR
names as the worst available one.

### The seam that makes step 3 small

`dayBoundaryOf(profile)` is **structurally typed** — `{ dayBoundary?: DayBoundary }`
— not `ProfileFields`. The field does not exist yet, and typing it structurally
means the function, its call sites and their tests all land before persistence
does and keep working unchanged the day the field appears.

### What is still NOT done

1. **75 calls in 26 files still bucket a wall-clock instant by the calendar
   date** — the frontends, which have no boundary to read until step 3. This is
   no longer a prose estimate: `node scripts/check-day-boundary.mjs --list`
   prints them, and the check is a **ratchet** that fails if the count moves in
   either direction. Up is a new latent bug; down means a conversion landed and
   nobody tightened the baseline.
2. **Persistence.** Still no `ProfileFields` entry, no mapper, no
   `firestore.rules` validation. Rules deploy **before** any client writes it.
3. **The setting.** Last, and only after 2.
4. **Q4 (widget/watch) and Q5 (importers) remain open decisions.** Q4 now has a
   concrete stake: `apps/mobile/src/widgets/render.tsx` renders without the
   profile in scope, so answering Q4 decides whether that call converts at all.

The one thing that did NOT survive the sweep as a real finding: two dead
`calendarDateKey` imports in `useTrends.ts` and `trends.component.ts`, removed.

## Amendment 3 — persistence, the setting, and the two questions that are now load-bearing (2026-08-25)

Steps 3 and 4 are done. **ADR-0030 is implemented**, and what remains is Q4 and
Q5 — decisions, not code.

### Persistence

`dayBoundary?: DayBoundary` on `ProfileFields`, `firestore.rules` validated and
**deployed before any client could write it**, in that order.

Two things were learned doing it.

**The web app REDECLARES `ProfileFields` rather than re-exporting core's** —
`src/app/services/firebase.service.ts:210`. `CLAUDE.md` says it re-exports them,
and that is wrong. The field had to be added in both places, and the way this
surfaced is worth recording: `dayBoundaryOf(profile)` failed to compile with
*"Type 'Profile' has no properties in common"*, which is TypeScript's weak-type
check telling the truth — the web's `Profile` genuinely had none of the
properties, because it is a different interface that happens to share a name.

**`firestore.rules` cannot validate the field's contents, and this is not a
shortcut.** Rules have no way to iterate a list, so the server can check that
`dayBoundary` is a list of at most 24 entries and *nothing whatsoever* about
what those entries are. A rule that looks like it validates a list of maps
cannot be written.

So the shape is enforced on the way OUT instead: `sanitizeDayBoundary` drops any
entry that is not a `{ from: 'YYYY-MM-DD', hour: 0..6 }`, re-sorts (because
`boundaryHourOn` walks in order and stops at the first entry past the key it is
asked about — an unsorted list hands back an older rule for a later day, a wrong
answer that looks entirely plausible), and keeps the last of duplicate keys.
Dropped rather than repaired: a half-understood entry silently re-buckets days,
and this feature's failure mode is a wrong number that looks right. Nine tests
cover it, each using a shape the server would have happily stored.

### The setting

Mobile only — the web is frozen for features (ADR-0022). Settings → *Day starts
at*, a three-option segment (midnight · 3 AM · 6 AM), in all three locales.

The write goes through core's `setDayStartHour`, which is what makes it
append-only: it refuses a `from` that is not after every entry on file and
returns the list unchanged when the hour is already in force, so the row can
call it on every press without a "did it change" guard. Six tests pin that the
writer appends rather than replaces, writes plain objects Firestore accepts, and
throws rather than silently re-sorting when asked to rewrite history backwards.

### The frontends

63 of the 75 outstanding calls converted. The boundary reaches them from the
profile that was **already** on the auth context (mobile) or the `FitnessStore`
signal (web), so no new Firestore listener was added anywhere — ADR-0016's
per-hook subscription model is untouched.

### What is left, and it is exactly Q4 and Q5

`npm run check:day-boundary` sits at **12 calls in 4 files**, and the ratchet
now fails in both directions. All 12 are blocked on a decision:

- **Q4 (widget/watch)** — `widgets/render.tsx` and `useWidgetSync` render with
  no profile in scope. Q4 decides whether they convert at all.
- **Q5 (importers keep their source's day)** — `health.ts` / `health-sync.ts`.
  Converting *half* an importer is worse than converting none: the user's own
  session day and the imported block's day are compared to decide a merge, so
  moving one and not the other breaks the merge outright. That is the concrete
  reason Q5 has to be answered before either half moves.
