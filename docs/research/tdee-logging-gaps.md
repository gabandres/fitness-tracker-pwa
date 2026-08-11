> **VERDICT** — A two-week logging gap does not just make Ignia's measured TDEE
> less certain, it makes it **wrong in a specific direction and confidently so**.
> Measured on this codebase: an under-logged trip drops maintenance by **635
> kcal/day while still reporting `reliable: true`**, and a clean gap with real
> weight gain makes the outlier guard silently discard **all seven** post-trip
> weigh-ins. The category's answer is settled and unanimous: **pause the
> estimate when data quality drops, hold the last good value, and resume** —
> MacroFactor flips `updating → holding` below ~4 logged days/week and tells the
> user which days it excluded. Ignia has no pause state, never imputes an
> unlogged day, and its reliability flag does not gate the failure it exists for.
> **Status:** DECIDED AND PARTLY SHIPPED, 2026-08-11. **Candidates 2 and 3 are
> in** (gap segmentation + the discarded-weigh-in count on Today); **candidate 1
> (the hold state) is deferred** and still the right next move; **candidate 4
> (imputation) is not happening** without its own research pass. §4 is kept as
> written, with what shipped recorded under it.
>
> **One claim in §4 was wrong and the correction matters**: candidate 2 does
> **not** kill §1b on its own — measured, segmenting *without* a settle window
> moves the rebound scenario from 2,392 to **3,469** against a true 2,500, five
> times the original error and in the direction that raises the target. The
> rebound does not belong to the old segment; it belongs to the *new* one, where
> nothing damps it. What shipped therefore also ignores the first 7 days after a
> break. See §6. ·
> **Researched:** 2026-08-11
> **Read this only if:** you are changing `calculateTdee`, the reliability gate,
> or anything that presents maintenance to a user.
> **Do not** re-derive the measurements in §1; they are reproducible and cited.

# Measured TDEE and logging gaps

Prompted by an owner question: *"if I travel 2 weeks and I don't log anything,
the math changes and it's a problem."* It is a bigger problem than the question
assumes, and the direction of the error is the surprising part.

---

## 1. What actually happens today — measured, not reasoned

`calculateTdee` is
`trimmedMean(logged intake) + (−weightSlope × 3500)`, fitted over the last **28
logged days** (`MEASURED_WINDOW_DAYS`), with a Theil–Sen outlier guard on the
weigh-ins.

Five scenarios were run against the real function. In **every** one the ground
truth is identical: the person burns 2,500, eats 2,500, and their true weight is
flat at 180 lb. Any deviation from 2,500 below is error introduced by the gap.

| # | Scenario | Reported TDEE | Error | completeness | `reliable` | weigh-ins dropped |
|---|---|---|---|---|---|---|
| A | No gap (control) | 2,500 | — | 100% | true | 0 |
| B | 2-week gap, +4 lb, resumes logging | 2,500 | 0 | 75% | **true** | **7** |
| C | 2-week gap, +8 lb, resumes logging | 2,500 | 0 | 75% | **true** | **7** |
| D | 2-week gap, +4 lb that then rebounds off | 2,345 | −155 | 75% | true | 1 |
| E | Trip logged 2 days of 14, at 3,500 each | **1,865** | **−635** | 82% | **true** | 0 |

Four distinct failures are visible here.

### 1a. Step-change blindness (B, C)

The gap produces a *step* in bodyweight: flat at 180, then flat at 184. Against a
28-day window that is mostly the old plateau, every post-trip weigh-in sits far
from the fitted line, so the robust guard classifies all seven as outliers and
drops them.

The number that comes out is *correct by accident* — and the app has thrown away
every observation of a real 4 lb change while reporting `reliable: true`. An 8 lb
gain (C) behaves identically. The guard exists to survive one mistyped 158 lb
entry; it cannot tell that from a genuine regime change.

`outliersDropped` is returned by `calculateTdee` and surfaced **nowhere** a user
can see it.

### 1b. Rebound reads as fat loss (D)

Travel weight is substantially glycogen and sodium. When it comes off over the
following week, the trend line sees a fall, and a fall means a deficit:
maintenance drops 155 kcal. The user is punished for the water leaving.

### 1c. Partial logging is poison, and it is the common case (E)

E is the realistic trip: you log a couple of the big days, roughly, and skip the
rest. Those two logged days are *partial* — 3,500 recorded against maybe 4,500
eaten — and they are the only intake evidence the window has for that fortnight.
Meanwhile the weigh-ins record the full gain.

