# Ignia — positioning & store listing copy

**Status:** rewritten 2026-07-23 for the **shipped free v1**, after the iOS
app went live on the App Store.

> **Why this was rewritten.** The previous draft sold a product that doesn't
> exist: "Snap a photo — AI estimates the macros", "Start free. Upgrade to
> Pro", a 7-day trial, and gated history. In the shipped build `PRO_ENABLED`
> is `false` on both platforms, `FEATURES.photoScan` is `false` on both
> platforms, and nothing is behind a paywall. Shipping that copy would have
> meant one-star reviews from users installing for a feature that isn't there,
> plus a 2.3.1 ("accurate metadata") review risk.
>
> **Rule for this file: never write a line the current build can't back.**
> Before editing, re-check `src/app/utils/features.ts`,
> `apps/mobile/src/lib/features.ts`, and both `subscription` modules.

---

## 0. Ground truth (what v1 actually is)

| | |
|---|---|
| App Store ID | `6788589414` · bundle `fit.ignia.app` |
| Listing URL | <https://apps.apple.com/app/id6788589414> |
| Platforms | iPhone (iOS 16+, **not** iPad — `supportsTablet: false`) · web PWA at <https://ignia.fit> |
| Android | not shipped — Play closed testing needs 12 testers × 14 consecutive days |
| Price | **Free. No paywall, no subscription, no trial.** Optional tip jar (iOS consumables via RevenueCat; external link on Android) that unlocks nothing |
| Languages | English + Spanish (Puerto Rico), fully translated |

**Shipped and claimable:**
adaptive TDEE recalibration from the real weight trend · strength-training log
(templates, sets/reps/RIR, double progression, plate calculator, warm-up
generator, cluster sets) · barcode scanning (Open Food Facts) · food search
(USDA FoodData Central + Open Food Facts) · plain-language meal entry · saved
presets, custom foods and recipes · AI coach grounded in the user's own logs ·
weekly insights, calorie budget, weight-trend projection · fasting timer ·
weight, measurements, Navy body-fat · CSV import (MyFitnessPal / Lose It! /
Cronometer) and export · in-app account deletion · offline PWA.

**NOT claimable — do not put these in any listing:**

| Feature | Why not |
|---|---|
| AI meal photo → macros | `photoScan: false` on both platforms (ADR-0015, deferred) |
| Pro / premium / unlimited-anything | `PRO_ENABLED = false`; there is no paid tier to upsell |
| Free trial, "upgrade", pricing anchors | nothing to buy |
| Apple Health / Health Connect sync | code-complete but **never device-tested**; not enabled |
| Home-screen widget, Apple Watch | not built |
| Progress photos | uploading works, but it was cut from the v1 story — don't market it |
| Android app | not shipped |

---

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
recorded in `docs/post-launch-roadmap.md` → PARKED. Turning it on means
flipping `PRO_ENABLED` on both platforms, rewriting §0's not-claimable table,
and reworking every field in `app-store-metadata.md` — with the same rule:
never claim what the build can't back.
