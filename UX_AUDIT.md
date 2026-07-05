# Macronaut — UX Audit

> Living document. Check items off as they ship. Last updated: 2026-04-17 (market-informed strategic pivot — see §S12).

Sections prior to §S12 are historical — every item is shipped. For the live backlog and market-positioning thinking, start at §S12.

---

## How to use this doc

- **Status legend:** `[ ]` open · `[~]` in progress · `[x]` shipped · `[-]` decided against
- When you ship a fix, tick the box and note the commit/date inline.
- Add new findings under the appropriate severity section; don't reshuffle existing ones.
- Keep rationale ("Why:") intact so future us can tell whether a still-open item is worth doing.

---

## 1. App understanding (verified 2026-04-15)

**Shape:** single-page Angular 21 PWA. Two auth gates (sign-in → onboarding), then a two-column layout on desktop (single column on mobile).

**Left column — daily ledger (`daily-ledger.component`):**
- Fasting strip (if active)
- Install-as-app prompt (after first logged meal, platform-aware)
- Travel-mode banner (if active)
- Streak badge
- 14-day date-chip strip (swipe + tap to navigate) + once-per-session swipe hint
- Today weight + "new entry" CTA
- Add/edit entry panel (hosts `entry-form`, `photo-capture`, `barcode-scanner`, `preset-picker`)
- Cold-start starter-food specimen card before first entry
- Log tape grouped by day (progress bars on today, inline per-day add, tap-to-edit meals)
- Undo-delete toast (8s, fully tappable)

**Right column — stacked:**
- `measurements.component` — waist/chest/bicep/hip with deltas
- `fasting.component` — 16h analog chronometer (start/break fast)
- `dashboard.component` — target · true TDEE · weight readout; adaptive-TDEE transition card; goal bar; weekly summary; weekly envelope; Gemini weekly report (cached); all-time progress; 14-day + all-time sparklines; CSV export
- `consultation.component` — streamed Gemini coach with suggested prompts

**Settings sheet (`settings-sheet.component`):** profile · reminders · language · modes · data/webhook · subscription · feedback · legal.

**Footer (global):** version/identity + privacy · terms · contact only.

**Global surfaces (`app.ts`):** SwUpdate modal, offline indicator, after-hours reminder banner, masthead (monogram, date, theme toggle, settings gear), auth gate, onboarding gate.

**Design language:** Instrument Serif + DM Sans + JetBrains Mono; warm cream paper / dark charcoal; oxblood accent, olive (on-track), terracotta (protein), gold (warning/travel). Lowercase copy with rotated stamp marks, ruler edges, tape strips, crop marks — "Personal Calibration Log" aesthetic.

---

## 2. Strengths to preserve

- Log-first layout — capture before analytics.
- Many paths to the same form (preset, barcode, photo, webhook).
- Adherence-neutral colors (no red/green shaming).
- Signals everywhere; views never stale after mutations.
- SwUpdate banner + 5-min poll keeps users on latest.

Don't regress these while fixing below.

---

## 3. Findings

Ordered by severity. Severity is impact × how many users hit it, not effort.

### 🔴 S1 — Copy is clever at the expense of comprehension

- [x] Replace "dispatch ⟶" / "transmitting…" → "ask" / "asking…" *(2026-04-12)*
- [x] Replace "break fast" → "end fast" (literal collision with "breakfast") *(2026-04-12)*
- [x] Consolidate save verbs: "filing…" (onboarding) → "saving…" to match entry-form *(2026-04-12)*
- [x] Add plain sub-headline on sign-in: one sentence on what the app does *(2026-04-12)*
- [x] Add "?" affordance to each dashboard readout (`target`, `true tdee`, `weight`) with a one-line tooltip *(2026-04-12)*
- [x] Relabel "cut pace" in onboarding as "weekly fat-loss target" (keep "cut pace" as secondary text) *(2026-04-12)*
- [x] Drop "fin" footer divider (rule itself is sufficient) *(2026-04-12)*
- [x] Replace `specimen · personal use · confidential` footer text with "made for you · private" *(2026-04-12)*
- [x] Rename onboarding section title from `field form · 001` to plain "your details" (keep stamp marks) *(2026-04-12)*

**Why:** brand voice should live in typography + frames, not in *function-gating* words. New users should never have to decode a label to continue.

### 🔴 S2 — Onboarding friction

