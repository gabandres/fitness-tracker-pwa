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
- Photo → macros via Gemini (Pro)
- AI weekly coach that reads your real history (Pro)
- Fasting timer + body-weight log + measurements
- Full Spanish (es-PR) localization
- PWA — installs to home screen, works offline once cached

**Pricing:** Free forever for the core flow. Pro is $3/mo or $24/yr.

## Tech

Angular 21 PWA backed by Firebase (Firestore, Auth, Cloud Functions, Hosting). Stripe for subscriptions via the `firestore-stripe-payments` extension. Gemini for photo→macros and the AI consultation.

## Positioning

Built for the audience that knows they want fat loss or lean gain and just wants a tool that respects their time — not another gamified shame-tracker. Calm visual design (warm-minimal palette, no red/green progress bars), private (no ads, no selling data, no training on logs), focused (kcal + protein only — carbs/fat skipped on purpose).

Uniquely, ships both photo-AI logging (like Cal AI) *and* adaptive TDEE coaching (like MacroFactor) — no other free app does both. See `UX_AUDIT.md` §S12 for the competitive analysis and live roadmap.

## Project map

- `src/` — Angular app. `services/fitness-store.service.ts` is the single reactive data layer; components inject it and read signals.
- `functions/` — Cloud Functions (gen2, Node 22). `analyzePhoto`, `consultationStream` (SSE AI coach, server-held Gemini key), `checkAccessStatus`, `logWebhook`, `deleteAccount`, `generateWeeklyReport`, `sendDailyReminders`, `sendDayThreeCoachPush`, `statusPulse`, `publishUserCount`, `weeklyFirestoreBackup`.
- `functions/test/rules/` — `@firebase/rules-unit-testing` suite for `firestore.rules`. Run with `npm run test:rules` (boots the Firestore emulator).
- `src/app/i18n/` — Transloco locales (`en`, `es-PR`).
- `.github/workflows/` — CI (`ci.yml`: install, typecheck, test, build on PR + main) and manual deploy (`deploy.yml`).
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

- **`.github/workflows/ci.yml`** runs on every PR + push to main/master: install, typecheck (app + functions), unit tests, production build.
- **`.github/workflows/deploy.yml`** is manual-trigger only (`workflow_dispatch`). Requires `FIREBASE_TOKEN` secret; optionally uploads sourcemaps if Sentry secrets are present.

## Operator checklist (post-deploy)

One-time setup items tracked here so we don't lose them:

- **Password policy**: Firebase Console → Authentication → Settings → Password policy — enable "require uppercase", "require numeric", min length 10.
- **Backups**: create GCS bucket `gs://fitness-tracker-gb-1775407101-backups` (us-central1) and add a 30-day object lifecycle rule. The `weeklyFirestoreBackup` function exports here every Sunday 06:00 UTC.
- **Alerts**: run `scripts/monitoring/setup-alerts.sh` once with project ID + notification channel to create Cloud Monitoring policies.

