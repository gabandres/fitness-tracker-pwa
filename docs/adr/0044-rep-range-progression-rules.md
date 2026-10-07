# ADR-0044: Progression reads a rep range per lift and predicts the next load; the derived band is retired

- **Status:** accepted 2026-10-07 — implemented; merged, not on any OTA
  (`STATUS.md` §2). Replaces ADR-0039 decision 2 (the derived band) and
  decision 3 (`targetRepBand` as the override). ADR-0038's validity gate and
  ADR-0039 decision 1 (RIR 0 is in band) and decision 4 (legacy sets) stand.
- **Date:** 2026-10-07
- **Touches:** `packages/core/src/progression-engine.ts` (myo-reps path,
  `resolveEngineConfig`, stalls), `progression-apply.ts` (new),
  `weekly-cluster-audit.ts` (`volumeCalls`), `workout.ts` (`ExerciseCategory`,
  `RepRange`, `LoadChange`, `TrainingPhase`, cluster `label`), `types.ts`
  (three profile settings), `firestore.rules` (`isValidExercise`,
  `isValidProfileCompleted` — **deploy before the OTA**), `apps/mobile` Train
  surfaces and Settings. No scheduled job, no AI call, no Cloud Function.

## Context

ADR-0039 derived each lift's band from its own best: `addLoadAt = max observed
activation reps`. The mark moved with the lifter — a new best raised the bar
it had to clear — so a lift advanced only by repeating its record, and every
load change restarted a three-session calibration with no call at all. Three
weeks in, the owner was still taking load calls from an outside coach.

## Decision

1. **A rep range per lift**, from its category (compound/machine 6-12,
   isolation 8-15, core 8-15, bodyweight 6-15; inferred from the name) or the
   lifter's `Exercise.repRange`. Effective reps = activation reps + logged RIR.
2. **Every cluster ≥ max is a candidate; the step is taken only if it is
   predicted to land in range.** e1RM = w × (1 + eff/30) from the lowest
   cluster (Epley — an estimate, labelled "expected"); predicted =
   ⌊30 × (e1RM/w2 − 1)⌋ at the next real step. Under `min` → build reps to
   max + 5, then a 3 s eccentric / pause rep, microplates if owned, one more
   cluster only if the volume rules allow it. Any cluster < max → hold, +1 rep.
   First session after an increase under `min` → drop back.
3. **Steps are equipment facts on the catalog** (`availableLoads`, now the
   "load steps"); dumbbells, Smith, barbell and plates default to 5 lb; a
   stack with none entered falls back to the template increment and says so.
   A Smith lift's prediction is "approximate" until `smithBarEffectiveLb` is
   entered. Added load on a bodyweight lift, and assistance, step on the rep
   rule alone — Epley needs the total load and the body is not logged.
4. **Stalls**: three valid sessions at one load with no new best, with a
   checklist (sleep < 7 h, intake under target, mini rest > 10 s); five
   suggests a variation.
5. **Templates change only by a tap or an explicit setting.** "Apply to
   template" on the finish sheet, or `Profile.autoApplyProgression` (default
   off). Every move — engine or hand edit — appends a `LoadChange` to the row's
   `loadLog`; an invalid read never moves a template.
6. **Volume**: at most +1 cluster per muscle per week, never above 6, never in
   a cut (`Profile.trainingPhase`, default cut; Roth 2023).

## Consequences

- The validity gate now also fails a load change between an activation and its
  minis (the 09-30 hammer curl 20 → 15 → 20); drop sets are exempt.
- Backtest from 2026-09-16 (`scripts/progression-backtest-2026-10-07.mts`)
  matches the coach's 2026-10-07 calls on every Leg and Pull lift except the
  pulldown, which needs its stack steps entered (85 by fallback vs 90).
- `targetRepBand` stays readable and rules-valid so old docs still update; no
  reader uses it.