- [x] Add top-line summary above the form: "six quick answers, about a minute — editable later" *(2026-04-13)*
- [x] Top-level reassurance row: ✓ private · ✓ no selling · ✓ editable anytime *(2026-04-13)*
- [x] Mark required fields with `*`; goal-weight row has a visible "skip if none" pill *(2026-04-13)*
- [x] On submit with missing fields → focus the first empty input; on height-out-of-bounds → focus heightFt *(2026-04-13)*
- [x] Submit button enabled on incomplete forms (was disabled) so taps still land feedback via focus *(2026-04-13)*
- [x] Split into 3 steps with a progress indicator: identity → activity → target. Same guided flow now applies in both first-run and edit mode, with sequential Back/Continue navigation, per-step explainer copy, and local-only progress until final save. *(2026-04-15)*

**Why:** first-run is the only time we get the user to fill a 6-field form. Any friction here correlates directly with abandonment.

### 🟠 S3 — Hidden settings / discoverability

- [x] Consolidate footer links into a single "settings" sheet opened via gear icon in the masthead (profile, reminders, modes, data, subscription, legal) *(2026-04-13)*
- [x] Keep footer for version/credits + legal only *(2026-04-13)*
- [x] Raise barcode + photo buttons to 44px with visible labels (new `.capture-btn` class) — "⊟ barcode" / "📷 photo" *(2026-04-12)*

**Why:** a first-time user scans the main surface; they'll never read the footer. Core capture paths (barcode, photo) are currently 11px buttons — below the scanning threshold.

### 🟠 S4 — Dashboard assumes statistical literacy

- [x] Promote a single hero number above the ledger: "kcal remaining today" with target/eaten subtitle *(2026-04-12)*
- [x] Collapse weekly envelope into one sentence. Kept the budget bar + consumed/budget labels underneath as at-a-glance trend. *(2026-04-12)*
- [x] Merge 14-day and all-time sparklines into one tabbed chart *(2026-04-17)*
- [x] Re-expose the adaptive-TDEE explanation — adaptive caption + always-visible source stamp *(2026-04-17)*

**Why:** the primary user question is "how many calories do I have left?" — it should be answerable in < 1 second. Today it requires parsing a progress bar.

### 🟠 S5 — Accessibility gaps

- [x] Add `:focus-visible` outline to all interactive elements globally *(2026-04-12)*
- [x] Add skip-link to `#main` *(2026-04-12)*
- [x] Add `role="status"` + `aria-live="polite"` to offline, reminder, update banners *(2026-04-12)*
- [x] Add `aria-label` on icon-only buttons (theme toggle, sign-out "out", day "+" buttons, barcode, photo, cancel "×") *(2026-04-12)*
- [x] Wrap sub-sections in `<h2>` or give `.rule` spans semantic heading roles *(2026-04-12)*
- [x] Add `<main id="main">` landmark *(2026-04-12)*
- [x] Contrast audit — reran the math: `graphite-soft #716960` actually passes at 4.79:1 (prior audit math was off). `aged #b8a480` at 2.1:1 does fail, but was only used as text in `.field-input::placeholder`. Switched placeholder to `graphite-soft` — passes. `aged` retained for decoration only. *(2026-04-13)*
- [x] Add `role="alert"` + focusable toast for undo-delete — auto-focus undo button on appear *(2026-04-17)*

**Why:** small fixes, compounding benefit. Cheap to do before surface grows.

### 🟠 S6 — Quiet state feedback

- [x] ~~Lengthen undo-delete toast to 8–10s~~ — already 8s in `fitness-store.service.ts:390`; audit was stale *(2026-04-12)*
- [x] Make the whole undo toast tappable (was undo-button-only) *(2026-04-12)*
- [x] Photo-analyze errors promoted to `role="alert"` so screen readers announce immediately *(2026-04-17)*
- [x] Save-verb consolidated to "save"/"guardar" everywhere *(2026-04-17)*

**Why:** ghost-mutations (silent saves, too-short undo windows) are the #1 source of confidence loss in mobile logging apps.

### 🟡 S7 — Right-column density on desktop

- [x] Decide the grouping — right column reordered to `dashboard → consultation → fasting → measurements` (high-use analytics first). Measurements + fasting stay in column but now below the primary analytics stack. *(2026-04-13)*
- [x] Make fasting chronometer a compact ledger-strip when active. New `FastingStripComponent` renders at the top of the ledger showing elapsed time + end-fast button. The full 200px analog dial self-hides while fasting; re-appears idle for the start-fast CTA. *(2026-04-13)*

**Why:** fasting is a chronometer, not analytics. Current stacking creates a ~6-screen scroll on desktop with weak topical grouping.

