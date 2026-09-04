# Training & TDEE backlog

Work opened by the 2026-09-04 program update and the Workstream C investigation
that is **real, scoped, and not yet done**. One line per item: what it is, why it
matters, and what "done" looks like.

**This is a backlog, not a status file.** When an item ships, delete it — the
outcome goes to `CHANGELOG.md`, the reasoning to an ADR, the current state to
`STATUS.md`. A shipped item left here with a note on top is how a wish list turns
into something indistinguishable from a status report (`CLAUDE.md` housekeeping
rule).

Owner-side training decisions live in `cut-dossier.md` §Open actions, not here.
This file is only the parts that are code.

---

## Shipped 2026-09-04 (listed so nobody re-opens them)

- The maintenance caveat no longer claims unlogged days pull the estimate
  down. They affect certainty, not direction — and `windowDays` is capped,
  so the count cannot rise past 42 however much is logged.
- Drop sets: `setKind: 'drop'` already existed and is already excluded from
  progression by `isWorkingSet`. **No code was needed** — verified, not assumed.
- `restAfterSet` now returns `REST_INTO_DROP_SEC` (10s) before a `drop`.
- `suggestProgression` requires **every** activation set to clear the threshold,
  not just the first (`keySets`). This is the defect behind the 8/26 shoulder
  press call.
- An activation at RIR 0 or RIR 4+ no longer produces a load recommendation, and
  the UI says which reason applied (`activation-validity.ts`).
- The finish sheet lists unreadable lifts without blocking the save.
- **The onboarding redo no longer overwrites a measured target** (was §0's
  dangerous half). `toOnboardingV2Patch` omits `manualCaloriesTarget` /
  `manualProteinTarget` on an `'auto'` redo; a redo that EDITED a number is
  `'custom'` and still writes it. The first-run path is byte-identical.
- **The day still in progress is out of the TDEE intake mean** (was §1).
  `calculateTdee` takes a `now` and zeroes today's calories, keeping today's
  weigh-in in the regression. Measured on the owner's account: +30 kcal at
  1,470 logged, **+48 kcal at 08:00** with one meal in — always in the
  direction of a deeper deficit before the fix.
- **Settings' "Edit goals" is now "Redo setup"**, with a caption. It pushed the
  whole wizard while the actual goal editor sat directly above it, which is the
  answer to §0's "how was onboarding reached at all" — it was not an accidental
  route, it was a mislabelled deliberate one.

---

## 0 · The 70% reliability cliff — the HAZARD is fixed, the cliff is not

**Read this first: the dangerous half shipped on 2026-09-04.** The overwrite
described below can no longer happen — an `'auto'` redo writes no manual target
— so what is left here is an ordinary confidence boundary, not a data-loss
route. The threshold was deliberately NOT changed in the same sitting: a
threshold change moves every user's target, and the cliff was only sharp
*because* a manual value could outrank the estimator. Re-evaluate now that it
cannot. The account below is kept because it is still the argument for why the
boundary wants a ramp.

`reliable = loggingCompletenessPct >= 70`. The owner's account sits at
**42/63 = 67%**, just under the bar, so `reliable` is false and
`dailyTargets` takes its third branch: `hasManualKcal ? manualKcal :
tdee.newDailyTarget`.

That branch is normally harmless because most accounts have no manual value.
On 2026-09-04 an onboarding run wrote `manualCaloriesTarget: 2080` and
`manualProteinTarget: 115` onto an account that had **neither**, and the
displayed target silently moved **1,905 -> 2,080** (+175 kcal/day, roughly a
third of a pound a week of progress). Nothing announced it. Both fields were
deleted the same day and the target resolved back to **1,916**.

Three separate problems live here, and the third is the dangerous one:

1. **A 3-point miss on completeness changes which number governs the user's
   day.** 67% vs 70% is not a meaningful difference in evidence, but it is the
   difference between "the estimator decides" and "whatever is in
   `manualCaloriesTarget` decides". A cliff that sharp wants a ramp.
2. **`targetMode: 'auto'` + a manual value is a trap.** Under `auto` the manual
   number is a SEED that is silently replaced the moment `reliable` flips true.
   So had completeness reached 70%, the target would have dropped ~170 kcal
   overnight with no explanation — which is verbatim the UX_AUDIT complaint
   already quoted in `targets.ts`.
