# ADR-0033: Sleep on Trends is one honest comparison, not a score

- **Status:** accepted (2026-08-25), with two amendments below
- **Date:** 2026-08-25
- **Touches:** `users/{uid}/dailySleep`, a new pure module in `packages/core`, `apps/mobile/src/hooks/useTrends.ts` + `useCoreSnapshot`, `apps/mobile/src/lib/ledger.ts` (a bounded sleep subscription), `apps/mobile/src/app/(app)/trends.tsx`, the three mobile locales, and [ADR-0030](0030-configurable-day-boundary.md)'s open Q5
- **Mockup:** [`assets/0033-sleep-mockup.html`](assets/0033-sleep-mockup.html) — three states × two themes at 360×720 dp ([screenshot](assets/0033-sleep-mockup.png))

## Context

The ask was "sleep analysis on Trends, below Weekly Budget or somewhere". The
word doing the work is **analysis**. A chart of hours slept is not analysis, it
is a chart; the question this ADR has to answer is what Ignia can *claim* about
sleep that is true, and what it must refuse to claim.

### 1. What sleep data actually exists today, field by field

This is the load-bearing section. Everything below is read out of the tree as of
this commit, not remembered.

**One scalar per day, and that is the whole domain.**

```
users/{uid}/dailySleep/{dateKey} = { hours: number, source?: 'manual' | 'import' }
```

- `firestore.rules:708-717` — `hasOnly(['hours','source'])`, `hours` is a number
  in `[0, 24]`, `source` optional and constrained to the two literals. There is
  no third field and the rules would reject one.
- **The stored value is rounded to the half hour**, by
  `clampSleepHours` (`packages/core/src/health-mapping.ts:85`):
  `Math.round(hours * 2) / 2`. Every writer goes through it.
- Writers: `setDailySleep` (manual — Today's sleep sheet via `useToday:346`, and
  the Train session-finish extras via `useTrain:525`) and `importDailySleep`
  (Apple Health / Health Connect via `health-sync.ts:113`, Oura Cloud via
  `oura.ts:243`). `source` exists since 2026-08-24
  ([ADR-0026](0026-oura-through-the-os-health-store.md) Amendment 3); a **missing**
  `source` counts as manual, deliberately, because the conservative reading is
  the one that cannot destroy a real entry.
- Readers: `readSleepHours` (`packages/core/src/daily-scalars.ts:43`),
  `subscribeDailySleep` (`ledger.ts:427`), the CSV export
  (`csv-export.ts:97`), Today's `DailyMetrics` row, and a **second copy** of the
  number denormalized onto `WorkoutSession.sleepHours` (`workout.ts:141`) when it
  arrives through the Train sheet.
- Provenance of the *transport* is **not** stored. `source` distinguishes typed
  from imported and nothing more — there is no `provider`, so a card cannot
  honestly say "via Oura" the way a cardio block can
  ([ADR-0026](0026-oura-through-the-os-health-store.md) decision 3 gave
  `CardioBlock` a `provider`; `dailySleep` never got one).

**How a night becomes a `dateKey`.** All three importers file a night on the day
the sleeper **woke up**:

| Transport | Where the day comes from |
|---|---|
| Apple Health | `calendarDateKey(new Date(s.endDate))` — `health.ts:246`, over `HKCategoryTypeIdentifierSleepAnalysis` samples filtered to the asleep values (not `inBed`, not `awake`), each sample's duration summed into the day |
| Health Connect | `calendarDateKey(new Date(end))` on a `SleepSession` — `health.ts:615` |
| Oura Cloud (`daily` scope) | Oura's own `day` field, validated not recomputed — `packages/core/src/oura-daily.ts:36-38`; `total_sleep_duration` seconds → quarter hours |

**Coverage is thin by construction.** `fetchOuraDaily` defaults to **14 days**
and caps at 60 (`functions/src/oura-daily.ts:59`); the health importer's window
is the same order. There is no backfill of a year of history, so "the last 14
nights" is not a UI choice so much as a description of what is there.

