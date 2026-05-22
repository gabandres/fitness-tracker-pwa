# ADR-0006: Drop `-v2` suffix from component naming

- **Status:** accepted
- **Date:** 2026-05-22 (landed in commit `d906b87`)

## Context

After the v1 retirement ([ADR-0001](0001-v2-rebuild-replaces-v1.md)),
v2 was the only UI generation. But the file names, class names, and
selector strings still carried the rebuild marker:
`today-v2.component.ts`, `EntrySheetV2`, `app-settings-sheet-v2`.
Every new contributor — human or agent — had to ask whether v1 still
existed (it didn't) and whether the suffix was load-bearing (it
wasn't).

A few component class names also collided semantically with domain
terms when the suffix was dropped. `Card`, `Button`, `Sheet`, `Ring` —
these are shared design-system primitives, not feature surfaces, and
their stripped names would be ambiguous when grepping for the concept.

## Decision

Rename component files, class names, and selectors to drop `-v2`
/ `V2`:

- `today-v2.component.ts` → `today.component.ts`, class `TodayV2` →
  `Today`, selector `app-today-v2` → `app-today`.
- Same shape applied to Body, Trends, History, DayDetail, Settings,
  Entry, RefineTargets, and the rest of the v2 surfaces.

Shared primitives under `src/app/components/ui/` keep a **`Ui` prefix**
on their class names to disambiguate from feature/domain names:
`UiCard`, `UiButton`, `UiRing`, `UiFab`, `UiSheet`, `UiFastingPill`,
`UiBarChart`, `UiSparkline`, `UiDaySummary`, `UiTabBar`, `UiIconButton`,
`UiWeightSheet`, `UiDevGallery`. The `Ui` prefix on a class name is
a signal: "this is a primitive, not a feature surface."

The i18n key namespace (`v2.*`) and CSS class namespace (`v2-*`) are
**intentionally left in place**. Renaming them would touch hundreds of
files for zero functional gain. They are legacy markers; do not add new
keys/classes with that prefix, do not refactor old ones. See
[ADR-0001](0001-v2-rebuild-replaces-v1.md).

## Consequences

- Greping for `Today` finds the feature surface; greping for `UiCard`
  finds the primitive. No false hits from `-v2` debris.
- New components follow the same rule: feature components get the bare
  concept name, primitives go in `src/app/components/ui/` with a `Ui`
  prefix.
- The mismatch between component names (no `v2`) and i18n / CSS
  namespaces (still `v2`) is now load-bearing trivia that this ADR
  exists to explain. A new contributor seeing `t('v2.today.title')`
  inside `today.component.ts` is not looking at a bug.
- See also [`CONTEXT.md` → UI surfaces](../../CONTEXT.md#ui-surfaces-post-4-rename--see-adr-0006docsadr0006-drop-v2-suffix-component-namingmd).
