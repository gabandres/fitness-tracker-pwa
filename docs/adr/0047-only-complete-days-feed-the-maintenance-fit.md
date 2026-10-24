# ADR-0047: Only complete days feed the maintenance fit

- **Status:** accepted 2026-10-24 (owner decision, applies to every account)
  — implemented on `feat/s-v2-maintenance`; JS + rules. **Deploy
  `firestore:rules` before any client writes `dailyLogged`.**
- **Date:** 2026-10-24
- **Relates to:** ADR-0024 (what the measured estimate may read — this adds
  a rule about which DAYS it may read; the multiplier seam is untouched),
  ADR-0016 (each hook opens its own `dailyLogged` listener), ADR-0045
  (a demotion out of measured mode is an automatic target change and is
  recorded and announced as one).
- **Touches:** `packages/core/src/complete-day.ts` (new), `tdee.ts`
  (`partitionCompleteDays`, `notEnoughCompleteDays`), `targets.ts`,
  `tdee-series.ts`, `tdee-recalibration.ts`, `measurement-progress.ts`,
  `composition-maintenance.ts`, `csv-export.ts`; `firestore.rules`
  (`dailyLogged`), `functions/src/gdpr.ts`; `apps/mobile` ledger, the hooks
  that run the estimator, Today, Trends, Daily targets, three locales.

## Context

Measured maintenance is `intake + deficit`, and the intake column is assumed
to be everything that was eaten. Every intake path filtered only
`calories > 0`, so a day logged in part — breakfast and nothing else — was
read as a day the user ate 400 kcal.

A real account logged many days at 262–1,150 kcal while its weight sat flat
at 150–153 lb. The estimator did exactly what it was built to do with that
input: flat weight on ~900 kcal means maintenance ~900. It reported a
**measured maintenance of 931 kcal**, at full confidence, and drove the
target off it (clamped up to the 1,500 floor). Nothing in the data said
which days were complete, so nothing in the estimator could tell a partial
day from a small one. The fixture in `complete-day.test.ts` reproduces the
shape (42 days, 9 at ≥ 1,000, flat weight) and reads **864** under the old
rule.

## Decision

1. **A finished day counts toward the fit only if it is a Complete day:**
   ≥ 1,000 kcal logged and not marked "not fully logged", or marked "fully
   logged" at any intake (`isCompleteDay`, `COMPLETE_DAY_MIN_KCAL = 1000`).
   1,000 sits below almost any adult's resting energy, so a day under it is
   far likelier a partial log than a real day — a plausibility floor, not a
   target, and the user can override it either way.
2. **The user's answer is stored per day**, `users/{uid}/dailyLogged/{day}`
   = `{ complete: bool, updatedAt: request.time }`, owner-only, tri-state
   (no doc = unset; clearing deletes). Answered on Today ("Day fully
   logged?").
3. **A day that is not complete is an UNLOGGED day, not a zero-intake one.**
   It leaves the logged-day rows, so the 14-day gate (`MEASURED_MIN_DAYS`),
   the 42-day window, completeness and confidence all count complete days.
   Its weigh-in is kept as a weight-only row, exactly like a weigh-in on a
   day with no log row, and still reaches the trend.
4. **The day in progress is not judged.** It was already zeroed and kept
   (`withoutInProgressIntake`); keeping it is what leaves a fully-logged
   account byte-identical (pinned field-for-field in `complete-day.test.ts`).
   An answer on today takes effect tomorrow.
5. **Fewer than 14 complete days → no measured estimate**, and the result
   says why (`notEnoughCompleteDays: { valid, needed: 14 }`). Today, Trends
   and Daily targets show "Maintenance: not enough complete days (n of 14)"
   instead of a number. The calorie target takes the existing non-measured
   branch: the manual/onboarding number when there is one, else the
   formula; `targetMode: 'custom'` is untouched.

## What the 14-day gate counted, before and after

Before: every `aggregateByDay` row — any day with any `dailyLogs` row,
including 0-kcal workout markers (written until 2026-10-15) and legacy
weigh-in-only rows, plus the day in progress. After: complete days, plus the
day in progress. So an account whose 14 rows included markers or 0-kcal
rows can drop back to formula mode; that is the rule working, not a
regression (`tdee.test.ts` records the two cases that changed on purpose).

## Consequences

- Accounts that under-log stop being "measured" off their partial days.
  Their target moves (to the manual or formula number); ADR-0045 records and
  announces it like any other automatic change.
- Accounts that log fully are unchanged to the kcal.
- A user who genuinely eats under 1,000 on a day has to say so for the day to
  count. That is the intended cost: the alternative is the 931.
- `trimmedMean` already dropped the single lowest day, which is why one
  partial day rarely moved an estimate before; many did.

## Alternatives considered

- **Impute the missing intake** (e.g. the user's median day). Invents data
  the estimator then fits as if observed; the existing design rule is
  "unlogged days are excluded, not imputed".
- **A per-user floor** (a fraction of the formula estimate). Moves with the
  profile and is harder to explain on screen than one stated number; the
  owner chose one rule for everyone.
- **Count a left-out day as a zero-intake day in the run** (zero its
  calories as the in-progress day does). Keeps it in the 14 and the window,
  which is exactly the evidence the rule is meant to stop the gate from
  counting.
