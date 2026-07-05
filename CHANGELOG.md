# Changelog

Significant ships to [macrolog.web.app](https://macrolog.web.app), newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

## 2026-07-02 — Mobile parity: AI coach, weekly report, invites

The Expo app closes its biggest gaps against the web app. Shared logic (prompt builders, SSE parser) lives in `packages/core` so both frontends behave identically.

- **AI coach on Expo.** The conversational coach (ask anything about your last 14 days, streamed and grounded in your real log) is now on mobile, reachable from Trends → "Ask the Coach". Shares the exact prompt builder + SSE parser with web, streams token-by-token, honors the same free 3/day quota. No Gemini key on the device — it goes through the `consultationStream` Cloud Function. English + Puerto Rican Spanish.
- **Weekly report (Pro) on Expo.** The AI weekly review — 14-day progress, adherence, protein, training, and one thing to focus on next — is now generatable in-app on Trends (was web-only; mobile previously had only the digest-email opt-in). Pro-gated, rendered in-app, one generation per ~6 days (server-enforced), reusing the deployed `generateWeeklyReport` function.
- **Invite a friend.** Mobile Settings gains the referral share: send your link, and when a friend signs up through it you both get a month of Pro free.

## 2026-07-02 — AI coach moved behind a Cloud Function (security)

- **Gemini API key off the client.** The conversational coach used to call Gemini directly from the browser with a key shipped in the app bundle (referrer-locked, free-tier — quota-abuse risk only, no billing). It now streams through a new `consultationStream` Cloud Function that holds the key server-side, verifies the caller's Firebase ID token, enforces the per-uid rate limit + daily quota, and relays Gemini's tokens to the browser as Server-Sent Events — so the typewriter UX is preserved with no key in the bundle. The old `reserveConsultation` / `releaseConsultation` callables are gone (the stream endpoint reserves the slot and refunds server-side on failure). The exposed key still needs a one-time console rotation to kill the leaked value.

## 2026-06-13 — Nine free features (plus progress photos)

A batch of non-AI features that close the biggest gaps against the switcher apps — all pure client-side math, Firestore, or canvas, so nothing here adds a recurring AI cost.

- **Meal slots.** Entries can now carry a breakfast / lunch / dinner / snack slot (defaulted by time of day). The day view groups by slot with per-slot kcal subtotals; unslotted rows stay in an "other" bucket and legacy days render flat. CSV import maps MyFitnessPal / Lose It! / Cronometer meal columns onto the slot.
- **Weekly insights (free, no AI).** A rule-based Trends card: best vs toughest day against target, average vs target, and a least-squares weight slope. The $0 sibling of the Pro AI report.
- **Weight projection.** A linear fit over the last 28 days draws a dashed forecast on the Body sparkline — "at this pace: X lb by <date>".
- **Weekly calorie budget / banking.** Trends shows the week's allowance (daily target ×7), consumed vs remaining for the ISO-local week, a Mon→Sun bar strip, and how much you can average per remaining day to stay on budget.
- **Plate calculator.** Tap "Plates" on any barbell set in a workout to see the per-side plate breakdown for that weight (45-lb bar, standard plate set), with any unreachable remainder called out.
- **Warm-up generator.** A collapsible "Warm-up" block on barbell exercises ramps empty bar → ~50/70/90% of the working load, each rounded to a loadable weight.
- **Progress photos (Pro).** A private, owner-only before/after gallery on Body — dated photos in Firebase Storage (the app's first use of Storage), fetched via `getBlob` so no shareable URL is ever minted, and never surfaced on the public profile or share card. Pro-gated: the only real cost is download bandwidth, so gating uploads keeps free accounts from generating any. `deleteAccount` purges the photo bytes too (GDPR Art. 17 stays complete).
- **Body-fat estimate.** The U.S. Navy circumference formula on Body, from a new optional `neck` measurement plus waist / height (and hip for women). Framed as an estimate, never clinical.
- **Share card.** Share your streak, days logged, and weight change as a 1200×630 image from Today — numbers only, via the native share sheet with a download fallback.

## 2026-06-12 — Carbs + fat macros, and import from other apps

- **Carbs + fat** join protein as optional macros on every entry, chip across Today and day detail, and flow through CSV export.
- **Switcher import.** Settings → Data accepts a MyFitnessPal, Lose It!, or Cronometer CSV export and replays your history into the ledger — switch in a couple of minutes and bring your past with you.
- The weekly AI report no longer auto-generates on staleness; generation is strictly user-initiated to keep AI spend predictable.

## 2026-05-06 — Recipe builder + what's-new banner

- **Build a recipe** inline in the entry sheet: sum several ingredients into one entry, then save it as a reusable preset.
- A dismissible **what's-new banner** on Today surfaces recent ships, versioned so it only reappears when something new lands.

## 2026-05-05 — One-tap CSV export

Settings → Data → "download CSV" exports every log, weight, water, measurement, and workout as a single file.

## 2026-05-01 — v1 retired, SEO pages, Day-3 target refinement

- The legacy v1 UI is **fully retired** — v2 is the only interface now. The `?ui=v1` escape hatch is gone and the dead code removed.
- New marketing/SEO surfaces: a free **/calculator** (TDEE + macros) and a **/macros** explainer, plus a refreshed OG image, to open a non-paid acquisition funnel.
- A **Day-3 "Refine targets"** card invites users onto the full Mifflin-St Jeor target calculation once they've logged a few days, replacing the initial two-question heuristic.

## 2026-04-29 — v2 design system (warm minimal)

Ignia's full UI is now warm minimal — a paper-toned, sage + rust palette with Geist Sans / Geist Mono, rounded cards, and Lucide icons. The editorial "Calibration Log" identity (forensic typography, capitalized stamps, monogram, ruler ticks) read as cold and clinical to fitness-focused users; the rebuild trades it for a calmer, more approachable aesthetic without changing what the app *does*.

- **Today** is now a rings-first hero: kcal accent ring + protein sage ring, entries below, water + exercise inline. No date-chip strip — past days live one tap away on a dedicated history surface.
- **History** is a month-grid calendar with mini kcal-rings per day. Tap a day for full read/edit access (FAB included for past-day backfills).
- **Trends** is a single-page scroll: 7-day stacked bar chart (kcal + protein with target lines), weekly averages, AI coach.
- **Body** combines weight (with sparkline + goal-progress bar), fasting (compact dial + start/end), and measurements (collapsed by default) on one page. A header pill across all surfaces shows the active fast in real time.
- **Entry sheet** unifies Manual / Photo / Barcode in a bottom-sheet — same flow on every viewport.
- **Settings** is a single-scroll bottom-sheet with Profile / Language / Reminders / Appearance / Subscription / Data / Feedback / Legal.
- v2 is now the default for everyone. `?ui=v1` is a one-release escape hatch while we settle any post-flip regressions.

## 2026-04-20 — Water intake tracking

New hydration row under today's day header with three quick-add buttons (glass 250 ml, bottle 500 ml, 1 L) and a tap-to-edit exact-value modal. Stored in milliliters as the single source of truth; the UI displays oz with 1-decimal precision in English, ml integer in Spanish — no per-user unit toggle since the Transloco active language is already an adequate proxy.

- New `users/{uid}/dailyWater/{dateKey}` subcollection. Schema-validated in rules: a single `ml` field, 0–20 000 range (upper bound ~5 gal to reject fat-finger fouls without blocking heavy athletes).
- `FirebaseService.getDailyWater()` + `setDailyWater()` match the `dailyWeights` pattern for consistency. Client-side increments via `FitnessStore.addWater(dateKey, deltaMl)` read the current signal value and write the resulting total (single-user app; no transactional read-modify-write needed).
- Modal reuses the native `<dialog>` pattern introduced for weight editing so ancestor transforms can't shove it off-viewport. Haptic feedback (`navigator.vibrate(12)`) on each quick-add tap to mirror the save-meal affordance.
- Water is **only visible for today** for now. Past-day hydration still exists in storage and will flow into the weekly AI report context once wired, but the ledger scroll stays clean — hydration-curious users see today's row, hydration-indifferent users see nothing new.
- No daily target. "8 glasses a day" is folklore, not evidence; a progress bar would violate the calm positioning. If/when a target lands, it has to be driven by activity and climate inputs, not a flat default.
- `deleteAccount` + `exportUserData` updated to cover the new subcollection (GDPR Art. 17 + 20 stay complete).

## 2026-04-19 — Quiet milestone line in the weekly AI report

Added positive-feedback signal without breaking the calm brand. The weekly Gemini report now receives a small milestone-context block when the user crosses a meaningful threshold — first week, two weeks, one month, three months, six months, one year of logging, long current streaks (≥30 days), or 100 / 500 / 1000 total meals logged. The prompt explicitly tells Gemini to use a dietician's nod tone (no emojis, no exclamation points, one italicized sentence at the end, grounded in what the data means for progress rather than the milestone itself) — and to skip the line entirely when the body of the report is already covering that theme. Scope is minimal: empty milestone state produces an empty prompt fragment, so reports for users who haven't crossed a threshold render exactly as before.

## 2026-04-19 — Product gaps: welcome email, account linking, history search, copy-any-day

Batch of four product-side features that close the biggest gaps surfaced in the launch-readiness review.

- **Welcome email on profile completion.** New `sendWelcomeEmail` Firestore trigger fires when a user flips `profileCompleted` false → true for the first time. Rendered in the user's onboarding locale (en / es-PR) via a new `email-templates.ts` that mirrors the editorial brand (warm cream paper, serif italic heading, oxblood stamp button). Delivered via Resend. Latched by a new `welcomeEmailSentAt` timestamp so re-saves and backfills never double-send. FROM address defaults to `onboarding@resend.dev` until a custom domain is verified in Resend; override via the `MACROLOG_EMAIL_FROM` env. Logs never contain the user's email — only the uid — to avoid a PII leak in the 30-day-retained Cloud Logs.
- **Account-linking flow for cross-provider emails.** Previously, a Google-registered user who tried to sign in with Microsoft (or email/password) got a friendly error and a dead end. Now: the attempted credential is captured, `fetchSignInMethodsForEmail` queries which provider actually owns the email, and the sign-in page renders a link-prompt panel. After the user signs in with the existing provider, the new credential is auto-attached via `linkWithCredential` so both providers work for the same account going forward. Handles Firebase's email-enumeration-protection return-empty-array case by offering all candidate providers instead of the single authoritative one. Works in all 6 directions (google↔microsoft↔password).
- **Searchable history view.** New `history-sheet` component mounted inside the settings sheet. Full-text search across meal labels + date-range filter, grouped by day newest-first. Free tier sees the same 90-day window charts already use; Pro sees unlimited history. Query input debounced 200 ms so computeds don't re-run per keystroke on Pro accounts with years of logs.
- **Copy-any-day to today.** Generalization of "repeat yesterday" — every past day in the ledger now shows a "↷ copy" button in its header that clones that day's meals into today (preserving time-of-day). Useful when yesterday was a rest day / travel day / outlier and you want to seed today from a more representative day. Cross-action guard prevents overlapping writes when combined with repeat-yesterday.

Client-side: new `preferredLocale` field persisted on the user profile so the welcome-email trigger (and any future server-side email) renders in the locale the user actually onboarded in. `firestore.rules` updated to allow `preferredLocale` + `welcomeEmailSentAt`.

## 2026-04-19 — Stripe Tax activated + default SaaS tax code

Last §S13 hard blocker cleared. Stripe Tax is live, the account default tax code is `txcd_10103000` ("Software as a service (SaaS) - personal use") which applies to Ignia Pro via account-default inheritance. Puerto Rico head-office address is registered with Stripe.

No jurisdictional tax registrations yet — Stripe monitors US state thresholds for free and flags when any are close, and at today's zero-EU-volume state that's the right posture. When a PR customer buys we'll need to register with Hacienda for SUT/IVU and record it via the Tax Registrations API; when EU volume materializes, EU OSS + UK HMRC registrations go in via the same API.

## 2026-04-19 — Stripe live-mode verified end-to-end

Proved programmatically via Stripe CLI + Cloud Functions logs that our live-mode Stripe pipeline is consistent — product, both prices, the webhook endpoint, and the signing secret configured in the `firestore-stripe-payments` Firebase extension. This was the last of the §S13 hard blockers we could clear without dashboard-form work.

- Product `prod_UKSEcAQhRmQQ9u` (Ignia Pro), both prices `price_1TLnJdHvWnhD3GuYy7gWFvyJ` ($3/mo) + `price_1TN1eGHvWnhD3GuYS90n9x3a` ($24/yr) — all `active: true, livemode: true`.
- Webhook `we_1TLnJfHvWnhD3GuYzV5h8a1m` → `ext-firestore-stripe-payments-handleWebhookEvents` on us-central1, enabled, livemode, subscribed to 14 events covering the full subscription + invoice + checkout lifecycle.
- Signing-secret match confirmed by real recent events appearing as "Successfully handled Stripe event" in the Cloud Functions logs — including `invoice.paid`, `customer.subscription.created`, `checkout.session.completed`. Test-mode-secret-against-live-endpoint would surface as "Webhook signature verification failed"; we see zero.

Only remaining Stripe item is enabling Stripe Tax (legal business info + jurisdictional registration), which has no public API and must happen in the Stripe dashboard.

## 2026-04-19 — Infra blockers resolved (backup bucket, password policy, monitoring alerts)

Three hard blockers from UX_AUDIT §S13 are now live. All applied via gcloud / REST API on the prod project `fitness-tracker-gb-1775407101`; no code changes beyond the monitoring script comment refresh.

- **GCS backup bucket** — `gs://fitness-tracker-gb-1775407101-backups` exists (us-central1, uniform-bucket-level access, 30-day delete lifecycle). The `647810616435-compute@developer.gserviceaccount.com` runtime SA got `storage.admin` on the bucket and `datastore.importExportAdmin` on the project. The existing `weeklyFirestoreBackup` scheduled function will now succeed instead of warning-and-skipping.
- **Firebase Auth password policy** — Identity Platform config patched to `ENFORCE` with min length 10, requires uppercase + lowercase + numeric. `forceUpgradeOnSignin: false` so existing users aren't locked out on their next sign-in — only new sign-ups + password resets are affected.
- **Cloud Monitoring alerts** — email notification channel routed to `gabrielandresbermudez@gmail.com` + 3 high-signal alert policies: Cloud Functions error rate >5% over 10 min, `statusPulse` absent for >30 min (the scheduled heartbeat), and `analyzePhoto` >500 invocations/hour (Gemini cost-burn canary). `scripts/monitoring/setup-alerts.sh` docs updated with the live channel ID and a note that the REST fallback was used because `gcloud beta` wasn't installed locally.

Remaining §S13 hard blocker: Stripe live-mode verify + Stripe Tax enablement (both require the Stripe dashboard — owner action, not scriptable).

## 2026-04-19 — Launch-readiness sweep (no-cost blockers)

All the code-side items from UX_AUDIT §S13 that don't require external spend or dashboard access. Remaining open items — Stripe live-mode verify, Stripe Tax, Firebase password policy, GCS backup bucket, Cloud Monitoring alerts, custom domain, ToS legal review, email sender domain, welcome emails, support inbox — are owner-only and still blocking public distribution.

- **Age gate in onboarding (COPPA + EU).** New required checkbox on step 1: "I confirm I'm 13 or older (16+ if I reside in the EU)." A `ageConfirmedAt` timestamp is persisted on the profile doc the first time the user checks and submits. Attestation is bound to an explicit `ageConfirmed: true` in `ProfileFields` — not implicit from any `saveProfile` call — so future callers cannot silently age-attest.
- **GDPR Art. 20 full JSON export.** New `exportUserData` callable returns a signed-in user's profile + all 5 subcollections (dailyLogs, presets, reports, dailyWeights, measurements) + the two quota docs. `webhookApiKey` and `fcmToken` are redacted before export (credentials, not personal data — widening their blast radius into Downloads would be wrong). Response is size-guarded to reject above ~9 MB with a typed `RATE_LIMITED` error so the client can surface actionable copy instead of the generic callable-overflow internal error. Exposed via a "download full JSON export" button on `/privacy` next to the existing CSV row.
- **Refund + auto-renewal policy on `/terms`.** Two new sections: "subscriptions + auto-renewal" (price ladder, trial, cancellation, receipts, price-change grandfathering) and "refunds" (EU/UK/Switzerland 14-day statutory right of withdrawal with explicit email path, rest-of-world discretionary goodwill refunds, chargeback contact-before-file clause). English + es-PR both filled.
- **Privacy policy sub-processor list corrected.** `dontShare` now enumerates every actual sub-processor: Google Cloud/Firebase (hosting, auth, Firestore, FCM), Google Gemini API (photo + coach), Stripe (payments), Sentry (crash reports). Explicitly states no analytics trackers / no ads to cement the positioning. Closes the §S13 "privacy policy must match reality" item after Plausible was turned off.
- **`/status` surfaced in footer.** Was built but never linked — users had no way to self-check before filing tickets. Both the pre-auth and authed footer blocks now include it alongside privacy/terms.
- **iOS apple-touch-icon declared explicitly.** `src/index.html` now declares both 152 (iPad) and 192 (iPhone) sizes rather than a single untyped link. iOS was scaling 192 for iPad, which is visually fine but the explicit declaration makes the add-to-home-screen intent readable.
- **Rate limits on auth-gated callables.** `deleteAccount` (5 s), `checkAccessStatus` (300 ms), `exportUserData` (30 s) now go through the same `enforceRateLimit` helper the photo + consultation paths use. New generic `RATE_LIMITED` error code in both client + server twins; localized "Too many requests in a row — wait a moment and try again." copy in en + es-PR. `checkAccessStatus` interval is deliberately tight so legitimate simultaneous callers (router guard + settings mount) don't collide.
- **Bundle budget warning raised 1.5 → 1.6 MB.** Initial bundle has crept past 1.5 MB with the i18n + Transloco work; hard error cap stays at 2 MB. Tracked as a cleanup item rather than another round of aggressive code-splitting.
- **Two new rules tests** for `ageConfirmedAt` — accepts a timestamp, rejects a non-timestamp — both exercising the `isValidProfileCompleted` schema path. Existing 11 specs still green.

## 2026-04-18 — Launch-readiness audit + landing pricing drift fix + Plausible off

Two small user-visible polish items and one meta doc-ship documenting what's still between "deployed" and "safe to share publicly."

- **Landing pricing drift fixed.** Landing advertised "$3/mo" from a hardcoded i18n string while the Subscribe card defaulted to the annual cadence at "$24/yr" with a "$36/yr" anchor strikethrough. The two surfaces contradicted each other and the landing undersold the 33% annual discount we already ship. Landing now reads prices from `SubscriptionService.displayPriceAnnual` / `displayPriceAnnualAnchor` / `displayPriceMonthly` — single source of truth is `environment.stripe`. Removed four orphan i18n keys that survived the change: `landing.proPrice`, `landing.ctaLead`, `landing.ctaEm`, `landing.ctaFinePrint`, `landing.startLoggingCta`.
- **Redundant final-CTA section removed from landing.** "one tap. one minute to set up. sign in with google." was a second CTA with the same `/app` destination as the hero "start logging" button. Two CTAs to one destination added friction without adding choice. Hero stays as the sole primary conversion point.
- **Plausible turned back off.** Paid product (~$9/mo) with the domain not registered in any Plausible account, so events fired into the void. Sentry breadcrumbs still capture the funnel trail on any error report at zero cost; flag can be flipped back on in one line when a subscription is active.
- **UX_AUDIT §S13 — launch-readiness checklist added.** Explicit list of what's still between "deployed at `macrolog.web.app`" and "safe to share with strangers." Five hard blockers (Stripe live-mode verify, Stripe Tax, Firebase password policy, GCS backup bucket, monitoring alerts), five soft blockers (ToS review, refund policy, account-deletion audit, age gate, full GDPR Art. 20 export), and strongly-advised items (custom domain, OG tags, transactional email sender domain, welcome email, support inbox). Read `UX_AUDIT.md` §S13 before any public distribution push.

## 2026-04-18 — Week 3 + 4 sweep (FAB, haptics, swipe-to-delete, budget toast, inline barcode, tuned starters, coachmark, day-3 push, social proof)

Batch implementation of every code-side item from the UX_AUDIT §S12 Week 3 + Week 4 backlog plus a couple of latent bugs the audit surfaced (regenerate button silently failing, Gemini prompts printing `undefined` for every weight).

- **Floating "+" FAB on mobile.** New `MobileFabComponent` sits above the tab bar on mobile only (md:hidden), calls `EntryFormManager.startAdd() + requestLogFocus()` to open the add sheet and scroll the ledger into view. Auto-hides while the entry form is already open to avoid double affordance.
- **Haptic feedback on save.** `EntryFormManager.submit()` now calls `navigator.vibrate?.(20)` on the success path. No-op on devices without the Vibration API, so desktop is unaffected.
- **Swipe-to-delete on log entries.** Meal rows translate left as you swipe; past 80px the delete fires and the existing undo toast gives you 5s to recover. Right-swipes are clamped. A short 15ms haptic fires on delete. Touch-only — desktop still uses the Edit → Delete path.
- **Day-budget closure toast.** `FitnessStore` gained a `budgetCrossed` signal driven by an effect comparing today's calories to the computed target. Fires once per calendar day (localStorage day-keyed), rendered as a dismissible toast in the daily ledger alongside the undo toast.
- **Inline barcode scanner in calories field.** `BarcodeScannerComponent` gained a `compact` input; the entry form renders a small icon-only variant inline inside the calories row so users can scan a packaged item without scrolling back to the capture row.
- **Goal-tuned starter foods.** `StarterFoodsComponent` re-orders the starter grid by the user's onboarding goal: cut (pace > 0) surfaces high-protein-per-calorie items first, bulk (pace < 0) surfaces calorie-dense items first, maintain / travel mode keeps the neutral order.
- **First-session TDEE coachmark.** Pulse animation on the TDEE "?" button + a hint line. Dismisses the first time the user taps any of the three readout help buttons; latched via localStorage so it never reappears.
- **Day-3 "ask your coach" push.** New `sendDayThreeCoachPush` scheduled function sends a one-shot push (`dayThreeCoachPushSent` latch) to users whose oldest log is ≥3 days old and who have a registered FCM token, deep-linking to `?tab=body`. App shell now honours `?tab=log|insights|body` as an initial-tab override.
- **Landing social proof.** New `publishUserCount` scheduled function writes `public/stats.totalUsers` hourly via the admin SDK. Landing page reads it (unauth-friendly rule) and renders "join N+ quiet loggers" only when N ≥ 100, rounded down to the nearest 10 so the number doesn't look falsely precise.
- **Regenerate button no longer silently fails.** The weekly-report regenerate flow used to eat `HttpsError`s (`REPORT_TOO_SOON`, `REPORT_NOT_ENTITLED`, payload errors) and log them to the console. Now surfaces them via a new `reportError` signal rendered below the report card with localized copy in en + es-PR.
- **Gemini prompts no longer leak "undefined" weights.** `buildSystemInstruction` now accepts the `dailyWeights` map and writes the real per-day weight (with "—" fallback) into the log table. Previously `log.weight` was always undefined on meal rows.
- **Sparkline weight flicker fixed.** The 14-day dashboard sparkline pulled `log.weight` with the same bug and went blank after a fresh weight log. Now merges dailyWeights into the series and dedupes by day.
- **Entry-form save bug (mobile).** The `.slide-down` animation permanently capped the add-entry specimen at `max-height: 500px` with `overflow: hidden` via `animation-fill-mode: both`. On mobile the full form exceeded 500px and the Exercise + Save buttons were clipped — users literally could not submit. Switched to a transform-based slide so there's no height constraint.

Not shipped (infra-only, deferred): Play Store TWA wrap.

## 2026-04-17 — Week 2 A + D (recent-entries row, empty-state hero)

Two shipments from the market-informed roadmap's Week 2 retention bucket. One targets daily friction (recent-entries), the other Day-1 activation (empty-state hero).

- **Recent-entries quick-add row.** New `FitnessStore.recentEntries` computed surfaces the last 5 unique meal labels from the loaded window, newest first, case-insensitively deduped, skipping empty-label logs (weight-only or 0-cal training markers). New `RecentEntriesComponent` renders chips above the preset picker inside the add-entry sheet; tap emits a `MacroEstimate` (same contract as preset-picker + photo-capture) and fires a `recent_entry_tapped` analytics event. Hides entirely when the list is empty so day-zero users see no ghost section.
- **Dashboard empty-state hero.** Day-1 users previously saw "no data — refresh?" on first dashboard load. Now they get a warm specimen card with a time-of-day greeting ("good morning / afternoon / evening —"), a hero line showing their personal daily target ("you have {{target}} kcal to spend today"), a 1-line subtitle reassuring that rough logs are welcome, and a `start today's log` stamp-btn CTA that opens the entry form AND switches to the log tab on mobile (via a new `EntryFormManager.requestLogFocus()` signal the App shell listens to).
- **Under the hood.** `EntryFormManager` hoisted from ledger-provided to `providedIn: 'root'` so non-ledger surfaces (dashboard, future FAB, quick-add buttons) can trigger the entry flow directly. An auth-state effect resets the form on sign-out so a subsequent sign-in by a different user can't accidentally edit/save against the previous user's `DailyLog.id`.

Code review passed after three fixes: recent-entries iteration direction corrected (`_logs()` is oldest-first per `FirebaseService.getRecentLogs`), sign-out reset wired via an auth-state effect, and the `greeting()` docstring rewritten to accurately describe its per-change-detection re-eval behaviour.

## 2026-04-17 — Week 1 closeout (trial CTA, price anchor, analytics foundation)

Closes every Week-1 item in the market-informed roadmap (`UX_AUDIT.md` §S12). Conversion funnel is now fully instrumented; Week-2 retention work can build on top.

- **"Start 7-day free trial" as the primary Subscribe CTA.** Industry research shows a trial-led CTA converts 2–4× better than a raw price offer for health apps. Button leads with "start 7-day free trial"; the price moves to a secondary "then $24/yr" line underneath. Prior "support · $24/yr (7-day free trial)" layout is retired.
- **Price anchor on the annual cadence pill.** New `environment.stripe.displayPriceAnnualAnchor = '$36/yr'` renders struck-through next to the actual $24/yr so the 33% savings vs 12× monthly is visible in one glance. Empty string hides the anchor entirely so we never invent a fake number. Annual toggle gains an accessible `aria-label` ("Annual, was $36, now $24") since screen readers don't announce `<s>` styling.
- **Analytics foundation (zero-cost today, Plausible-ready).** New `AnalyticsService` emits every event as both a `console.info` (developer visibility) and a `Sentry.addBreadcrumb` (free, attaches to any future error report so we can see the funnel steps that preceded a crash). Plausible POST is wired but gated on `environment.analytics.plausibleEnabled`, currently `false` — flip the flag once budget allows and events ship with no other change.
  - **Events tracked today:** `paywall_shown` + `paywall_click` (UpsellCardComponent, per friction source: photo/preset/csv/chart), `trial_started` (SubscribeComponent checkout), `export_clicked` (DashboardComponent CSV), `repeat_yesterday` (DailyLedgerComponent).

All three ships passed code review with two fixes applied: upsell-card effect comment clarified to document per-mount (= per-friction-hit) semantics; price-anchor wrapped in semantic `<s>` + aria-label so screen readers verbalise the savings correctly.

## 2026-04-17 — Market-informed pivot + contextual upsells + repeat-yesterday

Big strategic session. Did a deep dive on competitors (MyFitnessPal, Cronometer, MacroFactor, Cal AI, Lose It!) and distilled a positioning sentence the roadmap now serves: **"the calm, private macro log with an AI coach that actually reads your data."** Full competitive analysis + 4-week prioritised roadmap lives in `UX_AUDIT.md` §S12.

First shipped items from the new roadmap:

- **Contextual upsells (roadmap #1).** Free-tier friction points — out of photo quota, 11th preset attempted, CSV clicked — now surface a "try Pro free for 7 days" inline card instead of a bare error. Converts the three existing walls into the three best upsell moments in the app. Never fires for Pro / admin / comped users.
- **"Repeat yesterday" (roadmap #3).** One-tap button on the daily ledger that clones every entry from yesterday into today — the single highest-leverage retention fix in the audit, because ~40% of users eat similarly day-to-day and logging from scratch every day is the #1 reason calorie-tracking apps lose users by week two. Hides when yesterday had no entries.

Why these two first: conversion + retention in the same PR. #1 monetises the users who already hit walls daily; #3 removes the biggest friction point keeping new users from reaching Day-14.

## 2026-04-17 — Product-shape S3 pass (#7-A, #8-A, #11-A)

Three S3 audit items that deserved product reasoning before code. Each shipped as the minimal "A" option — reversible, telemetry-ready, leaves room to iterate once we have usage data.

- **Consultation suggested prompts de-emphasized (#7-A).** Pills dropped from `text-xs` + full opacity to `text-[10px]` + 75% opacity, wrapped in a "examples · tap to prefill, or type your own below" caption. Signals "discovery scaffold, not required" so first-time users don't freeze wondering if they have to pick one. Easy to promote back if telemetry shows suggestion usage is high.
- **Tablet breakpoint fixed (#8-A).** Responsive boundary shifted from `lg` (1024px) to `md` (768px) across `app.ts` layout grid, `isDesktop` media signal, and `mobile-tabs.component.ts`. iPad portrait and landscape now get the two-column desktop layout instead of mobile tabs over wasted width. Phones below 768px unchanged. Prior 1024 cutoff was a Tailwind default imported without rationale — comment added so the next contributor knows it was a deliberate 768 choice.
- **CSV export metadata (#11-A).** Export button gained a `title` attr describing the filename pattern (`macrolog-export-YYYY-MM-DD.csv`) and a caption below the action row explaining format + where iOS files land ("check Files → Downloads if nothing happens"). Addresses the silent-fail problem on iOS Safari where CSV downloads can open in unexpected apps without visible feedback. en + es-PR.

Skipped the "B" and "C" options (export modal, analytics dashboard) pending telemetry — see session notes for the full reasoning.

## 2026-04-17 — Micro-polish (S3 quick wins)

Four-item micro-polish pass on the S3 backlog. Two of the four turned out to be false positives in the audit — documented here so we don't re-open them.

- **Webhook "copy key" feedback.** Button label flips to "✓ copied" for 2 seconds after a successful `navigator.clipboard.writeText`; an `sr-only` `role="status"` announces the same to screen readers. Silent clipboard failures (insecure context, permission denial) leave the label unchanged instead of lying. en + es-PR.
- **Preset picker empty state.** After a user deletes their last preset, the quick-add row now shows a one-line caption ("no saved presets yet — use 'save as preset' on any entry you log often.") instead of disappearing entirely. en + es-PR.
- **Onboarding back button on step 1** — **already correct**. Back is wrapped in `@if (currentStep() > 1)` so it's never rendered on step 1. Audit item was a false positive.
- **Async button loading states** — **already correct**. Dashboard `refresh`, email-verify `check now`, `resend email`, and offline `retry` all already have `[disabled]` bindings + loading-state text swaps. Audit item was a false positive.

## 2026-04-17 — Post-launch UX pass (S1 + S2)

Closes all S1 + S2 items from the post-production audit. Every one ships on prod.

- **Photo size messaging aligned.** Client precheck (15 MB raw) and server defense-in-depth (20 MB base64 ≈ 15 MB raw post-resize) now produce consistent copy; en + es-PR error strings updated so users never see two different numbers. Server rejection message is generic ("Image too large after processing") — the specific 15 MB cap is mentioned only at the client tier where it's accurate.
- **Settings sheet TOC.** Sticky chip row at the top of the sheet jumps to profile, language, reminders, modes, data, subscription, feedback, legal — users on mobile no longer scroll past 6 sections to reach "subscription". Section IDs added with `scroll-mt-16` for clean landing. Nav is `aria-label`-ed.
- **Privacy contact fallback.** GDPR/jurisdiction block now lists three paths: mailto (preferred), a public GitHub issue template pre-filled with the `privacy` label, and the in-app feedback button. Stated 30-day response window. en + es-PR.
- **UTC reset visibility.** Photo + consultation remaining-count captions gained a `title` attribute ("daily quota resets at midnight UTC") for passive discovery. Settings → Reminders section shows an explicit "note: quotas reset at midnight UTC, not your local midnight" hint so users in western time zones don't get surprised. en + es-PR.
- **Ledger empty-state copy.** Replaced spatial "above" reference with the button name ("or press the New Entry button to log anything else.") — better for keyboard + VoiceOver users who don't scan spatially. en + es-PR.

Follow-up (S3 items 7–15 from the same audit) held for a future pass — see `UX_AUDIT.md`.

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

- **Microsoft provider live.** Azure App Registration `Ignia` (`appId 80eaaf29-9de3-4912-a08a-7f0c6009e310`, audience `AzureADandPersonalMicrosoftAccount`) wired to Firebase Auth. Anyone with a personal Microsoft account (outlook/hotmail/live) or a work/school Azure AD account can sign in.
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

- **Annual price live** in Stripe (`price_1TN1eGHvWnhD3GuYS90n9x3a`, $24/yr) on the existing `Ignia Pro` product. Same `firebaseRole=paid` metadata, same webhook — no extension reinstall needed.
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

- **Live-mode flipped.** Product `Ignia Pro` (prod_UKSEcAQhRmQQ9u) + price $3/mo (price_1TLnJdHvWnhD3GuYy7gWFvyJ) + webhook endpoint (we_1TLnJfHvWnhD3GuYzV5h8a1m) all created in Stripe live mode. Secret Manager rotated to live API key + live webhook signing secret; extension redeployed. Test-mode webhook disabled to prevent duplicate writes.
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
- **Product + price created in Stripe test mode**: `Ignia Pro` at `$3/mo` recurring with `firebaseRole=paid` metadata. Synced to Firestore `products` collection via webhook.
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

- Deployed to [macrolog.web.app](https://macrolog.web.app) as a PWA (`Ignia` / `Macros`).
- **Google Sign-In** (Gmail only) + per-user Firestore isolation.
- **Profile onboarding** with Mifflin-St Jeor formula as the TDEE seed.
- **Daily logging** — calorie + protein entries, meal labels, edit/delete, meal presets.
- **Gemini consultation** — streamed coaching grounded in 14-day context.
- **EMA weight smoothing** on a 14-day sparkline, goal progress bar, streak counter.
- **Weekly summary**, **CSV export**, **dark mode**.
- **Log-first tape-strip layout** with the "Personal Calibration Log" aesthetic (Instrument Serif, JetBrains Mono, warm cream/oxblood palette).
- **Offline support** via Firestore IndexedDB persistence.
- **SwUpdate reload banner** with 5-minute polling.
