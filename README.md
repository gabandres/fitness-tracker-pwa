# Ignia

A free, private macro tracker for lifters and people in a cut. **Live at <https://ignia.fit>**.

> Try it without an account → **<https://ignia.fit/calculator>**

Two numbers move the needle for fat loss and lean recomp: **calories** and **protein**. Ignia is built around those two — kcal + protein rings, nothing else cluttering the daily flow. Sign-up is two questions; logging a meal takes thirty seconds.

## What's there

- Free macro calculator (no sign-up): <https://ignia.fit/calculator>
- Per-weight, per-goal landing pages: e.g. <https://ignia.fit/macros/lose/180-lb>
- FAQ on macros / cuts / TDEE: <https://ignia.fit/faq>
- Daily kcal + protein rings, 14-day rolling history
- Adaptive TDEE — switches from formula to a measured TDEE after 14 days of logged data, based on your actual weight trend
- Photo → macros via Gemini — **free to everyone** (ADR-0017), limited by a server-side daily quota
- AI coach that reads your real history
- Fasting timer + body-weight log + measurements
- Full Spanish (es-PR) localization
- PWA — installs to home screen, works offline once cached

**Pricing: free. All of it.** There is no Pro tier, no subscription, no trial
and nothing to buy — `PRO_ENABLED` is `false` on both platforms. An optional tip
jar unlocks nothing.

*(Until 2026-08-15 this line advertised "Pro is $3/mo or $24/yr". A sweep on
2026-08-13 removed that claim from the live site — `/vs`, the calculator, the
FAQ and the social share image — and missed this file, which is the repo's front
page on GitHub.)*

## Tech

An **npm-workspaces monorepo**, not a single app: the root is the Angular 21 PWA, `apps/mobile/` is the Expo app that is live on the iOS App Store and is the long-term product (ADR-0015; the web logging surfaces are frozen per ADR-0022), and `packages/core` is the framework-free brain both share. Backed by Firebase (Firestore, Auth, Cloud Functions gen2, Hosting). Gemini for photo→macros and the AI coach. The `firestore-stripe-payments` extension is installed but **dormant** — nothing is purchasable.

## Positioning

Built for the audience that knows they want fat loss or lean gain and just wants a tool that respects their time — not another gamified shame-tracker. Calm visual design (warm-minimal palette, no red/green progress bars), private (no ads, no selling data, no training on logs), focused (kcal + protein only — carbs/fat skipped on purpose).

Uniquely, ships both photo-AI logging (like Cal AI) *and* adaptive TDEE coaching (like MacroFactor) — and both are free. See `UX_AUDIT.md` §S12 for the competitive analysis and live roadmap.

## Project map

