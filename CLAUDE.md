# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ignia — a free, private kcal+protein tracker (live at <https://ignia.fit>). An **npm-workspaces monorepo** with three buildable units plus shared code:

- **`src/`** — the root project is the Angular 21 **web shell**: marketing/compliance pages (`/`, `/vs`, `/calculator`, `/faq`, `/privacy`, `/terms`, `/status`, the prerendered SEO set, `/u/**`) plus **one signed-in surface, `/admin`**. **The web logging app was retired 2026-08-30 (ADR-0036).** It has its own `src/` and is the default `ng` project (`fitness-tracker-pwa`, the name is historical). Detail: `.claude/rules/web-shell.md` (loads with `src/**`).
- **`apps/mobile/`** — Expo SDK 57 React Native app, **live on the iOS App Store** and **Google Play production** (since 2026-09-03); which version is live is a `STATUS.md` question, never `app.json`'s. Has its own `CLAUDE.md` → `AGENTS.md`; read those when working there.
- **`packages/core/`** (`@macrolog/core`) — framework-free shared "brain": domain types + pure math (TDEE, targets, date, unit-system), imported by the Angular app, the Expo app and Cloud Functions. Keep it dependency-free and pure; cross-frontend domain/math logic lives here, never reimplemented per frontend.
- **`functions/`** — Firebase Cloud Functions (gen2, Node 22), its own package + tsconfig.

Workspaces are `packages/*` and `apps/*` (root `package.json`). `functions/` is NOT a workspace — it installs/builds independently.

## Commands

Run from repo root unless noted. This is a **PowerShell-primary Windows** environment.

```sh
npm start            # ng serve → http://localhost:4200 (dev config, auto-uses environment.development.ts)
npm run build        # prod build → dist/, then prerender-seo.mjs + sentry-release.mjs (build = more than ng build)
npm test             # app unit tests (vitest via @angular/build:unit-test)
npm run test:rules   # ALL functions specs incl. firestore.rules (delegates to functions/, boots emulator)
npm --prefix packages/core test          # pure-core vitest (no emulator)
npm --prefix packages/core run typecheck
npm --prefix functions run build         # tsc → functions/lib
cd apps/mobile && npx expo start         # Expo dev server + Expo Go
```

The emulator suite needs **JDK 21+** (on 17 it fails with `firebase-tools no longer supports Java version before 21`); `scripts/require-java21.mjs` puts one first on PATH, so `npm run test:rules` needs no PATH export (`docs/COMMANDS.md`).

Single test: `npx vitest run path/to/file.spec.ts` (or `-t "test name"`). Emulator-backed suites must run via the `firebase emulators:exec` wrappers above — they won't pass standalone.

## Deploy

```sh
npm run build && firebase deploy                 # hosting + functions
firebase deploy --only hosting                   # or: --only functions, --only firestore:rules
```

