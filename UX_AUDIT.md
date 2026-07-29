# Ignia — UX Audit

> Updated: 2026-07-29 — trimmed to open items; completed items are in git history and CHANGELOG.md

Living backlog of open UX/launch work for Ignia. Sections §S1–§S11 (the 2026-04 copy, a11y, onboarding, dashboard and post-launch passes) and the old §1/§3/§4/§6 narrative are fully shipped and have been removed — see git history and `CHANGELOG.md`. What remains: §2 (invariants to not regress), §S12 (positioning + remaining market items), §S13 (launch-readiness checklist, kept in full), §S14 (declutter decisions, none shipped yet) and §5 (checks for new surfaces). **Status legend:** `[ ]` open · `[~]` in progress · `[x]` shipped · `[-]` decided against. Tick the box and note the commit/date inline when you ship; keep each "Why:" intact.

---

## 2. Strengths to preserve

- Log-first layout — capture before analytics.
- Many paths to the same form (preset, barcode, photo, webhook).
- Adherence-neutral colors (no red/green shaming).
- Signals everywhere; views never stale after mutations.
- SwUpdate banner + 5-min poll keeps users on latest.

Don't regress these while fixing below.

---

## 🎯 S12 — Market-informed strategic direction (2026-04-17)

After a deep market dive (MyFitnessPal, Cronometer, MacroFactor, Cal AI, Lose It! — see the sources under §S13 and `CHANGELOG.md`), the product positioning crystallized as:

> **"The calm, private macro log with an AI coach that actually reads your data."**

Four load-bearing words: **calm** (vs shame-based MFP), **private** (real trust moat), **log** (editorial, adult, not gamified), **coach that reads your data** (adaptive TDEE + AI consultation — uniquely *both* photo-AI AND MacroFactor-style learning TDEE, which no competitor does).

### Live backlog (in priority order)

Weeks 1–3 (conversion path, first-session retention, daily-use polish) are complete; only Week 4 market-signal items remain.

#### Week 4 — market signals
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
- [x] **Custom domain.** Purchased **`ignia.fit`** (2026-07-05). Code URLs migrated macrolog.web.app→ignia.fit. Owner still to: connect `ignia.fit` as a custom domain on the `macrolog` hosting site (Firebase console + DNS, ~day to settle), update the Gemini client-key HTTP-referrer allow-list to include `https://ignia.fit`, and `gsutil cors set storage-cors.json` for the bucket.
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

## 5. Notes for future additions

- When adding a new surface, check it against: (a) does copy work for a first-time user; (b) is every icon-only button labelled; (c) does it announce state changes via `aria-live`.
- The "Personal Calibration Log" aesthetic is the differentiator — preserve it in *typography and frames*, not in *function-gating* words.
