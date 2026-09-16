# ADR-0039: RIR 0 is the activation standard, the rep band is derived per lift, and pre-cutoff sets are legacy

- **Status:** accepted 2026-09-15 — implemented; merged, not yet on any OTA
  (`STATUS.md` §2 owns where that stands). Amends ADR-0038.
- **Date:** 2026-09-15
- **Touches:** `packages/core/src/progression-engine.ts`,
  `packages/core/src/activation-validity.ts`, `packages/core/src/workout.ts`
  (`EffortStandard`, `RepBand`, `Exercise.effortStandard`,
  `Exercise.targetRepBand`, `WorkoutSet.legacyEffortStandard`),
  `firestore.rules` `isValidExercise`, `apps/mobile` (`RecommendationNote`,
  `recommendation-text.ts`, new `LiftSettingsSheet`, `ledger.editExercise`,
  three locale files), `scripts/mark-legacy-effort-standard.mjs`. No
  scheduled job, no AI call, no Cloud Function.

## Context

ADR-0038 assumed activation sets at RIR 1-2 and judged them against a band
hardcoded to that standard (11-12 add, 9-10 hold, under 9 build). An
analysis of the owner's 85 logged clusters showed the self-reported RIR was
not calibrated:

| logged RIR | n | mean activation reps | mean first mini |
|---|---|---|---|
| 0 | 5 | 7.6 | 3.2 |
| 1 | 36 | 10.2 | 5.6 |
| 2 | 43 | 11.4 | 7.7 |

The rest-pause validity rule reads a first mini above 5 as "the activation
was not close enough to failure". Only the RIR 0 sets pass it; the logged
RIR 2 sets were functionally RIR 4-5. Two things follow. The engine's
`rir-to-failure` invalidity was rejecting the only reads that were actually
valid. And thresholds calibrated to RIR 1-2 do not transfer to failure sets,
so a hardcoded band would be wrong for every lift the moment the standard
changed.

The owner is switching to RIR 0 on the activation for every lift except
Smith squat and Seated Cable Row, where one rep stays in reserve because
failure under load conflicts with a lumbar restriction.

## Decision

1. **RIR 0 is in band.** `ACTIVATION_RIR_MIN` is 0; the `rir-to-failure`
   reason is deleted from both `activation-validity.ts` and the engine.
   RIR 4+ stays invalid (`rir-too-easy`). **The first-mini rule is
   unchanged and remains the primary gate** — it works under any effort
   standard, which is exactly why it, and not the RIR, decides validity.

2. **The band is derived per exercise, never hardcoded.** While a lift has
   no band the engine recommends NO load and says "Calibrating — n of 3 valid
   sessions logged." After `CALIBRATION_SESSIONS` (3) valid reads at one
   load it derives, from the highest activation rep count observed across
   them: `addLoadAt = max`, hold `max-2 .. max-1`, build under `max-2`
   (`repBandFrom`). The calibration run is the consecutive clustered reads
   at the CURRENT load, so a load change restarts calibration by
   construction — that is how "recalculate whenever the load changes" is
   implemented, not as a stored counter. The derived band is **computed on
   read and never written**: ADR-0038's decision 8 (client-side, no cache,
   engine never mutates) still holds.

3. **The band is stored only as a manual override.** `Exercise.targetRepBand`
   (`{ addLoadAt, holdLo, holdHi }`) on the catalog doc; absent means
   "derive". The lift-settings sheet takes one number — the add-load mark —
   and stores `repBandFrom(n)`, so a stored band always has the same shape
   the engine would derive. Clearing it deletes the field
   (`targetRepBand: null` → `deleteField()`), never leaves a stale map.

4. **Effort standard per lift.** `Exercise.effortStandard: 'failure' |
   'rir1'`, default `failure`. On a `rir1` lift an activation at RIR 0 adds
   the warning `failure-on-rir1` ("Logged at failure. This lift is set to
   leave 1 rep in reserve.") to the recommendation; it never invalidates
   the read. Set to `rir1` on the owner's Smith squat and Seated Cable Row
   by the script.

5. **Recalibration flag.** Every set logged on or before 2026-09-15
   (inclusive, end of day AST) carries `legacyEffortStandard: true`, written
   once by `scripts/mark-legacy-effort-standard.mjs` and never by a client.
   The engine **excludes** legacy reads from the band derivation (they are
   skipped without breaking the calibration run) and treats a legacy LATEST
   read as `calibrate` rather than judging it, even under a manual band. They
   remain history: `last` still shows them, the stall run still counts them,
   PRs and CSV are untouched.

6. **Actions.** `add-load` at or over the mark on every cluster; `hold` in
   the hold band; `build-reps` under it (with the floor to build back to) or
   when the next step is too large; `repeat-invalid` and `calibrate` as
   before. On a multi-cluster lift the cluster named is the BINDING one —
   fewest reps — not the first one found. The split-cluster rule, increment
   awareness, stall detection and the weekly cluster audit are unchanged;
   the stall's `blockingGroup` is judged against the add-load mark and is
   omitted when there is no band yet.

7. **Where it surfaces.** `RecommendationNote` renders the calibration
   sentence as the reason line on a `calibrate` action, and as an extra
   line under an invalid read while no band exists; warnings render as an
   ink-coloured line under the reason. A settings affordance on the note
   opens `LiftSettingsSheet` (effort chips, the add-load-mark field, and the
   automatic band's current numbers) from both the active-session card and
   the template's next-session list. The `progression.targetReps` on a
   template row no longer feeds the clustered engine (only `incrementLb`
   does); it still drives straight-set double progression.

## Where the numbers live

| Input | Field | Why there |
|---|---|---|
| effort standard, band override | catalog `Exercise.effortStandard`, `Exercise.targetRepBand` | properties of the lift, not the programme |
| the derived band | nowhere — `calibrationFor(history)` on read | a cache would need invalidation on every load change |
| legacy flag | `WorkoutSet.legacyEffortStandard` | the set is the unit the standard applies to |
| increment | template row `progression.incrementLb` | unchanged from ADR-0038 |

## Consequences

- Every clustered lift is "Calibrating — 0 of 3" until three clean
  post-cutoff sessions at its load, since all prior data is legacy. That is
  the point: no recommendation is built on the old standard.
- A bodyweight cluster (no weight on any set) calibrates like any other —
  "no load" is one load key — so pull-ups and dips are not stuck calibrating.
- `firestore.rules` `isValidExercise` accepts the two new fields (deployed
  with this change; a client write before the rules deploy is rejected).

## Verification

`packages/core` 92 files / 1,567 tests green; mobile `tsc` clean and the 8
Train suites (61 tests) green, including the three-locale placeholder parity
check over the new keys; rules suite covers the two fields (accept + reject).