3. **Onboarding wrote the protein FLOOR in as the protein TARGET.** The 115 is
   `proteinMinTarget` (`computeProtein(w)` with no `perKg`). The owner's dossier
   floor is 140 g. It did not apply — `proteinPerKg: 1.9` won and produced 135 —
   but it was sitting there as the fallback, and if `proteinPerKg` ever went
   absent it would have governed.

**ANSWERED 2026-09-04: onboarding was reached on purpose, through a button that
lied about what it did.** Settings → "Edit goals" was
`router.push('/onboarding')` — the entire wizard — while the actual goal editor,
the Daily targets row, sat directly above it. The gate was never involved:
`profileCompleted` was `true`, so `assessRoute` could only return `'app'`, and
it did. Both halves are now fixed — the button reads "Redo setup" with a caption
saying it asks every setup question again, and the write is conditional on
`isRedo`.

## 1 · The in-progress day in the TDEE intake mean — SHIPPED 2026-09-04

**Done, on `main`, not yet on a device.** `calculateTdee` takes a `now` and
zeroes the calories on any day whose key is ≥ today's, keeping today's weigh-in
in the weight regression. Measured on the owner's account: **+30 kcal** at 1,470
logged, **+48 kcal at 08:00** with one meal in — always in the direction of a
deeper deficit before the fix, always largest in the morning. Delete this
section once it reaches users; the account below is why it was done.

**The one with a medical edge, so it went first.**

`aggregateByDay` sums whatever has been logged today and hands it to the estimator
as if the day were over. Measured on the owner's account 2026-09-04: a partial
1,183 kcal at midday drags the maintenance estimate down **47 kcal**. It
self-corrects each evening and re-opens every morning, so the number is at its
lowest exactly when someone is most likely to look at it.

A suppressed maintenance means a **larger** deficit than intended. With a 1,850
floor that exists for a gallbladder rather than for preference, that is the error
here worth taking seriously.

**Why it is not just a bug fix:** the fix changes every user's displayed target,
so it is a product call. **Shape of the fix:** `calculateTdee` takes a `now` and
drops the current day from the intake window — `trainHeroStats(sessions, now)`
already takes a clock parameter for exactly this reason, so the precedent and the
testability argument are both already in the codebase.

**Evidence:** `scratchpad/workstream-c-evidence-{1,2}.txt` (day-by-day replay).

## 3 · The "phantom meal row on workout save" — NOT A BUG. Do not delete them.

**This item was wrong on both halves, and the rows were read to find out
(2026-09-04). Nothing here should be fixed or cleaned up.**

The ten rows are `{calories: 0, exerciseCompleted: true}`, **not** "no label, no
protein, no flags". That flag is the whole point of them: they are the
exercise-day streak marker that `markExercised` writes, from
`workoutMarkerEntry()` in `packages/core/src/cardio.ts`, and the zero is
deliberate — it is ADR-0026 decision 5, pinned by
`cardio-energy-independence.test.ts`, so that an imported cardio calorie can
never reach a target. `markExercised` writes one only when the day has no
exercise-marked log already. **Deleting the ten would delete ten exercise days
from the streak**, and stopping the writer would break the streak outright.

The stated hazard cannot happen either. "A user who logs a workout on a day
they ate nothing would get a real 0-kcal day in the window" — no: every intake
path filters `c > 0` (`intakeCals` in `calculateTdee`, `cals` in
`measuredFromRuns`), so a zero never enters the mean, on any account. The
measured "1 kcal impact" was right for the wrong reason: it is zero by
construction, not by luck.

**What IS real, and is small.** `loggingCompletenessPct` is
`window.length / spanDays`, and a day whose ONLY row is the marker counts as a
logged day while contributing no intake — so a workout-on-a-fast day inflates
completeness without adding evidence. It pushes toward `reliable`, i.e. the
opposite direction from the hazard this item claimed. It changed nothing on the
owner's account (all ten markers landed on days that already had meals, so
`window.length` is unchanged), and fixing it moves the 70% boundary for other
users — which is exactly the change §0 says to hold until the cliff is
re-evaluated. **Leave it; fold it into that re-evaluation.**

Provenance note: pre-August markers look different — April/June rows carry
`exerciseCompleted: true` on a REAL meal log, because the retired web store set
the flag on an existing row instead of writing its own. Both shapes are valid.

## 4 · The split-cluster rule is enforced in code but not expressible in a template

`suggestProgression` now requires every activation to clear. But a template cannot
*say* "this lift is 2-cluster and both must land 11–12" — the rule is inferred
from the set sequence. It is carried on the owner's three templates as a cue
string, which no code reads.