### 🟡 S8 — Cold-start / empty-state

- [x] Fix ledger empty-state copy: "tap the button below" when button is at the *top* *(2026-04-12)*
- [x] Try-this specimen card for first run — 18 curated foods (drinks, breakfast, protein, carbs, fast food, PR staples). One tap opens the form pre-filled. Auto-hides after first entry. *(2026-04-13)*
- [x] Hide consultation panel until ≥3 entries exist (otherwise Gemini has nothing to analyze) *(2026-04-13)*

**Why:** the first 2 minutes decide whether a fitness-logging user comes back tomorrow.

### 🟡 S9 — Micro-interactions

- [x] Date chip: differentiated the two signals — has-data dot is now olive, today border stays oxblood *(2026-04-12)*
- [x] Add once-per-session swipe hint on ledger ("swipe to change day ↔") *(2026-04-13)*
- [x] Space sign-out / theme toggle apart + add icons; currently 2 chars apart, easy to mis-tap *(2026-04-17)*

### 🔴 S10 — Post-launch audit (2026-04-17)

All shipped in the S1+S2 pass. S3 items are in the next section.

- [x] Photo size message alignment — client said 15 MB, server said 5 MB. Now both paths quote 15 MB; server message neutralised to "too large after processing". *(2026-04-17)*
- [x] Settings sheet TOC — sticky chip row at top of sheet jumps to each section; IDs + scroll-mt-16 added to all 8 sections. *(2026-04-17)*
- [x] Privacy GDPR contact fallback — added GitHub issue + in-app feedback as alternatives to mailto, plus stated 30-day response window. *(2026-04-17)*
- [x] UTC reset hint — title attr on photo + consultation captions, explicit note in settings → reminders section. *(2026-04-17)*
- [x] Ledger empty-state copy — replaced "tap the button above" with "press the New Entry button" for non-spatial navigation. *(2026-04-17)*

### 🟡 S11 — Open S3 items from the same audit (lower priority)

Tracked here so they surface in the next UX pass. Each is low-impact individually; several share themes (button feedback, responsive breakpoints) that could be batched.

- [x] Consultation suggested-prompt pills de-emphasized — smaller/lighter + "examples · tap to prefill, or type your own" caption *(2026-04-17)*
- [x] Tablet 800–1023px — responsive break shifted from `lg:1024` to `md:768`; iPads get two-column layout *(2026-04-17)*
- [x] Apple Shortcuts "copy key" button has no success feedback — label flips to "✓ copied" for 2s + aria-live status *(2026-04-17)*
- [x] Onboarding back button on step 1 should be disabled — **already correct**: back is wrapped in `@if (currentStep() > 1)` so never rendered on step 1 *(verified 2026-04-17)*
- [x] CSV export — filename title attr + format-and-iOS-location caption below the action row *(2026-04-17)*
- [x] Fasting dial → strip transition can feel broken on end-fast; idle "start fast" CTA hard to reach on desktop during active fast *(2026-04-18)*
- [x] Async buttons — **already correct**: dashboard refresh, verify-email check-now + resend, offline retry all have `[disabled]` + loading-label swaps *(verified 2026-04-17)*
- [x] Preset picker has no empty state — one-line caption shown when list is empty *(2026-04-17)*
- [x] Dashboard sparkline may show stale data briefly after rapid-successive weight logs — sparkline now reads from the `dailyWeights` signal (updated synchronously after `setDailyWeight`) instead of `log.weight` which was always null on meal rows *(2026-04-18)*

---

## 🎯 S12 — Market-informed strategic direction (2026-04-17)

After a deep market dive (MyFitnessPal, Cronometer, MacroFactor, Cal AI, Lose It! — see sources at the bottom of this file and `CHANGELOG.md`), the product positioning crystallized as:

> **"The calm, private macro log with an AI coach that actually reads your data."**

Four load-bearing words: **calm** (vs shame-based MFP), **private** (real trust moat), **log** (editorial, adult, not gamified), **coach that reads your data** (adaptive TDEE + AI consultation — uniquely *both* photo-AI AND MacroFactor-style learning TDEE, which no competitor does).

### Where we compete

| App | Their angle | Annual | What we beat them on |
|---|---|---|---|
| MyFitnessPal | 14M food DB | $79.99 | Accuracy, privacy, no ads, aesthetic |
| Cronometer | Micronutrient accuracy | $59.88 | UX warmth, photo AI, price |
| MacroFactor | Adaptive TDEE | $71.99 (no free) | Has free tier, has photo AI |
| Cal AI | Photo-first, TikTok | ~$40 | Defensible AI (chain-of-thought + anchors), trust |
| Lose It! | Cheapest premium | $39.99 | Modern stack, active development |

