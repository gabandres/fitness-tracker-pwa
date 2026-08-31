# Ignia

A free, private macro tracker for lifters and people in a cut. **On the App Store and Google Play; the website is <https://ignia.fit>**.

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
- Home-screen widget, Apple Watch complication, Siri quick-add

**The browser version is retired (ADR-0036, 2026-08-30).** `ignia.fit` is the marketing/compliance site plus the owner's `/admin` page; the old `/app` routes tell you where the apps are.

**Pricing: free. All of it.** There is no Pro tier, no subscription, no trial
and nothing to buy — `PRO_ENABLED` is `false` on both platforms. **Donation
intake is also off** since 2026-08-19 (`FEATURES.tips = false` on both
platforms, the three `fit.ignia.tip.*` consumables removed from sale in ASC,
`/tip` → `/support`) while operations transfer to Bermudez Systems LLC; the
re-enable condition is payouts landing in the LLC's bank account, not a date.
This line described a live tip jar until then.

*(Until 2026-08-15 this line advertised "Pro is $3/mo or $24/yr". A sweep on
2026-08-13 removed that claim from the live site — `/vs`, the calculator, the
FAQ and the social share image — and missed this file, which is the repo's front
page on GitHub.)*

## Tech

An **npm-workspaces monorepo**, not a single app: the root is the Angular 21 web shell (marketing pages + `/admin`), `apps/mobile/` is the Expo app on the App Store and Google Play and is the product (ADR-0015; the web logging app was retired per ADR-0036), and `packages/core` is the framework-free brain the app and the Cloud Functions share. Backed by Firebase (Firestore, Auth, Cloud Functions gen2, Hosting). Gemini for photo→macros and the AI coach. Nothing is purchasable; the `firestore-stripe-payments` extension was removed 2026-08-31 (future subscriptions, if any, would use Apple/Google IAP).

## Positioning

Built for the audience that knows they want fat loss or lean gain and just wants a tool that respects their time — not another gamified shame-tracker. Calm visual design (warm-minimal palette, no red/green progress bars), private (no ads, no selling data, no training on logs), focused (kcal + protein only — carbs/fat skipped on purpose).

Uniquely, ships both photo-AI logging (like Cal AI) *and* adaptive TDEE coaching (like MacroFactor) — and both are free. See `UX_AUDIT.md` §S12 for the competitive analysis and live roadmap.

## Project map

