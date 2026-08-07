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
- [x] **Open Graph meta tags in `index.html`.** *(verified live 2026-08-04)* — this item described a state that had already stopped being true, and was read as open work twice. The full set (`og:type/site_name/title/description/url/image` + dimensions + alt, `twitter:card` large-image) is in the shell, `og-image.png` serves 200 as `image/png`, and `scripts/prerender-seo.mjs` rewrites title/description/url/locale/image **per route across all 105 prerendered pages** — `/es/` gets Spanish copy and `es_PR`. Cards render. The only real gap found on inspection was `og:locale` missing from the EN homepage: the homepage is the one `<head>` the prerender deliberately does not touch (rewriting `index.html` would break the SPA fallback), so it never received the tag the other 104 pages got. Declared in the shell, `fa80d0e6`.
- [x] **PWA icon set audit.** *(2026-04-19)* — explicit apple-touch-icon declarations for 152 (iPad) + 192 (iPhone) in `src/index.html`. Manifest covers 72/96/128/144/152/192/384/512. A dedicated 180×180 render from `icon-source.svg` is a nice follow-up but iOS scales 192 cleanly.
- [x] **Transactional email sender domain.** *(2026-07-24, `6cf63df3`)* — the real fault was never the DNS records this item assumed: mail shipped from Resend's shared sandbox domain and password resets from Firebase's, so DMARC alignment was impossible whatever `ignia.fit` published. Both now send from our own domain, password reset is a first-class server-generated link rather than Firebase's default, and every message carries a real plain-text part.
- [x] **Welcome / onboarding email sequence.** *(2026-07-24, `6cf63df3`)* — Day-0 welcome email ships, bilingual. Note it was also corrected for over-promising: it advertised photo scanning, which is deferred to a paid tier (ADR-0015), so a new user's first email broke a promise in their first session. Any future addition to this sequence inherits that trap.
- [ ] **Support inbox + SLA.** §S11 added a GitHub issue link + in-app feedback. Fine for zero users, terrible at 100+. Provision `support@macrolog.app`, state a 30-day response SLA in the privacy policy.
- [x] **Privacy policy disclosures match reality.** *(2026-04-19)* — `dontShare` enumerates Google Cloud/Firebase, Gemini, Stripe, Sentry. No Plausible mention (was never in the policy — confirmed clean).
- [x] **Link `/status` publicly.** *(2026-04-19)* — added to both pre-auth and authed footer in `app.ts` alongside privacy/terms/contact.

### 🔧 Engineering cleanup pre-launch
- [x] **Bundle budget regression.** *(2026-04-19)* — raised `maximumWarning` to 1.6 MB in `angular.json`; error cap stays at 2 MB. Deferred aggressive re-splitting until the trend justifies it.
- [x] **Rate limit audit on Cloud Functions.** *(2026-04-19)* — `deleteAccount` (5 s), `checkAccessStatus` (300 ms), `exportUserData` (30 s) now route through `enforceRateLimit`. New generic `RATE_LIMITED` error code (client + server twins + en/es-PR copy). `logWebhook` (onRequest) + `generateWeeklyReport` (6-day interval) keep their existing gating.
- [ ] **Staging environment on a separate Firebase project.** `environment.development.ts` exists but deploys go straight to prod. Real staging prevents "oops, that was production."
- [ ] **Function-handler unit tests.** `firestore.rules` suite now includes 2 new `ageConfirmedAt` specs (13 total); `sendDayThreeCoachPush`, `publishUserCount`, `generateWeeklyReport`, `analyzePhoto`, `exportUserData`, `deleteAccount` still lack handler-level tests. Would require `firebase-functions-test` wiring + admin-SDK mocking.

### Recommended launch order

**Five of the original six are done** (2026-08-02 audit). The list below used to
say "owner, not shipped" for items ticked `[x]` two sections above it — it was
read as a to-do list months after the work landed, which is exactly how this repo
re-scopes finished work. What actually remains:

1. **Terms of Service legal review** — the only original item still open, and it
   is *not* urgent: the auto-renewal language it turns on applies to a paid tier,
   and Pro is flag-gated off (ADR-0015). Revisit when Pro does.
2. ~~**OG meta tags**~~ — **closed 2026-08-04, and it was never actually open.**
   The tags were live and per-route correct; the entry above records what was
   verified and the one genuine gap it turned up. This is the third time this
   file has listed finished work as pending — the check is one `curl`, and it
   costs less than the re-scope.

