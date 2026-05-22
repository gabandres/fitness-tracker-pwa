# ADR-0005: Store facets split off FitnessStore

- **Status:** accepted
- **Date:** 2026-05-22 (landed in commit `1627e16`)

## Context

`FitnessStore` had grown to own logs, presets, fasting state, body
metrics (weights, water, measurements), the AI weekly report, and the
first-meal milestone latch — alongside every derivation (TDEE, targets,
streak, weekly, EMA, goal progress, monthly summary, today summary,
budget-crossed signal). Components that only needed the fasting pill
were transitively pulling in the Gemini service, the analytics service,
and the full subscription chain.

The store was also approaching the size where a circular dependency
became a real risk — the weekly-report flow needs derivations from the
hub, but the hub's lifecycle effect also needs to drive the report
state.

## Decision

Extract focused facet stores. The hub keeps coordination + derivations.

- **`FitnessStore`** (hub) — owns the canonical log + preset caches and
  all derivations (TDEE, target calories, protein target, streak,
  weekly, envelope, EMA, goal progress, today summary, monthly
  summary, budget-crossed). Coordinates the load lifecycle for the
  whole quad — its sign-in effect calls into the facets'
  `hydrate(...)` / `clear()`.
- **`FastingStore`** — fasting start/end + `isFasting` computed. Reads
  the profile through `LEDGER_PORT`; no internal mutable state.
- **`BodyMetricStore`** — daily weights, daily water, measurements,
  measurement deltas. `hydrate(...)` and `clear()` are driven by
  `FitnessStore._load()` and the sign-out effect.
- **`WeeklyReportStore`** — AI weekly-report state, Gemini generation
  flow, 7-day staleness check. Reads derivations and log windows from
  `FitnessStore` as a downstream consumer.
- **`MilestoneTracker`** — `first_meal_logged` analytics latch (backed
  by `localStorage` key `macrolog.first-meal-tracked`) and the
  `MilestoneContext` consumed by the weekly-report prompt builder.

The hub-vs-facet cycle (hub needs to refresh the report, report needs
hub derivations) is resolved by **constructor-time hook registration**:
`WeeklyReportStore`'s constructor calls
`FitnessStore._registerWeeklyReportHooks(refresh, clear)`. The hub
holds opaque callbacks; it does not inject `WeeklyReportStore`.

Derivations stay on the hub even when the underlying state lives in a
facet (e.g. `goalProgress` reads `BodyMetricStore.dailyWeights()`). The
rule: state can move, derivations stay together so any future call
that combines them doesn't have to re-resolve which store owns what.

## Consequences

- Components inject the smallest store they need. The fasting pill
  pulls `FastingStore`; the measurements list pulls `BodyMetricStore`;
  the weekly-report panel pulls `WeeklyReportStore`. The hub is only
  for code that actually wants derivations.
- Sign-in / sign-out lifecycle is centralized in `FitnessStore`. New
  facet stores must expose `hydrate(...)` + `clear()` and wire them
  into the hub's lifecycle, not run their own auth effects.
- New cross-store flows that *would* introduce a cycle use the same
  hook-registration pattern. Constructor-injection of a downstream
  store from the hub is forbidden.
- The hub is still a sizable file. That is acceptable — its mass is
  derivations, which are themselves the value the store provides.
  Resist the urge to split derivations across files for tidiness;
  cohesion beats line count.
- See also [`CONTEXT.md` →
  Stores](../../CONTEXT.md#stores-post-3-split--see-adr-0005docsadr0005-store-facets-splitmd).