Result: intake is understated, weight gain is not, and the algorithm resolves
the contradiction the only way it can — by concluding the person burns less.
**635 kcal/day less.** This is the same mechanism that puts the owner's own
account at 1,870 against a 2,552 formula estimate (§3 of `STATUS.md`).

### 1d. The reliability flag does not gate this

`reliable` is `completeness ≥ 70% && intakeDays ≥ 10`. In E it is **true** at 82%
completeness while the answer is off by a quarter. Completeness measures the
*density of logged days within the span they cover*, which a couple of mid-trip
logs is enough to satisfy. It says nothing about whether those logs were
complete, and nothing about a step change in weight.

---

## 2. How the category solves it

### MacroFactor — pause, hold, and say so

The clearest and most documented answer, and it is a **state machine, not a
smoother**.

- **Minimum cadence: at least four logged days per week**, daily ideal
  ([help 110](https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates)).
- Below it, **the expenditure estimate stops updating** — the status changes
  from **`updating` to `holding`** — until logging is consistent again (ibid.).
- The rationale is an explicit error-budget argument: **nutrition data carries
  ~15% estimation error, weight data under 1%**. Rather than let the noisy input
  move the estimate, they freeze it (ibid.).
- **The last high-confidence value is preserved** rather than decayed, on the
  reasoning that absent a radical lifestyle change, your pre-break expenditure is
  still close enough to generate usable targets
  ([expenditure-v3](https://macrofactor.com/expenditure-v3/)).
- V3 **imputes** unlogged days rather than ignoring them, estimating their intake
  to within ~15–20%, which is what buys the tolerance: V2 needed 80–85% data
  completeness, V3 pauses only past **three missing days per week** (ibid.).
- Water-weight shifts — fluid retention, salt, post-stall "whoosh" — were
  explicitly targeted in V3 and have **smaller impact on the estimate** than
  before (ibid.).
- The user is told. A **Logging Break coaching module** welcomes you back, lists
  **the days it identified as break days**, and explains when the algorithm will
  un-pause ([help 251](https://help.macrofactorapp.com/en/articles/251-coaching-module-logging-break)).

### Partial logging is treated as worse than no logging

This is the sharpest lesson and it inverts an intuition.

- A **blank day** — no entries at all — is *skipped* by the algorithm.
- A **partially logged day** is *not*, and it poisons the window. Logging 1,500
  on a day you ate 3,000 pulls the expenditure estimate down by **~71 kcal**, and
  because the window is 21 days, it does so **for three weeks**
  ([help 241](https://help.macrofactorapp.com/en/articles/241-what-is-partial-logging)).
- So they **detect likely partial days and let the user mark them ignored**
  (ibid.). The guidance is: if you cannot reconstruct a day to within ±30%,
  delete the day entirely rather than leave a partial record.

### Trend weight, not raw weigh-ins

The oldest idea in the space and still the standard. Daily scale readings are
dominated by water; the fat signal is under 0.2 lb/day and is lost in that noise
([Hacker's Diet, *Signal and Noise*](https://www.fourmilab.ch/hackdiet/e4/signalnoise.html)).
The remedy is an **exponentially weighted moving average** — recent readings
weighted more heavily, the trend line rather than the point being what drives
any calorie decision
([Hacker's Diet](https://www.fourmilab.ch/hackdiet/www/hackdiet.html),
[exponential smoothing](https://en.wikipedia.org/wiki/Exponential_smoothing)).

Practitioner guidance converges on the same staging: a preliminary estimate at
~7 days, meaningful at 14, high-confidence at 21–30 days of *consistent* logging
([adaptive-TDEE overview](https://www.zolthealth.com/learn/what-is-adaptive-tdee)).

---

## 3. Where Ignia differs — four concrete gaps

| | Category practice | Ignia today |
|---|---|---|
| Low data | **Pause**; hold the last good estimate | Always recomputes, from whatever is there |
| Unlogged days | **Impute** (V3) or pause | **Ignored entirely** — biases intake low |
| Partial days | **Detected and excludable** | Indistinguishable from a real low-intake day |
| Weight signal | EWMA trend weight | Regression over raw weigh-ins, with an outlier guard that **discards step changes** |

The reliability flag is the closest thing Ignia has to a pause, and it is not
one: it only downgrades the *target* (`dailyTargets` falls back), while the
maintenance figure is still computed, still displayed, and — since 2026-08-11 —
displayed on Today.

One thing Ignia already has that helps: **`travelMode`** on the profile, which
zeroes `targetPaceLbsPerWeek`. It changes the target, not the estimate, so it is
a hook rather than a solution.

---

## 4. Candidates, priced. None chosen.

**1 — A hold state (highest value, matches the category).**
Add `source: 'held'` (or a `holding` flag) to `TdeeResult`. When the trailing
window falls below a logging-cadence bar, stop recomputing and return the last
good value with the date it was computed. Requires persisting one number and one
timestamp per user — a profile field, no new collection. Both frontends already
branch on `source`, so the UI cost is a badge and a sentence. This is the fix
that answers the owner's question directly.

**2 — Segment on a gap instead of fitting across it.**
A break longer than N days ends the current trend segment; the fit restarts
after it. Directly kills 1a and 1b: the step is a boundary, not an outlier, and
the rebound belongs to a new segment. Pure change inside
`weightTrendLbsPerDay`, fully unit-testable, no storage. Cheapest real fix.

**3 — Surface `outliersDropped` and the completeness counts.**
Already computed, currently invisible. "7 weigh-ins ignored" is a strong signal
that the estimate is not describing the user's last three weeks. Near-zero cost
now that `windowDays`/`spanDays` are already plumbed to the view layer.

**4 — Impute unlogged days (what buys V3 its tolerance).**
The most accurate and the most dangerous: an imputation model that is wrong is
indistinguishable from data. Would need its own research pass and a real
validation set. **Not recommended before 1–3.**

**Partial-day detection** is the sleeper. It is the mechanism behind the worst
measured failure (E, −635 kcal) and the owner's own 1,870, and MacroFactor
considered it worth a dedicated coaching module. A first cut needs no model: a
day whose logged intake is implausibly low against that user's own history is a
candidate, and the user confirms.

## 5. What not to do

- **Do not widen the outlier guard** to stop it eating step changes. It exists
  because one stray 158 lb reading moved a real account's maintenance from 2,741
  to 1,619. Segment instead (candidate 2) — that keeps the guard for what it is
  for.
- **Do not hide the number when data is thin.** Withholding leaves Today saying
  nothing, and the estimate is still the user's own data. Hold it, label it, date
  it.
- **Do not change the target math to compensate.** The target already falls back
  correctly when `reliable` is false. The defect is in the estimate and in what
  the UI claims about it, and that is where it should be fixed.

---

## 6. What shipped, 2026-08-11 — and the measurement that changed the design

Candidates **3** then **2**, in that order, after an explicit owner decision to
lift *"do not change the TDEE math"* for candidate 2 only. Candidate 1 is
deferred; candidate 4 is not on the table.

### Candidate 3 — the discarded weigh-ins are visible now

`MaintenanceView.weighInsDropped` carries `outliersDropped` through to the
Today maintenance line on both platforms. **Deliberately not gated on
`reliable`**: the two-week-break case discards seven weigh-ins while reporting
`reliable: true`, so gating it there would have hidden it in exactly the case it
exists for. Copy names the cause rather than the statistic — "a real jump in
weight can look like a bad reading".

### Candidate 2 — segment on the break, then let the water settle

`weightTrendLbsPerDay` now fits only the run of weigh-ins since the last break
of **≥7 days**, and ignores the first **7 days** of that run.

The settle window is not decoration; it is the difference between a fix and a
regression. Every scenario below holds the truth at 2,500 kcal:

| Scenario | Before | Segmented only | Segmented + settle |
|---|---|---|---|
| §1a step: +4 lb over a break, then flat | 2,038 (−462, 7 weigh-ins discarded) | **2,500** | **2,500** |
| §1b rebound: +4 lb, water off over the next week | 2,392 (−108) | **3,469 (+969)** | **2,500** |
| Fewer than 4 weigh-ins since the break | 2,500 | 2,500 | 2,500 |

Segmenting alone fixes the step and **makes the rebound five times worse**, in
the direction that raises the target — travel water leaving is a real fall
inside a fresh 14-day segment, and the old whole-window fit at least had the
pre-break plateau damping it. §4's claim that candidate 2 "directly kills 1a and
1b" holds only with the settle window.

Two guards on over-reach, both pinned by tests: a break shorter than 7 days
changes nothing (a long weekend is a skipped morning, not a changed regime), and
a post-break run with fewer than 4 surviving weigh-ins falls back to the old
whole-window fit rather than to `null` — null would send `calculateTdee` to the
hardcoded 2,450 seed, replacing a biased estimate built from this user's data
with one built from nobody's.

### What this does NOT fix

**§1c, partial logging — the biggest measured error (−635) — is untouched**, and
it is the one behind the owner's own 1,870. Segmentation is a weight-trend fix;
partial logging poisons the *intake* side. That, and the hold state, are what
candidate 1 and partial-day detection are for.