**Trends cannot see any of it.** `useTrends` reads `useCoreSnapshot('Trends')`,
which subscribes exactly three channels — recent logs, daily weights, profile.
Sleep is not among them, and `subscribeDailySleep` as written subscribes the
**whole collection with no range bound** (`ledger.ts:427`), which is fine for
`useToday`'s single listener and is not what a second consumer should copy.

### 2. What does not exist, and cannot be faked

No sleep stages. No efficiency. No bedtime or wake timestamps — the sample times
are consumed to compute a duration and then discarded. No latency, no
interruptions, no sleeping heart rate, no HRV, no restfulness, no temperature.
No per-night record at all: two naps and a night collapse into one number, by
design (`parseOuraDaily` sums them, `oura-daily.ts:133`).

Sleep is also absent from `DaySummary`, from `WeeklyInsights`, from the History
month grid, from the widget/watch App Group snapshot, and from every derivation
in the TDEE estimator.

### 3. What other apps do, and the one line it changes

Surveyed 2026-08-25 against primary product/support pages. Compressed; the
column that matters is the last one.

| App | Headline | Composite score | Default window | Causal voice |
|---|---|---|---|---|
| **Oura** | Sleep Score 0–100 + a plain-language sentence | Yes, 7 named contributors, each shown with its gain/loss | one night; week/month in Trends | correlational hedging ("your data suggests") |
| **Whoop** | Sleep Performance % | Yes — the most aggressive of the set; rolls up performance, efficiency, consistency, 14-day debt | nightly; debt rolls 14 days | Journal explicitly pairs logged behaviours against next-day scores |
| **Apple Health / watchOS 26** | Sleep Score 0–100 (50 duration / 30 bedtime consistency / 20 interruptions) | Yes, new; previously time-in-bed only | single night, toggles W/M/6M | none |
| **Fitbit** | Sleep Score | Yes; restoration sub-score tied to sleeping HR vs daytime resting HR | week/month/year tabs | presents sleeping-HR → restoration as explanatory |
| **Garmin** | Sleep Score + Sleep Coach + Body Battery | Yes, three of them | nightly | **prescriptive** — "go to bed earlier tonight" |
| **AutoSleep** | Sleep rings + rating 1–100, plus a Sleep Bank debt/credit | Yes, but every component is visible | last night + running bank | none |
| **Sleep Cycle** | Quality 1–100 over three named pillars | Yes, coarser and explained | single night, reports for trends | none |
| **MacroFactor** | **nothing** — sleep is not an importable type at all | — | — | — |
| **Cronometer** | Imports Sleep Score / duration / stage from Apple Health onto the dashboard | passthrough of the device's | passthrough | pitched explicitly as *correlating sleep with nutrition* |

Two rows carry the decision.

**Every scored app builds its score from independent signals Ignia does not
have.** Oura's seven contributors, Apple's three components, Fitbit's sleeping
heart rate — remove the sensors and what is left is duration, which is the one
thing Ignia has. A 0–100 built from a single duration is a number wearing a
costume: it implies sub-components that do not exist, and it is exactly the
"cheap AI slop" this design was told to avoid. **Ignia will not compute a sleep
score, and this is not a maybe-later.**

**The two nutrition comparables split, and the split is instructive.**
MacroFactor refuses sleep outright — sleep is not in its integrations list, an
absence confirmed rather than assumed. Cronometer imports it and pitches it *for
correlating against nutrition*. Ignia is closer to Cronometer's read of the
opportunity, for a reason neither wearable app has: **Ignia already owns the
second variable.** The survey's own closing assumption — that a duration-only
app "has no second variable to correlate against" — is false here. Intake is
the thing this product is best at measuring, it is aligned to the same
`dateKey`, and it is the only pairing in the app where both halves are strong.

## The questions this ADR has to answer

1. **What is the insight?** Sleep↔weight-trend, sleep↔intake, sleep↔training, or
   consistency for its own sake — pick one and defend it.
2. **Is any statistical claim shown, and on what evidence?** At n ≈ 14–60 a
   correlation coefficient is noise with a decimal point.
3. **Which night belongs to which day**, and what happens under a non-midnight
   `dayBoundary`?
4. **What does a user with no sleep data see?** That is most users.
5. **What belongs in `packages/core`?**

## Decision

