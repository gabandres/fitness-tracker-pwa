# Changelog

Significant ships to [macrolog.web.app](https://macrolog.web.app), newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

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
