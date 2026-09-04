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

---

## 0 · The 70% reliability cliff, and what it let happen — HIGHEST PRIORITY

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

**Also unexplained and worth finding: how onboarding was reached at all.**
`profileCompleted` was `true` before the write, so `assessRoute` could only
return `'app'`; the gate did not fail. `onboarding.tsx` has an `isRedo` branch,
so a deliberate redo is supported — an accidental one is the bug. Until that is
understood, any account can have its targets overwritten the same way.

## 1 · The in-progress day is in the TDEE intake mean — DECISION NEEDED

**The one with a medical edge, so it goes first.**

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

## 3 · Phantom meal row written on workout save

Ten rows on the owner's account, `{calories: 0}` with no label, no protein, no
flags. Dates match the workout sessions exactly (8/04, 8/06, 8/12, 8/18, 8/24,
8/26, 8/27, 8/31, 9/02, 9/03).

**Harmless to the TDEE** — every one landed on a day that already had meals, so
they sum into an existing total; deleting all ten moves the estimate by 1 kcal.
That is measured, and it is why this is not item 1.

Still worth fixing: they are junk rows in the user's own food log, and the
*reason* they are harmless is luck about this account's logging habits, not
design. A user who logs a workout on a day they ate nothing would get a real
0-kcal day in the window.

Find the writer, stop it, then clean up the ten rows.

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
a feature.

## 8 · Out-of-range historical weight

`dailyWeights` holds `184.9998490935815` under key **`2017-06-22`** — nine years
before the account existed. `cut-dossier.md` §8 item 9 records this as
*2026-06-22*; the stored key is 2017. Worth confirming which is wrong before
touching it, since a date-derivation bug and a bad value need different fixes.

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