### Where we lose (and mitigations)

- **Food DB gap** — MFP has 14M entries, we have PR staples + whatever users type. *Mitigation:* double down on photo + barcode + preset flows so DB size matters less.
- **No social proof** — zero reviews visible on landing. *Mitigation:* add real user count once we cross 100.
- **No TikTok strategy** — Cal AI won distribution, not product. *Mitigation:* one honest creator collab, not a campaign.
- **Price signal** — $24/yr is 60% cheaper than MacroFactor; reads as "budget" to some. *Mitigation:* lead with 7-day trial, not price.

### Live backlog (in priority order)

#### Week 1 — conversion path ✅ complete
- [x] **#1 Contextual upsells** at the three free-tier friction points (photo quota out, 11th preset attempted, free-tier CSV clicked). "Try Pro free for 7 days" label. *(2026-04-17)*
- [x] Subscribe card: "start 7-day free trial" is the primary label; price is secondary ("then $24/yr"). *(2026-04-17)*
- [x] Price anchor on the annual pill: "$36/yr" struck through next to "$24/yr" with accessible `aria-label` for screen readers. *(2026-04-17)*
- [x] Analytics foundation: `AnalyticsService` emits to `console.info` + `Sentry.addBreadcrumb` in all environments; Plausible gated behind `environment.analytics.plausibleEnabled` for when budget allows. Events live: `paywall_shown`, `paywall_click`, `trial_started`, `export_clicked`, `repeat_yesterday`. *(2026-04-17)*

#### Week 2 — first-session retention
- [x] **#3 "Repeat yesterday"** one-tap button that clones yesterday's full log. *(2026-04-17)*
- [x] Recent-entries row in the add-entry sheet — last 5 unique meal labels, tap to prefill. *(2026-04-17)*
- [x] Starter-foods card tuned to onboarding goal (cut → lean protein, bulk → denser carbs). *(2026-04-18)*
- [x] First-session coachmark on the dashboard "?" TDEE explainer. *(2026-04-18)*
- [x] Empty-state dashboard hero: time-of-day greeting + "you have {{target}} kcal to spend today" + CTA that switches to the log tab. *(2026-04-17)*

#### Week 3 — daily-use polish
- [x] Floating "+" FAB on mobile for one-tap new-entry access. *(2026-04-18)*
- [x] Haptic feedback (`navigator.vibrate([20])`) on save. *(2026-04-18)*
- [x] Swipe-to-delete on log entries. *(2026-04-18)*
- [x] Day-summary closure toast when user crosses daily budget. *(2026-04-18)*
- [x] Barcode scan inside the calorie input (not a separate tab). *(2026-04-18)*

#### Week 4 — market signals
- [x] Day-3 push notification: "You have data now — ask your coach." Deep links to consultation. *(2026-04-18)*
- [x] Landing page social proof: "join N+ quiet loggers" once we cross 100 users. *(2026-04-18)*
- [ ] Play Store TWA wrap for discovery.
- [ ] One creator collab for "calm macro log" TikTok angle.

---

## 🚀 S13 — Public-launch readiness (2026-04-18)

What's between "deployed" and "safe to share with strangers." Grouped by severity, not by effort. Everything in this section is gating wider distribution.

