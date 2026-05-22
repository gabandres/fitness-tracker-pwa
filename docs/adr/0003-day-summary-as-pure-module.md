# ADR-0003: Day summary as a pure module

- **Status:** accepted
- **Date:** 2026-05-22 (landed in commits `4fd6f02` + `72d34a9`)

## Context

Per-day rollups — total calories, total protein, meal count, exercised
flag, weight for the day — were being computed in at least three
places: the Today card's local component logic, the weekly-report
prompt builder, and the CSV export path. Each had slightly different
handling for the legacy `liftCompleted` / `cardioCompleted` flags, for
the protein rounding rule, and for whether a weight-only day counted as
a "meal day".

CSV export and the Today card had already drifted on the exercised-flag
detection. The next surface (recipe analytics) was about to add a
fourth copy.

## Decision

`DaySummary` is a pure, dependency-free function:

```text
summarizeDay(dateKey, logs, dailyWeights?) → DaySummary
```

It lives in `src/app/utils/day-summary.ts` and returns the canonical
shape (`dateKey`, `totalCalories`, `totalProtein`, `mealCount`,
`exercised`, `weightLb`). No signals. No Firestore reads. The protein
rounding rule (nearest gram) and the exercised flag (true if any of
`exerciseCompleted` / `liftCompleted` / `cardioCompleted` is set) live
here and nowhere else.

`FitnessStore.summaryFor(dateKey)` wraps `summarizeDay` and aliases
`mealCount → count` for legacy callers; both names refer to the same
field.

## Consequences

- Every surface that needs per-day totals reads from `summarizeDay`
  (directly or via `FitnessStore.summaryFor`). Component-local rollup
  code is a bug — replace it.
- The function is trivially testable (see `day-summary.spec.ts`). New
  aggregation rules — e.g. fiber, sugar, micros — get added here once
  and propagate everywhere.
- Callers needing "null on empty days" (e.g. the Day Summary card on
  Today, which hides itself when there's nothing to show) must check
  `mealCount === 0`. The function always returns a `DaySummary`,
  never `null`, because every existing caller relies on numeric zeros.
- The `count` alias on `FitnessStore.summaryFor` is legacy. New code
  should use `mealCount`. The alias will not be removed until no
  callers reference it.
- See also [`CONTEXT.md` → DaySummary](../../CONTEXT.md#aggregations).
