# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ignia — a free, private kcal+protein tracker (live at <https://ignia.fit>). The repo is an **npm-workspaces monorepo** with three buildable units plus shared code:

- **`src/`** — the root project IS the Angular 21 PWA (the flagship product). Despite being a workspace root, it has its own `src/` and is the default `ng` project (`fitness-tracker-pwa`).
- **`apps/mobile/`** — Expo SDK 54 React Native app, **live on the iOS App Store** (which version is live is a question for `STATUS.md`, not for `app.json`). Android not launched. Has its own `CLAUDE.md` → `AGENTS.md`; read those when working there. Its `main` is a custom `index.js` (not `expo-router/entry`) so the Android widget task handler registers before React mounts.
- **`packages/core/`** (`@macrolog/core`) — framework-free shared "brain": domain types + pure math (TDEE, targets, date, unit-system). Imported by BOTH the Angular app and the Expo app. Keep it dependency-free and pure.
- **`functions/`** — Firebase Cloud Functions (gen2, Node 22), its own package + tsconfig.

Workspaces are declared in root `package.json` as `packages/*` and `apps/*`. `functions/` is NOT a workspace — it installs/builds independently.

## Commands

Run from repo root unless noted. This is a **PowerShell-primary Windows** environment.

```sh
npm start            # ng serve → http://localhost:4200 (dev config, auto-uses environment.development.ts)
npm run build        # prod build → dist/, then prerender-seo.mjs + sentry-release.mjs (build = more than ng build)
npm test             # app unit tests (vitest via @angular/build:unit-test)
npm run test:ledger  # FirestoreLedgerCore emulator tests (boots Firestore emulator, needs JDK 21+)
npm run test:rules   # ALL functions specs incl. firestore.rules (delegates to functions/, boots emulator)
```

Per-workspace:
```sh
npm --prefix packages/core test          # pure-core vitest (no emulator)
npm --prefix packages/core run typecheck
npm --prefix functions run build         # tsc → functions/lib
cd apps/mobile && npx expo start         # Expo dev server + Expo Go
```

**Both emulator suites need JDK 21+** and PATH `java` here is 17, so they fail
with `firebase-tools no longer supports Java version before 21` — a PATH
problem that reads like a broken suite. `scripts/require-java21.mjs` preflights
both and prints the fix (`STATUS.md` §7 has it); run the two **separately**, or
the second inherits the first's emulator port.

Single test: `npx vitest run path/to/file.spec.ts` (or `-t "test name"`). Emulator-backed suites must run via the `firebase emulators:exec` wrappers above — they won't pass standalone.

## Deploy

```sh
npm run build && firebase deploy                 # hosting + functions
firebase deploy --only hosting                   # hosting only
firebase deploy --only functions                 # functions only
firebase deploy --only firestore:rules           # rules only
```

Firebase project `fitness-tracker-gb-1775407101`, hosting site `macrolog`. **Always run a PROD build before `firebase deploy`** — dev builds skip `ngsw.json`, which leaves the update banner firing for users. CI build/test runs on every PR + push to main (`.github/workflows/ci.yml`); **CI never deploys** — there is no deploy workflow. Releases are pushed by hand from a workstation with the commands above.

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

### Mobile app data layer (apps/mobile) — NOT the port/adapter seam
The Expo app does **not** use `LEDGER_PORT`. It talks to Firestore through the Firebase JS SDK directly in `apps/mobile/src/lib/ledger.ts` — a flat file of thin `subscribe*` (onSnapshot) + async CRUD functions whose doc shapes mirror `FirestoreLedgerCore` byte-for-byte, so both apps read/write the same data and pass the same rules. State is **per-tab hooks** (`useToday`, `useHistory`, `useBody`, `useTrain`); each hook independently `onSnapshot`-subscribes, so the same collection (e.g. `presets`, `customFoods`) is **deliberately subscribed in multiple hooks** rather than shared through one context — match this precedent, don't extract a lone shared hook (**ADR-0016**; the duplication is bounded by focus-gating — subscribe inside `useFocusEffect` and wrap unsubs in `trackSubs`, never a permanent listener). Do not re-propose a shared subscription cache; the concurrent multiplier it targets doesn't exist and the model is intentional. Cross-frontend domain/math logic belongs in `packages/core` (pure, reused by both apps); never reimplement it per frontend. A web feature should be followed by a committed mobile port — mobile is the long-term product (PWA lifespan uncertain).

