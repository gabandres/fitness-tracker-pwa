# Macronaut — Positioning & Store / Paywall Copy

Working draft for App Store + Google Play listings and the in-app paywall.
Grounded in the *actual* feature set (adaptive TDEE, AI photo logging,
FDC + Open Food Facts search, barcode, the Train tab, recipes, fasting,
bilingual en/es-PR). Don't ship claims the build can't back.

---

## 1. Positioning

**One-liner**
> The macro tracker that adapts to *you* — and tracks your lifting too.

**Positioning statement**
> For lifters and macro-counters who are tired of static calorie goals and
> apps that ignore the gym, Macronaut is a nutrition + training tracker that
> learns your real metabolism from your weight trend and adjusts your targets
> automatically — while logging your workouts, progression, and macros in one
> place. Unlike MyFitnessPal (static goals, no training) or MacroFactor
> (no workout logging), Macronaut does both, with photo and barcode logging
> and a calm, fast interface.

**The wedge (don't fight MyFitnessPal head-on)**
1. **Lifters who track macros.** Adaptive TDEE + a real strength log
   (cluster sets, progression, plate math, warm-ups) is a combination none of
   the big players ship. This is the sharpest, most defensible angle.
2. **Spanish / Puerto Rico.** Full es-PR localization in an underserved,
   lower-competition market.

**Proof points (all real today)**
- Adaptive TDEE from a least-squares weight trend (MacroFactor's signature —
  most apps don't have it).
- 4 ways to log: type, photo (AI), barcode, or search (USDA FoodData Central
  **+** Open Food Facts).
- Train tab: templates, double-progression suggestions, plate calculator,
  warm-up generator, cluster training.
- Weekly insights, weight projection, calorie budget, fasting, body-fat, CSV
  import (MFP / Lose It! / Cronometer) and export, progress photos.
- Installable PWA, offline, daily reminders. No account wall to try it.

---

## 2. App Store (iOS) listing

**App name (30 char max)**
`Macronaut: Calories & Lifts`

**Subtitle (30 char max)**
`Adaptive macros + workouts`

**Promotional text (170 char, updatable anytime)**
> Your calorie target shouldn't be a guess. Macronaut learns your real
> metabolism from your weight trend and adjusts automatically — and logs your
> lifts too.

**Keywords (100 char, comma-separated, no spaces)**
`macro,calorie,counter,tracker,tdee,adaptive,protein,gym,workout,lifting,fasting,barcode,diet,coach`

**Description**
```
Macronaut is the calorie + macro tracker that adapts to your body — and
tracks your training in the same app.

WHY IT'S DIFFERENT
Most apps hand you a fixed calorie number and never change it. Macronaut
learns your real maintenance calories from your weight trend and adjusts
your targets each week, so progress doesn't stall. And unlike other macro
apps, it has a proper strength-training log built in.

LOG A MEAL FOUR WAYS
• Snap a photo — AI estimates the macros
• Scan a barcode
• Search a huge food database (USDA + Open Food Facts)
• Type it, or tap a saved preset

ADAPTIVE COACHING
• Targets that adjust to your real metabolism, not a formula
• Weekly insights, calorie budget, and weight-trend projection
• Carbs, fat, and protein goals

TRAIN, NOT JUST EAT
• Workout templates with set/rep/RIR logging
• Automatic progression suggestions, plate calculator, warm-up sets
• Cluster training support

ALSO INCLUDED
• Intermittent fasting timer
• Body weight, measurements, body-fat, and progress photos
• Import from MyFitnessPal, Lose It!, or Cronometer; export anytime
• Full English & Spanish (Puerto Rico)

Start free. Upgrade to Pro for adaptive coaching, AI photo logging, and
unlimited history.
```

**What's New (release notes template)**
> • Faster food search — now backed by USDA + Open Food Facts
> • Accessibility + touch-target polish across the app
> • Bug fixes for workout editing and cluster sets

---

## 3. Google Play listing

**Title (30 char)**
`Macronaut: Calorie & Lift Log`

**Short description (80 char)**
`Adaptive calorie & macro tracker with AI photo logging and a workout log.`

**Full description** — reuse the iOS description (Play allows 4000 chars; the
above fits). Lead with the adaptive + training hook in the first 2 lines, as
Play truncates early.

---

## 4. ASO notes
- Primary terms: *macro tracker, calorie counter, adaptive TDEE, macro
  coach*. Secondary: *workout log, lifting, protein, fasting, barcode*.
- Cal AI proved **AI photo logging** is a high-intent search magnet — keep
  "AI" and "photo" in metadata.
- The training angle is low-competition in this category; lean into
  "calorie + workout in one app".
- Localize the es-PR listing separately — almost no localized competition.

---

## 5. Paywall & upsell copy

### Free vs Pro split (recommended)
**Free (no wall to try):** manual + barcode + search logging, basic daily
rings, weight log, fasting timer, 1 workout template, recent history.
**Pro:** adaptive TDEE coaching, AI photo logging, unlimited workout
templates + analytics, weekly insights / projection, unlimited history,
progress photos, CSV import/export, themes.

### Pricing
- Anchor against MacroFactor ($71.99/yr) and undercut: **$29.99–$39.99 / yr**
  (≈ $2.50–3.33/mo) or **$4.99 / mo**.
- Offer an annual default with a 7-day free trial (trials lift conversion and
  are standard in the category).
- iOS: price through StoreKit IAP at 15% (Small Business Program). Web: keep
  Stripe. (See ADR-0011 for entitlement reconciliation.)

### Paywall screen
**Headline**
> Stop guessing your calories.

**Subhead**
> Pro learns your real metabolism and adjusts your targets every week — plus
> AI photo logging and your full training log.

**Bullets (with check icons)**
- ✓ Adaptive calorie & macro targets
- ✓ Snap-a-photo AI meal logging
- ✓ Unlimited workouts, progression & analytics
- ✓ Weekly insights & weight-trend projection
- ✓ Unlimited history + CSV export

**CTA (primary)**
> Start 7-day free trial

**CTA (secondary / reassurance)**
> Then $29.99/year. Cancel anytime.

**Restore link**
> Restore purchases

### Contextual upsell microcopy (when a free user hits a gated feature)
- AI photo: *"Photo logging is a Pro feature — let AI estimate macros from a
  photo. Try Pro free for 7 days."*
- Adaptive target: *"Want targets that adjust to your real metabolism? That's
  Pro."*
- Extra template: *"Free includes 1 workout template. Go Pro for unlimited."*
- History beyond window: *"See your full history with Pro."*

### Onboarding value line (pre-paywall)
> Set your goal in 30 seconds. We'll dial in your real targets as you log.

---

## 6. What still gates "ready to charge strangers"
- **Food DB coverage** — FDC + OFF (now merged) closes most of the gap;
  spot-check branded/restaurant coverage before launch.
- **AI cost guardrails** — keep photo logging Pro-gated with per-user quotas
  so growth doesn't outrun revenue.
- **iOS payments** — requires the Capacitor + StoreKit work in ADR-0011;
  don't promise an iOS subscription until that ships.
- **Marketing** — parked by decision; this doc is ready to deploy the day a
  channel opens.
