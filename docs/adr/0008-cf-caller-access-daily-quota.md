# ADR-0008: CallerAccess + DailyQuota modules in Cloud Functions

- **Status:** accepted
- **Date:** 2026-06-11

## Context

Every quota-bearing callable in `functions/src/index.ts` re-implemented
the same preamble: auth check, per-uid rate limit, stripeRole read, and
"unlimited access" resolution — followed by a hand-rolled daily-quota
transaction (UTC day key, `${uid}_${day}` doc id, limit compare,
never-below-zero refund). The pattern existed at six sites across
`index.ts` and `admin-ops.ts`, with zero logic tests.

Worse, the two privilege checks had drifted: `hasUnlimitedAccess` only
knew about the admin list and `config/accessList`, while
`checkAccessStatus` additionally honoured the referral `compedUntil`
profile field. A referral-comped user saw the "unlimited" badge in the
UI but was still charged free-tier quotas by `analyzePhoto` and
`reserveConsultation`.

## Decision

Two modules:

- **CallerAccess** (`caller-access.ts`) — `resolveCaller(request,
  rateLimit?)` → `{ uid, email, tier, unlimited }`. Tier order:
  `admin` → `comped` → `paid` → `free`. **Comped is unified**: the
  accessList AND a future referral `compedUntil` both resolve to the
  same `comped` tier, everywhere — fixing the drift above. Both
  sources are cached 60s per function instance (the referral check is
  per-uid).
- **DailyQuota** (`daily-quota.ts`) — the quota ledger for the `photo`
  and `consultation` kinds: per-tier limits, `reserve` / `release` /
  `peek` / `resetToday` / `deleteAll` / `dump`. Callables never touch
  the quota collections directly.

Both take `Firestore` by constructor injection and are tested against
the emulator (`functions/test/`, run via `npm test` =
`firebase emulators:exec`).

## Consequences

- Referral-comped users now bypass photo/consultation quotas (matching
  what the UI always claimed). This is a deliberate behaviour change.
- A referral grant takes up to 60s to be honoured (cache TTL) instead
  of immediately — same tradeoff the accessList already made.
- Quota or tier changes happen in one module each; the callables in
  `index.ts` only orchestrate.
- New quota-capped features add a `QuotaKind` entry instead of copying
  the transaction.
- The `unauthenticated` error message is now the generic "Must be
  signed in." for export/delete too; clients key off the typed
  `ErrorCode`, not the message.
