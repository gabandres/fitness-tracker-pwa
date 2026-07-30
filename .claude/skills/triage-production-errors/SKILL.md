---
name: triage-production-errors
description: Triage, diagnose, and fix Ignia production errors across its three separate error surfaces — Sentry (web PWA), Cloud Functions logs, and App Store Connect crash reports (iOS). Use for "any errors in prod?", "what's crashing?", "the app is broken for a user", "check the functions logs", or when the owner pastes a stack trace or a user's bug report.
---

# Production error triage

Ignia has **no single error console**. Three surfaces, each covering a different
slice of the product, and none of them talks to the others:

| Surface | Covers | Where | Auth |
|---|---|---|---|
| **Sentry** | Angular PWA only — uncaught exceptions + breadcrumbs | `@sentry/angular`, DSN in `src/environments/environment.ts` | `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` |
| **Cloud Functions logs** | all ~30 gen2 functions in `functions/src/` | Firebase MCP `functions_get_logs`, or `firebase functions:log` | already logged in |
| **App Store Connect** | iOS native crashes (Expo app) | ASC API via `scripts/asc-client.mjs` | ASC API key — see `CLAUDE.local.md` |

**The Expo app has no Sentry and no Crashlytics.** A JS-level crash on mobile
produces *nothing* on any dashboard — it only shows up as a user complaint or an
ASC crash report if it took the native process down. Do not assume "Sentry is
quiet" means "mobile is fine"; say so explicitly when reporting.

## Step 1 — scope the question

- Pasted stack trace or Sentry issue link → skip to Step 3 (diagnose) on that one issue.
- "Any errors in prod?" → sweep all three surfaces (Step 2), newest first.
- A specific user is broken → start with Cloud Functions logs filtered to their uid,
  then Sentry, then ask which platform they were on.
- "Is the site up?" → this is not an error question. Check `https://ignia.fit/status`
  (heartbeat is healthy <20 min, degraded <45 min, written every 15 min by
  `statusPulse` in `functions/src/ops.ts`) and run `npm run doctor`.

## Step 2 — sweep

### Sentry (web)

Credentials come from the environment (the same `SENTRY_*` names `ci.yml` passes
as secrets); locally they live in the git-ignored env file described in
`CLAUDE.local.md`. Check they are present before trying — if they are not, say so
and fall back to asking the owner to read the issue list in the Sentry UI. Never
guess a token, and never echo one.

```sh
npx --yes @sentry/cli issues list --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" --max-rows 25
```

Releases are tagged `BUILD_TAG || GITHUB_SHA || local-<ts>` by
`scripts/sentry-release.mjs`, and source maps are uploaded at build time — a prod
stack trace should be de-minified. If it is minified, the build that produced it
ran **without** `SENTRY_AUTH_TOKEN` (the script no-ops and logs a line), so the
frames are only as good as the bundle.

Two things to read on every issue, not just the exception:
- **Breadcrumbs** — `AnalyticsService` writes every product event as a breadcrumb
  on purpose (`src/app/services/analytics.service.ts`); that trail *is* the repro
  steps.
- **Release + first-seen** — a first-seen right after a deploy makes it this
  deploy's fault; an old signature does not.

### Cloud Functions

Prefer the Firebase MCP tool over the CLI (structured output, no context dump):
`functions_get_logs` for project `fitness-tracker-gb-1775407101`.

Known noise to filter out before reporting anything as a problem:
- `hourlyTasks` runs every task in an independent `Promise.allSettled`
  (`functions/src/hourly-tasks.ts`) — one rejected task logs but does not fail the
  run, and is not an outage.
- Callable functions throw typed errors from `functions/src/error-codes.ts`;
  a `HttpsError` with a known code is the *designed* rejection path
  (quota, auth, validation), not a crash. Only untyped throws are crashes.
- `log-webhook` fails open on rate-limiter errors by design.

### iOS crashes

Only worth checking after a mobile release, or when a user reports the app closing
itself. Read the live version from `STATUS.md` first (not `app.json`) so you know
which build to look at, then query ASC with `scripts/asc-client.mjs` (it loads the
local env file on import — no shell setup).

## Step 3 — diagnose

1. **Reproduce locally before theorizing.** Use the emulator loop
   (`npm run dev`, seeded user `e2e@test.com` / `UserTest123`) so a repro attempt
   cannot corrupt real user data. See the `test-web-ui` skill.
2. **Map the frame to the layer.** Web data bugs are almost always in the ledger
   seam (`src/app/ledger/`, `FirestoreLedgerCore`) or `FitnessStore` facets —
   components do not touch Firestore. Mobile data bugs are in
   `apps/mobile/src/lib/ledger.ts`.
3. **Check the four repeat offenders first** — in this repo these cause more prod
   errors than anything else:
   - A **second Firebase SDK copy** (`import ... from 'firebase/firestore'` in
     app-bundle code). Broke prod sign-in once. Grep for it before anything else
     when the error is `doc()`/instance-identity shaped.
   - An **un-deployed `firestore.rules`** — the dev app talks to PROD Firestore, so
     a client writing a new top-level field gets `permission-denied` until
     `firebase deploy --only firestore:rules` runs. Rules ship *before* clients.
   - **Log-window mixing** (ADR-0004 / `CONTEXT.md` "Time windows over logs") —
     wrong-but-plausible history and aggregation numbers.
   - **A dev build deployed to hosting** — skips `ngsw.json` and leaves the update
     banner firing for everyone. Symptom is "users stuck on old version".
4. **Does it reproduce on both frontends?** If yes, the bug is in `packages/core`
   or in the shared doc shape, and the fix belongs there — not twice.

## Step 4 — report, then fix

Report before touching code. One block per distinct signature:

> **Signature** — exception + top app frame
> **Surface / first seen / count / affected users**
> **Root cause** — the actual line, as `path:line`
> **Blast radius** — web only / mobile only / both; data corruption or cosmetic
> **Fix** — one or two sentences
> **Ships how** — hosting deploy / functions deploy / rules deploy / EAS build (mobile fixes do NOT reach users until a new binary ships — say this out loud)

Then apply the fix only after the owner picks. Cover it with a test where one
exists for that layer (`npm test`, `npm run test:ledger`, `npm run test:rules`,
`npm --prefix packages/core test`), and update `STATUS.md` if the bug or the fix
changes what is true right now.

## Guardrails

- **Never write to production Firestore to "test" a fix.** Repro in the emulator.
- A Sentry issue with zero users affected and one event is noise; do not open work
  on it unprompted.
- Do not add a new error-reporting service or a new scheduled function to "watch"
  for errors — Cloud Scheduler's 3 free jobs are all spent (fold into
  `hourly-tasks.ts` if recurring work is genuinely needed), and the owner is
  cost-averse.