### Firestore rules are the access-control layer
There is no app server. `firestore.rules` (~670 lines, dense — per-collection field/shape/range validation) + Firebase Auth enforce all access; the public web Firebase keys in `src/environments/*` are public by design. **Deploy `firestore:rules` BEFORE clients write any new top-level field** — the dev app talks to PROD Firestore, so an un-deployed rule rejects new writes. Cover rule changes with `npm run test:rules`.

## Where to look (one file per question)
- **`STATUS.md` — what is true right now.** Live version, what is merged but in no binary, what is blocked and on what. **Read it before scoping anything.** If another file disagrees with it, the other file is stale — fix or delete it. **It has a ~200-line budget**: when something ships its entry is *deleted*, not updated, and the outcome goes to `CHANGELOG.md`. It reached 941 lines once and carried four self-contradictions; a status file nobody can hold in their head stops being read.
- **`docs/COMMANDS.md`** — how to *check* a claim in `STATUS.md` rather than trust it: ASC/Play/EAS/Sentry queries, the OTA fingerprint gate, the ngsw verifier. Prefer running one of these over believing a number in prose.
- **`docs/build-infrastructure.md`** — EAS ceilings, iOS credentials/profiles, Android signing, and the resolved build traps that will be re-hit (silent pod drops, `.easignore`, `autoIncrement` gaps).
- **`CONTEXT.md`** — canonical domain glossary. One concept = one term, with legacy synonyms called out (e.g. Log/Entry/Meal all map to `DailyLog`). Read it before naming things or grepping.
- **`docs/adr/`** — architecture decisions 0001-0016: the "why" behind the seams above. 0013 (food resolution), 0014 (mobile theming), 0015 (Ignia pivot) and 0016 (per-hook subscriptions) are load-bearing and cited throughout this file.
- **`CHANGELOG.md`** — significant ships, newest first. Entries before 2026-06-13 live in `CHANGELOG-archive.md`.
- **`docs/research/`** — long-form research (watch transport, watchOS targets, activity/TDEE semantics, competitive scan). **Every file opens with a VERDICT block: read that and stop, unless you need the detail.** Cite these conclusions; do not re-derive them.
- **`UX_AUDIT.md`** — open UX backlog only; **§S13 is the launch-readiness checklist**.
- **`docs/app-store-metadata.md`** — source of truth for App Store listing field values (`docs/go-to-market.md` owns positioning).
- **`docs/seo-status.md`** — what Google has actually indexed, and the 2026-07-29 baseline. Re-check with `node scripts/gsc.mjs inspect`.
- **`docs/DEV_ENVIRONMENT.md`** — emulator dev loop + the owner runbook for console/DNS steps code can't do.
- **`CLAUDE.local.md`** (git-ignored, may not exist) — machine-local notes: where the Apple `.p8` keys live, demo-account details, capture paths. Locations only, never secret values. Read it before asking the owner where a credential is.
- **`README.md`** — product positioning, full Cloud Functions list, secrets policy. **`STRIPE_SETUP.md`** — dormant Stripe wiring, for whenever Pro turns on.

**Housekeeping rule: a plan document is deleted the day its work ships.** Its outcome goes to `CHANGELOG.md`, its reasoning to an ADR, its current state to `STATUS.md`. Git keeps the original. A shipped plan left in the tree with a "CORRECTION" block on top is how a wish list becomes indistinguishable from a status report — that failure has already cost this project three re-scopes of work that was already built.

## Guardrails that run automatically

`.claude/settings.json` wires three `PreToolUse` hooks (`.claude/hooks/`). Each
one corresponds to a failure that has really happened here and that is
**invisible to tsc, the unit tests, and the tool's own exit code** — which is why
prose alone did not prevent them:

| Hook | Blocks | Because |
|---|---|---|
| `guard_firestore_import.py` | `from 'firebase/firestore'` in `src/**` (not specs, not `apps/mobile/**`, not `functions/**`) | a second SDK copy breaks `doc()`/instance identity; it broke prod sign-in once |
| `guard_firebase_deploy.py` | a hosting deploy whose `dist` fails its own `ngsw.json` SHA1 sweep or predates `src/` | a dev/stale build leaves the update banner firing for every returning user |
| `guard_eas_update.py` | `eas update` run from Windows rather than via `ssh ignia-mac` | the fingerprint is machine-dependent; a Windows publish exits 0 and reaches **nobody** |