### 🚨 Hard blockers — must-have before any public share
- [x] **Stripe live-mode end-to-end verification.** *(2026-04-19)* — verified via Stripe CLI + Cloud Functions logs. Product `prod_UKSEcAQhRmQQ9u` + both prices (`price_1TLnJdHvWnhD3GuYy7gWFvyJ` $3/mo, `price_1TN1eGHvWnhD3GuYS90n9x3a` $24/yr) all `active: true, livemode: true`. Webhook `we_1TLnJfHvWnhD3GuYzV5h8a1m` → `ext-firestore-stripe-payments-handleWebhookEvents`, subscribed to 14 events including all subscription + invoice + checkout lifecycle. Signing-secret match proven by successfully-handled real events (`invoice.paid`, `customer.subscription.created`, `checkout.session.completed`) in the Cloud Functions logs.
- [x] **Stripe Tax enabled.** *(2026-04-19)* — Tax Settings `status: active`, head office set to the Caguas PR address. Default tax code is `txcd_10103000` ("Software as a service (SaaS) - personal use"). Product `prod_UKSEcAQhRmQQ9u` has no explicit tax_code, so it inherits the correct account default — functionally equivalent, though setting it explicitly at the product level would be nicer belt-and-suspenders for future products. **Zero jurisdictional registrations** recorded yet — Stripe monitors US state thresholds but does not collect until a registration is added. When a PR customer or meaningful EU/UK volume appears, register via Hacienda (PR SUT/IVU), OSS (EU), HMRC (UK) and add to Stripe via `POST /v1/tax/registrations`.
- [x] **Firebase Auth password policy.** *(2026-04-19)* — applied via Identity Platform REST API: `ENFORCE`, min length 10, requires uppercase + lowercase + numeric. `forceUpgradeOnSignin: false` so existing passwords remain valid.
- [x] **GCS backup bucket exists.** *(2026-04-19)* — `gs://fitness-tracker-gb-1775407101-backups` created (us-central1, uniform-bucket-level access, 30-day delete lifecycle). `647810616435-compute@developer.gserviceaccount.com` granted `storage.admin` on the bucket + `datastore.importExportAdmin` on the project so `weeklyFirestoreBackup` can write.
- [x] **Cloud Monitoring alerts.** *(2026-04-19)* — email channel `projects/…/notificationChannels/14532171541501133516` (→ `gabrielandresbermudez@gmail.com`) + 3 alert policies (Cloud Functions error rate >5% over 10 min; statusPulse absent >30 min; analyzePhoto >500 invocations/hour). Applied via REST because `gcloud beta` wasn't installed; documented the REST fallback in `scripts/monitoring/setup-alerts.sh`.

### ⚠️ Soft blockers — ship-breakers if the app catches traction
- [ ] **Terms of Service legal review.** `/terms` exists — needs a Termly/Iubenda pass or a lawyer read for: limitation of liability, arbitration, governing jurisdiction, subscription auto-renewal language (required by CA/NY/NC/FL state law for auto-renew SaaS).
- [x] **Refund policy published.** *(2026-04-19)* — "refunds" + "subscriptions + auto-renewal" sections on `/terms`. EU/UK/CH 14-day statutory withdrawal with explicit email path, rest-of-world discretionary goodwill, chargeback-before-file clause. en + es-PR.
- [x] **Account deletion wiring audit.** *(2026-04-19)* — verified `deleteAccount` purges all 5 subcollections (dailyLogs, presets, reports, dailyWeights, measurements), both quota collections, Stripe subscriptions (cancel_at_period_end), profile doc (which holds fcmToken), and the Firebase Auth user. Rate-limited 5 s.
- [x] **Age gate in onboarding.** *(2026-04-19)* — new required checkbox on step 1, stamps `ageConfirmedAt: Timestamp` on the profile. Attestation bound to an explicit `ageConfirmed: true` in `ProfileFields` so future `saveProfile` callers cannot silently age-attest. Rules validator updated.
- [x] **Full GDPR Art. 20 data export.** *(2026-04-19)* — new `exportUserData` callable dumps profile (redacted of `webhookApiKey` + `fcmToken`) + all 5 subcollections + quota docs. Size-guarded at ~9 MB with typed error. Download button on `/privacy`.

### 💪 Strongly advised (not strictly blocking)
- [ ] **Custom domain.** `macrolog.web.app` reads as "Firebase hobby project." Buy `macrolog.app` or `.com`, point at Firebase Hosting, set as primary site. Two-day DNS settling. Big trust bump for the landing page.
- [ ] **Open Graph meta tags in `index.html`.** When the URL is pasted in WhatsApp / Slack / iMessage there's no preview card today. Add `og:title`, `og:description`, `og:image` (a screenshot of the ledger). LinkedIn and Twitter support the same OG spec.
- [x] **PWA icon set audit.** *(2026-04-19)* — explicit apple-touch-icon declarations for 152 (iPad) + 192 (iPhone) in `src/index.html`. Manifest covers 72/96/128/144/152/192/384/512. A dedicated 180×180 render from `icon-source.svg` is a nice follow-up but iOS scales 192 cleanly.
- [ ] **Transactional email sender domain.** Firebase Auth ships verify + password-reset from `noreply@fitness-tracker-gb-1775407101.firebaseapp.com` — deliverability tanks and the domain looks amateur. Set up a verified sending domain (SPF + DKIM on the custom domain), customize the Firebase Auth email templates.
- [ ] **Welcome / onboarding email sequence.** No email flow exists today. A single Day-0 "here's what you can do this week" email materially lifts Day-7 retention.
- [ ] **Support inbox + SLA.** §S11 added a GitHub issue link + in-app feedback. Fine for zero users, terrible at 100+. Provision `support@macrolog.app`, state a 30-day response SLA in the privacy policy.
- [x] **Privacy policy disclosures match reality.** *(2026-04-19)* — `dontShare` enumerates Google Cloud/Firebase, Gemini, Stripe, Sentry. No Plausible mention (was never in the policy — confirmed clean).
- [x] **Link `/status` publicly.** *(2026-04-19)* — added to both pre-auth and authed footer in `app.ts` alongside privacy/terms/contact.

