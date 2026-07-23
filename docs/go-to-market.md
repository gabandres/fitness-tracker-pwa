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

## 2. App Store listing (iOS)

**App name** (30 max)

```
Ignia: Calories & Lifts
```

**Subtitle** (30 max)

```
Adaptive macros + workouts
```

**Promotional text** (170 max — editable any time without a new build; use it
for what's-new pushes)

```
Your calorie target shouldn't be a guess. Ignia learns your real metabolism
from your weight trend and adjusts it — and logs your lifts too. Free, no
ads, no paywall.
```

**Keywords** (100 max, comma-separated, **no spaces**)

```
tdee,protein,counter,tracker,gym,strength,fasting,barcode,diet,weight,food,log,fitness,carb,bulk
```

Words already in the app name and subtitle (*calories, lifts, adaptive,
macros, workouts*) are deliberately **omitted** — Apple indexes those fields
separately and repeating them wastes characters.

**Description**

```
Ignia is a calorie and macro tracker that adapts to your body — and tracks
your training in the same app. Everything is free. No ads, no subscription,
no locked features.

WHY IT'S DIFFERENT
Most apps hand you a fixed calorie number and never change it. Your body
isn't fixed. Ignia learns your real maintenance calories from your own
weight trend and adjusts your targets as you go, so progress doesn't stall
after week three. And unlike other macro apps, it has a proper strength
log built in — you don't need a second app for the gym.

LOG A MEAL IN SECONDS
• Scan a barcode
• Search USDA FoodData Central and Open Food Facts
• Type it in plain language — "2 eggs and a bagel"
• Tap a saved preset, custom food, or recipe

TARGETS THAT KEEP UP
• Recalibrated from your real weight trend, not a one-time formula
• Weekly insights, calorie budget, and weight-trend projection
• Protein, carb and fat goals
• An AI coach that reads your actual logs — not generic advice

TRAIN, NOT JUST EAT
• Workout templates with set / rep / RIR logging
• Automatic progression suggestions
• Plate calculator and warm-up generator
• Cluster set support

ALSO INCLUDED
• Intermittent fasting timer
• Body weight, measurements and body-fat estimate
• Import from MyFitnessPal, Lose It! or Cronometer
• Export everything to CSV, any time
• Full English and Spanish (Puerto Rico)

YOUR DATA IS YOURS
No ads. No data selling. No cross-app tracking. Export or delete your
account from inside the app whenever you want.

Ignia is free because it's a solo project, not a funding round. There's an
optional tip if you want to support it — it unlocks nothing, because
nothing is locked.

Ignia is not a medical device and does not provide medical advice.
```

**What's New — next release**

```
• Rate Ignia without leaving the app
• Faster, more accurate food search
• Fixes and polish across logging and the training tab
```

**Review Notes (App Store Connect)** — keep current:
demo account credentials, "all features are free; the tip is a consumable
that unlocks nothing", support URL `https://ignia.fit/support`.

---

## 3. Google Play listing (drafted, not yet used)

Hold until closed testing (12 testers × 14 consecutive days) completes.

**Title** (30 max)

```
Ignia: Calorie & Lift Log
```

**Short description** (80 max)

```
Free adaptive calorie & macro tracker with a real workout log. No ads.
```

**Full description** — reuse the iOS description; Play allows 4000 chars.
Play truncates early, so the adaptive + training hook must land in the first
two lines (it does).

---

## 4. Spanish (es-PR) listing

The app is fully localized, so ship a localized listing. Near-zero competition
in Spanish for this category — this is cheap reach.

**Nombre** (30 max)

```
Ignia: Calorías y Pesas
```

**Subtítulo** (30 max)

```
Macros que se ajustan a ti
```

**Texto promocional** (170 max)

```
Tu meta de calorías no debería ser una adivinanza. Ignia aprende tu
metabolismo real de tu tendencia de peso y la ajusta — y registra tus pesas.
Gratis, sin anuncios.
```

**Palabras clave** (100 max, sin espacios)

```
tdee,proteina,contador,dieta,gimnasio,pesas,ayuno,codigo,barras,peso,comida,fuerza,carbohidratos
```

**Descripción**

```
Ignia es un contador de calorías y macros que se adapta a tu cuerpo — y
registra tus entrenamientos en la misma app. Todo es gratis. Sin anuncios,
sin suscripción, sin funciones bloqueadas.

POR QUÉ ES DIFERENTE
La mayoría de las apps te dan un número de calorías fijo y nunca lo cambian.
Tu cuerpo no es fijo. Ignia aprende tus calorías de mantenimiento reales de
tu propia tendencia de peso y ajusta tus metas sobre la marcha, para que el
progreso no se estanque. Y a diferencia de otras apps de macros, trae un
registro de pesas completo — no necesitas una segunda app para el gimnasio.

REGISTRA UNA COMIDA EN SEGUNDOS
• Escanea el código de barras
• Busca en USDA FoodData Central y Open Food Facts
• Escríbelo en lenguaje natural
• Usa un preset guardado, comida propia o receta

METAS QUE TE SIGUEN EL PASO
• Recalibradas con tu tendencia de peso real, no con una fórmula de una vez
• Resumen semanal, presupuesto de calorías y proyección de peso
• Metas de proteína, carbohidratos y grasa
• Un coach con IA que lee tus propios registros

ENTRENA, NO SOLO COMAS
• Plantillas de entrenamiento con series, repeticiones y RIR
• Sugerencias automáticas de progresión
• Calculadora de discos y generador de calentamiento

TAMBIÉN INCLUYE
• Cronómetro de ayuno intermitente
• Peso, medidas y estimado de grasa corporal
• Importa desde MyFitnessPal, Lose It! o Cronometer
• Exporta todo a CSV cuando quieras
• Español (Puerto Rico) e inglés completos

TUS DATOS SON TUYOS
Sin anuncios. Sin venta de datos. Exporta o borra tu cuenta desde la app.

Ignia no es un dispositivo médico y no da consejo médico.
```

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
- Localize the es-PR listing separately (§4) — the competition there is thin.
- Screenshot order is the conversion trio: (1) adaptive target with the
  weight trend, (2) the training log mid-session, (3) fast logging /
  barcode. Caption each with a claim, not a feature name.

---

## 6. When Pro eventually turns on

Out of scope for v1 and **not** to be referenced in any current listing. The
paid direction (AI photo-scan flagship, ADR-0015) and its pricing anchors are
recorded in `docs/post-launch-roadmap.md` → PARKED. Turning it on means
flipping `PRO_ENABLED` on both platforms, and rewriting §2 and §4 again — with
the same rule: never claim what the build can't back.
