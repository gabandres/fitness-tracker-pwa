# ADR-0025: Cardio is a block on the workout session, not a second collection

- **Status:** accepted
- **Date:** 2026-08-24

## Context

[ADR-0007](0007-workout-train-tab.md) shipped the Train tab strength-only and
said so twice — "strength-only for v1 (cardio stays the existing marker)" in the
decision, and "structured cardio" first in its Deferred list. That marker is
still all there is: a `DailyLog` carrying `exerciseCompleted: true` and zero
calories, which cannot distinguish a 5k from a bike commute from a walk to the
store. `CONTEXT.md` records the archaeology — `cardioCompleted` was a real field
once, historic docs still carry it, new writes never set it, and aggregation
folds all three markers into a single "exercised that day". The domain has had a
cardio-shaped hole in it, with a legacy name already sitting in the hole.

Two things make now the moment rather than later.

**There is data to import.** Oura, Apple Watch, Garmin and Whoop all write
auto-detected workouts into Apple Health / Health Connect with duration,
distance, average heart rate and active energy. The app reads five daily scalars
from that store already ([`health-sync.ts`](../../apps/mobile/src/lib/health-sync.ts))
and discards every workout it sees. See
[ADR-0026](0026-oura-through-the-os-health-store.md) for that half.

**Cardio is no longer load-bearing for the estimator.** Before
[ADR-0024](0024-continuous-activity-multiplier-floored-at-fao-minimum.md),
"how do we account for a run" was an arithmetic question about TDEE. It is not
any more: measured mode is energy balance, and energy balance already contains
every training calorie. So cardio is a *record-keeping and programming*
feature, which is a much smaller and much better-defined problem.

The real question is where it lives. Three shapes were considered:

- **A second `cardioSessions` collection.** Clean math separation, and an
  imported workout maps to it 1:1. But it splits training history in two, needs
  its own template concept, its own history list, its own streak reconciliation,
  and forces every "did I train today?" question to read two collections.
- **A cardio `logStyle` on the existing exercise.** Reuses everything. But
  `WorkoutSet` is `weight`/`reps`/`durationSec`, the progression engine is
  double-progression on load, and `sessionVolume` is Σ weight×reps — a 5k row
  entering those code paths is a defect waiting for a plausible-looking
  refactor to expose it.
- **A distinct block on the same session.** What this ADR picks.

## Decision

**1. `WorkoutSession` gains `cardio?: CardioBlock[]`, beside `exercises[]`.**
A lifting day with a 20-minute finisher is one session with both arrays
populated. A run on its own is one session with `exercises: []` and one cardio
block — the same doc, the same history row, the same
`FitnessStore.finishWorkout` cross-cutting finish, the same `exerciseCompleted`
marker, the same streak. There is one Train history, and it is complete.

**2. The block is the unit, and it carries its own numbers.**

```ts
export type CardioModality =
  | 'run' | 'walk' | 'ride' | 'swim' | 'row' | 'elliptical'
  | 'stair' | 'hike' | 'sport' | 'other';

export interface CardioBlock {
  modality: CardioModality;
  /** Free-text name. Required when modality is 'other', optional otherwise —
   *  "Zone 2", "Intervals", "Commute". Never translated; it is user data. */
  label?: string;
  durationSec: number;
  /** Distance in METERS. See "Units" below. */
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  /** Active energy in kcal, as REPORTED by whatever measured it. Read-only
   *  provenance, never an input to a target — see Decision 5. */
  kcal?: number;
  /** RPE 1-10. The cardio analogue of RIR; clamped the same way. */
  rpe?: number;
  notes?: string;
  source: CardioSource;
  /** Stable id from `source`'s own store, for idempotent re-import. */
  sourceId?: string;
  startedAt?: Date;
}
```

`CardioSource` is `'manual' | 'health'`, with the *provider* (Oura, Apple Watch,
Garmin) recorded separately as read provenance — ADR-0026 owns that field.

