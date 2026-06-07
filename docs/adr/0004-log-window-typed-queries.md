# ADR-0004: Typed last-N-days log-window queries

- **Status:** accepted
- **Date:** 2026-05-22 (landed in commit `d049b49`)

## Context

The `FitnessStore._logs` signal was being misused as a "last 14 days"
window in several places — weekly-report assembly, streak math beyond
the cached range, n-day adherence calculations. It is not a calendar
window. It is the result of
`LEDGER_PORT.getRecentLogs(14)`, which is a **14-ROW cap** on the
underlying Firestore query, oldest-first. A heavy logger (seven
meals/day) sees ~2 days of history in that signal; a sparse logger
sees weeks.

Some callers were also doing `Date.now() - n * 24 * 60 * 60 * 1000` to
build their own window, which silently drifts at DST transitions and
isn't aligned to local midnight.

## Decision

`FitnessStore` exposes two typed window queries, both keyed on
`localDateKey` (`YYYY-MM-DD` in local TZ — see
[`CONTEXT.md` → localDateKey](../../CONTEXT.md#conventions)):

- **`async logsForLastDays(n)`** — the canonical "last N calendar days
  ending today" query. Awaits `_loadAllTimeLogs()` once if
  `_allTimeLogs` hasn't hydrated, then filters by date-key membership.
- **`logsForLastDaysSync(n)`** — same semantics, computed-safe (no
  await). Returns `[]` until history hydrates. Callers MUST gate on
  `isHistoryHydrated()` to distinguish "no logs in window" from
  "history not loaded yet".

A private `windowCalendarKeys(n)` helper produces the date-key set so
the membership test stays DST-correct.

`_logs` retains its semantics: a small, fast rolling cache of the most
recent rows for Today-card use cases. Its docstring now spells out the
14-ROW-not-14-DAYS distinction.

## Consequences

- Any "last N days" question — weekly report, adherence stat,
  monthly trend — goes through `logsForLastDays(n)` /
  `logsForLastDaysSync(n)`. Hand-rolled millisecond math is a bug.
- Computeds that depend on `logsForLastDaysSync` must check
  `isHistoryHydrated()` first, or they will render "0 days" before
  the all-time cache loads.
- The all-time cache is hydrated lazily. The first caller of
  `logsForLastDays` triggers `_loadAllTimeLogs()`; subsequent callers
  pay nothing. This is acceptable because users who need historical
  windows (Trends, weekly report, monthly) hit them deliberately, not
  on first paint.
- See also [`CONTEXT.md` → Time windows over
  logs](../../CONTEXT.md#time-windows-over-logs) and
  [ADR-0005](0005-store-facets-split.md) (the hub still owns these
  derivations).

## Amendment (2026-06-06): typed `HistoryWindow` replaces the manual gate

The original sync accessor returned a bare `DailyLog[]` and told callers
to *remember* to check `isHistoryHydrated()` first. Two derivations
(`goalProgress`, `monthlySummary`) read the all-time cache without that
check and rendered wrong values on first paint, then jumped once the
cache hydrated — the exact failure the convention was meant to prevent. A
convention enforced by memory is not enforced.

So the gate now rides in the return type. `logsForLastDaysSync(n)` is
replaced by **`logsForLastDaysState(n)`**, and a sibling
**`allHistoryState()`** covers full-history reads; both return a
[`HistoryWindow`](../../CONTEXT.md#time-windows-over-logs) —
`{ loaded: false } | { loaded: true; logs }`. A caller cannot reach
`logs` without handling `loaded: false`, so forgetting the gate is a
compile error, not a silent misrender.

`isHistoryHydrated()` also changed meaning: it now reflects a real
`_historyLoaded` flag set after `_loadAllTimeLogs()` *settles* (even on an
empty or failed load), not `_allTimeLogs().length > 0`. The old
definition left a genuinely log-less account "unhydrated" forever,
permanently hiding the gated derivations. The boolean stays for callers
that only need the flag; new computeds should prefer the typed accessors.