- `src/` — the Angular PWA (the repo root *is* the default `ng` project). `services/fitness-store.service.ts` is the single reactive data layer; components inject it and read signals.
- `apps/mobile/` — the Expo SDK 54 React Native app, live on the iOS App Store, Android in closed alpha. Has its own `AGENTS.md`; read it before working there.
- `packages/core/` (`@macrolog/core`) — pure shared domain types + math (TDEE, targets, dates, units), imported by both apps. Keep it dependency-free.
- `functions/` — Cloud Functions (gen2, Node 22), read from `functions/src/index.ts` on 2026-08-15: `logWebhook`, `analyzePhoto`, `consultationStream` (SSE AI coach, server-held Gemini key), `checkAccessStatus`, `exportUserData`, `deleteAccount`, `registerAppleRefreshToken`, `generateWeeklyReport`, `statusPulse`, `weeklyFirestoreBackup`, `hourlyTasks`, `sendWelcomeEmail`, `onDailyLogCreated`, `onSubscriptionWritten`, `sendPasswordReset`, `sendVerificationEmail`, `searchFoods`, `getFoodDetail`, `importRecipe`, `ogImagePublicProfile`, `servePublicProfilePage`, `bootstrapAdmin`, `setAdminClaims`, `startImpersonation`, `stopImpersonation`.
  *(The old list named `sendDailyReminders`, `sendDayThreeCoachPush` and `publishUserCount` as separate functions. They are not: Cloud Scheduler's free tier is 3 jobs and all 3 are spent, so recurring work folds into the `hourlyTasks` dispatcher — see `CLAUDE.md`. Regenerate this list from `index.ts` rather than editing it by hand.)*
- `functions/test/rules/` — `@firebase/rules-unit-testing` suite for `firestore.rules`. Run with `npm run test:rules` (boots the Firestore emulator).
- `src/app/i18n/` — Transloco locales (`en`, `es-PR`).
- `.github/workflows/` — CI only (`ci.yml`: install, typecheck, test, build on PR + main). **There is no deploy workflow**; releases are pushed by hand from a workstation.
- `scripts/sentry-release.mjs` — post-build sourcemap upload + strip (no-op if Sentry secrets absent).
- `scripts/monitoring/` — one-time Cloud Monitoring alert-policy setup (`setup-alerts.sh`).

## Reference docs

- **`CHANGELOG.md`** — significant ships, newest first.
- **`UX_AUDIT.md`** — living UX backlog. **§S13 is the launch-readiness checklist** — read it before any public distribution push (Stripe live verification, tax, password policy, backups, monitoring alerts, GDPR, custom domain, email deliverability, etc.).
- **`STRIPE_SETUP.md`** — one-time Stripe + Firebase Extension wiring.

## Daily commands

```sh
npm start          # ng serve on http://localhost:4200
npm run build      # production build → dist/ (+ Sentry sourcemap upload if secrets set)
npm test           # vitest via ng test
npm run test:rules # Firestore rules unit tests (boots emulator)
```

## Deploy

```sh
npm run build
firebase deploy                  # hosting + functions
firebase deploy --only hosting   # hosting only (no function changes)
firebase deploy --only functions # function changes only
```

Firebase project: `fitness-tracker-gb-1775407101`. Hosting site: `macrolog`.

## Secrets

### Safe to commit (already in `src/environments/*.ts`)

- **Firebase web config** (`apiKey`, `projectId`, `authDomain`, `storageBucket`, `messagingSenderId`, `vapidKey`, `appId`) — these are public by Firebase design; access control is enforced by `firestore.rules` + Firebase Auth, not by hiding the keys.
- **Sentry DSN** — public; Sentry rate-limits by DSN owner, not by secret.
- **Gemini client key** (used by the consultation streaming call) — HTTP-referrer-restricted at Google Cloud, so only `https://ignia.fit` can use it.
- **Stripe `priceId` values** — public identifiers.

### Must stay server-side (never in `src/`)

- **`GEMINI_API_KEY`** used by `analyzePhoto` / `generateWeeklyReport` — stored in Firebase Functions Secret Manager (`firebase functions:secrets:set GEMINI_API_KEY`).
- **Stripe secret key + webhook signing secret** — held by the `firestore-stripe-payments` extension in its own Secret Manager entries. See `STRIPE_SETUP.md`.
- **`FIREBASE_TOKEN`** (CI deploy) — GitHub Actions repo secret; generate with `firebase login:ci`.
- **`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`** (CI sourcemap upload) — GitHub Actions repo secrets.

Local-only overrides belong in `src/environments/environment.local.ts` (gitignored). If you need a per-developer Gemini key for testing, put it there and import explicitly.

## CI / CD

- **`.github/workflows/ci.yml`** runs on every PR + push to main: `npm run doctor -- --no-cloud`, unit tests, a functions build (PRs that touch `functions/**`), and a real production build. Doc-only pushes are skipped (`paths-ignore`). Sourcemaps upload to Sentry when the `SENTRY_*` secrets are present.
- **There is no deploy workflow.** CI's job is to keep `main` green, not to ship — releases are pushed by hand from a workstation (`npm run build && firebase deploy`). This removed a dependency on the deprecated `firebase login:ci` token, which kept expiring and failing the run.

## Operator checklist (post-deploy)

One-time setup items tracked here so we don't lose them:

- **Password policy**: Firebase Console → Authentication → Settings → Password policy — enable "require uppercase", "require numeric", min length 10.
- **Backups**: create GCS bucket `gs://fitness-tracker-gb-1775407101-backups` (us-central1) and add a 30-day object lifecycle rule. The `weeklyFirestoreBackup` function exports here every Sunday 06:00 UTC.
- **Alerts**: run `scripts/monitoring/setup-alerts.sh` once with project ID + notification channel to create Cloud Monitoring policies.