**3. Templates prescribe cardio the way they prescribe sets.**
`WorkoutTemplate` gains `cardioBlocks?: PlannedCardioBlock[]`, which is the
prescription (`modality`, `targetDurationSec`, `targetDistanceM`, `label`,
`notes`) exactly as `PlannedSet` is the prescription for a set. Starting a
session snapshots them into `cardio[]` as *targets*, and — following the
`targetReps` precedent already in `WorkoutSet` — the prescribed numbers render
as placeholders and are committed to `durationSec`/`distanceM` only when the
block is actually completed. A prescription is not a record of work done. This
is the same footgun ADR-0007 already paid for once.

**4. The strength math never sees a cardio block, by construction.**
`sessionVolume`, `computeExercisePRs`, `bestE1RMByExercise`, `metricForSet`,
`suggestProgression` and `trainHeroStats.topSet` all iterate
`session.exercises`, and none of them gains a cardio branch. Cardio derivations
(weekly minutes, weekly distance, longest effort) are new pure functions in
`packages/core/src/cardio-view.ts`, siblings of `train-view.ts`, never edits to
it. A test pins the property: adding cardio blocks to a session must leave every
strength number byte-identical.

**5. `kcal` is display-only and never reaches a target.**
Rendered on the block as "what your ring said", never summed into the day's
budget, never subtracted from intake, never added to TDEE. This is
[ADR-0024](0024-continuous-activity-multiplier-floored-at-fao-minimum.md)
decision 4 restated for the event stream: energy balance already contains every
training calorie, so spending it again is a double-count. ADR-0026 pins it with
a test in the same family as `tdee-wearable-independence.test.ts`.

**Units.** Distance stores **meters**; pace and mph/kph are derived at render
through `unit-system.ts`, never stored. This deliberately breaks symmetry with
load, which stores pounds — that asymmetry is a legacy corpus being preserved,
not a preference, and there is no corpus of stored distances to preserve here.
Duration stores seconds, matching `durationSec` on `WorkoutSet`.

## Consequences

- **`firestore.rules` must be deployed BEFORE any client writes a cardio
  block.** `isValidWorkoutSession` is a `hasOnly([...])` allow-list
  (`firestore.rules:279`), so an un-deployed rule does not ignore the new field
  — it rejects the entire session write, including the strength half. The dev
  app talks to production Firestore, so this fails on a developer's machine
  first. Rules ordering is the first task of the implementation, not the last.
- **The nested-array trust model from ADR-0007 extends unchanged.** Rules
  validate `cardio is list` and a size cap; they cannot iterate blocks, same as
  they cannot iterate sets. Field-level validity is the client's job via
  `packages/core` clamps, and the single-user trust model is what makes that
  acceptable.
- **`WorkoutSession.durationMin` and `CardioBlock.durationSec` are different
  things** — the first is how long the whole gym session took, the second is how
  long one run was. They are one careless autocomplete apart. Both carry doc
  comments saying so.
- **Naming.** `CONTEXT.md` gains **Cardio block** as the canonical term, with
  the legacy `cardioCompleted` field cross-referenced so nobody revives it. One
  concept, one term.
- **The web app does not get this.** [ADR-0022](0022-web-pwa-frozen-not-retired.md):
  the web logging surfaces are frozen, mobile is the source of truth, and a
  mobile feature owes no web port. The Angular Train tab keeps rendering
  sessions correctly because it iterates `exercises[]` and will simply not see
  `cardio[]` — which is exactly the behaviour a frozen surface should have. It
  must not *crash* on the unknown field; that is a one-line check, not a port.
- **Imports land in the same shape as manual entry**, so the import path is a
  mapper and not a parallel feature. That is the property that made this shape
  worth the extra field over a second collection.

## Alternatives rejected

- **A separate `cardioSessions` collection.** Two histories, two template
  concepts, two answers to "did I train today", and a streak that has to
  reconcile across both. The math separation it buys is available for free by
  simply not writing a cardio branch into the strength functions.
- **Cardio as a `logStyle` on `TemplateExercise`.** Puts a 5k inside a
  double-progression engine that would suggest adding 5 lb to it. The type
  system would permit it and every existing test would stay green.
- **Storing pace instead of duration + distance.** Pace is a ratio of two
  measurements; storing the ratio loses both. Derive it.
- **Storing miles or kilometers.** Forces a unit choice into the record and
  makes the stored value depend on a display preference the user can change.