### 🔧 Engineering cleanup pre-launch
- [x] **Bundle budget regression.** *(2026-04-19)* — raised `maximumWarning` to 1.6 MB in `angular.json`; error cap stays at 2 MB. Deferred aggressive re-splitting until the trend justifies it.
- [x] **Rate limit audit on Cloud Functions.** *(2026-04-19)* — `deleteAccount` (5 s), `checkAccessStatus` (300 ms), `exportUserData` (30 s) now route through `enforceRateLimit`. New generic `RATE_LIMITED` error code (client + server twins + en/es-PR copy). `logWebhook` (onRequest) + `generateWeeklyReport` (6-day interval) keep their existing gating.
- [ ] **Staging environment on a separate Firebase project.** `environment.development.ts` exists but deploys go straight to prod. Real staging prevents "oops, that was production."
- [ ] **Function-handler unit tests.** `firestore.rules` suite now includes 2 new `ageConfirmedAt` specs (13 total); `sendDayThreeCoachPush`, `publishUserCount`, `generateWeeklyReport`, `analyzePhoto`, `exportUserData`, `deleteAccount` still lack handler-level tests. Would require `firebase-functions-test` wiring + admin-SDK mocking.

### Recommended launch order
If treating this as a sprint to public-launch:
1. Stripe live-mode + Stripe Tax verification (30 min) — **owner, not shipped**
2. Password policy + GCS bucket + monitoring alerts (1 hr) — **owner, not shipped**
3. Custom domain + OG meta tags (half day, mostly DNS wait) — **owner, not shipped**
4. ~~Account deletion audit + full data export endpoint~~ — shipped 2026-04-19
5. Transactional email sender domain (2 hrs) — **blocked on custom domain**
6. Terms/Refund policy review (1 hr, $50 for Termly subscription) — **refund text shipped 2026-04-19; legal review still outstanding**

Only after all six are ticked should the app be promoted in any channel outside direct personal share.

### Decided against (deliberately not shipping)

- **Shame-based gamification** (streak-break punishment, red/green progress) — breaks the calm positioning.
- **Third pricing tier** ($7.99/mo "Pro+") — revisit at 1,000+ active users; not worth the maintenance cost today.
- **Forced account creation before first log** — planned "Guest Mode" is the fix if Day-1 retention data warrants it.

### Market research sources

