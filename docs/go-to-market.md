# Ignia — positioning & store listing copy

**Status:** rewritten 2026-07-23 for the **shipped free v1**, after the iOS
app went live on the App Store.

> **Why this was rewritten.** The previous draft sold a product that doesn't
> exist: "Snap a photo — AI estimates the macros", "Start free. Upgrade to
> Pro", a 7-day trial, and gated history. In the shipped build `PRO_ENABLED`
> is `false` on both platforms and nothing is behind a paywall. (`photoScan`
> was `false` too when this was written; **ADR-0017 turned it on and free on
> 2026-08-07**, so the photo claim is now fair game — the paywall claims are
> not.) Shipping that copy would have
> meant one-star reviews from users installing for a feature that isn't there,
> plus a 2.3.1 ("accurate metadata") review risk.
>
> **Rule for this file: never write a line the current build can't back.**
> Before editing, re-check `apps/mobile/src/lib/features.ts` and
> `apps/mobile/src/lib/subscription.ts` (the web copies went with the web
> logging app, ADR-0036).

---

## 0. Ground truth (what v1 actually is)

| | |
|---|---|
| App Store ID | `6788589414` · bundle `fit.ignia.app` |
| Listing URL | <https://apps.apple.com/app/id6788589414> |
| Platforms | iPhone (iOS 16+, **not** iPad — `supportsTablet: false`) · Android · **no browser version** — the web logging app was retired 2026-08-30 (ADR-0036); <https://ignia.fit> is the marketing site |
| Android | On the Play **alpha** track and **submitted to production 2026-08-29, in review** — this row said "closed testing only, production access needs 12 testers × 14 days" until 2026-08-30; access was granted on 08-29. Whether the public listing is live is a `STATUS.md` §1 question (the store URL returning 200 is the only read). Do not quote a date. |
| Price | **Free. No paywall, no subscription, no trial.** **The tip jar is OFF since 2026-08-19** — `FEATURES.tips = false` on both platforms, the three `fit.ignia.tip.*` consumables are `DEVELOPER_REMOVED_FROM_SALE`, `/tip` → `/support`. Do not market a way to pay the developer; there isn't one. Re-enables only when payouts land in the Bermudez Systems LLC bank account (`STATUS.md` §3) |
| Languages | English + Spanish (Puerto Rico), fully translated |

**Shipped and claimable:**
adaptive TDEE recalibration from the real weight trend · strength-training log
(templates, sets/reps/RIR, double progression, plate calculator, warm-up
generator, cluster sets) · barcode scanning (Open Food Facts) · food search
(USDA FoodData Central + Open Food Facts) · plain-language meal entry · saved
presets, custom foods and recipes · AI coach grounded in the user's own logs ·
weekly insights, calorie budget, weight-trend projection · fasting timer ·
weight, measurements, Navy body-fat · CSV import (MyFitnessPal / Lose It! /
Cronometer) and export · in-app account deletion · **AI meal
photo → macros, free to everyone** (ADR-0017) · **Apple Watch app and
complication** · **home-screen and Lock Screen widgets**, device-verified.

**The question this section answers is "what can the public install", not "what
is built".** Those diverged on 2026-08-08 and are still apart: the App Store
serves **1.1.0 / build 24**, while TestFlight runs 1.2.0 / build 54, which is
`WAITING_FOR_REVIEW` with a manual release. Anything that landed after build 24
is real, shipped, and **still unclaimable to the public** until 1.2.0 is
released. Re-read `STATUS.md` §2 for the current cutline.

**NOT claimable — do not put these in any listing:**

| Feature | Why not |
|---|---|
| Pro / premium / unlimited-anything | `PRO_ENABLED = false`; there is no paid tier to upsell |
| Free trial, "upgrade", pricing anchors | nothing to buy |
| Progress photos | uploading works, but it was cut from the v1 story — don't market it |
| Android app | On the Play alpha track, **production submitted 2026-08-29 and in review** — the public listing is not live until the store URL returns 200 (`STATUS.md` §1). This row said "closed alpha only, production access needs 12 testers × 14 days" until 2026-08-30; access was granted on 08-29. Do not market Android as available until the URL is live |
| Voice dictation · the redesigned Add screen · the fasting Live Activity · the wide home-screen widget | all shipped and all **only on TestFlight** — they reach the public when 1.2.0 releases, not before |

**Corrected 2026-08-15 — two rows in this table were badly wrong**, and both
would have suppressed a real headline feature during a launch push:

- *"AI meal photo → macros — `photoScan: false` on both platforms (ADR-0015,
  deferred)"*. **False since 2026-08-07.** ADR-0017 amended 0015: photo scan is
  **ON and free to everyone** (`apps/mobile/src/lib/features.ts` reads
  `photoScan: true`; the web copy is gone with ADR-0036 — verified in
  code). Its tiering is server-side only. It is in the live 1.1.0 binary and is
  claimable today.
