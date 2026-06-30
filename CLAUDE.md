# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Macro Log — a free, private kcal+protein tracker (live at <https://macrolog.web.app>). The repo is an **npm-workspaces monorepo** with three buildable units plus shared code:

- **`src/`** — the root project IS the Angular 21 PWA (the flagship product). Despite being a workspace root, it has its own `src/` and is the default `ng` project (`fitness-tracker-pwa`).
- **`apps/mobile/`** — Expo SDK 54 React Native app (v1 built, not yet shipped to device). Has its own `CLAUDE.md` → `AGENTS.md`; read those when working there.
- **`packages/core/`** (`@macrolog/core`) — framework-free shared "brain": domain types + pure math (TDEE, targets, date, unit-system). Imported by BOTH the Angular app and the Expo app. Keep it dependency-free and pure.
- **`functions/`** — Firebase Cloud Functions (gen2, Node 22), its own package + tsconfig.

Workspaces are declared in root `package.json` as `packages/*` and `apps/*`. `functions/` is NOT a workspace — it installs/builds independently.

## Commands

Run from repo root unless noted. This is a **PowerShell-primary Windows** environment.

```sh
npm start            # ng serve → http://localhost:4200 (dev config, auto-uses environment.development.ts)
npm run build        # prod build → dist/, then prerender-seo.mjs + sentry-release.mjs (build = more than ng build)
npm test             # app unit tests (vitest via @angular/build:unit-test)
npm run test:ledger  # FirestoreLedgerCore emulator tests (boots Firestore emulator, needs Java)
npm run test:rules   # firestore.rules unit tests (delegates to functions/, boots emulator)
```

Per-workspace:
```sh
npm --prefix packages/core test          # pure-core vitest (no emulator)
npm --prefix packages/core run typecheck
npm --prefix functions run build         # tsc → functions/lib
cd apps/mobile && npx expo start         # Expo dev server + Expo Go
```

Single test: `npx vitest run path/to/file.spec.ts` (or `-t "test name"`). Emulator-backed suites must run via the `firebase emulators:exec` wrappers above — they won't pass standalone.

## Deploy

```sh
npm run build && firebase deploy                 # hosting + functions
firebase deploy --only hosting                   # hosting only
firebase deploy --only functions                 # functions only
firebase deploy --only firestore:rules           # rules only
```

Firebase project `fitness-tracker-gb-1775407101`, hosting site `macrolog`. **Always run a PROD build before `firebase deploy`** — dev builds skip `ngsw.json`, which leaves the update banner firing for users. CI build/test runs on every PR (`.github/workflows/ci.yml`); deploy is manual (`deploy.yml`, `workflow_dispatch`).

## Architecture — the big picture

### Reactive data layer (Angular app)
`services/fitness-store.service.ts` (`FitnessStore`) is the single reactive data layer. Components inject it and read **signals** — they do not touch Firestore directly. The store is split into facets (ADR-0005): `fasting-store`, `body-metric-store`, `workout-store`, `weekly-report-store` each own their slice.

### Ledger port/adapter seam (hexagonal — ADR-0009, issue #6)
The app depends on an **injection token `LEDGER_PORT`** (`src/app/ledger/ports/ledger.port.ts`), NOT on Firestore directly. Wiring lives in `app.config.ts`: `{ provide: LEDGER_PORT, useExisting: FirebaseService }`. Implementations:
- `FirebaseService` — the live Firestore adapter.
- `firestore-ledger.core.ts` (`FirestoreLedgerCore`) — pure verb logic, emulator-tested.
- `in-memory-ledger.adapter.ts` — for unit tests.

When adding data operations, extend the port interface and all adapters, not just Firebase.

### Log windows are typed and NOT interchangeable (ADR-0004)
There are three distinct windows over `DailyLog`s: **RecentLogs** (14-ROW rolling cache via `getRecentLogs(14)`), and two others. They look similar and mixing them is a known footgun. Read `CONTEXT.md` "Time windows over logs" before touching history/aggregation code.

### Single Firebase SDK copy rule (critical)
NEVER `import` plain `firebase/firestore` in app-bundle code — `@angular/fire` injects its own SDK instance, and a second copy breaks `doc()`/instance identity (this broke prod sign-in once). Use the injected Firestore. In Node test configs, alias instead. Smoke-test a **signed-in** session after any adapter/SDK change.

### Firestore rules are the access-control layer
There is no app server. `firestore.rules` (30k+ lines of logic) + Firebase Auth enforce all access; the public web Firebase keys in `src/environments/*` are public by design. **Deploy `firestore:rules` BEFORE clients write any new top-level field** — the dev app talks to PROD Firestore, so an un-deployed rule rejects new writes. Cover rule changes with `npm run test:rules`.

## Reference docs (read before relevant work)
- **`CONTEXT.md`** — canonical domain glossary. One concept = one term, with legacy synonyms called out (e.g. Log/Entry/Meal all map to `DailyLog`). Read it before naming things or grepping.
- **`docs/adr/`** — architecture decisions 0001–0012. The "why" behind the seams above.
- **`CHANGELOG.md`** — significant ships, newest first.
- **`UX_AUDIT.md`** — living UX backlog; **§S13 is the launch-readiness checklist** (read before any public push).
- **`STRIPE_SETUP.md`** — one-time Stripe + Firebase Extension wiring.
- **`README.md`** — product positioning, full Cloud Functions list, secrets policy (what's safe to commit vs. server-only), operator post-deploy checklist.

## Conventions
- **Latest versions, not LTS pins** — this repo intentionally tracks bleeding-edge (Angular 21, Firebase 12, Expo 54). Don't silently downgrade to dodge peer conflicts.
- **Styling**: Tailwind v4 (`@tailwindcss/postcss`) in the web app; the Expo app uses StyleSheet (NOT NativeWind — a tailwind v3/v4 monorepo conflict, see ADR-0012).
- **i18n**: Transloco, locales `en` + `es-PR` in `src/app/i18n/`. Keep both in parity.
- **No new AI features** without checking — the owner is AI-cost-averse; weekly-report autogenerate was killed for cost.
- Component naming dropped the `-v2` suffix (ADR-0006); the v1 app was fully retired.
