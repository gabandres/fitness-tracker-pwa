# Training & TDEE backlog

Work opened by the 2026-09-04 program update and the Workstream C investigation
that is **real, scoped, and not yet done**. One line per item: what it is, why it
matters, and what "done" looks like.

**This is a backlog, not a status file.** When an item ships, delete it — the
outcome goes to `CHANGELOG.md`, the reasoning to an ADR, the current state to
`STATUS.md`. A shipped item left here with a note on top is how a wish list turns
into something indistinguishable from a status report (`CLAUDE.md` housekeeping
rule).

Owner-side training decisions live in the owner's `cut-dossier.md` §Open actions (not in this repo), not here.
This file is only the parts that are code.

---
## 0 · Open from the 70% reliability-cliff fix (Option A shipped 2026-09-04)

- **Device verification on an account that actually moves** — `review@`
  (`xFm6lDvP…`, +144 kcal at the time), not the owner's, whose cliff height was 0.
- **Re-evaluate the `reliable` threshold** (`loggingCompletenessPct >= 70`) now
  that a manual seed can no longer outrank a measured estimate. Fold in §3's
  marker-only days (3 accounts, 3 days in PROD on 09-04 — immaterial alone).

(Until 2026-11-19 this file also held a "Shipped 2026-09-04" list, the full
§0 measurement, and §1/§5/§6/§7/§8 — all shipped or done: the intake-mean fix,
supersets (ADR-0040 `supersetTags`), per-exercise `restAfterSec`, the exercise
merge, the stray-weight delete. Git and `CHANGELOG.md` keep them.)


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

**MEASURED 2026-09-04, and it is immaterial: 3 accounts, 3 marker-only days, in
the whole of PROD.** The owner has none. So the inflation is real and cannot
move anybody across the 70% bar. It is now folded into §0's options rather than
standing as its own item — it does not justify a change of its own.

Provenance note: pre-August markers look different — April/June rows carry
`exerciseCompleted: true` on a REAL meal log, because the retired web store set
the flag on an existing row instead of writing its own. Both shapes are valid.

## 4 · The split-cluster rule is enforced in code but not expressible in a template

`suggestProgression` now requires every activation to clear. But a template cannot
*say* "this lift is 2-cluster and both must land 11–12" — the rule is inferred
from the set sequence. It is carried on the owner's three templates as a cue
string, which no code reads.

Only worth doing if the rule needs to vary per lift. Right now it does not.

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
