# ADR-0009: LedgerPort phase 5 — id returns, not explicit-UID or Result<T>

- **Status:** accepted
- **Date:** 2026-06-11 (closes issue #6)

## Context

Issue #6's original RFC sketched a phase-5 end-state for `LEDGER_PORT`:
explicit UID parameters, `Result<T, DomainError>` return types, and
domain-typed drafts free of Firestore `Timestamp`. By the time phase 5
came up, the third leg was already done (phase 2 closed every
`Timestamp` leak; the port imports zero Firestore types). The remaining
two legs were re-evaluated against the deep-module test rather than
applied mechanically.

## Decision

**Adopted — add-verbs return the server-assigned doc id.**
`addLog` / `addPreset` / `addMeasurement` now return `Promise<string>`
(matching the workout verbs that always did). This unblocks the real
phase-5 payoff the RFC tied to the shape change: stores reconcile their
caches locally after single-row mutations instead of refetching.
`FitnessStore.addLog`/`updateLog` and preset/measurement adds are now
**zero-read** — the per-mutation `getRecentLogs ×2` refetch survives
only for deletes (older rows must be able to re-enter the 14-row
window) and bulk paths (`repeatYesterday`, `copyDayToToday`,
`markExercised`).

**Rejected — explicit UID at the port.** The port is the *current
user's* ledger; the adapter resolving UID from its auth context is the
deep design. An explicit uid parameter on ~45 methods would force every
store and component to acquire auth knowledge just to thread a value
the adapter already owns — a wider interface, not a deeper one. The
uid-explicit layer exists where it pays: `FirestoreLedgerCore` takes a
uid thunk and is exercised per-uid in the emulator contract.

**Rejected — blanket `Result<T, DomainError>`.** Across the app,
callers branch on specific error identity at only a handful of sites
(preset/template caps via typed Error subclasses, the profile-read
timeout, callable error codes). Wrapping all ~45 methods would convert
every call site into `if (!r.ok) throw r.error` ceremony without
concentrating any knowledge. Typed error needs stay solved the
existing way: dedicated Error subclasses carrying data
(`PresetLimitError`-style), introduced per-need.

## Consequences

- Issue #6 is complete; future architecture reviews should not
  re-suggest explicit-UID or blanket-Result port rewrites without new
  evidence (e.g. a second authenticated user context, or N call sites
  hand-rolling error discrimination).
- Single-log mutations no longer self-heal cache drift via refetch; the
  local reconcilers mirror the adapter's write semantics exactly
  (`deleteField` clears, weight/timestamp persist when omitted) and the
  contract suites pin those semantics on both adapters.
- The optimistic `Measurement.date` uses client `now()` until the next
  hydrate; the server stamps its own — skew is cosmetic and bounded by
  one session.