Shipped since this list was written: Stripe live-mode + Tax, password policy, GCS
backup bucket, monitoring alerts (all 2026-04-19); the custom domain `ignia.fit`;
and the transactional email sender domain, which is no longer "blocked on custom
domain" — `6cf63df3` rebuilt the templates and moved password reset onto our own
sender, and the welcome email ships with it.

**This section no longer gates distribution.** The app is live on the iOS App
Store and in review for Play closed testing; what gates wider promotion now is in
`STATUS.md`, not here.

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

## 🧭 S15 — Competitive roadmap backlog (2026-08-07)

Derived from `docs/research/competitive-feature-scan.md` by removing everything
that has since shipped. **Most of that scan's twelve candidates are closed** —
Health sync (both platforms, incl. Health Connect), home-screen widget, Watch
app + complication, recipe-URL import, adaptive TDEE (`packages/core/tdee-recalibration.ts`),
local nudges, streak + freeze, barcode, voice/NL logging, AI coach. Do not
re-scope those; check the file that owns each before believing this list.

Candidate 9 (photo-scan) **shipped 2026-08-07** — see ADR-0017 and `CHANGELOG.md`.
What remains, in the order it was prioritized with the owner:

### Approved in principle — next projects

- [ ] **N1 · Siri / App Intents + Android Quick Settings tile.** No code exists
      today (`grep` for `AppIntent`/`Siri` returns nothing in `apps/mobile`).
      "Hey Siri, log 40 grams of protein" → straight into `apps/mobile/src/lib/ledger.ts`.
      $0 runtime, native-only, and **nobody in the surveyed set does this well**
      — it is the cheapest genuine differentiator left. Drives logging friction
      toward ~2s, which is the variable retention actually turns on. Note this
      is native config: it **changes the EAS fingerprint**, so it needs real
      builds on both platforms, not an OTA.
- [x] **N2 · Bundle USDA as the food DB.** **SHIPPED 2026-08-07** — ADR-0018.
      13,272 foods (SR Legacy + FNDDS + Foundation, CC0) committed at
      `functions/data/usda-foods.json` and searched in memory, replacing the
      live FDC API: no key, no 1,000 req/hour ceiling, no upstream outage.
      Open Food Facts still serves branded/barcode. Wire contract unchanged, so
      it shipped functions-only with no client release. Retires
      `USDA_FDC_API_KEY` (8 → 7 active secret versions).
      **Still open — the half this does NOT do:** photo-scan continues to let
      the model emit macros directly. Wiring `analyzePhoto` to resolve its
      recognized items against this DB is what actually closes ADR-0015's split
      vision architecture, and it is now a small change rather than a blocked
      one. **N6 and N7 are unblocked by this.**

### Tier 2 — cheap and on-brand, unscheduled

- [ ] **N3 · Fasting Live Activity / Dynamic Island.** Extends the fasting timer
      already shipped free (Cronometer paywalls theirs at $59.99/yr). iOS-only,
      $0, pure lock-screen retention. Native → needs a build.
- [ ] **N4 · Interactive widget quick-add.** The widget renders today but is
      display-only; iOS 17+ `AppIntent` buttons and Android `RemoteViews`
      actions would let a preset be logged without opening the app. Small delta
      on infrastructure already shipped (`apps/mobile/WIDGET.md`). Pairs
      naturally with N1 — same App Intents work.
- [ ] **N5 · Guest mode / log-before-signup.** Already listed under §S13
      "Decided against" as the fix *if Day-1 retention warrants it*. Forced
      account creation before the first log is the standard freemium leak, and
      "no account needed" carries the privacy pitch better than any copy does.
      Revisit against real retention data, not intuition.

### Tier 3 — deliberately deferred, with the reason

- [ ] **N6 · Restaurant / chain-menu data.** A real table-stakes gap (MFP ships
      it free). Deferred because a bundled static dataset goes stale and a live
      API costs money — **do it after N2**, reusing that bundling mechanism.
- [ ] **N7 · Full micronutrient panel (80+).** Off the kcal+protein focus;
      Cronometer owns this niche. Cheap only if N2 lands first.
- [ ] **N8 · Social challenges / community.** **Not planned.** Needs a server
      plus moderation, conflicting with the cost discipline in `CLAUDE.md`, and
      gamified competition contradicts the "calm" positioning §S12 is built on.
      Recorded here so it stops being re-proposed, not because it is queued.

---

## 5. Notes for future additions

- When adding a new surface, check it against: (a) does copy work for a first-time user; (b) is every icon-only button labelled; (c) does it announce state changes via `aria-live`.
- The "Personal Calibration Log" aesthetic is the differentiator — preserve it in *typography and frames*, not in *function-gating* words.
