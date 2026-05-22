# ADR-0002: Firestore-direct no-backend architecture

- **Status:** accepted

## Context

Macro Log is a single-user productivity PWA — every document belongs to
one user, and there are no cross-user reads outside of opt-in public
profiles and aggregate admin counters. Standing up a dedicated app
server would mean operating an extra tier, paying for its idle capacity,
and recreating per-user authorization that Firebase already provides via
security rules and Auth claims.

Three pieces of the system are unavoidably non-trivial: the Gemini
weekly report (Pro-gated, needs server-only writes), the photo-macro
analyzer (third-party API call with rate limits), and the
GDPR-mandated export/delete flows. These cannot run client-direct.

## Decision

The architecture has **no dedicated app server**. Two tiers only:

1. **Client → Firestore direct.** Reads and writes of user-owned
   collections (`dailyLogs`, `dailyWeights`, `dailyWater`, `presets`,
   `measurements`, `reports`, the profile doc) go through `@angular/fire`
   with Firestore security rules as the enforcement layer. The
   `LEDGER_PORT` abstraction sits in front of this.
2. **Client → Cloud Functions for everything that needs trust.**
   Pro-gated callables (`generateWeeklyReport`), third-party API calls
   (`analyzePhoto`), GDPR endpoints (`exportUserData`, `deleteAccount`),
   scheduled jobs (reminders, weekly digest, backup), and Firestore
   triggers (subscription claim sync, welcome email). These run under
   the admin SDK with explicit Auth/entitlement checks.

The Gemini **client API key** ships in the browser bundle, protected by
HTTP referrer + API restrictions on the GCP key. It powers in-app chat
and photo analysis from the client. The Gemini **server key**, scoped
to the weekly-report CF, lives in Secret Manager and is never exposed.

## Consequences

- No Express, no NestJS, no Node app to deploy. Hosting is Firebase
  Hosting + Functions only.
- The line between "what runs where" is binary and load-bearing: if
  you find yourself adding client-side gating that *matters*, it
  belongs in a Cloud Function instead. Client gates are cosmetic; the
  Stripe `stripeRole=paid` custom claim is checked server-side in
  every callable that enforces Pro.
- Firestore security rules carry real weight. A rule misconfiguration
  is a privilege bug. Schema changes that touch security must update
  rules in the same commit.
- The Gemini client key is a non-secret. If it leaks, the referrer
  restriction limits abuse; rotate via the GCP console if needed. Do
  not treat it as a credential.
- New collections default to the no-backend pattern. Reach for a Cloud
  Function only when one of: entitlement check, third-party call,
  admin-SDK-only write, scheduled execution, or cross-user read.
