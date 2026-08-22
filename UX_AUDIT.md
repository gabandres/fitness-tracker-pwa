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
| **T1** | Trends: merge "Averages" into Insights. Drop raw weight Δ (keep least-squares slope); collapse avgKcal + avg-vs-target into one cell. Result: a 6-cell insights grid (best/worst day · avgKcal+vs-target · avgProtein · adherence % · weight trend). | [x] `c824b99d` 2026-06-14 — verified on screen 2026-08-12: the grid renders exactly those six cells |
| **T2** | Trends: fold WeeklyBudget into the insights card as a toggle → the **Weekly panel** (default view = insights). `weekly-budget.ts` untouched. | [x] `c824b99d` 2026-06-14 — the `panelView` toggle, default `insights` |
| **T3** | Trends: merge WeeklyReport + AI coach into one **Coach panel** — free "Ask the coach" (quota'd) shown first, Pro WeeklyReport below with an inline lock badge → existing upsell. | [x] `c824b99d` 2026-06-14 — Ask first, collapsible report below |
| **B1** | Body: move the Body-fat estimate caption out of the weight card into the Measurements card (its inputs — waist/neck — are entered there). | [x] **not open — verified 2026-08-12.** Body fat is its own standalone card between the weight hero and Measurements (`body.component.ts:137`). Solved differently from the wording, but the stated problem — it living in the weight card — has not been true for some time |
| **B2** | Body: pull the Progress Photos block out of the weight card into its own card, **collapsed by default, placed last** (matches Measurements pattern). | [-] **moot — verified 2026-08-12.** There is no Progress Photos block on the web Body page at all; the only match is marketing copy describing it as a Pro feature. Nothing to move |
| **TD1** | Today: one-**Nudge**-at-a-time gate (priority refine → push → install → what's-new). Repeat-yesterday reclassified as a **utility**, ungated. Worst-case Today: rings + repeat-yesterday + one Nudge. | [x] **web was already done; MOBILE shipped 2026-08-12.** Web has had `activeNudge()` since `c824b99d` (`today.component.ts:560`). Mobile could stack three — update banner, what's-new banner, recalibration card — above the rings. `useTodayNudge` is the mobile twin, priority update → recalibration → whatsNew, pinned by tests |
| **TR1** | Train: collapse the per-set "Plates" buttons into the per-exercise warm-up toggle → one **"Plates & warm-up"** tools panel per exercise (plate breakdown per distinct set weight + warm-up ramp). Accepts loss of per-set inline plate glance. `plate-math.ts` / `warmup.ts` untouched. | [x] **not open — verified 2026-08-12.** `session-sheet.component.ts:98` is literally "Plates & warm-up tools (barbell only) — one affordance per exercise", with the plate breakdown per distinct weight and the warm-up ramp inside it |

> **The four rows above were checked against the code on 2026-08-12, and three
> of them were already done.** That is the fifth time this table's empty boxes
> have been read as open work. The check took twenty minutes; the box is now
> ticked with the file and line that proves it, which is the only form of this
> row worth keeping. Only TD1 had anything left, and only on mobile.

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

- [x] **N1 · Siri / App Intents + Android Quick Settings tile.** **SHIPPED
      2026-08-07 — ADR-0020.** Android in **vc 18** (alpha): a Quick Settings tile
      that logs slot 1, labelled with the preset's name, writing through
      `ledger.ts` from a headless JS context — so Android needed no native write
      path at all. iOS in **build 27** (TestFlight): `AppShortcutsProvider` Siri
      phrases writing over the Firestore REST API with an ID token minted from a
      refresh token in the app's own Keychain.
      One correction to this entry's original wording: the promised phrase "log 40
      grams of protein" cannot be honoured as written, because `LogEntry.calories`
      is required and protein-only has no legal value to write — the intent takes
      calories and **prompts** for it when missing, which is one spoken question
      instead of a fabricated number. $0 runtime held: no function, no secret, no
      Firestore field, no rules change.
      **iOS shipped BROKEN in build 27 and was fixed in build 28** (2026-08-08).
      iOS silently refused to register the `AppShortcutsProvider`, because an App
      Shortcut may not carry a *required* parameter and one invalid shortcut
      invalidates the provider — so Ignia never appeared in the Shortcuts app and
      every phrase answered "I can't help with that". Nothing caught it: the build
      was clean and `Metadata.appintents` extracted perfectly into the binary. See
      the trap in `apps/mobile/AGENTS.md`.
      **iOS device QA: the starred Siri row PASSED on build 28** — Siri offered the
      presets and wrote a real row, so the whole REST path (Keychain, token
      exchange, `PATCH`, rules) is proven. **Build 29** adds spoken preset names
      ("log overnight oats in Ignia"); those phrases are unrun.
      **Android APP-UI QA is now automated** (2026-08-09): the Maestro regression
      suite walks 15 flows on an emulator, 15/15 green, and its e2e rows are
      verified against Firestore. **That does NOT close the widget rows** — the
      suite drives the app, and no `adb` command can place a home-screen widget,
      so the widget's own quick-add button stays unverified on Android. The
      Quick Settings tile IS drivable (`adb shell cmd statusbar click-tile`).
      Of the 21 checkboxes in `apps/mobile/WIDGET.md`, one is ticked.
- [x] **N2 · Bundle USDA as the food DB.** **SHIPPED 2026-08-07** — ADR-0018.
      13,272 foods (SR Legacy + FNDDS + Foundation, CC0) committed at
      `functions/data/usda-foods.json` and searched in memory, replacing the
      live FDC API: no key, no 1,000 req/hour ceiling, no upstream outage.
      Open Food Facts still serves branded/barcode. Wire contract unchanged, so
      it shipped functions-only with no client release. Makes
      `USDA_FDC_API_KEY` dead code — though **it is still BOUND to the deployed
      revisions and cannot simply be deleted**, and unbinding it takes 8 → 7
      active secret versions, which does **not** get under the free-tier cap of 6.
      Measured 2026-08-08: the doctor check stays red either way, so the saving is
      ~$0.06/mo and nothing else. `STATUS.md` §1 carries the two routes already
      tried and the one remaining.
      **N6 and N7 are unblocked by this.**
- [x] **N2b · Photo-scan resolves its macros against that DB.** **SHIPPED
      2026-08-07** — ADR-0019, and the half N2 deliberately left open. The vision
      model now returns a list of `{name, grams, state}` and
      `functions/src/photo-resolve.ts` looks each up, closing ADR-0015 §1's split
      vision architecture. The response is additive, so every already-installed
      binary got the grounded numbers on the functions deploy; the itemized
      review screen went out as an OTA. Also 2.9x faster (`thinkingBudget: 0`),
      and `scripts/smoke-photo-scan.mjs` now exists to check it end to end
      against prod, which nothing did before.

### Tier 2 — cheap and on-brand, unscheduled

- [x] **N4b · The wide quick-add face: 4×2 Android / `systemMedium` iOS.**
      **SHIPPED 2026-08-13** — iOS build 46 (`.systemMedium` + a purpose-built
      `HomeWideView`) and Android vc 30, off `ab19dd97`. Android's provider XML
      had `resizeMode` absent, which defaults to `none` — that alone was the
      "square only" limitation. **Device-verified**, and it took four builds:
      picking the rectangle crashed on a `ForEach` over colliding ids, the face
      rendered empty because no home face had ever drawn `Metric.progress`, and
      the chips were invisible on tinted Home Screens. Details in `STATUS.md` §1.
      Original entry follows.
      *(Was still unticked on 2026-08-15, three days after shipping and after
      being device-verified — the fourth time this file has listed finished work
      as pending.)* With up
      to 3 buttons instead of 1. Split out of N4 (above) so vc 18 and build 27
      each carried exactly one new native surface. Everything it needs already
      exists — `QUICK_ADD_MAX` is 3, the snapshot already carries up to 3 slots,
      and `performQuickAdd` already takes a slot index — so this is a layout plus
      an `app.json` widget-size declaration, **not** new plumbing. Native config,
      so it needs builds on both platforms. **Do not start it before the starred
      device-QA rows in `WIDGET.md` pass**: it widens a surface whose basic
      mechanism is still unverified.
      **Gate status 2026-08-08 — HALF OPEN.** The iOS starred row passed on build
      28, so the iOS half is clear. **Android's three starred rows remain unrun**,
      and Android's write path is a different mechanism entirely (headless JS
      through `ledger.ts` with `AsyncStorage` auth, not Swift + REST), so the iOS
      result says nothing about it. Since N4b widens *both* platforms, the gate is
      still shut — and build 27 is the standing argument for why it should be.
- [x] **N3 · Fasting Live Activity / Dynamic Island.** **SHIPPED 2026-08-08**
      in iOS build 30 (ADR-0021), and **verified on an iPhone 17 Pro simulator**
      the same day: `liveactivitiesd` logged the activity against
      `FastActivityAttributes`, the Dynamic Island rendered the flame with a
      counting timer, and ending the fast cleared it within seconds. Drawn
      on-device by `Text(timerInterval:)` — no APNs, no Cloud Function, no
      secret. **Still unverified: the 8-hour ceiling and its re-arm**, which
      needs nine real hours on hardware. Extends the fasting timer already
      shipped free (Cronometer paywalls theirs at $59.99/yr). iOS-only, $0,
      pure lock-screen retention.
- [x] **N4 · Interactive widget quick-add.** **SHIPPED 2026-08-07** — one
      quick-add button on the existing 2×2 Android face (vc 18) and on iOS
      `systemSmall` via `Button(intent:)` (build 27), ADR-0020. It paired with N1
      exactly as predicted: one shared `performQuickAdd`, one slot list, one
      Settings picker, one snapshot field.
      **One piece deliberately left:** the wider **4×2 / `systemMedium`
      three-button face**, moved to Tier 2 below rather than shipped alongside,
      because a widget's declared size is native config and `WIDGET.md`'s locked
      reasoning caps a binary at one untested native surface.
- [ ] **N5 · Guest mode / log-before-signup.** Already listed under §S13
      "Decided against" as the fix *if Day-1 retention warrants it*. Forced
      account creation before the first log is the standard freemium leak, and
      "no account needed" carries the privacy pitch better than any copy does.
      Revisit against real retention data, not intuition.

### Found by the Maestro regression suite, 2026-08-09 — small, unscheduled

Both surfaced from the suite's first-ever walk of these states. Neither is a
crash; both are "the app says nothing when it should say something", which is
the class of defect this project keeps paying for.

- [x] **The Coach quota is invisible until you spend one.** **FIXED
      2026-08-09.** `remaining`/`limit` were set only from the stream's
      `onMeta` inside `ask()`, so the chip could not render on a freshly-opened
      screen. Coach now reads the day's `consultationQuota` doc on mount:
      `firestore.rules` allows a client to read its OWN doc (ids are
      `<uid>_<day>`, so the uid prefix is the tenant key; writes stay denied),
      which costs one document read and **no new Cloud Function**. Rules
      deployed before the client shipped, with two tests covering the
      uid-scoping — including that a prefixing uid cannot slip through.
- [x] **A failed dictation start is indistinguishable from a dead mic.**
      **FIXED 2026-08-09.** `MicButton`'s `error` listener flipped `listening`
      back to false and surfaced nothing. It now shows `voice.failed` and
      points at typing — not at Settings, since that is the permission path,
      which already has its own message. Found on the emulator, which has no
      recognizer at all; on hardware one normally exists, which is why this
      path had never been seen.

### From a real user — Abdiel Medina, 2026-08-21 (unscheduled, not yet triaged)

Three items, reported in Spanish over chat against the live Android build.
Recorded verbatim in substance; nothing here is fixed yet.

- [x] **The speed dial stays open on top of the photo-scan result, blocking
      "Add today". FIXED and SHIPPED 2026-08-22 — Android OTA number 6 and iOS
      OTA number 5, both verified.** Reproduced
      on the LG VS988 first, and it was TWO defects, not one. (a) The label
      pill was a plain `View`, so it became the touch target and no ancestor
      was a responder: tapping the words "Scan meal" did nothing at all, while
      the same tap 90px right on the circle worked. (b) Hardware back on the
      scan screen navigated out from under the open dial and landed on Today
      with it still fanned open. `LogSpeedDial` now makes pill+circle one
      `Pressable`, takes back while open, and closes on any route change;
      `log-speed-dial-dismiss.test.tsx` pins all three (3 fail before the fix,
      3 pass after). The `06-scan-intro.yaml` workaround is deleted. His words: after the scan finishes and the food appears,
      *"se queda abierta la opcion de scan meal y manual entry por encima de la
      info"* — the Scan meal / Manual entry pills sit over the result and he
      expects them to dismiss on their own.

      **This is the SAME defect the Maestro suite hit the same day, and that
      matters.** `06-scan-intro`'s capture came out as the scan screen greyed
      under the dial's scrim, and it was written up in that flow as a
      test-harness artifact — "the fallback deep link lands with the dial still
      open." A real user hitting it on the review screen says otherwise: it is a
      **product bug**, and the flow's comment understates it. `LogSpeedDial` is
      rendered by the TAB LAYOUT, so it survives navigation; `choose()` closes it
      only when the satellite BUTTON is tapped, and a tap that lands on the label
      pill (or races the navigation) leaves it open over whatever comes next.
      Fix the component, not the flow — then simplify `06-scan-intro` back.

- [x] **No way to set a custom calorie goal. SHIPPED 2026-08-22.** An explicit
      `targetMode` (Automatic / Custom), editable numbers on the onboarding plan
      step, and a Settings → Daily targets editor. The premise turned out to
      understate it: `manualCaloriesTarget` already existed and was written at
      onboarding, but it was a **seed** — `dailyTargets` used it only until a
      measured estimate became reliable and then replaced it silently, so the
      complaint was not just "no input" but "the number I was given is not
      mine". Custom now beats measured, the estimator keeps running and is shown
      beside the user's number, and Refine no longer deletes what they typed.
      Verified on an LG VS988: the hero ring moved to a typed 2,000 against a
      measured 2,723, and switching back to Automatic left both stored values
      intact. **Decided against the plan's 1,200 input floor** — `dailyTargets`
      clamps at `calorieFloor` (1,500 default), so 1,300 would have been stored
      and 1,500 displayed, which is the same silent override in a new place.
      ORIGINAL REPORT: *"cuando vas a editar el goal de
      los kcal … los pone automatico, no se le puede añadir un custom mode que
      la persona misma pueda poner la cantidad que quiere?"* The target is
      computed and cannot be overridden with a number the user chooses. Worth
      weighing against the estimator work — a manual override competes with
      measured TDEE, so decide whether it pins the target, seeds it, or is a
      separate mode before building.

- [x] **No in-app feedback surface. SHIPPED 2026-08-22.** A composer at
      Settings → Send feedback, in its own section second from the top, plus a
      standing line on the What's-new card. Writes `users/{uid}/feedback/{id}`,
      create-only, and a Firestore trigger emails the owner. **One detail here
      was wrong and is worth keeping:** the note below says nothing in the app
      points at `/support`. Something did — Settings → Help, filed under
      **Legal** between Terms of Use and the medical disclaimer. That does not
      weaken the report, it sharpens it: the channel existed and was placed
      where nobody would find it, which is exactly the social-barrier point.
      Verified end to end from the device — a real send reached
      gabriel@bermudezsystems.com, confirmed `delivered` by the Resend API.
      ORIGINAL REPORT: *"por qué no le haces una parte de feedback
      in-app para que por shy te escriban sugerencias"* — his point is the
      social barrier, not the channel: people who would not message the owner
      directly would leave a note inside the app. Note this arrived by private
      chat, which is itself the evidence. `/support` exists on the web shell but
      nothing in the app points at it.

### From a second-hand report — "the app is not intuitive for women", 2026-08-22 (walkthrough findings, NOT the user's words)

**There is no verbatim report, and that is the first thing to fix.** What
reached this repo is one sentence, relayed: *the app is not intuitive for
women*. Not known: who said it, how many people, which platform, which screen,
or what "not intuitive" meant concretely. It is **not** in the in-app feedback
system — the `feedback` collection group holds two documents, one QA row and
one water report, both already handled. So nothing below is a user's words, and
none of it should be shipped as if it were.

The owner confirmed on 2026-08-22 that the one sentence is all that exists.
What follows instead is a **structured first-run walkthrough** on the LG VS988
(Android 9, 360×720 dp) against Play-signed vc 37 plus the current OTA, read
against the source. These are findings a fresh pair of eyes hits; they are
**candidate explanations**, not a diagnosis of the report.

**Ask for the actual words before building any of this.** The precedent is
Abdiel's calorie-goal item directly above: the paraphrase said "no custom
option", the real defect was that the number *was* settable and then silently
overwritten. A summary that has passed through two people is the weakest
evidence in this file.

- [ ] **F1 · The first number the app gives you is body weight × a constant,
      and that constant is biased by sex. This is the strongest finding here
      and it is arithmetic, not opinion.** Onboarding's plan step calls
      `computeKcal(weightLb, goal)` — `packages/core/src/macro-heuristic.ts:46`
      — which is `weight × {11 lose | 14 maintain | 17 gain}`. No sex, no
      height, no age, no activity level. Compared against the app's *own*
      Mifflin-St Jeor path (`basalMifflinStJeor`, `packages/core/src/tdee.ts:981`)
      at the "Lightly active" 1.375 bucket:

      | Person (same weight, same age, same activity) | Real maintenance | App "maintain" | App "lose" → actual rate |
      |---|---|---|---|
      | Woman, 150 lb, 30 | 1,894 | 2,100 (**+11%**) | 1,650 → 0.49 lb/wk |
      | Man, 150 lb, 30 | 2,240 | 2,100 (−6%) | 1,650 → 1.18 lb/wk |
      | Woman, 180 lb, 45 | 1,978 | 2,520 (**+27%**) | 1,980 → **−0.00 lb/wk** |
      | Man, 180 lb, 45 | 2,324 | 2,520 (+8%) | 1,980 → 0.69 lb/wk |

      Heights are the CDC/NCHS **measured** NHANES means for US adults 20+,
      Aug 2021–Aug 2023 — 5'8.9" male, 5'3.5" female — so the only things
      varying between the paired rows are sex and average height, the two
      inputs `computeKcal` does not take. Every constant used is the app's own:
      the 1.375 "light" bucket from `ACTIVITY_MULTIPLIERS` (`tdee.ts:226`) and
      `KCAL_PER_POUND = 3500` (`tdee.ts:147`).

      Same app, same weight, same age, same goal: the man loses at **2.4×** the
      woman's rate. The bottom row is the one that matters — for a 180 lb
      45-year-old woman the app's "lose fat" target of 1,980 kcal sits **2
      kcal/day above** her estimated maintenance. She follows it exactly and
      loses nothing, ever. "Not intuitive" is a mild way to describe that; so
      is "this app doesn't work".

      **Two honest caveats, neither of which rescues the finding.** Mifflin-St
      Jeor is itself an estimate (±10% is the usual quoted band), so the "real
      maintenance" column is a reference point, not truth — but it is *the app's
      own reference point*, which is the whole argument: Ignia disagrees with
      itself by up to 27%, and does so in one direction for women. And the
      3,500 kcal/lb conversion is a static rule that **overestimates** real
      loss as time passes (Hall, *Int J Obes* 2013), so the lb/wk column is the
      optimistic case; the lived result is slower still.

      Why it persists: `dailyTargets` (`packages/core/src/targets.ts:178-186`)
      uses the onboarding number until `tdee.source === 'measured' && reliable`
      — weeks of logging away. The formula path cannot rescue it either,
      because `toProfileFields` returns `null` without `sex`/`heightIn`/`age`/
      `activityLevel` (`targets.ts:85-97`). So a user who never opens Refine
      targets sits on the heuristic for the entire period in which she is
      deciding whether the app works.

- [ ] **F2 · The app already contains the correct math and routes every new
      user around it.** Sex, height, age and activity level — exactly the four
      Mifflin-St Jeor inputs — are collected only in **Settings → Refine
      targets**, whose subtitle is *"Sharpen your calorie target · unlocks body
      fat"*. That reads as an optional power-user extra. It is not: without it
      the target is a guess with a sex-dependent error (F1), and the body-fat
      estimate — whose formula genuinely differs by sex,
      `packages/core/src/body-fat.ts:37` — cannot run at all. The screen is
      four short fields. Moving it, or a prompt toward it, into the first run
      is the cheapest fix in this section.

      *Not a finding, recorded so nobody re-reports it:* the Sex selector shows
      "Male" pre-selected on the QA account because that account has it
      **stored**. For a fresh profile the state is `null` and neither option is
      selected (`refine-targets.tsx:57`). There is no male default.

- [ ] **F3 · Body weight is pounds-only, everywhere, with no way to change
      it.** Onboarding's `BigInput` hardcodes a literal `lb` glyph
      (`onboarding.tsx:443`) beside a 72 pt number, and the Body tab hardcodes
      `lb` on the hero, the goal rail and every history row. The `unitSystem`
      profile field exists and is settable, but Settings labels that row
      **`settings.portionDisplay`** and it only reaches food serving sizes — so
      the label is honest and the gap is real: a metric user cannot enter or
      read body weight in kilograms anywhere in the app. Typing 68 (kg) at
      onboarding yields a plan built for a 68 lb person.

- [ ] **F4 · The most common way to log food has no name on the entry
      surface, and the name it does have discourages use.** The speed dial
      offers exactly two choices: **Scan meal** and **Manual entry**. The sheet
      behind "Manual entry" opens with a full-width **"Search foods…"** field
      as its first and largest element. So the food database — the path most
      people want — is labelled as the manual-work option. A user who does not
      want to photograph her lunch and does not want to type macros by hand
      reads that dial as offering nothing for her. Renaming the satellite is a
      one-string change; the sheet also has no title.

- [ ] **F5 · On Today, the + button covers the empty state's only CTA.** At
      360×720 dp the orange FAB is drawn over "Repeat yesterday", which renders
      as `Repe⬤sterday`. Screenshot-confirmed on the LG VS988. The ScrollView
      has a 96 px tail spacer (`index.tsx:333`) that handles the scrolling
      case, but on a first run the content is *shorter* than the viewport, so
      nothing scrolls and the spacer sits below the button instead of lifting
      it. The empty state is the one screen every new user sees first.

- [ ] **F6 · Terms of art go unexplained on the two most-viewed panels.**
      Today's hero reads `0 / 2,323 kcal` and `maintenance 2,723`; Trends leads
      with a **MEASURED** badge, *Maintenance estimate*, and *73% logging
      completeness*. None is defined anywhere in the app. "kcal" appears in
      20+ strings where most people would read "calories"; "maintenance" is a
      term someone who has dieted before knows and nobody else does; and a
      first-run user has no way to tell whether 73% completeness is good.
      Trends does one thing right and it is worth copying — *"Weekly averages
      unlock at 3 logged days"* explains itself.

**Ranking, if the verbatim reports never arrive:** F1 and F2 are the same fix
and should be done together — they are a correctness defect with a measurable
sex-dependent error, not a matter of taste, and they are worth fixing on their
own merits whatever the report turns out to have meant. F5 is a ten-minute
layout fix. F4 is one string. F3 and F6 are real but are scope, not defects.

### Tier 3 — deliberately deferred, with the reason

- [x] **N6 · Restaurant / chain-menu data — MOSTLY ALREADY SHIPPED, measured
      2026-08-12.** The premise was wrong, and it was wrong because N2 fixed it
      as a side effect. FNDDS carries chain menu items and N2 bundled FNDDS, so
      the committed dataset already holds **61 McDonald's rows, 28 Burger King,
      24 KFC, 19 Wendy's, 19 Pizza Hut, 13 Taco Bell, 12 Subway, 10 Domino's**.
      Searching works today: "big mac", "whopper" and "taco bell burrito" each
      return the right item as the top hit. Six regression locks now pin that in
      `functions/test/usda-db.spec.ts`, because the coverage is **incidental** —
      nothing in the ingest asks for restaurant data, so a `--no-survey` run or
      a size trim would silently delete all of it.
      **What genuinely remains is narrow: Starbucks (0 rows) and Chipotle (3).**
      Both are drink- and build-your-own-heavy, which the FNDDS survey does not
      model. Closing that half needs a **licensed menu source**, not a guess:
      inventing macros for a latte would be fabricating health data, which is
      worse than returning nothing. A test asserts those two queries return
      empty, so the day a source is added, it fails and says so.
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
