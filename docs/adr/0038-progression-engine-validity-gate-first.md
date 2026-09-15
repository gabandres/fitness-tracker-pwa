# ADR-0038: The progression engine — a validity gate that runs first, then activation-only progression

- **Status:** accepted 2026-09-15 — implemented; merged, not yet on any OTA
  (`STATUS.md` §2 owns where that stands)
- **Date:** 2026-09-15
- **Touches:** `packages/core/src/progression-engine.ts` (new),
  `packages/core/src/weekly-cluster-audit.ts` (new), two fields on the
  catalog `Exercise` (`availableLoads`, `assisted`) and one on
  `SessionExercise` (`recommendation`), `firestore.rules` `isValidExercise`
  (deployed 2026-09-15), `apps/mobile/src/hooks/useTrain.ts`,
  `apps/mobile/src/app/(app)/train.tsx`,
  `apps/mobile/src/components/train/{RecommendationNote.tsx,recommendation-text.ts}`,
  three locale files. No scheduled job, no AI call, no Cloud Function.

## Context

The owner's program is myo-reps: an activation set at RIR 1-2, then mini-sets
after 5-10 s rest, one to two clusters per lift. Until now the next-session
call (add load, hold, repeat) was worked out by hand from a CSV export and
asked for in chat. Three things made that fragile and are on the record:

- the app already refused to recommend load off an activation at RIR 0 or
  RIR 4+ (`activation-validity.ts`, 2026-09-04), and already required every
  cluster to clear the rep threshold (`keySets`), so half the rule existed;
- self-reported RIR is unreliable by 1-2 reps (Steele 2017, Halperin, Refalo
  2024 — cited in `activation-validity.ts`), while the mini-set rep count is
  an objective measurement of the activation that nothing read;
- the manual analysis had twice advanced load off a read the minis said was
  invalid (the 2026-09-09 cable row: activation 10, first mini 8).

## Decision

1. **Layer 1 runs first and blocks everything after it.** A cluster read is
   valid only when the first mini lands in 2-5 reps, the activation's RIR is
   1-3 (the existing band), no mini out-reps its activation, the load did not
   change between clusters, and — on a lift the template prescribes as a
   cluster — RIR was logged at all. An invalid read yields `repeat-invalid`
   with the specific reason and NEVER a load change. This is the one rule the
   rest of the module exists to protect.

2. **Missing RIR blocks only on clustered lifts.** The 2026-09-04 choice
   ("absence of a measurement is not a measurement") stands for straight-set
   users, who are most users; the engine returns `action: 'none'` for them and
   the double-progression bump they had is untouched. Strictness is a property
   of the cluster protocol, keyed on the template prescribing an activation.

3. **Layer 2 reads the activation set only.** The band is
   `[targetReps − 1, targetReps]` from the template's `progression.targetReps`,
   defaulting to 11-12. Below band → hold; in band on EVERY cluster → add
   load; over band on every cluster → add load, flagged under-loaded. The
   blocking cluster is named. The template's per-exercise target wins over a
   fixed band because the RDL, rear delt and calf raise already carry
   different targets and the owner set them.

4. **Layer 3 refuses a leap.** The next load is the next `availableLoads` step
   on the catalog exercise, else `progression.incrementLb`, else 5 lb. A step
   over 15% becomes `build-reps` (current reps + 2 first) — except when every
   activation is already over the band, where the cap would freeze a lift that
   is plainly too light. `assisted: true` inverts the direction: progress is
   less assistance, floored at zero.

5. **Layer 4 diagnoses stalls.** Three consecutive same-load sessions with the
   binding activation reps not rising on the latest step is a stall; the
   report counts invalid reads, too-easy activations and a cluster that blocks
   every time. From five sessions it ranks interventions: mini rest 5-10 s,
   drop the blocking cluster one step, reduce load 10%.

6. **Layer 5 counts CLUSTERS, not sets.** One cluster is one rest-pause set,
   judged against 2-6 per muscle per week — not the 10-20 straight-set figure.
   The primary muscle is `muscles[0]` on the catalog exercise: already there,
   already ordered by the person who wrote it, no rules change. An exercise
   with no muscles is named under "unattributed" rather than dropped.

7. **The engine recommends; it never mutates a template.** Its only write is a
   snapshot of its call onto each session exercise at start
   (`SessionExercise.recommendation`), so the session records what was
   recommended next to what was done; `followedRecommendation` reads the
   override. Session exercises are not field-validated by rules, so this
   needed no rules change.

8. **Computation is client-side on read**, in pure core functions, from the
   completed sessions the Train tab already subscribes to. No cache, no
   Cloud Function, no new listener (ADR-0016 respected).

## Where the numbers live

| Input | Field | Why there |
|---|---|---|
| cluster or not, rep target, increment | template row (`plannedSets`, `progression`) | the prescription |
| equipment steps, assisted | catalog `Exercise.availableLoads`, `Exercise.assisted` | equipment, not programme |
| primary muscle | catalog `Exercise.muscles[0]` | already populated on 27 of 31 docs; the 4 empty ones were filled 2026-09-15 |
| the call the lifter saw | `SessionExercise.recommendation` | the audit trail |

## What it deliberately does not do

No pump / soreness / joint-pain prompts (that is a volume model built on
subjective inputs), no %1RM (nothing is tested), no velocity, no deload
scheduling, no automatic template edits.

## The one place the spec and the data disagreed

The spec's Layer 2 validation case — 2026-09-15 Smith squat C1 11 @ RIR 1,
C2 10 @ RIR 1 → HOLD, C2 blocked — is stated on the activations alone. The
session as logged has a C1 first mini of **6**. Under decision 1 that read is
invalid, and the engine says REPEAT 20 rather than HOLD 20. The load is the
same either way; the difference is that no claim about C2 is made off a read
the minis reject. Both readings are pinned in `progression-engine.test.ts`.

## Verification

`packages/core` 1,553 tests green (37 new, every historical case in the spec
as a fixture from the real sessions); mobile 57 Train tests green (9 new,
including the spec's example strings rendered through the real pipeline and a
three-locale placeholder-parity check); rules suite 741 green (2 new); mobile
`tsc` clean; web `tsc` clean; functions build clean.