### 1. The primary claim is sleep against intake, and there is only one

**On your shorter nights, did you eat more?** Not weight trend, not training,
not consistency.

- **Weight trend is rejected on data quality.** The weight series is already the
  noisiest input in the app — `lastTrendSegment` exists because a two-week gap
  produces a *step* the outlier guard misreads, and one stray reading has moved a
  real account's maintenance from 2,741 to 1,619 kcal. Pairing 14 sleep readings
  against that is two noisy series producing a confident-looking number.
- **Training is rejected on n.** Sessions are sparse and self-scheduled; a
  fortnight yields three or four, which is not a comparison.
- **Consistency is rejected as an insight**, though it is kept as furniture: "you
  slept 6h 39m a night" is a fact worth printing and is not analysis.
- **Intake wins because both halves are strong and already aligned.** Logged
  calories are the product's core measurement, and a night filed on the wake day
  sits on the same `dateKey` as the eating that follows it — so the pairing needs
  no lag term, no windowing, and no assumption. That alignment is a property of
  how the importers already work (§1), not something this ADR invents.

### 2. No score, no coefficient, no causal sentence — ever

- **No 0–100.** Reasoned above from the survey.
- **No correlation coefficient, no p-value, no R².** Daily observations are
  autocorrelated (weekday rhythm, weekend drift), n is 14–60, and a user cannot
  calibrate an `r` even when it is honest. This is stated as a rule so the next
  reader does not "improve" the card by adding one.
- **No causal or prescriptive copy.** Garmin's Sleep Coach voice is off limits.
  The sentence describes days that already happened and says so.

What is shown instead is a **paired contrast between the user's own days** — two
group means and their difference, in the units the user already reads. It is
arithmetic they could do themselves from the CSV export, which is the test this
ADR uses for whether a claim is honest.

### 3. The evidence bar is explicit, and the ramp it approximates is named

The contrast sentence renders only when **all** of these hold over a 60-day
window:

| Gate | Value | Why |
|---|---|---|
| nights with a sleep reading | ≥ 14 | below a fortnight the split groups are single-digit and one bad night moves the answer |
| the day paired with each night is fully logged | `mealCount > 0 && totalCalories > 0` | the same "logged day" predicate `loggedThisWeek` already uses |
| each group after the median split | ≥ 5 nights | a 4-night group's mean is a coin flip |
| \|difference\| | ≥ 150 kcal | see below |

**The 150 kcal floor is an assumption and is flagged as one.** Portion-estimate
error on a single logged day is plausibly ±200 kcal; a 6-day group mean shrinks
that to roughly ±80, so 150 is about two standard errors. That reasoning is
defensible and it is **not measured** — it should be calibrated against the
owner's own history before this ships, and this ADR would rather state a
falsifiable number than hide the judgement inside a threshold constant.

**The split is at the user's own median, and ties are dropped.** Nights equal to
the median join neither group, so the two groups cannot share a value and
"shorter" means shorter than *this person's* normal — never shorter than a
population 7- or 8-hour standard, which Ignia has no authority to assert.

**How this relates to `measuredConfidence`.** The estimator's answer to thin
evidence is a ramp, not a cliff: `measuredConfidence`
(`packages/core/src/tdee.ts:547`) blends toward the Mifflin anchor by the
*minimum* of three ratios, and its Amendment-era third term exists precisely
because a 14-day boundary produced a −449 kcal single-day jump. A sentence
cannot ramp — it is present or it is not. What ramps instead is **the card
around it**: from the third night onward the headline, the strip and the
coverage footer are all there and unchanged, and crossing the bar adds one
paragraph. The layout never jumps, so the cliff is confined to the one element
that is inherently binary. That is the honest translation of the precedent, and
it is stated here rather than left to look like an oversight.

### 4. The card is one number, one strip, one sentence

Rendered in [`assets/0033-sleep-mockup.html`](assets/0033-sleep-mockup.html).

- **Headline:** the mean night as `6h 39m` in the display face at `font.h1`, with
  `a night, last 14` beside it. A duration, never a score.
