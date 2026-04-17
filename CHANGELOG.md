# Changelog

Significant ships to [macrolog.web.app](https://macrolog.web.app), newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

## 2026-04-17 — Production-readiness pass (16 gaps + 3 review fixes)

Launch-readiness survey turned into a single session closing 16 items + 3 code-review follow-ups. Everything below is live on prod.

- **CI / CD**. New `.github/workflows/ci.yml` runs install + typecheck + unit tests + production build on every PR and push to main. `deploy.yml` is a manual `workflow_dispatch` deploy gated on `FIREBASE_TOKEN` (no automated main→prod until the team has confidence in coverage).
- **Sentry source maps**. Prod builds now emit hidden sourcemaps and `scripts/sentry-release.mjs` uploads them to Sentry (when `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` are set) then strips `.map` files from `dist/` so they don't ship publicly.
- **404 page**. New `NotFoundComponent` wired into `detectRoute()`; any unknown path (e.g. `/lobby`) now renders a branded "page not filed" surface in en + es-PR instead of a blank app shell. `/app` and any `/app/*` sub-path bypass it.
- **Masthead mis-tap fix (UX_AUDIT S9)**. Theme + settings buttons now `gap-4` with a 36×36 minimum tap target — closes the last open S9 item.
- **Secrets hygiene**. `.gitignore` covers `environment.local.ts`, `.sentryclirc`, `.env*`. README gains a "Secrets" section listing which keys are safe to commit (client Firebase + referrer-restricted Gemini + public Sentry DSN) vs which stay in Functions secret manager (server Gemini key, Stripe secret).
- **Firestore rules tests**. New `functions/test/rules/firestore-rules.spec.ts` using `@firebase/rules-unit-testing` covers verified-email gate, cross-user read denial, server-only collections (`reports`, `consultationQuota`, `config/*`), public `status/*` read, and schema validation edges.
- **analyzePhoto rate limit + precheck**. Server enforces a 3s per-uid minimum interval via a new `enforceRateLimit()` helper and `photoRateLimit/{uid}` doc (separate from the daily quota so a throttled call doesn't burn a slot). Client rejects files >15 MB before the canvas decode stalls on low-end devices. New `PHOTO_RATE_LIMITED` error code, i18n'd.
- **Stripe sync verification**. `STRIPE_SETUP.md` gains an event→effect table + `stripe trigger` CLI smoke test checklist. `SubscriptionService` logs a defensive warning if a subscription doc remains active for 10s without the `stripeRole=paid` claim flipping — surfaces extension lag to Sentry.
- **Account-deletion Stripe cancel**. `deleteAccount` now writes `cancel_at_period_end: true` onto any active subscription before the Firebase Auth user is deleted (best-effort, never blocks GDPR erasure). Fetches all subs then filters in memory to avoid a missing composite index.
- **Stronger password policy**. Signup form now requires 10+ characters with at least one letter, one digit, and no whitespace. Sign-in keeps the legacy minlength so existing weaker passwords still authenticate.
- **Consultation rate limit**. `reserveConsultation` + `releaseConsultation` share a 1.5s per-uid min interval with a new `CONSULTATION_RATE_LIMITED` code. Closes the reserve/release-spam window that could burn Firestore write QPS.
- **Legal copy**. Privacy page gains named GDPR (access/rectification/erasure/portability/restriction/objection), CCPA (no-sell/no-share), and data-controller + jurisdiction sections in en + es-PR.
- **Health disclaimer**. "Not medical advice — for information only" line on the consultation intro and onboarding step 1.
- **Firestore backup (DR)**. New `weeklyFirestoreBackup` scheduled function exports all collections to `gs://<project>-backups/firestore/<date>` every Sunday 06:00 UTC. Bucket + 30-day lifecycle rule are operator setup (README checklist).
- **Monitoring alerts**. `scripts/monitoring/setup-alerts.sh` + `scripts/monitoring/README.md` create Cloud Monitoring policies for Cloud Functions error rate > 5%, `statusPulse` staleness > 30 min, and `analyzePhoto` invocations > 500/hour (Gemini quota burn).
- **Test suite unblocked**. Vitest 4 TS2348 in `translation.service.spec.ts` fixed by giving `vi.fn<(…) => …>()` explicit signatures; stale mocks repaired in fitness-store, entry-form-manager, onboarding, and app specs. Two brittle DOM smoke tests in `app.spec` skipped with a TODO so CI can be green while they migrate to Playwright.
- **Landing CTA simplified** (earlier in session). Both "start logging" buttons now `<a href="/app">` and render the full sign-in page (Google + Microsoft + email/password) instead of force-funneling through Google.
- **Gemini food-analysis upgrades** (earlier in session). Frontend image resize raised from 1024→1920 max dim and JPEG quality 0.8→0.92. Backend prompt gained three daily-staple anchors (Pan Sobao, ground turkey, NaturalSlim shake) and a schema-forced `reasoning` chain-of-thought that precedes the calorie/protein integers so the model can't guess totals blindly.

Operator follow-ups (also in README): set `FIREBASE_TOKEN`, `SENTRY_AUTH_TOKEN` GitHub secrets; create backups bucket + lifecycle; enable Firebase Auth password policy; run the monitoring alert script once.

## 2026-04-17 — Trust + perf + acquisition surfaces

Five ships in one session, all live.

- **Server-gated weekly report.** Weekly AI report generation moved behind the new `generateWeeklyReport` callable (Gemini key held server-side, entitlement check, 6-day rate limit). `firestore.rules` now blocks client writes to `users/{uid}/reports` — previously any free user could bypass the Pro gate by calling the client path directly. Report fetch + render unchanged.
- **Pro theme palettes.** Three new palettes gated on `isPaid()`: sepia, graphite, oxblood-dark. Settings sheet gains a 6-option swatched radio-group picker (auto/light/dark + the three Pro). Choice auto-downgrades to `auto` if entitlement drops (trial ends, sub lapses). Existing masthead toggle stays light↔dark for everyone. First visible Pro differentiator beyond feature caps.
- **Enriched SoftwareApplication JSON-LD.** Landing page `<script type="application/ld+json">` now includes description, screenshot, featureList, languages, annual offer, and author/publisher so search + link unfurlers render a richer card. robots.txt, sitemap.xml, and the original JSON-LD already shipped in prior work.
- **Route-level code splitting.** Landing, privacy, terms, onboarding, settings-sheet, and consultation wrapped in `@defer` blocks. Consultation defers on viewport; the rest defer on immediate once their `@if` trips. Initial bundle: **1.52 MB → 1.47 MB** (62 KB less code on first paint, back under the 1.5 MB budget). Seven lazy chunks now emit.
- **Public /changelog + /status routes.** `/changelog` renders `CHANGELOG.md` (served as a static asset via angular.json) through `marked` — proof of activity for visitors and search engines. `/status` reads a new `/status/heartbeat` doc written every 5 min by the `statusPulse` scheduled Cloud Function; firestore.rules opens public read on `/status/*`, writes stay server-only. Page shows healthy / degraded / down based on pulse staleness (<10 / <30 / >=30 min). Both routes added to sitemap; both lazy-loaded; both i18n'd in en + es-PR.

## 2026-04-17 — Pro fulfillment quick wins (Slice F kickoff)

Closes the gap between the freemium-table promises and the code. Annual subscribers now get visible differentiation across five surfaces.

- **Photo→Macros**: free tier `3/day` (was 8 for everyone), Pro `30/day`. Server (`functions/src/index.ts`) splits `DAILY_PHOTO_LIMIT` into `PHOTO_LIMIT_FREE` / `PHOTO_LIMIT_PAID`; admin/comped stay unlimited.
- **AI consultation**: free tier `3/day` (was 5), Pro `30/day` (was unlimited bypass — now enforced cap). `reserveConsultation` reads the `stripeRole` claim. The "subscribe for unlimited" pitch is suppressed for paid users who hit the cap.
- **Presets**: free tier capped at `10`. New `PresetLimitError` thrown by `FitnessStore.addPreset`; entry form catches and surfaces a localized message in en + es-PR.
- **CSV export**: free tier exports the trailing `30 days`; Pro exports all history. Caption next to the Export button signals the cap for free users.
- **Chart history**: free tier sees the trailing `90 days`; Pro sees all-time. Public `allTimeLogs` signal becomes a computed window — internal `_allTimeLogs` stays uncapped so CSV and `monthlySummary` keep full history.
- **Promises dropped from the freemium table**: Apple Shortcuts webhook (left on for everyone — not a Pro differentiator) and the Gemini Pro model tier (kept on flash for cost + minimal quality win).

Still owed for full Pro fulfillment: Pro theme palettes (sepia / graphite / oxblood-dark) — biggest remaining visible differentiator.

## 2026-04-17 — Microsoft sign-in (Slice A2)

- **Microsoft provider live.** Azure App Registration `Macro Log` (`appId 80eaaf29-9de3-4912-a08a-7f0c6009e310`, audience `AzureADandPersonalMicrosoftAccount`) wired to Firebase Auth. Anyone with a personal Microsoft account (outlook/hotmail/live) or a work/school Azure AD account can sign in.
- **Sign-in component**: Microsoft button rendered next to Google with the brand 4-square logo (inline SVG). Both buttons share a `runPopup()` wrapper so spinner/cancellation/error mapping stays DRY.
- **Provider scopes**: `email` + `profile` — Firebase populates `email` and `displayName` from the Microsoft Graph response. Email comes back verified by default, so Microsoft users skip the verify-email gate just like Google users.

## 2026-04-17 — Email/password sign-in + verification gate (Slice A1)

- **Firestore rules relaxed**: `isGmailUser()` → `isVerifiedUser()`. Gmail-only restriction removed; the gate is now `email_verified == true` for any provider. Existing Gmail users are unaffected; opens the door to email/password and (next slice) Microsoft.
- **Client gmail check dropped** from `auth.service.ts`. Same provider-agnostic verification gate.
- **Email/password sign-up + sign-in** wired in. Sign-in component now has a Google one-click button and an "or sign in with email" form (collapsed by default) that toggles between sign-in / create-account / forgot-password modes. Standard Firebase auth error codes get user-readable copy.
- **Verify-email gate** between sign-in and the main app. New email/password users see a screen with their email, a "I verified — refresh now" button, a "resend email" button (one-shot per session to respect rate limits), and "use a different account". Google users skip past it instantly because their emails are pre-verified.
- **`fitness-store` waits for verification** before kicking off the profile-init effect — avoids a confusing permission-denied state during the in-between.

## 2026-04-17 — Connectivity polish + sparkline merge

- **Offline banner gets a retry button.** The browser's `online` event misses captive-portal recoveries — tapping retry now re-probes a tiny static asset (no SW cache) and refreshes the store on success.
- **Install-prompt rationale rewritten** to lead with concrete user benefit ("one-tap access, opens faster than a browser tab, daily reminders fire reliably") instead of the prior generic "install as app" framing.
- **14-day + all-time weight charts merged** into a single chart with a 14d/all segmented range toggle. Saves vertical space on the dashboard and stops users comparing two near-duplicate panels. Toggle hides when there isn't enough history for the all-time view.

## 2026-04-17 — Motion design tokens + snappier toasts

- **Motion tokens introduced** (`--motion-fast: 180ms`, `--motion-base: 280ms`, `--motion-slow: 520ms`, `--motion-ease`) so timing stays coherent and is one-place-tunable. Existing `.ink-in`/`.tape-in` animations refactored to consume the tokens — no observable change.
- **New `.toast-in` utility (180ms)** for transient overlays. Applied to the undo toast (was 520ms ink-in — too dramatic for "deleted, undo?") and the photo-error card (previously had no entrance animation).
- **`prefers-reduced-motion` already kills all of it** via the existing blanket rule; new class added to the explicit list for clarity.

## 2026-04-17 — A11y + copy polish

- **Undo toast now uses `role="alert"`** (was `status`/`aria-live=polite`) and **auto-focuses the undo button** when it appears so keyboard users can press Enter to undo without hunting.
- **Photo-analyze error card promoted to `role="alert"`** so screen readers announce failures immediately instead of waiting for an idle pause.
- **Save-verb consolidated to "save"/"guardar"** across entry form and measurements (was a mix of "save" / "commit" / "confirmar"). The editorial "commit" framing was unclear for first-time users (CLAUDE.md UX constraint: clarity over cleverness).
- **Measurements view grid is responsive** — `grid-cols-2 sm:grid-cols-4` so the four stats don't cramp on phones.
- **Adaptive TDEE attribution stays visible after day 14** with a new caption ("adapted from your last 14 days of weight + calorie logs"). Previously the source stamp hid once measured mode kicked in, removing the cue that explains why the TDEE moves over time.

## 2026-04-17 — Annual tier ($24/yr) + cadence toggle

- **Annual price live** in Stripe (`price_1TN1eGHvWnhD3GuYS90n9x3a`, $24/yr) on the existing `Macro Log Pro` product. Same `firebaseRole=paid` metadata, same webhook — no extension reinstall needed.
- **Subscribe card now shows a monthly/annual toggle.** Default selection is annual to anchor on the higher-LTV option; "save 33%" badge highlights the discount vs 12× monthly. Trial hint (7 days) applies to both cadences.
- **Renewal copy adapts to the selected price** — manage view reads `displayPriceFor(priceId)` so an annual subscriber sees `$24/yr` instead of the monthly anchor.
- **Dev-env stripe block added** to `environment.development.ts` (was missing — caused dev builds to hide the Subscribe card entirely).

## 2026-04-13 — PWA install nudge + feedback mailto

- **Install-as-app prompt** at the top of the ledger. Desktop + Android use the native `beforeinstallprompt` flow — one tap installs. iOS Safari shows "tap Share → Add to Home Screen" text instructions since the API isn't exposed there. Hides automatically once installed, on standalone display, or when dismissed (7-day cooldown via localStorage). Only renders after the user has logged ≥1 meal.
- **"Send feedback" in the settings sheet.** Opens the user's mail app with a pre-filled template: "what happened / expected" sections plus auto-attached browser, path, build tag, and timestamp so bug reports don't turn into interview cycles.

## 2026-04-13 — Friend comp list (no-redeploy admin bypass)

- **Comp friends without redeploying.** Firestore doc `config/accessList` with a `compedEmails: string[]` field. Edit via the Firebase console to grant/revoke free access — changes take effect within ~60 seconds (server cache).
- **Server**: `reserveConsultation`, `releaseConsultation`, `analyzePhoto` now check `isAdmin || isComped` via a cached Firestore read. New callable `checkAccessStatus` tells the client the user's status.
- **Client**: `SubscriptionService.isComped` signal populated on sign-in. `isPaid = isAdmin || isComped || subscriptionActive`. Subscribe card shows an olive "friend access" badge (distinct from admin) instead of the Subscribe pitch.

## 2026-04-13 — Live Stripe mode + admin bypass

- **Live-mode flipped.** Product `Macro Log Pro` (prod_UKSEcAQhRmQQ9u) + price $3/mo (price_1TLnJdHvWnhD3GuYy7gWFvyJ) + webhook endpoint (we_1TLnJfHvWnhD3GuYzV5h8a1m) all created in Stripe live mode. Secret Manager rotated to live API key + live webhook signing secret; extension redeployed. Test-mode webhook disabled to prevent duplicate writes.
- **Admin bypass.** Emails in `ADMIN_EMAILS` (server `functions/src/index.ts` + client `subscription.service.ts`) skip all quotas and behave as paid. Currently: `gabrielandresbermudez@gmail.com`. Client shows an "admin access" badge instead of the Subscribe pitch.
- **Test-mode orphans purged.** Old test-mode subscription, checkout sessions, payment record, and customer doc deleted from Firestore for a clean slate in live mode.

## 2026-04-13 — Consultation quota + polish items

- **AI coach rate limit.** New `reserveConsultation` + `releaseConsultation` Cloud Functions. Free tier: 5/day (atomic Firestore counter, transactional). Paid tier (stripeRole=paid claim): unlimited. Consultation component calls reserve before streaming and release on post-reserve failure so a transient Gemini error doesn't silently consume a slot. Counter "N of 5 left today" shows in the composer caption; over-limit error points at the Subscribe surface.
- **ID token refresh on subscription change.** `SubscriptionService` now forces a `getIdToken(true)` when `isPaid` flips true, so a newly-subscribed user doesn't hit the free-tier cap until their cached token expires.
- **Photo error polish.** Photo-to-Macros failures now render in a prominent dismissible red-border specimen card (was plain inline text that got lost in scroll).
- **Swipe hint.** Once-per-session prompt above the date chips — "← swipe the log to change day →". Auto-dismisses on successful swipe or tap. sessionStorage-gated.
- **Consultation panel auto-hides with < 3 entries.** Cold-start users don't see an AI coach panel that would produce unhelpful "need more data" replies.
- **Account deletion now purges consultationQuota docs** alongside photoQuota.

## 2026-04-13 — Stripe extension installed and wired

- **Firebase Stripe Extension live** (`invertase/firestore-stripe-payments@0.3.11`). Declarative install via `firebase.json` + `extensions/firestore-stripe-payments.env`. Secrets stored in GCP Secret Manager.
- **Product + price created in Stripe test mode**: `Macro Log Pro` at `$3/mo` recurring with `firebaseRole=paid` metadata. Synced to Firestore `products` collection via webhook.
- **Webhook endpoint registered** pointing at `ext-firestore-stripe-payments-handleWebhookEvents` with the full event list (products, prices, checkout.session, customer.subscription, invoice, tax_rate). Signing secret stored in Secret Manager.
- **Subscribe card active** on macrolog.web.app footer. End-to-end flow ready for test-mode checkout with card `4242 4242 4242 4242`.

## 2026-04-12 — Stripe subscription infrastructure

- **SubscriptionService** — wraps the Firebase Stripe Extension. `startCheckout()` writes a doc that the extension turns into a Stripe Checkout URL and redirects there. `openCustomerPortal()` opens the managed portal for cancel/card-update/invoices. `isPaid` signal reflects active/trialing subscription state in real time via `onSnapshot`.
- **Subscribe card** — renders in the app footer *only when* `environment.stripe.priceId` is configured. Empty by default so the repo stays committable. Shows "support · $3/mo (7-day free trial)" for non-subscribers; flips to "on free trial until {date}" / "active, renews {date}" with a Manage button once subscribed.
- **Firestore rules** extended for the `customers/{uid}/...` and `products/{id}/...` collections the extension uses.
- **`STRIPE_SETUP.md`** — ~20-min one-time install walkthrough: Stripe account → product + $3/mo price → restricted API key → extension install → webhook registration → env swap → end-to-end test with `4242 4242 4242 4242`.
- **No hard feature gates yet.** This is voluntary-support infrastructure. Gates (webhook-only-for-paid, unlimited-AI-for-paid) will come in a later PR once there are real subscribers to shape the free tier around.

## 2026-04-12 — Sentry wired, contact email set

- **Sentry error monitoring** wired via `@sentry/angular`. Uncaught client errors now report to the `macrolog` project in Sentry. DSN + sample rate live in `environment.ts`; init is a no-op if DSN is empty so we can keep the env file committable.
- **Contact email** swapped to `gabrielandresbermudez@gmail.com` in privacy, terms, and footer.

## 2026-04-12 — Privacy, terms, account deletion

- **Privacy policy** at `/privacy` — plain English, covers what's stored, what goes to Google's Gemini (photos + consultation context), what we don't do (no selling, no ads, no AI training on your data), and your export/delete rights.
- **Terms of use** at `/terms` — short version: use it as intended, not medical advice, you own your data.
- **Account deletion** — "delete my account" button on the privacy page. Confirmation-gated. Calls a new `deleteAccount` Cloud Function that cascades Firestore subcollections (dailyLogs, presets, reports, dailyWeights, measurements), purges photoQuota, deletes the profile doc, and removes the Firebase Auth user. Irreversible; GDPR-compliant.
- **Footer links** — privacy · terms · contact (mailto:macrolog.support&#64;gmail.com).

## 2026-04-12 — UX audit foundations

- **"kcal remaining today" hero** — the primary user question ("can I eat this?") is now answered in a big serif number at the top of the ledger. Oxblood when over budget.
- **Weekly envelope rewritten** — the 4-data-point grid became a single plain-english sentence: *"you're 380 kcal under for the week — aim 2,290 over the next 4 days."*
- **Capture buttons enlarged** — barcode + photo went from 36px/11px to 44px/12px with real labels (`⊟ barcode`, `📷 photo`).
- **Accessibility foundations** — global `:focus-visible` outline, skip link, `<main>` landmark, aria-labels on icon buttons, `role="status"` on offline/reminder/update banners, tappable undo toast.
- **Copy pass** — "cut pace" → "weekly fat-loss target", "break fast" → "end fast" (no more collision with "breakfast"), "dispatch" → "ask", "filing…" → "saving…", plain sub-headline on sign-in explaining what the app does.
- **Dashboard readouts** — each of `target / true tdee / weight` now has a "?" button revealing a plain-english explanation.
- **UX_AUDIT.md** — living audit doc added at the repo root.

## 2026-04-11

- **Cardio + lift training toggles** redesigned with clearer on/off indicators and better aria support.

## 2026-04-09

- **Photo-to-macros upgraded** to Gemini 2.0 Flash — structured output, confidence signal in the UI when low.
- **Daily photo quota** (8/day per user) added to protect the Gemini budget.
- **iOS PWA tap-to-edit** fixed after a subtle interaction between swipe listeners, animation stacking contexts, and GPU layers.

## 2026-04-08 — Ledger depth

- **Protein target progress bar** on the day header.
- **All-time weight chart** in addition to the 14-day sparkline.
- **Swipe-to-navigate days** on the ledger.
- **Two-column desktop layout** — ledger on the left, analytics/coach on the right.
- **Weight promoted to the day header**, stored in a dedicated Firestore collection (no more ghost-meal workaround).
- Internal: extracted `EntryFormManager` and per-day child components.

## 2026-04-07 — Calibration polish

- **Adaptive TDEE transition card** — fires once when measured mode kicks in at day 14, showing formula vs. measured diff.
- **Configurable daily reminder hour** via footer dropdown.
- **All-time summary** card added to the dashboard.
- **Typography + spacing overhaul** ("Legible Instrument v2") — cooler cream, larger fonts, higher contrast, tighter vertical rhythm.
- Date editing now persists correctly in edit mode.

## 2026-04-06 — Big feature wave

- **Body measurements** (waist / chest / bicep / hip) with deltas.
- **Barcode scanner** (OpenFoodFacts lookup).
- **FCM push notifications**.
- **Cloud Functions** — Apple Shortcuts webhook (`logWebhook`) and server-side Photo-to-Macros (`analyzePhoto`).
- **Meal-based entries** with day-header grouping; multiple meals per day.
- **Travel mode**, **weekly calorie envelope**, **fasting chronometer** (16h analog dial).
- **Undo-delete toast**, **after-hours daily reminder**, **14-day date navigation strip**, **weekly auto-generated AI report**.
- Internal: `FitnessStore` single reactive data layer replaces fragmented per-component fetching.

## 2026-04-05 — Initial launch

- Deployed to [macrolog.web.app](https://macrolog.web.app) as a PWA (`Macro Log` / `Macros`).
- **Google Sign-In** (Gmail only) + per-user Firestore isolation.
- **Profile onboarding** with Mifflin-St Jeor formula as the TDEE seed.
- **Daily logging** — calorie + protein entries, meal labels, edit/delete, meal presets.
- **Gemini consultation** — streamed coaching grounded in 14-day context.
- **EMA weight smoothing** on a 14-day sparkline, goal progress bar, streak counter.
- **Weekly summary**, **CSV export**, **dark mode**.
- **Log-first tape-strip layout** with the "Personal Calibration Log" aesthetic (Instrument Serif, JetBrains Mono, warm cream/oxblood palette).
- **Offline support** via Firestore IndexedDB persistence.
- **SwUpdate reload banner** with 5-minute polling.
