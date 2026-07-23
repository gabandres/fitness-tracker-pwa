# App Store Connect — paste-ready metadata

**For:** Ignia · ASC app ID `6788589414` · bundle `fit.ignia.app`
**Written:** 2026-07-23. Source of truth for the claims: `docs/go-to-market.md` §0.

Everything on this page is **metadata-only** — it changes in App Store Connect
with **no new binary and no EAS build**. That matters right now: builds are
capped until the August 2026 quota reset, but this is the biggest ASO lever
available today and none of it is blocked.

**Before pasting, re-read the not-claimable list** (`go-to-market.md` §0). If
a build flag flips, this file is stale. Nothing here mentions Pro, trials, AI
photo scanning, Health sync, widgets or Android — all are off or unbuilt.

---

## Applied status — 2026-07-23

Driven directly in ASC. What the live console actually allowed corrected two
assumptions in the original draft; both are reflected below.

| Item | State |
|---|---|
| 1.0 promotional text | **LIVE** on the released listing |
| Version **1.1.0** | **Created**, in *Prepare for Submission* |
| 1.1.0 EN description, keywords, what's new, promo text, marketing URL | **Saved** |
| EN subtitle → `Adaptive macros + workouts` | **Saved** |
| App name | **Unchanged on purpose** — see below |
| es-MX name, subtitle, description, keywords | **NOT saved** — still English. See §2 |
| Screenshots | Not started — owner, on device |

**Correction 1 — only promotional text is live-editable.** The draft claimed
the support/marketing URLs could also be changed on a released version. They
can't: on a version in *Ready for Distribution*, ASC exposes an Edit control
for **promotional text and copyright only**. Name, subtitle, keywords,
description, URLs and screenshots are all read-only until a new version
exists. That makes creating the next version the gate for everything else.

**Correction 2 — the app name stays `Ignia — Calories & Training`.** The draft
renamed it to "Ignia: Calories & Lifts". That was a regression: the live name
already indexes *Calories* **and** *Training*, and "training" outsearches
"lifts". The app name is the highest-weighted field Apple indexes, so dropping
a strong term out of it to gain a weaker one is a net loss. Keywords below are
built around keeping it.

**The real ASO win was the keyword field.** It previously read
`calorie,protein,macro,tracker,food,diet,weight,fasting,workout,gym,lifting,cut,tdee,nutrition`
— but `calorie` was already in the app name and `protein`, `tracker` and
`fasting` were already in the subtitle. Apple indexes name, subtitle and
keywords separately, so those four terms were dead weight: roughly **30 of 100
characters wasted**. Reclaiming them bought `counter`, `strength`, `barcode`,
`carb` and `bulk`.

---

## How to apply

ASC → **Ignia** → *(left rail)* **App Store** tab.

| Field | Where | Needs review? |
|---|---|---|
| Promotional text | Version page | **No** — live within minutes, any time |
| Description, keywords, support URL | Version page | Yes — with the next submission |
| Name, subtitle | Version page | Yes |
| Screenshots | Version page → Media | Yes |
| Localization (es-MX) | Version page → language dropdown → **+** | Yes |

**Promotional text is the free slot.** It updates without review and without
a build. Use it for anything time-sensitive; the description can't do that.

> **Important:** editing description/keywords/screenshots puts the version in
> *Prepare for Submission*. Those edits only go live attached to a submission.
> If you don't want to submit now, change **promotional text only** — it takes
> effect immediately on the live listing.

---

## 1. English (primary) — APPLIED

### App name — 27/30 · **unchanged, do not edit**
```
Ignia — Calories & Training
```

### Subtitle — 26/30 · saved
```
Adaptive macros + workouts
```

### Promotional text — 166/170 · *updates live, no review*
```
Your calorie target shouldn't be a guess. Ignia learns your real metabolism from your weight trend and adjusts it — and logs your lifts too. Free, no ads, no paywall.
```

### Keywords — 98/100 · comma-separated, **no spaces after commas** · saved
```
protein,counter,tdee,gym,lifting,strength,fasting,weight,diet,food,barcode,carb,cut,bulk,nutrition
```
Words already in the name (*calories, training*) and subtitle (*adaptive,
macros, workouts*) are deliberately absent — Apple indexes those fields
separately, so repeating a term buys nothing while costing characters. If the
name or subtitle ever changes, rebuild this list against the new wording.

### Description
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

### URLs
| Field | Value |
|---|---|
| Support URL | `https://ignia.fit/support` |
| Marketing URL | `https://ignia.fit/download` |
| Privacy Policy URL | `https://ignia.fit/privacy` |

> Marketing URL now points at `/download` rather than the homepage — it's the
> page written to convert a store visitor, and it carries the browser fallback
> for anyone who bounces off the install.

### What's New — next version
```
• Rate Ignia without leaving the app
• Faster, more accurate food search
• Fixes and polish across logging and the training tab
```