- **The strip:** 14 slim columns, height proportional to hours against a 10-hour
  ceiling, with a dashed reference line at **the user's own average**. The nights
  in the short group are drawn in `colors.info`; every other night is
  `colors.faint`. This is the point of the visual — the highlighted bars are
  *exactly* the nights the sentence is about, so the chart is the claim drawn
  rather than decoration beside it. One accent colour, no legend beyond a single
  12 px line.
- **A missing night is a hairline at the baseline.** Never a zero, never
  interpolated, and the coverage footer says `13 of 14 nights` out loud.
- **The sentence, then the qualifier.** "On your 5 shortest nights you logged
  2,410 kcal — 260 more than on your 6 longest." / "Your own days, side by side.
  A pattern, not a proof."
- **The footer names provenance at window level** — `imported` or `typed` or
  both. It does **not** say "via Oura", because `dailySleep.source` cannot
  support that claim (§1) and widening it is a rules change bought for a word.

It sits **directly below Weekly Budget** and above the Coach entry: the hero,
This Week and Budget are all things that set or spend a target, and sleep sets
nothing. It is also the newest and least proven surface on the screen, so it must
not push the budget below the fold on a 360×720 dp device.

### 5. A night belongs to the day the sleeper woke up, and the card does not re-derive it

[ADR-0030](0030-configurable-day-boundary.md) Q5 proposed that *imported daily
totals keep their source's day*. **For sleep that holds, and it is now confirmed
rather than assumed:** all three importers already file on the wake day (§1), and
Oura's `day` is a value the ring decided that ADR-0030 explicitly forbids
overriding.

Two consequences, one good and one that has to be written down.

**The good one.** Under any boundary of 0–6 hours, a person who wakes *after*
their own day start has `dayKeyAt(wakeInstant) === calendarDateKey(wakeInstant)`.
So the night and the eating day that follows it land on the same key at every
supported boundary, for essentially everyone, and the pairing in decision 1 needs
no correction term.

**The one that has to be written down.** `setDailySleep` is called with
`todayKey`, which `useToday:228` derives with `dayKeyAt` — it is
**boundary-aware**. The importers are not: `npm run check:day-boundary` still
lists `health.ts:246` and `health.ts:615` among the unconverted calls. At a
non-midnight boundary the two writers can therefore disagree about one night, and
the failure is not cosmetic: **`importDailySleep`'s "never overwrite a typed
night" guard is keyed on the document id**, so a manual row at key D cannot
protect against an import at key D−1. The import writes a second, unguarded row,
and the strip shows two nights where there was one.

The reachable window is narrow — it needs a wake time *before* the user's own
day start, or a sleep entry typed after the boundary but before the next night —
and the boundary setting shipped on 2026-08-25 with approximately nobody using a
non-zero value. **This ADR does not fix it and does not block on it.** It is Q5's
business, it now has a concrete second victim beside the workout-merge case
[ADR-0026](0026-oura-through-the-os-health-store.md) already records, and the
narrow fix — have `importDailySleep` check the adjacent key for a manual row when
the boundary is non-zero — should be decided there, with the importers, not here.

**The card reads whatever `dateKey` is stored and never re-derives it.**

### 6. Most users have nothing, so most users get a row, not a card

Three states, and the third is the common one.

- **≥ 14 nights and the bar cleared** — the full card (mockup state 1).
- **3–13 nights** — the same card without the sentence, plus one progress line
  naming the exact threshold: *"5 nights so far. At 14, Ignia will line your
  shorter nights up against what you ate on those days."* This mirrors
  `activity.windowProgress`, which already sits on this screen for the same
  reason: a silent wait reads as "nothing happened", and that is how a Health
  connection gets revoked.
- **0–2 nights** — **no card and no section header.** One hairline-bounded row:
  *"Sleep · connect Oura or Apple Health, or log a night on Today"*, tapping
  through to Connected apps.

The empty state is a row rather than a card on purpose. Trends already carries a
hero, an activity correction, This Week, Budget and Coach; a permanently empty
sleep widget on top of that is the generic-dashboard failure, and the sleep row
on Today is already the right place to invite a first entry. One line is enough
to make the feature discoverable without pretending there is data.

