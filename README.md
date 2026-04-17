# Macro Log

Calorie, protein, weight, fasting, and body-measurement tracker. Live at **<https://macrolog.web.app>**.

Angular 21 PWA backed by Firebase (Firestore, Auth, Cloud Functions, Hosting). Stripe for subscriptions via the `firestore-stripe-payments` extension. Gemini for photo→macros and the AI consultation.

## Project map

- `src/` — Angular app. `services/fitness-store.service.ts` is the single reactive data layer; components inject it and read signals.
- `functions/` — Cloud Functions (gen2, Node 22). `analyzePhoto`, `reserveConsultation`, `releaseConsultation`, `checkAccessStatus`, `logWebhook`, `deleteAccount`.
- `src/app/i18n/` — Transloco locales (`en`, `es-PR`).

## Reference docs

- **`CHANGELOG.md`** — significant ships, newest first.
- **`UX_AUDIT.md`** — living UX backlog.
- **`STRIPE_SETUP.md`** — one-time Stripe + Firebase Extension wiring.

## Daily commands

```sh
npm start          # ng serve on http://localhost:4200
npm run build      # production build → dist/
npm test           # vitest via ng test
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
- **Gemini client key** (used by the consultation streaming call) — HTTP-referrer-restricted at Google Cloud, so only `https://macrolog.web.app` can use it.
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