### Review notes
```
All features in Ignia are free. There is no subscription, no paywall and no
gated content. The optional tip (consumable in-app purchase) unlocks nothing
— it is a donation.

Account deletion is available in-app: Settings → Delete account.

Demo account:
  Email: <fill in>
  Password: <fill in>
```
**Fill in the demo account before submitting** — a missing one is a common
avoidable rejection.

---

## 2. Spanish — STILL TO DO

**The es-MX localization already exists — and it is filled with the English
copy.** Spanish-locale users currently see an untranslated listing. This is a
live defect, not a missing nice-to-have.

ASC has no `es-PR` option, which is why the store language is **Spanish
(Mexico) — `es-MX`**; it serves Puerto Rico and the wider LatAm audience. The
in-app locale stays `es-PR`; only the store listing language differs.

To apply: on **App Information** and on the **1.1.0 version page**, switch the
language dropdown (top right of each section) from *English (U.S.)* to
*Spanish (Mexico)*, then paste the fields below and **Save each page
separately** — the two pages have independent Save buttons.

### Nombre — 23/30
```
Ignia: Calorías y Pesas
```

### Subtítulo — 26/30
```
Macros que se ajustan a ti
```

### Texto promocional — 166/170
```
Tu meta de calorías no debería ser una adivinanza. Ignia aprende tu metabolismo real de tu tendencia de peso y la ajusta — y registra tus pesas. Gratis, sin anuncios.
```

### Palabras clave — 96/100 · sin espacios
```
tdee,proteina,contador,dieta,gimnasio,ayuno,codigo,barras,peso,comida,fuerza,carbohidratos,grasa
```
96/100. `pesas` was dropped because it now sits in the Spanish app name, and
`calorias` / `macros` are covered by the Spanish name and subtitle.

### Descripción
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

### Novedades
```
• Califica Ignia sin salir de la app
• Búsqueda de alimentos más rápida y precisa
• Correcciones y mejoras en el registro y en la pestaña de entrenamiento
```

---

## 3. Screenshots

### Why they need replacing
The current set predates the positioning this listing now uses. Two problems:
it doesn't say **free** anywhere, and it doesn't lead with the two things that
actually differentiate Ignia (adaptive targets, a real training log). A store
visitor decides from the first two frames, before reading a word of the
description.

### This costs zero EAS builds
Capture on the **iPhone that already has the App Store build installed** — the
shipped app is on your phone, so no dev build, no simulator, no quota.
Volume-up + side button, then AirDrop to the Mac/PC.

### Required sizes
Apple needs **one** set; it downscales for smaller devices.

| Display | Pixels (portrait) | Devices |
|---|---|---|
| **6.9"** (upload this) | **1320 × 2868** | iPhone 16 Pro Max / 15 Pro Max class |
| 6.5" (fallback) | 1242 × 2688 | iPhone 11 Pro Max / XS Max class |

A native screenshot from a current iPhone is already the right pixel size — do
not scale or crop it. Max 10 per localization; 3–5 well-chosen beats 10.

### Shot list — order is the pitch
The first two are what most visitors see without scrolling. Both differentiators
must land there.

| # | Screen | Caption (EN) | Caption (ES) |
|---|---|---|---|
| 1 | Today — rings with the adaptive target visible | **Your target moves because your body did** | **Tu meta cambia porque tu cuerpo cambió** |
| 2 | Train — a session in progress, sets/reps/RIR | **The only macro tracker with a real lifting log** | **El único contador de macros con registro de pesas** |
| 3 | Food search or barcode result | **Log a meal in about five seconds** | **Registra una comida en unos cinco segundos** |
| 4 | Trends — weekly insights + weight projection | **See where the week actually went** | **Mira a dónde se fue la semana de verdad** |
| 5 | Settings or a "no paywall" surface | **Every feature. No subscription. No ads.** | **Todas las funciones. Sin suscripción. Sin anuncios.** |

Captions are burned into the image, not an ASC field — add them as a text band
above the screenshot in any image editor. Keep the type large enough to read in
the search-results thumbnail strip, which is where most of them get seen.

### Capture checklist
- [ ] Signed in as a demo account with **realistic, populated data** — empty
      rings and a blank history sell nothing
- [ ] **No PII**: no real name, no personal email, no owner account
- [ ] Full battery / clean status bar if you care about polish
- [ ] Dark or light consistently across the set — don't mix
- [ ] Capture the Spanish set too, with the app language switched to es-PR
- [ ] No feature visible that §0 says isn't claimable

---

## 4. Post-change checks

- [ ] Promotional text live on the listing (no review needed — verify within
      ~15 min)
- [ ] Keyword field has **no spaces** after commas (spaces waste characters)
- [ ] Every character count in this file still holds after any edit
- [ ] Spanish localization saved and complete — a half-filled localization
      renders worse than none
- [ ] Support URL resolves: <https://ignia.fit/support>
- [ ] Marketing URL resolves: <https://ignia.fit/download>
- [ ] Demo account filled into review notes and **verified working** in a
      fresh install
