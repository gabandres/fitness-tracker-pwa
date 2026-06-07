# Architecture Decision Records

An ADR captures an architecturally significant decision: the context
that forced the call, what was decided, and what we now accept as a
consequence. The point is not to be exhaustive — it is to leave a
breadcrumb so a future reader (human or agent) knows *why* the code
looks the way it does.

## When to write one

Write an ADR when:

- A choice shapes more than one file and would be hard to reverse.
- A constraint (cost, tier-gating, single-user model, no-backend) drove
  a design that would otherwise look wrong.
- A name or convention is now load-bearing across the codebase.

Do **not** write an ADR for routine refactors, cosmetic changes, or
decisions that are local to a single component.

## Naming + structure

- Filename: `NNNN-kebab-case.md`, monotonically increasing. Never
  renumber.
- Required sections: **Status**, **Context**, **Decision**,
  **Consequences**.
- Allowed Status values: `proposed`, `accepted`, `superseded by ADR-NNNN`,
  `deprecated`.
- Cross-link freely — to other ADRs and to terms in
  [`CONTEXT.md`](../../CONTEXT.md).

## Index

| #    | Title                                                                                  | Status   |
| ---- | -------------------------------------------------------------------------------------- | -------- |
| 0001 | [v2 rebuild replaces v1](0001-v2-rebuild-replaces-v1.md)                               | accepted |
| 0002 | [Firestore-direct no-backend architecture](0002-firestore-no-backend-architecture.md)  | accepted |
| 0003 | [Day summary as a pure module](0003-day-summary-as-pure-module.md)                     | accepted |
| 0004 | [Typed last-N-days log-window queries](0004-log-window-typed-queries.md)               | accepted |
| 0005 | [Store facets split off FitnessStore](0005-store-facets-split.md)                      | accepted |
| 0006 | [Drop `-v2` suffix from component naming](0006-drop-v2-suffix-component-naming.md)     | accepted |
| 0007 | [Workout logging — the Train tab](0007-workout-train-tab.md)                            | accepted |