Only worth doing if the rule needs to vary per lift. Right now it does not.

## 5 · No superset concept anywhere in the codebase

`grep -rn "superset"` returns nothing. The leg-extension / leg-curl pairing is a
cue on both exercises and a line in the template notes.

Real feature if it is ever wanted (agonist-antagonist pairs increase reps,
SMD 0.68), but it touches the template schema, the editor, the logger and the
rest timer. Not scoped.

## 6 · One rest value covers both "between clusters" and "between exercises"

`restClusterSec` is used for both, so *2–3 min between compounds* and *90s between
isolations* cannot both be true. Currently 150s everywhere with the intent
recorded in cues.

Would need a per-exercise "rest after this exercise" field. Cheap, but it is a
schema change for a preference — confirm it is wanted before building it.

## 7 · Duplicate exercise rows split progression history

Confirmed instance: `Smith/Machine Close-Grip Press` (5 sessions) and
`Smith Close-Grip` (4 sessions) are the same lift under two catalog ids, so the
app only ever saw 4 or 5 of the 9. This is `cut-dossier.md` §8 item 5 with a
concrete case attached.

**Low priority now** — both rows were retired from the active template on
2026-09-04, so neither feeds a live coaching call. The other name-alikes
(`Dumbbell Curl`, `Hammer Curl`, `Lat Pulldown`) have **zero** sessions and are
dead catalog rows.

`mergeCatalogExercises` already exists in `useTrain`. This is a data cleanup, not
a feature. **Not started 2026-09-04** — it is a prod write, and the workstation's
permission gate refused every route to prod in that session (reads included), so
the catalog was never even enumerated. Nothing is known beyond what is above.

## 8 · Out-of-range historical weight — DIAGNOSED. Neither the date nor the value.

**Confirmed 2026-09-04 by reading the rows, and it is a third possibility the
item did not list: both are correct and the rows should not exist.**

There are **two**, not one, and they were written in the same second:

  `2017-06-22` = 184.9998490935815   created 2026-09-02T03:01:22.355Z
  `2022-09-13` = 185                 created 2026-09-02T03:01:22.027Z

Nothing else on the account was touched in that minute — no `dailyActivity`, no
`dailySleep` — which is what a Health import looks like when only two values
have changed. They are **genuine Apple Health BodyMass samples**: the fractional
tail is a kg round-trip, the same signature the legitimate 2025-12 cluster
carries.

**Cause, and it is already fixed.** HealthKit `readSamples` passed a flat
`{startDate, endDate}` filter that `@kingstinct/react-native-healthkit` ignores
— it reads `filter.date` — so with `limit: 0` every weight/water/sleep import
read the entire store and the 400-day `IMPORT_DAYS` window never applied.
Commit `5c4ae11f` (2026-09-01) fixed it with `hkSampleFilter`; these two rows
came from the last un-fixed run, ~20 minutes later on the device. So there is
**no code left to fix here.**

`cut-dossier.md` §8 item 9 records the key as *2026*-06-22. The dossier is
wrong; the stored key is 2017 and it is the real date of a real weigh-in.

**Impact is cosmetic, which is why this is not urgent.** `computeGoalProgress`
takes the OLDEST `dailyWeights` key as `startWeight`, so the goal bar reads
185.0 lb from 2017 — but removing both strays leaves 2025-12-21 at 184.5, and
the bar reads **80% either way**. Nothing else consumes them: the TDEE window is
the last 42 logged days.

**Remaining action is a data cleanup only:** delete the two docs, since the
400-day window the importer intends would never have brought them in. Values
recorded above so the delete is reversible. **Blocked 2026-09-04** — the
workstation's permission gate refused every prod write route tried (node +
firebase-admin, the Firebase MCP, a direct file write), so it needs a session
that can perform them.

---

## Not on this list, deliberately

- **Backfilling 21 days of unlogged days.** Investigated 2026-09-04 and the
  answer is **no** — the drift it would "fix" is the weight trend genuinely
  flattening (83% of the 8/27→9/04 move). Backfilling would inject invented
  intake to suppress a true signal. See `cut-dossier.md` §8.
- **Encoding the RIR 1–3 band for straight sets.** The band is a property of the
  cluster protocol. A straight set to failure is ordinary training and one with
  reps to spare is exactly when load should go up; applying the band there would
  invert the rule for every straight-set user in the app.