**When a source is connected and has produced nothing, the row says that
instead** — *"Sleep · connected to Oura — no nights yet"*. That is
[ADR-0026](0026-oura-through-the-os-health-store.md)'s empty-state rule applied
verbatim: the Oura app can have its export switched off, Android before vc 38
returns an empty list, and "you have no sleep" is a lie in both cases.

### 7. All of the math is pure and lives in `packages/core`

A new `packages/core/src/sleep-intake.ts`, framework-free, Firestore-free:

```ts
summarizeSleep(sleepByDay, dateKeys): { nights, coveredDays, meanHours, medianHours }
sleepIntakeContrast(sleepByDay, days, opts): SleepContrast | null
```

`sleepIntakeContrast` returns `null` when any gate in decision 3 fails, so the
component has no thresholds in it and the bar is testable without a renderer.
Both frontends can call it, which matters more under a freeze, not less
([ADR-0022](0022-web-pwa-frozen-not-retired.md)) — though see decision 9.

### 8. Sleep never reaches a target

`sleepHours` is not added to `DaySummary`, not folded into `WeeklyInsights`, not
read by `dailyTargets`, and no sleep-derived adjustment touches the TDEE
estimator. This is the same seam
[ADR-0026](0026-oura-through-the-os-health-store.md) decision 5 draws for
imported energy and [ADR-0024](0024-continuous-activity-multiplier-floored-at-fao-minimum.md)
draws for the activity multiplier, and it is drawn here in advance because the
plausible optimisation is already obvious: *we can see they slept badly, so
soften the target.*

There is no evidence base for a sleep-conditioned calorie target, the estimator's
whole value is that it fits intake against a weight trend without editorial, and
a correction applied to a number the user cannot audit is precisely the silent
degradation ADR-0030 was written about. Pinned by a
`sleep-target-independence.test.ts` modelled on
`cardio-energy-independence.test.ts`: with 120 logged days, moving every night
across 4 / 7 / 10 hours must leave `dailyTargets` byte-identical.

### 9. Mobile only, and the plumbing is a bounded subscription

Web gets nothing ([ADR-0022](0022-web-pwa-frozen-not-retired.md) — the logging
app is frozen for features). Copy ships in **en, es-PR and pt-BR**, flat keys,
`{n}`-style interpolation.

`useTrends` needs sleep it cannot currently see. Per
[ADR-0016](0016-mobile-per-hook-subscriptions-intentional.md) it opens **its own**
focus-gated listener rather than sharing `useToday`'s — the duplication is the
model, and the thing that bounds it is focus-gating, which `useCoreSnapshot`
already enforces. But it must be a **new range-bounded reader**
(`subscribeDailySleepSince(uid, sinceDateKey)`), not `subscribeDailySleep`:
the existing one has no range bound, and a two-year account has ~700 documents in
that collection. Copying an unbounded listener into a second hook is how a read
bill starts.

## Amendment 1 — one window of 14 days, and the gate is 12 nights (2026-08-25)

**Decisions 3 and 4 contradicted each other and could not both be built.**
Decision 3 evaluates the gates "over a 60-day window"; decision 4 draws a
14-night strip and says the highlighted bars are *"exactly the nights the
sentence is about"*. At different windows that second claim is false — the
sentence would name ~25 nights while the strip drew 14.

Put to the owner during implementation and resolved toward **one window of
`SLEEP_WINDOW_DAYS` = 14 days for both**, with the nights gate moved
**14 → 12**. Three things pointed the same way:

- The mockup's own numbers only close at 14. State 1 reads *"5 shortest"* and
  *"6 longest"* against *"13 of 14 nights"* — 5 + 6 = 11 of 13 drawn. At a
  60-day window those counts would be in the twenties.
- **The highlighted-bars-are-the-claim property is the strongest idea in this
  design**, and it is the first casualty of two windows.
- §1 of this ADR already records that `fetchOuraDaily` defaults to **14 days**
  and the health importer is the same order. A 60-day window would mostly be
  describing history nobody fetched.

**12 rather than 14 is the mockup's number, not an invented one.** At a 14-day
window a 14-night gate means a *complete* fortnight with no gaps, which State 1
— 13 of 14, sentence shown — is not. Twelve leaves room for the gaps a real
importer produces without abandoning the fortnight.