They match **invocations, not mentions** — echoing, grepping or heredoc'ing one
of these commands is allowed, and `npm run build && firebase deploy` (the
documented one-liner) passes because the chain rebuilds first. `python
.claude/hooks/test_guards.py` is the 21-case matrix; run it after touching a
guard. A guard that fires on the happy path is a guard that gets deleted.

## Conventions
- **Latest versions, not LTS pins** — this repo intentionally tracks bleeding-edge (Angular 21, Firebase 12). Don't silently downgrade to dodge peer conflicts. **Expo is the exception and is currently BEHIND**: `apps/mobile` is on SDK **54** (RN 0.81.5) while npm's `latest` is **57** — measured 2026-08-17, when `tracker-app` was found on 57. The upgrade is wanted, and is gated on being able to build iOS: it cannot be validated until a Mac with disk headroom exists, since Windows cannot build iOS at all. Do not start it while an App Store release is `WAITING_FOR_REVIEW` with `AFTER_APPROVAL`.
- **Styling**: Tailwind v4 (`@tailwindcss/postcss`) in the web app; the Expo app uses StyleSheet (NOT NativeWind — a tailwind v3/v4 monorepo conflict, see ADR-0012).
- **Mobile theming (ADR-0014)**: the Expo app is dual-theme, dark leads. Components read the palette via `useTheme()`/`useThemedStyles()` from `src/lib/theme-context` — never a static `colors` import from `theme.ts` (those exports are gone; `ShareCard` pins `palettes.light` on purpose). Text on `colors.ink` surfaces uses `colors.onInk`; field/chip fills use `colors.inputBg`. Custom font families (`type.display/heading`) must not be paired with `fontWeight`.
- **i18n**: web uses Transloco (`src/app/i18n/{en,es-PR}.json`, **nested** keys, `{{var}}` interpolation); mobile uses **flat** keys (`apps/mobile/src/i18n/{en,es-PR}.ts`, `{var}` interpolation). Keep both locales in parity per platform; when porting a string across platforms, convert the key shape **and** the interpolation braces (`{n}` ↔ `{{n}}`).
- **No new AI features** without checking — the owner is AI-cost-averse; weekly-report autogenerate was killed for cost.
- **v1 is free — Pro/deferred features are gated OFF via flags, not deleted** (kept for a later re-enable). No purchasable product ships yet. Both apps mirror the same model: web `PRO_ENABLED` in `src/app/services/subscription.service.ts` (when false, `isPaid()` is forced `true` so non-cost perks — themes, higher limits, streak-freeze — unlock for everyone) + `FEATURES.photoScan` in `src/app/utils/features.ts`; mobile `PRO_ENABLED` in `apps/mobile/src/lib/subscription.ts` + `FEATURES` in `apps/mobile/src/lib/features.ts`. **Two distinct flags**: `isPaid`/`isPro`-gated code = non-cost perks (unlocked in v1); `PRO_ENABLED`/`FEATURES`-gated code = purchase surfaces + AI-cost features (weekly report) — these stay **hidden**. **Photo-scan is the exception and is now ON and free on both platforms** (ADR-0017, 2026-08-07, amending 0015's paid gate): web `FEATURES.photoScan: true`, mobile on by *absence* of `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` in `eas.json`. Its tiering is **server-side only** (`dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling`) because a client cannot express "paid" while `PRO_ENABLED` is false — a client-side paid check there unlocks it for everyone, the opposite of the intent. The client flags are a kill switch, not a cost control. Server-side Stripe extension + referral CFs are dormant (not removed). When adding or changing a gate, mirror both platforms and pick the right flag.
- **Parity is NO LONGER bidirectional — the web logging app is frozen (ADR-0022, 2026-08-12).** Mobile is the long-term source of truth (ADR-0015). New features are mobile-first and may be mobile-only; a mobile feature does **not** oblige a web port. The web logging surfaces (Today/Trends/Body/Train) stay *correct* — bugs, rules, security and dependency upgrades are still fixed — they simply stop gaining features, so "the web version of this is missing" is expected and is not a gap to file. The web **shell** (landing, `/vs`, `/calculator`, `/faq`, `/privacy`, `/terms`, `/support`, `/status`, and the 105 prerendered SEO pages) keeps shipping normally and is **not** optional: Apple requires the live privacy URL and Play requires the delete-account URL, both on `ignia.fit`. Do not propose deleting the website. Retirement is deferred to a measurement — `node scripts/usage-report.mjs --days 30`, reading `platforms` — and may not be revisited on intuition before that data exists. Cross-frontend domain/math still lives in `packages/core`, and matters *more* under a freeze: pure math is what keeps a frozen frontend correct with nobody porting to it.
- **Cost discipline** (owner is GCP-cost-averse too). **Both free tiers below are per BILLING ACCOUNT, and this billing account (`010F4E-5E97BC-6B83D0`) carries four projects** — `fitness-tracker-gb-1775407101`, `citafy-6129184`, `sigil-finance`, `zoho-integration-billing`. Ignia does not get its own allowance: another project adding a scheduler job or a secret version silently pushes Ignia's into billable, and a bill that grows here may have nothing to do with this repo. Measured 2026-08-04: lifetime net spend across all four is ~$7.85, of which Ignia is ~$2.25 and **Secret Manager version storage is the single largest line, at $5.91 account-wide — the Gemini API is $0.08.** The failure mode is forgotten secret versions, not traffic. Scheduled Cloud Functions: **Cloud Scheduler's free tier is 3 jobs, and all 3 are already spent** (`hourlyTasks`, `statusPulse`, `weeklyFirestoreBackup`) — there is NO headroom, so any new recurring work must fold into the hourly dispatcher (`functions/src/hourly-tasks.ts`, each task in an independent `Promise.allSettled`), not one `onSchedule` per task. **Secret Manager's free tier is 6 active versions** — after rotating a secret, `gcloud secrets versions destroy` the superseded ones (the Stripe extension pins `versions/latest`). **The audited floor is 7, not 6** (2026-08-09): every remaining secret holds exactly one live version and each is bound to something real, so `npm run doctor` PASSES at 7 and fails on growth past it, printing the ~$0.06/mo overage every run. Going under 6 means retiring the dormant Stripe extension — a product decision. `USDA_FDC_API_KEY` was retired that day; nothing had read it since ADR-0018 bundled the database, but **the binding was stale Cloud Run config on BOTH `searchFoods` and `getFoodDetail`**, and a loop-based scan that silently failed every read reported "nothing binds it" — deleting on that evidence would have stopped `searchFoods` booting. **Scan for bindings in ONE call, never a per-service loop**: `gcloud run services list --format="value(metadata.name, spec.template.metadata.annotations)" | grep -i <SECRET>`. Removing the binding needs `gcloud run services replace` on an edited service YAML (`--remove-secrets` crashes on the Firebase-managed annotation) — and **an exported YAML can name an image tag Artifact Registry has already garbage-collected**, which fails the revision and leaves the service `Ready: False` while traffic keeps serving the last good revision. The recovery is `firebase deploy --only functions:<name>`, which rebuilds the image; it also drops the stale binding, so it is the cheaper first move. Account-wide the count is **13** (Ignia 8, `zoho-integration-billing` 5), so ~7 versions bill at $0.06/mo each. **13 is the honest floor** — audited 2026-08-07 and every remaining version is genuinely bound: Ignia's 8 to live functions or the ACTIVE `invertase/firestore-stripe-payments` extension (the Apple trio is *required* for Sign in with Apple account deletion), and Zoho's 5 to a Cloud Function that served POSTs on 2026-08-03. The audit did retire one: `ANTHROPIC_API_KEY`, bound to `analyzePhoto` but never executed because `PHOTO_PROVIDER` is `"gemini"`. **Order matters when removing a bound secret** — gen2 resolves bindings at instance start, so unbind → redeploy → verify → *then* `gcloud secrets delete`; destroying first stops the function booting. Never set `minInstances` (idle warm cost). Prefer coarse schedules (the `/status` heartbeat is 15-min, not 1-min). **Every AI-cost callable sits behind TWO guards, and a new one must use both**: `dailyQuota` (`functions/src/daily-quota.ts`) caps one user per day, and `spendCeiling` (`functions/src/spend-ceiling.ts`) caps everyone together — per-user limits are a fairness mechanism, the ceiling is a solvency one, and a free tier makes the second the load-bearing half. The ceiling resets at UTC midnight; its sibling kill-switch deliberately does **not** (a switch that re-arms itself is a delay, not a kill). Order matters: `check()` before the per-user reserve, `record()` after. Admins are recorded but never blocked.
- Component naming dropped the `-v2` suffix (ADR-0006); the v1 app was fully retired.
