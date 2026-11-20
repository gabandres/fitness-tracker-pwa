# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ignia — a free, private kcal+protein tracker (live at <https://ignia.fit>). The repo is an **npm-workspaces monorepo** with three buildable units plus shared code:

- **`src/`** — the root project is the Angular 21 **web shell**: the marketing/compliance pages (`/`, `/vs`, `/calculator`, `/faq`, `/privacy`, `/terms`, `/status`, the prerendered SEO set, `/u/**`) plus **one signed-in surface, `/admin`**. **The web logging app was retired 2026-08-30 (ADR-0036)** — Today/Trends/Body/Train, the `LEDGER_PORT` data layer, the service worker and web push are deleted, and the old routes render a "moved to the apps" page. Despite being a workspace root, it has its own `src/` and is the default `ng` project (`fitness-tracker-pwa`, the name is historical).
- **`apps/mobile/`** — Expo SDK 57 React Native app, **live on the iOS App Store** (which version is live is a question for `STATUS.md`, not for `app.json`). Android: **live on Google Play production** (since 2026-09-03) — which version is live is again a `STATUS.md` question. Has its own `CLAUDE.md` → `AGENTS.md`; read those when working there. Its `main` is a custom `index.js` (not `expo-router/entry`) so the Android widget task handler registers before React mounts.
- **`packages/core/`** (`@macrolog/core`) — framework-free shared "brain": domain types + pure math (TDEE, targets, date, unit-system). Imported by BOTH the Angular app and the Expo app. Keep it dependency-free and pure.
- **`functions/`** — Firebase Cloud Functions (gen2, Node 22), its own package + tsconfig.

Workspaces are declared in root `package.json` as `packages/*` and `apps/*`. `functions/` is NOT a workspace — it installs/builds independently.

## Commands

Run from repo root unless noted. This is a **PowerShell-primary Windows** environment.

```sh
npm start            # ng serve → http://localhost:4200 (dev config, auto-uses environment.development.ts)
npm run build        # prod build → dist/, then prerender-seo.mjs + sentry-release.mjs (build = more than ng build)
npm test             # app unit tests (vitest via @angular/build:unit-test)
npm run test:rules   # ALL functions specs incl. firestore.rules (delegates to functions/, boots emulator)
```

Per-workspace:
```sh
npm --prefix packages/core test          # pure-core vitest (no emulator)
npm --prefix packages/core run typecheck
npm --prefix functions run build         # tsc → functions/lib
cd apps/mobile && npx expo start         # Expo dev server + Expo Go
```

**The emulator suite needs JDK 21+**; on a PATH `java` of 17 it fails
with `firebase-tools no longer supports Java version before 21` — a PATH
problem that reads like a broken suite. `scripts/require-java21.mjs` is a
**launcher**: it finds a JDK 21+, puts it first on PATH and runs the command,
so `npm run test:rules` needs no PATH export (`docs/COMMANDS.md`).

Single test: `npx vitest run path/to/file.spec.ts` (or `-t "test name"`). Emulator-backed suites must run via the `firebase emulators:exec` wrappers above — they won't pass standalone.

## Deploy

```sh
npm run build && firebase deploy                 # hosting + functions
firebase deploy --only hosting                   # hosting only
firebase deploy --only functions                 # functions only
firebase deploy --only firestore:rules           # rules only
```