- *"Apple Watch — not built"*. **False since 1.1.0.** The watch app and its
  complication ship from build 19 on, `apps/mobile/targets/` holds `watch` and
  `watch-widget`, and Apple would not have taken 1.1.0 without the watch
  screenshots that are on file. Claim the **app and the glanceable numbers**;
  do not claim real-time refresh, which is `BEHAVIOUR UNVERIFIED` and, per
  ADR-0023, cannot be pushed to a WidgetKit complication at all — what ships is
  an approximately hourly pull.

**Shipped, in the live binary, and previously mis-filed as "not in a binary
yet":** Apple Health sync including the activity import (steps, active energy)
that corrects the activity level, and the home-screen widget — which was device-
verified on a real iPhone on 2026-08-03, numbers moving after a logged meal.

## 1. Positioning

**One-liner**

> The macro tracker that adapts to you — and tracks your lifting too.

**Positioning statement**

> For lifters who count macros and are tired of a calorie target that never
> changes, Ignia is a nutrition **and** training tracker that learns your real
> maintenance calories from your own weight trend and adjusts as you go —
> while logging your sets, reps and progression in the same app. MyFitnessPal
> gives you a static number and no training log. MacroFactor has the adaptive
> math but no training log, at about $72/year. Ignia does both, free.

**The wedge — do not fight MyFitnessPal on database size.**

1. **Lifters who track macros.** Adaptive TDEE **plus** a real strength log is
   a combination no major competitor ships. Sharpest, most defensible angle;
   lead with it everywhere.
2. **Free where the category is paid.** MacroFactor ~$72/yr, MFP Premium
   ~$80/yr, Cal AI subscription-gated. Ignia has no paywall at all — a
   genuinely rare claim, and the reason to act now rather than bookmark.
3. **Spanish / Puerto Rico.** Full es-PR localization in an underserved,
   low-competition market. Almost nothing here is localized.

**Proof points (all true today)**

- Targets recalibrate from a least-squares fit of your own weight trend, not
  from a formula that assumed you're average.
- Four ways to log: barcode, food search (USDA + Open Food Facts), plain
  language, or a saved preset.
- A training log with double-progression suggestions, plate math, warm-up
  generation and cluster sets.
- AI coach that reads your actual logs instead of dispensing "drink more
  water".
- Import your history from MyFitnessPal, Lose It! or Cronometer; export CSV
  and delete your account from inside the app, any time.
- No ads, no data selling, no paywall.

---

## 2–4. Listing copy — moved

The per-field listing copy that used to live here (app name, subtitle,
promotional text, keywords, description, Play draft, Spanish listing) now lives
in **[`app-store-metadata.md`](app-store-metadata.md)**, which is the single
source of truth and records what is actually saved in App Store Connect.

It was duplicated across three documents and drifted: this file still claimed
the app was named "Ignia: Calories & Lifts" and carried a keyword list built
around that name, while the live listing has always been
`Ignia — Calories & Training`. Copy values *out* of `app-store-metadata.md`
when you need them; never copy them back in here.

**This file owns positioning and strategy** — §0 ground truth, §1 the wedge,
§5 ASO reasoning, §6 the monetization boundary. Those are the parts worth
arguing about; the field values are just their output.

---

## 5. ASO notes

- **Ratings are the lever we're shortest on.** A new listing starts at zero,
  and rating count/average is the biggest non-keyword ranking input. The
  in-app prompt (`apps/mobile/src/lib/reviewPrompt.ts`) fires at genuine
  positive moments; the Settings → *Rate Ignia* row is the always-on path.
  Both shipped 2026-07-23.
- **Install velocity from ignia.fit feeds ranking.** The site's organic pages
  (`/calculator`, the 8 calculator variants, `/macros/*`, `/vs/*`, `/faq`) now
  carry App Store badges plus an iOS Safari smart banner and a dedicated
  `/download` page. That traffic was previously invisible to the store.
- Primary terms: *macro tracker, calorie counter, adaptive TDEE, TDEE
  calculator*. Secondary: *workout log, lifting, protein, fasting, barcode*.
- The **training angle is low-competition** inside the nutrition category.
  Lean on "calories + workouts in one app" — it's the differentiator that
  survives a screenshot glance.
- **"Free" is a headline, not a footnote.** Every visible competitor is
  subscription-gated. Put it in the subtitle line of any post, the first
  screenshot caption, and the promo text.
- The Spanish listing is **live as es-MX** (ASC has no es-PR option) — applied
  2026-07-23. Competition in Spanish is thin, so keep it in parity whenever the
  English copy changes.
- **Keyword fields must not repeat words already in the app name or subtitle.**
  Apple indexes the three separately. The original field wasted ~30 of 100
  characters this way; see `app-store-metadata.md` for the corrected lists.
- Screenshot order is the conversion trio: (1) adaptive target with the
  weight trend, (2) the training log mid-session, (3) fast logging /
  barcode. Caption each with a claim, not a feature name.

---

## 6. When Pro eventually turns on

Out of scope for v1 and **not** to be referenced in any current listing. The
paid direction (AI photo-scan flagship, ADR-0015) and its pricing anchors are
recorded in `STATUS.md` §5 (decided-not-happening). Turning it on means
flipping `PRO_ENABLED` on both platforms, rewriting §0's not-claimable table,
and reworking every field in `app-store-metadata.md` — with the same rule:
never claim what the build can't back.
