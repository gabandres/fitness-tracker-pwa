# ADR-0007: Workout logging — the Train tab

- **Status:** accepted
- **Date:** 2026-06-07

## Context

The app tracked food intake, weight, and a binary "exercised today"
marker, but had no way to log *what* a workout actually was. Users train
on repeatable splits (e.g. Chest/Triceps/Shoulders) and want structured
set logging, progression over time, and personal-record tracking — none
of which the single `exerciseCompleted` flag on a `DailyLog` can express.

The example that drove the design is cluster training: an *activation*
set followed by short-rest *mini-sets*, grouped into clusters (C1/C2),
with per-exercise form cues and an explicit double-progression rule. The
feature must also serve users doing plain straight sets.

## Decision

Add a fourth primary tab, **Train**, backed by three new user-owned
Firestore collections and a `WorkoutStore` facet (sibling to
`BodyMetricStore`, per [ADR-0005](0005-store-facets-split.md)). Free with
Pro upsells; strength-only for v1 (cardio stays the existing marker).

### Three entities

- **Exercise** (`users/{uid}/exercises`) — the per-user catalog. Each
  lift is a stable identity (`exerciseId`) that progression charts and
  PRs aggregate over. Renaming is one edit; the same lift across two
  templates is one chart.
- **WorkoutTemplate** (`users/{uid}/workoutTemplates`) — an editable
  blueprint: ordered exercises (referencing `exerciseId` + a snapshot
  name), target loads, cues, a `ProgressionRule`, and a `plannedSets`
  scaffold. Rest config (`restMiniSec`, `restClusterSec`) lives here.
- **WorkoutSession** (`users/{uid}/workoutSessions`) — one logged
  instance. Starting a session **snapshots** the template's exercises
  into the session doc, so later template edits never rewrite history.
  A `status: 'active' | 'completed'` field drives crash/resume.

### Flat sets, optional grouping

An exercise has an ordered `sets[]`; each set carries a `kind`
(`warmup | activation | working | mini | drop`) and an optional `group`.
Straight sets render as a plain list; setting `group` renders C1/C2
clusters. One schema serves both styles — clusters are a UI affordance,
not a schema fork.

### Live-write + single active session

Set entry debounce-writes to the session doc (`status:'active'`); Finish
flips it to `'completed'`. Firestore offline persistence covers gym
dead-zones, and resume is "find the active session". `WorkoutStore`
enforces a single-active invariant in `startSession` so the
`getActiveSession` `limit(1)` query is deterministic.

### Rule-based progression (no AI)

Progression is a pure, deterministic double-progression
(`utils/workout-progression.ts`, a pure module per
[ADR-0003](0003-day-summary-as-pure-module.md)): when the key set hits
`targetReps` for `holdSessions` consecutive sessions, suggest
`+incrementLb`. PRs use the Epley estimated 1RM. AI coaching is a
deferred Pro layer, layered on top later.

### Hub owns the cross-cutting finish

Bodyweight on a session writes through to `dailyWeights` (one source of
truth with the Body tab), and finishing stamps a 0-cal
`exerciseCompleted` `DailyLog` marker so the day counts toward the streak
and shows the History dot. Both concerns live on `FitnessStore`
(`finishWorkout`), which already owns logs + body — `WorkoutStore` never
imports the hub, avoiding the circular dependency
[ADR-0005](0005-store-facets-split.md) warned about.

## Consequences

- **Seam discipline holds.** `LEDGER_PORT` gained the workout methods;
  `Timestamp` ↔ `Date` conversion stays inside the Firestore adapter's
  workout mappers (the *Date type at the seam* convention). The
  in-memory adapter mirrors the contract for tests.
- **Rules trust the owner for nested arrays.** The set/exercise arrays
  are deeply nested; rules validate top-level scalars, list-size caps,
  and string caps (same single-user trust model as `measurements`), not
  every nested field. A single validator covers create + merge-update
  because `request.resource.data` is the post-write doc.
- **One composite index.** `workoutSessions(templateId, status,
  timestamp desc)` backs the per-template "last session" query; every
  other workout query is single-field.
- **Free vs Pro caps mirror presets/charts.** `CUSTOM_TEMPLATE_LIMIT_FREE`
  (client-cosmetic, like `PRESET_LIMIT_FREE`) and
  `WORKOUT_HISTORY_DAYS_FREE` (like `CHART_HISTORY_DAYS_FREE`).
- **Deferred:** structured cardio, AI coaching, and es-PR seed content
  (UI chrome is translated; shipped library/templates are English-only
  for v1; user-entered names/cues are data, never translated).