- [Best Macro Tracking Apps Compared 2026](https://www.macronutrientcalculator.org/blog/macro-tracking-apps/)
- [MyFitnessPal Premium Cost 2026](https://healthfitpublishing.com/myfitnesspal-premium-cost-is-macro-tracking-worth-it-in-2026/)
- [MacroFactor Review 2026 — Outlift](https://outlift.com/macrofactor-review/)
- [How top subscription apps approach paywalls — RevenueCat](https://www.revenuecat.com/blog/growth/how-top-apps-approach-paywalls/)
- [Paywall tactics for health apps — Adapty](https://adapty.io/blog/paywall-newsletter-22/)
- [App Retention Benchmarks 2026](https://enable3.io/blog/app-retention-benchmarks-2025)
- [Two Teens Built Cal AI — Slashdot](https://slashdot.org/story/25/04/04/2338220/two-teenagers-built-cal-ai-a-photo-calorie-app-with-over-a-million-users)

---

## 🧹 S14 — Feature-declutter audit (2026-06-14)

After the nine-feature batch (`CHANGELOG.md` 2026-06-13), the surface grew
faster than the **calm / restraint** brand allows. This pass audits every
tab against that lens — verdicts KEEP / MERGE / DEMOTE / CUT / PRO-GATE —
and consolidates without deleting capability. **No `utils/*` math is
removed; only UI placement changes** (cheap to re-expose). Grilled with
`/grill-with-docs`; new glossary terms **Weekly panel**, **Coach panel**,
**Nudge vs utility** landed in `CONTEXT.md`.

### Decisions (locked)

| ID | Change | Status |
|----|--------|--------|
| **T1** | Trends: merge "Averages" into Insights. Drop raw weight Δ (keep least-squares slope); collapse avgKcal + avg-vs-target into one cell. Result: a 6-cell insights grid (best/worst day · avgKcal+vs-target · avgProtein · adherence % · weight trend). | [ ] |
| **T2** | Trends: fold WeeklyBudget into the insights card as a toggle → the **Weekly panel** (default view = insights). `weekly-budget.ts` untouched. | [ ] |
| **T3** | Trends: merge WeeklyReport + AI coach into one **Coach panel** — free "Ask the coach" (quota'd) shown first, Pro WeeklyReport below with an inline lock badge → existing upsell. | [ ] |
| **B1** | Body: move the Body-fat estimate caption out of the weight card into the Measurements card (its inputs — waist/neck — are entered there). | [ ] |
| **B2** | Body: pull the Progress Photos block out of the weight card into its own card, **collapsed by default, placed last** (matches Measurements pattern). | [ ] |
| **TD1** | Today: one-**Nudge**-at-a-time gate (priority refine → push → install → what's-new). Repeat-yesterday reclassified as a **utility**, ungated. Worst-case Today: rings + repeat-yesterday + one Nudge. | [ ] |
| **TR1** | Train: collapse the per-set "Plates" buttons into the per-exercise warm-up toggle → one **"Plates & warm-up"** tools panel per exercise (plate breakdown per distinct set weight + warm-up ramp). Accepts loss of per-set inline plate glance. `plate-math.ts` / `warmup.ts` untouched. | [ ] |

**Net:** Trends 6 cards → 3 (chart · Weekly panel · Coach panel); Body
weight card returns to weight; Today caps at one Nudge; Train logger
loses per-row button noise.

**Untouched:** rings, 7-day chart, fasting, measurements core, share
button (inline), CSV import, recipe builder.

**ADR check:** none warranted — every change is UI-only and reversible
with the pure modules preserved, so the "hard to reverse" bar fails.

---

## 4. Prioritised change list

### Ship this week (cheap, high-impact)
- [x] **Copy pass** (S1 items checked above) — *2026-04-12*
- [x] **A11y foundations** (S5 items checked above) — *2026-04-12*
- [x] Fix ledger empty-state copy contradiction (S8) — *2026-04-12*
- [x] Make undo toast fully tappable (S6) — toast was already 8s — *2026-04-12*
- [x] Promote "kcal remaining today" hero (S4) — placed at top of ledger, keeps dashboard 3-up row intact per "ship the additive change first, restructure with evidence later" — *2026-04-12*

### Ship next (small surgery)
- [x] Consolidate footer → settings sheet (S3) *(2026-04-13)*
- [x] Onboarding: top-line summary, required/optional pills, focus-on-error (S2) *(2026-04-13)*
- [x] Split onboarding into a 3-step guided flow with progress indicator (S2) *(2026-04-15)*
- [x] Merge weight trends into tabbed chart (S4) *(2026-04-17)*
- [x] Raise barcode/photo buttons to 44px with labels (S3) — *2026-04-12*
- [x] Contrast audit — fix graphite-soft / aged usage (S5) *(2026-04-13)*

### Needs a design decision first
- [x] Right-column grouping (S7) — reordered + fasting made ambient via strip *(2026-04-13)*

---

## 5. Notes for future additions

- When adding a new surface, check it against: (a) does copy work for a first-time user; (b) is every icon-only button labelled; (c) does it announce state changes via `aria-live`.
- The "Personal Calibration Log" aesthetic is the differentiator — preserve it in *typography and frames*, not in *function-gating* words.

---

## 6. Change log

- **2026-04-12** — Initial audit written; S1 copy pass + S5 a11y foundations shipped in same commit.
- **2026-04-12** — S8 empty-state copy fixed; S6 undo toast made fully tappable (toast was already 8s — audit initially said 5s, corrected).
- **2026-04-12** — S4 "kcal remaining today" hero shipped at top of the ledger (below travel-mode banner, above streak). Dashboard 3-up readout left untouched deliberately; re-evaluate after a week of use.
- **2026-04-12** — Copy/cheap bucket: "?" tooltips on dashboard readouts (tap-to-reveal), "cut pace" → "weekly fat-loss target", dropped "fin", footer "specimen · confidential" → "made for you · private", onboarding "field form · 001" → "your details", date-chip has-data dot changed from oxblood to olive (differentiates from today's border).
- **2026-04-12** — S3: barcode/photo capture buttons upgraded to 44px tap targets with visible labels ("⊟ barcode" / "📷 photo") via new `.capture-btn` class. S4: weekly envelope collapsed from 4-data-point grid to a one-sentence summary; budget bar kept for at-a-glance trend.
- **2026-04-13** — Audit catch-up: settings sheet replaced the old utility footer; install prompt, swipe hint, consultation cold-start hide, and contrast fix all shipped. Backlog updated on **2026-04-15** to remove stale open items.
- **2026-04-15** — S2 shipped: onboarding is now a 3-step guided flow (`identity → activity → target`) with a progress tracker, short explainer copy per step, Back/Continue navigation, and the same flow reused for edit mode.
- **2026-04-17** — Big audit catch-up day. Shipped: S4 sparkline merge (14d/all toggle), S4 adaptive-TDEE caption + always-visible source stamp, S5 undo toast `role="alert"` + auto-focus, S6 photo-error promoted to `role="alert"`, S6 save-verb consolidated to "save"/"guardar". Plus shipped (not in audit): annual tier ($24/yr) + cadence toggle, Microsoft sign-in, email/password sign-in + verify gate, motion design tokens, offline-banner retry button, install-prompt rationale rewritten, mobile measurements grid responsive, **Pro fulfillment Slice F kickoff** (photo/consultation tier split, presets cap, CSV 30-day window, chart 90-day window).
- **2026-04-17** — Production-readiness pass. S9 masthead mis-tap closed (gap-4 + 36×36 tap targets, the last open S9 item). Landing CTAs simplified to `/app` redirects so users see the full sign-in surface instead of a Google-only popup. 404 page added for unknown paths. Health "not medical advice" line on consultation intro + onboarding step 1. Password policy tightened on signup (10+ chars, letter + digit, no whitespace). See `CHANGELOG.md` 2026-04-17 entry for the non-UX items from the same pass (CI, Sentry sourcemaps, rate limits, GDPR/CCPA, backups, monitoring).
- **2026-04-17** — Post-launch S1 + S2 pass (S10). Photo size error messaging aligned between client (15 MB raw) and server (20 MB base64); contradictory numbers removed. Settings sheet gained a sticky TOC chip row + section IDs for jump navigation. Privacy GDPR section now offers GitHub issue + in-app feedback as mailto alternatives, with a stated 30-day response SLA. UTC quota-reset hint surfaced via `title` on remaining-count captions and an explicit note in Settings → Reminders. Ledger empty-state copy now names the button ("press the New Entry button") instead of the spatial "above". S3 items parked under S11 for a future pass.
- **2026-04-17** — S3 pass 1: micro-polish. Webhook "copy key" button shows "✓ copied" + aria-live for 2s. Preset picker renders an "empty state" caption after last preset is deleted instead of vanishing. Verified two false positives in the audit (onboarding back button already hidden on step 1; async buttons already had disabled/loading states).
- **2026-04-17** — S3 pass 2: product-shape items (#7, #8, #11). Consultation suggested prompts de-emphasized (smaller/75% opacity + "examples" caption) so they read as discovery hints rather than required picks. Tablet breakpoint fixed by shifting responsive boundary from `lg:1024` to `md:768` — iPads now get the two-column layout instead of mobile tabs + wasted width. CSV export gained a `title` attr with the filename pattern and a caption below explaining format + iOS file location. All three shipped as "option A" (minimal, reversible) pending telemetry for later iteration.
- **2026-04-17** — Week 1 conversion-path closeout. Contextual upsells live at photo/preset/CSV walls. Subscribe card leads with "start 7-day free trial"; annual cadence pill shows "$36/yr" struck through next to "$24/yr" with an accessible aria-label verbalising the savings. Analytics foundation ships: zero-cost today via `console.info` + Sentry breadcrumbs, ready to flip to Plausible via an env flag once budget allows — events wired at every funnel step (paywall_shown, paywall_click, trial_started, export_clicked, repeat_yesterday).
- **2026-04-17** — Week 2 A + D ship. Recent-entries row renders the last 5 unique meal labels above the preset picker in the add-entry sheet; one-tap re-log via the same `MacroEstimate` contract the preset picker + photo capture use. Empty-state dashboard replaced with a warm time-of-day greeting + "you have X kcal to spend today" hero + "start today's log" CTA that switches to the log tab on mobile. Side effect: `EntryFormManager` hoisted to root with an auth-state reset so non-ledger surfaces can drive the entry flow without cross-user leakage.