- `src/` — the Angular web shell (the repo root *is* the default `ng` project): landing, calculators, comparisons, FAQ, legal, status, public profiles, and `/admin`. No data layer — the logging app is gone (ADR-0036).
- `apps/mobile/` — the Expo SDK 57 React Native app, live on the iOS App Store and submitted to Google Play production (`STATUS.md` has where that stands). Has its own `AGENTS.md`; read it before working there.
- `packages/core/` (`@macrolog/core`) — pure shared domain types + math (TDEE, targets, dates, units), imported by both apps. Keep it dependency-free.
- `functions/` — Cloud Functions (gen2, Node 22), read from `functions/src/index.ts` on 2026-08-15: `logWebhook`, `analyzePhoto`, `consultationStream` (SSE AI coach, server-held Gemini key), `checkAccessStatus`, `exportUserData`, `deleteAccount`, `registerAppleRefreshToken`, `generateWeeklyReport`, `statusPulse`, `weeklyFirestoreBackup`, `hourlyTasks`, `sendWelcomeEmail`, `onDailyLogCreated`, `onSubscriptionWritten`, `sendPasswordReset`, `sendVerificationEmail`, `searchFoods`, `getFoodDetail`, `importRecipe`, `ogImagePublicProfile`, `servePublicProfilePage`, `bootstrapAdmin` (`setAdminClaims` deleted 2026-08-30 — one admin, no grant path), `startImpersonation`, `stopImpersonation`.
  *(The old list named `sendDailyReminders`, `sendDayThreeCoachPush` and `publishUserCount` as separate functions. They were not, and the first two are **deleted** as of 2026-08-30 — web push went with the web logging app, ADR-0036 / #112. `publishUserCount` folds into `hourlyTasks`: Cloud Scheduler's free tier is 3 jobs and all 3 are spent, so recurring work folds into the `hourlyTasks` dispatcher — see `CLAUDE.md`. Regenerate this list from `index.ts` rather than editing it by hand.)*
- `functions/test/rules/` — `@firebase/rules-unit-testing` suite for `firestore.rules`. Run with `npm run test:rules` (boots the Firestore emulator).
- `src/app/i18n/` — Transloco locales (`en`, `es-PR`).
- `scripts/sentry-release.mjs` — post-build sourcemap upload + strip (no-op if Sentry secrets absent).
- `scripts/monitoring/` — one-time Cloud Monitoring alert-policy setup (`setup-alerts.sh`).

## Reference docs

- **`CHANGELOG.md`** — significant ships, newest first.
- **`UX_AUDIT.md`** — living UX backlog. **§S13 is the launch-readiness checklist** — read it before any public distribution push (Stripe live verification, tax, password policy, backups, monitoring alerts, GDPR, custom domain, email deliverability, etc.).

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
- **`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`** (sourcemap upload at build time) — read from the git-ignored `.env.local` on the workstation that runs the build. `CLAUDE.local.md` owns the copies and the rotation order.

Local-only overrides belong in `src/environments/environment.local.ts` (gitignored). If you need a per-developer Gemini key for testing, put it there and import explicitly.

## CI / CD

- **There is no CI and no deploy workflow.** `.github/workflows/ci.yml` was deleted on 2026-08-23: it had failed on every run for days on a defect nobody was reading (`packages/core` typecheck), so its only live output was a failure email. A gate nobody reads is worse than no gate — it trains you to ignore red.
- **Verification is a workstation step, before you ship.** `npm run doctor -- --no-cloud`, then the `verify-build` skill (all four buildable units: web shell, `packages/core`, `functions`, `apps/mobile`). Releases are pushed by hand — `npm run build && firebase deploy` — and the `PreToolUse` guards in `.claude/hooks/` block the deploys CI never caught anyway.

## Operator checklist (post-deploy)

One-time setup items tracked here so we don't lose them:

- **Password policy**: Firebase Console → Authentication → Settings → Password policy — enable "require uppercase", "require numeric", min length 10.
- **Backups**: create GCS bucket `gs://fitness-tracker-gb-1775407101-backups` (us-central1) and add a 30-day object lifecycle rule. The `weeklyFirestoreBackup` function exports here every Sunday 06:00 UTC.
- **Alerts**: run `scripts/monitoring/setup-alerts.sh` once with project ID + notification channel to create Cloud Monitoring policies.

### A FIRST deploy that fails mid-create leaves the function unreachable, and `firebase deploy` will not repair it

Measured 2026-08-24 on `fetchOuraWorkouts`. Every callable in this project
carries `allUsers` + `roles/run.invoker` on its Cloud Run service, and it is
**not optional**: a Firebase Auth ID token is not a Google IAM identity, so
without that binding Cloud Run rejects the request at the infrastructure layer
*before* the callable's own auth check runs.

**Firebase sets the invoker on CREATE, never on UPDATE.** So this sequence
leaves a permanently broken function:

1. first deploy dies (`Could not build the function. Deadline Exceeded`),
2. the retry succeeds — but reports `updating`, not `creating`,
3. the binding is never applied, and **re-running `firebase deploy` does not
   fix it**, because the function now exists.

The symptom is precise and easy to misread as an auth bug in your own code:
the function answers **403** where a healthy sibling answers **401**. 401 means
the callable ran and rejected you; 403 means you never reached it.

```sh
# The check — a healthy callable answers 401, a broken one 403.
curl -s -o /dev/null -w "%{http_code}
" -X POST   https://us-central1-<project>.cloudfunctions.net/<fn>   -H "Content-Type: application/json" -d '{"data":{}}'

# Confirm, and compare against any sibling.
gcloud run services get-iam-policy <fn-lowercased> --region=us-central1   --project=<project> --format=json      # a broken one prints only an etag

# The fix.
gcloud run services add-iam-policy-binding <fn-lowercased>   --region=us-central1 --project=<project>   --member=allUsers --role=roles/run.invoker
```

**Note the service name is the function name LOWERCASED** (`fetchouraworkouts`).

`npm run doctor` catches the function being absent, which is what surfaced this
one — but it checks *deployed vs exported*, not *invokable*, so a function that
deploys and cannot be called passes. Probe any NEW callable once before
believing it works; an existing one cannot regress this way.