## Amendment 2 — the empty row keeps its promise (2026-08-25)

The 0–2 night row shipped with a chevron and no action. Found by looking at a
device screenshot rather than by any of the 427 green specs, and fixed the same
day: it pushes `/connected-apps`, which is where both halves of its own sentence
live. Recorded because the failure is a general one — **an affordance that does
not act reads as a broken row, which is worse than not drawing it** — and
because this row is the only discoverable path to a sleep source for the
majority of users the ADR predicts will see it.

One deviation from decision 4 was kept deliberately. The prose says the coverage
footer is present "from the third night onward"; the mockup's State 2 has no
footer, and that is what shipped, because *"13 of 14 nights"* under a progress
line that already says *"5 nights so far"* is the same fact twice.

## Consequences

- **The card is empty for most people and that is correct.** Sleep arrives with a
  wearable or with a habit of typing it; neither is common. A design that looks
  good only in the populated state would have been the wrong design.
- **The claim can say nothing for a long time.** Fourteen nights *and* fourteen
  fully-logged days *and* a 150 kcal gap is a real bar, and a user who sleeps
  consistently will never clear the last gate — correctly, because there is
  nothing to report. The progress line has to carry that weight without sounding
  like a countdown to a promise.
- **The 150 kcal floor is unvalidated.** It is the softest number in this ADR.
- **`dailySleep` grows a second listener.** Bounded, focus-gated, on a collection
  that is one small document per day.
- **A comment in `packages/core` is wrong and should be fixed regardless of this
  ADR.** `oura-daily.ts:69` states *"A quarter is what `setDailySleep` stores"*.
  It is not: `clampSleepHours` rounds to the **half** hour, so
  `sleepSecondsToHours`' careful quarter-hour rounding is re-rounded on the way
  in and an Oura night of 7h45m is stored as 8h00m. Harmless to this feature —
  the contrast works in group means of half-hours — but the comment asserts a
  precision the schema does not keep.
- **`npm run check:day-boundary` reports 10 calls in 3 files.** ADR-0030
  Amendment 3 and the ADR index both say **12 in 4**. Something converted after
  those were written; the ratchet is the truth and the prose is stale.

## What is explicitly not in scope

- **Sleep stages, efficiency, bedtime consistency, or a sleep-debt balance.** All
  need data Ignia does not store, and two of them need timestamps the importers
  discard.
- **A sleep goal or target.** Ignia does not tell anyone how long to sleep. The
  reference line is the user's own average for exactly this reason.
- **Backfilling history.** The importers reach 14 days by default and 60 at most;
  a deeper import is a separate decision with its own cost.
- **Surfacing sleep on History or the widget.** The month grid and the App Group
  snapshot both stay as they are.
- **Anything on the web.**

## Alternatives rejected

- **A Sleep Score.** Every scored app in the survey builds its number from
  independent sensor signals. Ignia has one duration. A score here would be an
  invented composite, and the owner's brief ruled it out by name.
- **A correlation coefficient, or a scatter plot of sleep against calories.**
  Honest-looking, unstable at this n, and uninterpretable by the audience.
- **Sleep against the weight trend.** Two noisy series; the weight series already
  needs `lastTrendSegment` and a robust outlier guard to be usable at all.
- **A sleep-adjusted calorie target.** Decision 8. No evidence base, and it would
  quietly corrupt the one number the product is built on.
- **Re-deriving the night's day under the user's boundary.** Contradicts
  ADR-0030's own instruction not to override Oura's `day`, and would move nights
  the ring already filed correctly.
- **Adding sleep to `useCoreSnapshot` for everyone.** Three screens would pay for
  a listener one screen reads.

## What would falsify this

- The owner's own history producing a short-vs-long gap that swings wildly as one
  night is added — which would mean the gates in decision 3 are too loose and the
  bar should rise before this ships.
- A gap that never exceeds 150 kcal on any real account, which would mean the
  primary claim has nothing to say and the card should be the headline plus the
  strip and nothing else.

Both are answerable from data that already exists, on the one account with an
Oura ring attached, before a line of the card is built.