Firebase project `fitness-tracker-gb-1775407101`, hosting site `macrolog`. **Always run a PROD build before `firebase deploy`** — `npm run build` is what writes the prerendered pages, the release stamp and `build-info.json` (the guard's evidence); a dev build ships none of them. **There is no CI** — `.github/workflows/ci.yml` was deleted 2026-08-23 after failing on every run for days (see `README.md` §CI / CD). Verification is a workstation step: `npm run doctor -- --no-cloud` plus the `verify-build` skill. Releases are pushed by hand from a workstation with the commands above.

## Architecture — the big picture

### The web shell (Angular, `src/`) — what is left after ADR-0036
There is no data layer on the web any more. The shell's components read at most one Firestore doc each (`public/stats`, `publicProfiles/{slug}`, `status/heartbeat` — `statusPulse` is the FUNCTION, `status/heartbeat` is the doc it writes) through the injected `Firestore`, and `/admin` goes through `AdminService` → `CallableGateway` → the `admin*` callables, gated on the `admin` custom claim (`src/app/app.ts` renders it only signed-in and only at desktop width; `AdminComponent` handles signed-in-but-not-admin). Routing is a signal read off `location.pathname` in `app.ts` — there is no `<router-outlet>`, which is what lets `scripts/prerender-seo.mjs` serve every content page from the same `index.html`. The retired logging routes (`/app`, `/history`, `/trends`, `/body`, `/train`, `/onboarding`) render `RetiredComponent`, not a 404. **`LEDGER_PORT`, `FitnessStore`, `FirestoreLedgerCore` and `in-memory-ledger.adapter` are gone** — if a doc still cites them it is stale. The one admin is the owner's Gmail, the sole entry of `SEED_ADMINS` in `functions/src/admin-claims.ts`, and **there is no grant path**: `setAdminClaims` was deleted 2026-08-30, so a second admin needs a code change + deploy + re-bootstrap. The `/admin` gate says "Admin" and offers one Google button — nothing else, on purpose. **The console itself** (`src/app/components/admin/`, revamped 2026-08-30) is a sidebar shell + ⌘K palette over eight sections; its numbers come from `AdminDataService` (one cache for every callable) and its Overview prints plain-English insights from `admin-insights.ts` — pure, unit-tested, thresholds stated in the code. DAU/WAU/MAU come from the `adminGetUsageSeries` callable because `usageEvents` is owner-read only. To see it without your Google session: `npm start` then `/admin?preview=1` (dev builds only, fixture data, no callables).

### Log windows are typed and NOT interchangeable (ADR-0004)
There are three distinct windows over `DailyLog`s: **RecentLogs** (a 14-ROW rolling cache), and two others. They look similar and mixing them is a known footgun. Read `CONTEXT.md` "Time windows over logs" before touching history/aggregation code in `apps/mobile` or `packages/core`.

### Single Firebase SDK copy rule (critical)
NEVER `import` plain `firebase/firestore` in app-bundle code — `@angular/fire` injects its own SDK instance, and a second copy breaks `doc()`/instance identity (this broke prod sign-in once). Use the injected Firestore. Smoke-test a **signed-in** `/admin` session after any SDK change.

### Mobile app data layer (apps/mobile)
The Expo app talks to Firestore through the Firebase JS SDK directly in `apps/mobile/src/lib/ledger.ts` — a flat file of thin `subscribe*` (onSnapshot) + async CRUD functions. **Its doc shapes are now the only client implementation**; `firestore.rules` and `CONTEXT.md` document them. State is **per-tab hooks** (`useToday`, `useHistory`, `useBody`, `useTrain`); each hook independently `onSnapshot`-subscribes, so the same collection (e.g. `presets`, `customFoods`) is **deliberately subscribed in multiple hooks** rather than shared through one context — match this precedent, don't extract a lone shared hook (**ADR-0016**; listeners are wrapped in `trackSubs` and never outlive their screen. **Since 2026-10-22 a blur closes nothing**: a `'focus'`-gated feed opens on the screen's first focus and holds its listeners until unmount, because re-opening a tab's set on every visit was the measured tab-switch lag, 120–350 ms of frozen JS per press — ADR-0016 amendment 2). Do not re-propose a shared subscription cache; the concurrent multiplier it targets doesn't exist and the model is intentional. **Since 2026-09-14 the gating/provenance/readiness glue is stated once in `hooks/useLedgerFeed.ts`** — a hook passes its own channels and still opens its own `subscribe*` inside each one, so the listener model is unchanged (ADR-0016 amendment); new reading hooks go through it rather than re-rolling the `useFocusEffect` + `trackSubs` block. Its write-side counterpart is `lib/ledger-ops.ts`, where a **ledger operation** (`finishWorkout`, `repeatYesterday`, `writeDailyMetric`) is the multi-step sequence a screen used to assemble — it sits ABOVE `ledger.ts` because `health-sync.ts` and `pending-logs.ts` already import it. Cross-frontend domain/math logic belongs in `packages/core` (pure, reused by the app and by Cloud Functions); never reimplement it per frontend. Mobile is the product (ADR-0015, ADR-0036).

### Firestore rules are the access-control layer
There is no app server. `firestore.rules` (~670 lines, dense — per-collection field/shape/range validation) + Firebase Auth enforce all access; the public web Firebase keys in `src/environments/*` are public by design. **Deploy `firestore:rules` BEFORE clients write any new top-level field** — the dev app talks to PROD Firestore, so an un-deployed rule rejects new writes. Cover rule changes with `npm run test:rules`.

## Where to look (one file per question)
- **`STATUS.md` — what is true right now.** Live version, what is merged but in no binary, what is blocked and on what. **Read it before scoping anything.** If another file disagrees with it, the other file is stale — fix or delete it. **It has a ~200-line budget**: when something ships its entry is *deleted*, not updated, and the outcome goes to `CHANGELOG.md`. It reached 941 lines once and carried four self-contradictions; a status file nobody can hold in their head stops being read.
- **`docs/COMMANDS.md`** — how to *check* a claim in `STATUS.md` rather than trust it: ASC/Play/EAS/Sentry queries, the OTA fingerprint gate, the `build-info.json` deploy check. Prefer running one of these over believing a number in prose.
- **`docs/build-infrastructure.md`** — EAS ceilings, iOS credentials/profiles, Android signing, and the resolved build traps that will be re-hit (silent pod drops, `.easignore`, `autoIncrement` gaps).
- **`CONTEXT.md`** — canonical domain glossary. One concept = one term, with legacy synonyms called out (e.g. Log/Entry/Meal all map to `DailyLog`). Read it before naming things or grepping.
- **`docs/adr/`** — architecture decisions 0001 onward (`ls docs/adr | tail -3` for the latest): the "why" behind the seams above. 0013 (food resolution), 0014 (mobile theming), 0015 (Ignia pivot), 0016 (per-hook subscriptions), 0022 (the web freeze) and **0036 (the web logging app is retired; `ignia.fit` is a shell plus `/admin`)** are load-bearing and cited throughout this file. 0024 owns the one seam a plausible optimisation would break: the device's activity multiplier is a *seed-only* prior and must never reach the measured estimate.
- **`CHANGELOG.md`** — significant ships, newest first. Entries before 2026-06-13 live in `CHANGELOG-archive.md`.
- **`docs/research/`** — long-form research (watch transport, watchOS targets, activity/TDEE semantics, competitive scan). **Every file opens with a VERDICT block: read that and stop, unless you need the detail.** Cite these conclusions; do not re-derive them.
- **`UX_AUDIT.md`** — open UX backlog only; **§S13 is the launch-readiness checklist**.
- **`docs/app-store-metadata.md`** — source of truth for App Store listing field values (`docs/go-to-market.md` owns positioning).
- **`docs/seo-status.md`** — what Google has actually indexed, and the 2026-07-29 baseline. Re-check with `node scripts/gsc.mjs inspect`.
- **`docs/DEV_ENVIRONMENT.md`** — emulator dev loop + the owner runbook for console/DNS steps code can't do.
- **`CLAUDE.local.md`** (git-ignored, may not exist) — machine-local notes: where the Apple `.p8` keys live, demo-account details, capture paths. Locations only, never secret values. Read it before asking the owner where a credential is.
- **`README.md`** — product positioning, full Cloud Functions list, secrets policy. (`STRIPE_SETUP.md` was deleted 2026-08-31 with the Stripe extension — any future subscriptions go through Apple/Google IAP.)

**Housekeeping rule: a plan document is deleted the day its work ships.** Its outcome goes to `CHANGELOG.md`, its reasoning to an ADR, its current state to `STATUS.md`. Git keeps the original. A shipped plan left in the tree with a "CORRECTION" block on top is how a wish list becomes indistinguishable from a status report — that failure has already cost this project three re-scopes of work that was already built.

## Guardrails that run automatically

`.claude/settings.json` wires three `PreToolUse` hooks (`.claude/hooks/`). Each
one corresponds to a failure that has really happened here and that is
**invisible to tsc, the unit tests, and the tool's own exit code** — which is why
prose alone did not prevent them:

| Hook | Blocks | Because |
|---|---|---|
| `guard_firestore_import.py` | `from 'firebase/firestore'` in `src/**` (not specs, not `apps/mobile/**`, not `functions/**`) | a second SDK copy breaks `doc()`/instance identity; it broke prod sign-in once |
| `guard_firebase_deploy.py` | a hosting deploy whose `dist` has no `build-info.json` (written last by the prod build), no `sitemap.xml`, no safety worker, or predates `src/` | a dev/stale build ships no prerendered pages and no release stamp; until ADR-0036 it also left the PWA update banner firing for every returning user |
| `guard_eas_update.py` | a bare `eas update` (no single `--platform`), one without `--environment`, or one from a host not in its `OWNER` table. **OTAs for both platforms go out from `winbox`, checkout `Z:\fitness-tracker-pwa`** (the table still allows `mac` for a future Mac: both hosts compute the same fingerprints, `patches/@expo+fingerprint+0.20.14.patch`, and export the same bundles, `apps/mobile/metro.config.js`). `ignia-mac` was sold 2026-11-13; from 2026-08-17 to 2026-11-12 the hosts were split per platform | the fingerprint was machine-dependent; a publish whose hash matches no binary exits 0 and reaches **nobody** |

They match **invocations, not mentions** — echoing, grepping or heredoc'ing one
of these commands is allowed, and `npm run build && firebase deploy` (the
documented one-liner) passes because the chain rebuilds first. `python3
.claude/hooks/test_guards.py` (`python` on Windows) is the 45-case matrix; run
it after touching a guard or `.claude/settings.json`. Its last block runs the
exact `settings.json` command strings through a shell, because a hook whose
interpreter is missing exits 127, which Claude Code reads as "allow": the
commands try `python3` and fall back to `python` (the Windows Store `python3`
stub fails the probe). A guard that fires on the happy path is a
guard that gets deleted.

## Conventions
- **Latest versions, not LTS pins** — this repo intentionally tracks bleeding-edge (Angular 21, Firebase 12). Don't silently downgrade to dodge peer conflicts. **Expo caught up on 2026-08-17**: `apps/mobile` moved SDK 54 → **57** (RN 0.86.2, React 19.2) in `b4e60194`, and it is merged to `main`. An SDK bump moves BOTH fingerprints, so it needs a new binary per platform before anything reaches a user; `STATUS.md` owns where that stands. Node is pinned in `.nvmrc`/root `engines` at 24.12.0, and **the Windows PC (`winbox`, checkout `Z:\fitness-tracker-pwa`) is the one machine that rewrites `package-lock.json`** since 2026-11-13, when `ignia-mac` was sold (it was the Mac from 2026-10-21 to then, and Windows before that). Install there with `npm ci --ignore-scripts && npx patch-package && npm rebuild @firebase/util`: a plain `npm ci` fails there (`msgpackr-extract` has no win32-arm64 build), and `patch-package` and `@firebase/util`'s postinstall are the two install steps the mobile bundle depends on (`apps/mobile/AGENTS.md`). A web-shell build/deploy from the PC is not yet verified. The rule stands regardless of machine: one lockfile author.
- **Styling**: Tailwind v4 (`@tailwindcss/postcss`) in the web shell; the Expo app uses StyleSheet (NOT NativeWind — a tailwind v3/v4 monorepo conflict, see ADR-0012).
- **Mobile theming (ADR-0014)**: the Expo app is dual-theme, dark leads. Components read the palette via `useTheme()`/`useThemedStyles()` from `src/lib/theme-context` — never a static `colors` import from `theme.ts` (those exports are gone; `ShareCard` pins `palettes.light` on purpose). Text on `colors.ink` surfaces uses `colors.onInk`; text and icons on an `accent` / `danger` / `tealSolid` fill use `colors.onFill` (dark in dark mode — white there fails AA; `theme-contrast.test.ts`); field/chip fills use `colors.inputBg`. Custom font families (`type.display/heading`) must not be paired with `fontWeight`.
- **i18n**: web uses Transloco (`src/app/i18n/{en,es-PR}.json`, **nested** keys, `{{var}}` interpolation); mobile uses **flat** keys (`apps/mobile/src/i18n/{en,es-PR,pt-BR}.ts`, `{var}` interpolation). **Mobile carries THREE locales, not two.** Keep every locale in parity per platform; when porting a string across platforms, convert the key shape **and** the interpolation braces (`{n}` ↔ `{{n}}`).
- **No new AI features** without checking — the owner is AI-cost-averse; weekly-report autogenerate was killed for cost.
- **v1 is free — Pro/deferred features are gated OFF via flags, not deleted** (kept for a later re-enable). No purchasable product ships. **Since ADR-0036 the flags live on mobile only**: `PRO_ENABLED` in `apps/mobile/src/lib/subscription.ts` (when false, `isPro()` is forced `true` so non-cost perks — themes, higher limits, streak-freeze — unlock for everyone) and `FEATURES` in `apps/mobile/src/lib/features.ts`. The web copies (`src/app/services/subscription.service.ts`, `src/app/utils/features.ts`) were deleted with the web logging app. **Two distinct flags**: `isPro`-gated code = non-cost perks (unlocked in v1); `PRO_ENABLED`/`FEATURES`-gated code = purchase surfaces + AI-cost features (weekly report) — these stay **hidden**. **Photo-scan is the exception and is ON and free** (ADR-0017, amending 0015's paid gate): `FEATURES.photoScan = true` is hardcoded in `apps/mobile/src/lib/features.ts` — no env read. Its tiering is **server-side only** (`dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling`) because a client cannot express "paid" while `PRO_ENABLED` is false — a client-side paid check there unlocks it for everyone, the opposite of the intent. The client flag is a kill switch, not a cost control. **The Stripe extension was REMOVED 2026-08-31** (owner's call: if subscriptions ever ship they go through Apple/Google IAP, not Stripe) — its two secrets went with it, putting Secret Manager exactly at the free tier. The `stripeRole` custom claim SURVIVES as the paid-tier marker (set manually via the admin console; read by `caller-access.ts` for quota tiering) — the name is historical. Referral CFs remain dormant.
- **There is no web logging app (ADR-0036, 2026-08-30; it was frozen from ADR-0022 until then).** Mobile is the product (ADR-0015). Features are mobile-only; "the web version of this is missing" is by design and is not a gap to file — there is nothing to port to. The measurement ADR-0022 asked for came back at **web 3 of 104 active day-documents (2.9%)** and the owner retired it. What `ignia.fit` still is: the marketing/compliance **shell** (landing, `/vs`, `/calculator`, `/faq`, `/privacy`, `/terms`, `/support`, `/status`, the prerendered SEO pages, `/u/**` public profiles, `app-version.json`, the `firebase.json` rewrites) and **`/admin`**, the owner's single-admin panel. The shell is **not** optional: Apple requires the live privacy URL and Play requires the delete-account URL, both on `ignia.fit`, the Oura redirect and the Google Sign-In authorized domain live there, and the mobile app links to it. Do not propose deleting the website. Two items ADR-0036 records as OPEN (owner's call, reversible default taken): the SEO/marketing pages and the public profile pages are **kept**. Cross-frontend domain/math still lives in `packages/core`.
- **Cost discipline** (owner is GCP-cost-averse). Ignia sits alone on billing account `01916B-2927E2-E01DC7`, so both free tiers are its own, and both are fully spent: **Cloud Scheduler's 3 jobs** (`hourlyTasks`, `statusPulse`, `weeklyFirestoreBackup`) — new recurring work folds into the hourly dispatcher (`functions/src/hourly-tasks.ts`, each task in an independent `Promise.allSettled`); **Secret Manager's 6 active versions** — destroy the superseded version after a rotation; `npm run doctor` fails past 6. Never set `minInstances`; prefer coarse schedules. **Every AI-cost callable sits behind TWO guards, and a new one uses both**: `dailyQuota` (one user per day) and `spendCeiling` (everyone together), `check()` before the per-user reserve and `record()` after. **Read `docs/cost-discipline.md` before** removing, rotating or unbinding a secret, adding a scheduled job or an AI callable, or reading the bill.
- Component naming dropped the `-v2` suffix (ADR-0006); the v1 app was fully retired.