Firebase project `fitness-tracker-gb-1775407101`, hosting site `macrolog`. **Always run a PROD build before `firebase deploy`** — `npm run build` writes the prerendered pages, the release stamp and `build-info.json` (the guard's evidence); a dev build ships none of them. **There is no CI** (`README.md` §CI / CD): verification is a workstation step, `npm run doctor -- --no-cloud` plus the `verify-build` skill, and releases are pushed by hand. Mobile builds, OTAs and store submissions: the `build-ios` and `build-android` skills; builds run on the build Mac through `mac` (`Z:\machines\README.md`).

## Architecture — the rules that bite

- **Web shell**: no data layer; components read at most one Firestore doc each, `/admin` goes through the `admin*` callables, routing is a signal in `app.ts` (no `<router-outlet>`). `.claude/rules/web-shell.md`.
- **Log windows are typed and NOT interchangeable (ADR-0004).** Three distinct windows over `DailyLog`s: **RecentLogs** (a 14-ROW rolling cache) and two others; mixing them is a known footgun. Read `CONTEXT.md` "Time windows over logs" before touching history/aggregation code in `apps/mobile` or `packages/core`.
- **Single Firebase SDK copy (critical).** NEVER `import` plain `firebase/firestore` in app-bundle code — `@angular/fire` injects its own SDK instance, and a second copy breaks `doc()`/instance identity (this broke prod sign-in once). Use the injected Firestore. Smoke-test a **signed-in** `/admin` session after any SDK change.
- **Mobile data layer**: `apps/mobile/src/lib/ledger.ts` (thin `subscribe*` + CRUD), per-tab hooks that each subscribe on purpose (ADR-0016: do not propose a shared subscription cache), `hooks/useLedgerFeed.ts` for new reading hooks, `lib/ledger-ops.ts` for multi-step writes. Mobile is the product (ADR-0015, ADR-0036). `.claude/rules/mobile-app.md`.
- **Firestore rules are the access-control layer.** No app server: `firestore.rules` (~670 lines, per-collection field/shape/range validation) + Firebase Auth enforce all access; the public web Firebase keys in `src/environments/*` are public by design. **Deploy `firestore:rules` BEFORE clients write any new top-level field** — the dev app talks to PROD Firestore, so an un-deployed rule rejects new writes. Cover rule changes with `npm run test:rules`.

## Where to look (one file per question)

- **`STATUS.md` — what is true right now.** Live version, what is merged but in no binary, what is blocked and on what. **Read it before scoping anything.** If another file disagrees with it, the other file is stale — fix or delete it. **~200-line budget**: when something ships its entry is *deleted*, not updated, and the outcome goes to `CHANGELOG.md`.
- **`docs/COMMANDS.md`** — how to *check* a claim in `STATUS.md` rather than trust it: ASC/Play/EAS/Sentry queries, the OTA fingerprint gate, the `build-info.json` deploy check. Prefer running one of these over believing a number in prose.
- **`docs/build-infrastructure.md`** — EAS ceilings, iOS credentials/profiles, Android signing, resolved build traps that will be re-hit (silent pod drops, `.easignore`, `autoIncrement` gaps).
- **`CONTEXT.md`** — canonical domain glossary. One concept = one term, legacy synonyms called out (Log/Entry/Meal all map to `DailyLog`). Read it before naming things or grepping.
- **`docs/adr/`** — decisions 0001 onward (`ls docs/adr | tail -3` for the latest). Load-bearing: 0013 (food resolution), 0014 (mobile theming), 0015 (Ignia pivot), 0016 (per-hook subscriptions), 0022 (web freeze), **0036 (web logging app retired; `ignia.fit` is a shell plus `/admin`)**. 0024 owns the seam a plausible optimisation would break: the device's activity multiplier is a *seed-only* prior and must never reach the measured estimate.
- **`CHANGELOG.md`** — significant ships, newest first; before 2026-06-13 in `CHANGELOG-archive.md`.
- **`docs/research/`** — long-form research (watch transport, watchOS targets, activity/TDEE semantics, competitive scan). **Every file opens with a VERDICT block: read that and stop, unless you need the detail.** Cite these conclusions; do not re-derive them.
- **`UX_AUDIT.md`** — open UX backlog only; **§S13 is the launch-readiness checklist**.
- **`docs/app-store-metadata.md`** — App Store listing field values (`docs/go-to-market.md` owns positioning).
- **`docs/seo-status.md`** — what Google has indexed, the 2026-07-29 baseline; re-check with `node scripts/gsc.mjs inspect`.
- **`docs/DEV_ENVIRONMENT.md`** — emulator dev loop, the build-Mac runbook (§3) and the owner runbook for console/DNS steps code can't do.
- **`CLAUDE.local.md`** (git-ignored, may not exist) — machine-local notes: where the Apple `.p8` keys live, demo-account details, capture paths. Locations only, never secret values. Read it before asking the owner where a credential is.
- **`README.md`** — product positioning, full Cloud Functions list, secrets policy. (`STRIPE_SETUP.md` was deleted 2026-08-31 with the Stripe extension.)

**Housekeeping: a plan document is deleted the day its work ships.** Its outcome goes to `CHANGELOG.md`, its reasoning to an ADR, its current state to `STATUS.md`. Git keeps the original. (Why both rules exist: the `audit-docs` skill.)

## Guardrails that run automatically

`.claude/settings.json` wires three `PreToolUse` hooks (`.claude/hooks/`), each for a real failure that tsc, the tests and the tool's exit code cannot see. They match **invocations, not mentions**. After touching one, run `python .claude/hooks/test_guards.py`. Detail: `.claude/rules/guards.md`.

| Hook | Blocks | Because |
|---|---|---|
| `guard_firestore_import.py` | `from 'firebase/firestore'` in `src/**` (not specs, not `apps/mobile/**`, not `functions/**`) | a second SDK copy breaks `doc()`/instance identity; it broke prod sign-in once |
| `guard_firebase_deploy.py` | a hosting deploy whose `dist` has no `build-info.json` (written last by the prod build), no `sitemap.xml`, no safety worker, or predates `src/` | a dev/stale build ships no prerendered pages and no release stamp |
| `guard_eas_update.py` | a bare `eas update` (no single `--platform`), one without `--environment`, or one from a host not in its `OWNER` table — locally or sent to the build Mac (`mac run`/`mac bg`/`ssh buildmac`) | a publish whose hash matches no binary exits 0 and reaches **nobody** |

## Conventions

- **Latest versions, not LTS pins** — Angular 21, Firebase 12, Expo SDK 57 (from 54, RN 0.86.2, React 19.2: `b4e60194`, 2026-08-17). Don't silently downgrade to dodge peer conflicts. An SDK bump moves BOTH fingerprints, so it needs a new binary per platform before anything reaches a user (`STATUS.md` owns where that stands).
- **One lockfile author: the Windows PC** (checkout `Z:\fitness-tracker-pwa`) rewrites `package-lock.json` since 2026-11-13 (the Mac from 2026-10-21 to then, Windows before that); the build Mac only runs `npm ci` (through `mac sync`). Node is pinned in `.nvmrc`/root `engines` at 24.12.0. The PC's install command and why plain `npm ci` fails there: `apps/mobile/AGENTS.md` (*The install*). A web-shell build/deploy from the PC is not yet verified.
- **Shared with the other apps**: `scripts/aab-preflight.sh` and `ipa-preflight.sh` are shims for `@bermudez/mobile-kit` (`Z:\mobile-kit`, a root devDependency pinned to a git tag): change a check there, then move the pin.
- **Styling**: Tailwind v4 in the web shell; StyleSheet in the Expo app (NOT NativeWind, ADR-0012). Mobile theming rules (ADR-0014): `.claude/rules/mobile-app.md`.
- **i18n**: web uses Transloco (`src/app/i18n/{en,es-PR}.json`, **nested** keys, `{{var}}`); mobile uses **flat** keys (`apps/mobile/src/i18n/{en,es-PR,pt-BR}.ts`, `{var}`). **Mobile carries THREE locales, not two.** Keep every locale in parity per platform; when porting a string across platforms convert the key shape **and** the braces (`{n}` ↔ `{{n}}`).
- **No new AI features** without checking — the owner is AI-cost-averse; weekly-report autogenerate was killed for cost.
- **v1 is free**: Pro/deferred features are gated OFF via flags (mobile only), not deleted; no purchasable product ships; photo-scan is ON and free with server-side tiering. The flags and their traps: `.claude/rules/mobile-app.md`.
- **There is no web logging app (ADR-0036).** Features are mobile-only; a missing web version is not a gap. The website itself is required (store privacy/delete-account URLs, Oura redirect, Sign-In domain): do not propose deleting it (`.claude/rules/web-shell.md`).
- **Cost discipline** (owner is GCP-cost-averse; both free tiers are fully spent): new recurring work folds into the hourly dispatcher (`functions/src/hourly-tasks.ts`), never a new Cloud Scheduler job; destroy superseded Secret Manager versions (`npm run doctor` fails past 6); never set `minInstances`; every AI-cost callable uses BOTH `dailyQuota` and `spendCeiling`. **Read `docs/cost-discipline.md` before** removing, rotating or unbinding a secret, adding a scheduled job or an AI callable, or reading the bill.
