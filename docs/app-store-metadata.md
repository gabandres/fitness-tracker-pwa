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
| es-MX name, subtitle, description, keywords, promo, what's new | **Saved** |
| es-MX Support URL | **Fixed** — was `ignia.fit`, missing `/support` |
| Screenshots | Not started — owner, on device (§3) |

**Correction 4 (2026-07-29) — what is live is 1.0, not 1.1.0.** Several docs
(including the repo `CLAUDE.md`) describe the App Store app as "v1.1.0". The
ASC API disagrees, and it is authoritative:

| Version | State | Build |
|---|---|---|
| 1.1.0 | `PREPARE_FOR_SUBMISSION` | **none attached** |
| 1.0 | `READY_FOR_SALE` | build 7, uploaded 2026-07-20 |

**As of 2026-08-06 that is no longer true**: `1.1.0` has real binaries —
TestFlight **build 19** (`4527017a`, commit `fdcd92ed`, `VALID`), preceded by
16 and 13. The version page is still `PREPARE_FOR_SUBMISSION` and **has never
gone to App Review**, and no build is attached to it yet.

- **What's New for 1.1.0 spans `168e0394..fdcd92ed`** — build 7 (live) to build
  19. That is the range the copy below was written from. Use the build's own
  commit, not `HEAD`: `HEAD` now runs ahead of the binary.
- Anything described as "fixed on the shipped 1.1.0 binary" was in fact fixed
  against **1.0**. The `dailyWeights` index is the live example: it repaired
  Refine Targets for users on 1.0 without an app update, because the fix was
  server-side.

Re-check with:
```sh
node -e "import('./scripts/asc-client.mjs').then(async({api,APP_ID})=>{const r=await api('GET','/v1/apps/'+APP_ID+'/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState');r.data.forEach(v=>console.log(v.attributes.versionString,v.attributes.appStoreState))})"
```

**This file is the source of truth for listing field values.** `go-to-market.md`
owns positioning and strategy; The pre-launch listing draft was deleted
2026-07-29 (recoverable from git history); it duplicated these fields and
drifted — don't reintroduce a second copy.

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

There is also a constraint the draft didn't know about: per an earlier listing draft
(git history), the bare word **"Ignia" was already reserved by another
developer** in App Store Connect, which is *why* the listing title carries a
descriptor at all. The on-device name (from `app.json`) is still just "Ignia".

**Third defect class, caught only on re-read: a stray `a` at the start of three
fields.** `Ctrl+A` intermittently failed to register as a modifier while
driving ASC, so the `a` landed as a literal character — it hit the English
promotional text and the Spanish promotional text and What's New. All fixed.
**Verify every field after saving; the character counter is the tell** (a
166-char promo showing 3 remaining instead of 4 means a stray character).

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

### What's New — 1.1.0

**Rewritten 2026-08-06** against `168e0394..fdcd92ed` — the range that TestFlight
**build 19** actually spans, i.e. everything since the live 1.0 build 7. The
2026-07-29 draft this replaces predated the Apple Watch work entirely and led
with the widget; the Watch app is the headline of this release and was missing.
Every bullet is backed by a commit and by a verification.

**Extended 2026-08-07 for BUILD 24**, which supersedes 19 as the binary under
review. The range grows to `168e0394..ebf60dcb` and the delta is exactly one
user-visible iOS change — `ebf60dcb`, writing a food in yourself — so exactly
one bullet was added. Two things in that range are deliberately NOT described:
`049e5af2` (the widget render fix) is Android-only, and `b8306f9f` (the update
banner) landed *after* build 24 was uploaded and reaches these users over the
air, so claiming it would promise something the binary does not contain.

**The machine-readable copy is `store-assets/whats-new-1.1.0.json`**, which
`scripts/asc-swap-review-build.mjs --notes` uploads. This document stays the
source of truth for wording; if the two disagree, this one is right and the
JSON needs correcting.

**en-US**
```
• Ignia on your wrist — an Apple Watch app and a face complication showing the calories and protein you have left, plus Lock Screen widgets on iPhone
• Home-screen widget — today's calories and protein at a glance
• Apple Health now imports steps and active energy, and your activity level corrects itself from what you actually did
• Writing in a food yourself is now one tap from the top of the Add screen, and a search that finds nothing offers to add what you typed
• Sign in with Google or Apple and connect it to the account you already have — no more accidental second account
• Meal reminders can each be turned off on their own
• One stray weigh-in no longer drags your weight trend
• Refine Targets reliably loads your latest weight
• Dates now follow the app's language instead of the phone's
• Editing a workout template keeps its clusters, cues and progression
• Body measurements no longer vanish while you type, and can be edited after saving
• Rate Ignia without leaving the app
```

**es-MX**
```
• Ignia en tu muñeca: app para Apple Watch y complicación en la carátula con las calorías y la proteína que te quedan, más widgets en la pantalla bloqueada del iPhone
• Widget en la pantalla de inicio: tus calorías y proteína de hoy de un vistazo
• Apple Health ahora importa pasos y energía activa, y tu nivel de actividad se corrige solo según lo que de verdad hiciste
• Escribir una comida tú mismo ahora está a un toque desde arriba en la pantalla de añadir, y una búsqueda sin resultados te ofrece añadir lo que escribiste
• Inicia sesión con Google o Apple y conéctalo a la cuenta que ya tienes: se acabaron las segundas cuentas por accidente
• Cada recordatorio de comida se puede apagar por separado
• Un pesaje fuera de rango ya no arrastra tu tendencia de peso
• Refinar objetivos carga tu peso más reciente de forma confiable
• Las fechas siguen el idioma de la app, no el del teléfono
• Editar una plantilla de entrenamiento conserva sus clusters, claves y progresión
• Las medidas corporales ya no desaparecen mientras escribes y se pueden editar después de guardarlas
• Califica Ignia sin salir de la app
```

| Bullet | Commit(s) | Verified |
|---|---|---|
| Apple Watch app + complication + Lock Screen | `fa0223b6`, `8cc2ba39`, `360662eb` | **on a paired watch, 2026-08-06** — face refreshes after a meal without launching the watch app |
| Widget | `79e9fbff`, `d166a216` | on a physical iPhone, TestFlight build 13 |
| Health activity import + activity-informed TDEE | `4a84dc64`, `2d1e22d6`, `dc009ae4` | — |
| Account linking | `aa8febde` | — |
| Per-reminder switches | `6bae19cd` | — |
| Weigh-in outlier rejection | `946e7250` | — |
| Refine Targets / `dailyWeights` client half | `4f91b1f0` | — |
| Date localization | `5028a9e8` | — |
| Template editor keeps clusters/cues/progression | `e47fd366` | component test |
| Body measurements | `62200d8c` | component test |
| In-app rating prompt | `84898243` | — |

**Both 2026-07-29 QA gates are now cleared** — the widget ran on a physical
iPhone (build 13) and the Watch app on a real watch (build 19), so neither
bullet is a promise against an unrun feature any more.

**Deliberately NOT claimed:** photo scan (off — the production EAS profile sets
`EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0`), anything Pro or purchasable
(`PRO_ENABLED=false`), the manual food-entry rework (merged **after** build 19,
so it is not in this binary), and Apple Health *sync* itself — that shipped in
1.0 and is already live, only the activity import is new here. The
password-reset email rebuild (`6cf63df3`) is server-side and already in effect
for 1.0 users, so it is not app release news.

### Submission-gating fields — 1.1.0 (set 2026-08-06)

| Field | Value | Why |
|---|---|---|
| Attached build | **19** (`4527017a`) | a version with no build attached cannot be submitted; this one had none for two weeks |
| `usesIdfa` | **false** | no ads, no attribution SDK. Left `null` it stops the submission flow to ask |
| Export compliance | declared on the build: `usesNonExemptEncryption=false` | set per-build, not per-version — a new build re-asks |
| Demo account | `review@ignia.fit`, required | ASC carries it forward; never point Review at `demo@ignia.fit` |
| Release type | `AFTER_APPROVAL` | ships the moment Review passes |

### Screenshots on file — 1.1.0 (checked 2026-08-06)

| Locale | `APP_IPHONE_67` | `APP_WATCH_SERIES_10` |
|---|---|---|
| en-US | 5 | 2 |
| es-MX | 4 | 2 |

Watch order is deliberate — **`watch-app-46mm` first, `watch-complication-46mm`
second**. The lead screenshot carries the most weight and App Review wants the
app itself, not a face. Order is not upload order: set it with
`PATCH /v1/appScreenshotSets/{id}/relationships/appScreenshots`, passing the
ids in the order you want.

**The Apple Watch set is new in 1.1.0 and was the last hard blocker** — the app
ships a watchOS app from build 19 on, and Apple will not take the version
without watch screenshots. The enum is `APP_WATCH_SERIES_10` (46mm, **416 × 496
exactly**); a capture of any other size is rejected by size, not resized. Other
valid watch types are `APP_WATCH_ULTRA` (410 × 502), `APP_WATCH_SERIES_7`
(396 × 484), `APP_WATCH_SERIES_4` (368 × 448) — one type is enough.

Upload path is scripted, not manual: `uploadScreenshot(setId, buffer, fileName)`
in `scripts/asc-client.mjs` (reserve → PUT → commit → poll). **`COMPLETE` on
`assetDeliveryState` is the only proof it worked** — the POST returns 200 long
before Apple has processed the image.

**#46 has partial evidence now.** The `watch-app-46mm` capture is the watch
app's own screen at 46mm in English, and it renders clean — nothing clipped,
progress bar full width, text centred. **40mm and Spanish remain unverified**,
so #46 stays open; this closes one of its four cells, not the issue.

One quality gap, not blocking: **es-MX carries the English captures** — the
numbers render in English ("712 kcal left"). Not a rejection risk, but Spanish
captures belong there; the raw-capture convention is
`store-assets/raw/{en,es}/` (git-ignored).

### Review notes
```
All features in Ignia are free. There is no subscription, no paywall and no
gated content. The optional tip (consumable in-app purchase) unlocks nothing
— it is a donation.

Account deletion is available in-app: Settings → Delete account.

Demo account: **`review@ignia.fit`** — set in the dedicated *Demo Account*
fields, not in the notes body.
```

### The two accounts — do not mix them up

| Account | Used for | Set where |
|---|---|---|
| **`review@ignia.fit`** | **App Review signs in here.** Always. | ASC → App Review Information → Demo Account name/password |
| `demo@ignia.fit` | Screenshot captures only | nowhere in ASC |

App Store Connect carries the demo-account fields forward to each new version
automatically, so `review@ignia.fit` stays set without anyone re-entering it —
verified on both 1.0 and 1.1.0. **If it ever needs changing, change it on the
version, not by swapping which account is seeded.**

**The password is deliberately not written down here. This repository is
public**, and a committed password would hand anyone the account App Review
signs in with. It lives in the password manager and in ASC's own field, which
is private to Apple.

Keep both accounts populated with `scripts/seed-demo-account.mjs` (21 days of
logs, a 28-day weight trend, five training sessions). It overwrites in place
rather than stacking a second history:

```sh
node scripts/seed-demo-account.mjs --email review@ignia.fit --reset --force
node scripts/seed-demo-account.mjs --email demo@ignia.fit --reset
```

`--force` is needed for the review account because it predates the script and
carries hand-made rows the guard refuses to touch unasked.

A missing or non-working demo account is a common avoidable rejection, so
verify sign-in on a fresh install before submitting.

---

## 2. Spanish (es-MX) — APPLIED

The es-MX localization **already existed and was filled with the English
copy** — Spanish-locale users were being served an untranslated listing. That
was a live defect, not a missing nice-to-have. Now fully translated.

ASC has no `es-PR` option, which is why the store language is **Spanish
(Mexico) — `es-MX`**; it serves Puerto Rico and the wider LatAm audience. The
in-app locale stays `es-PR`; only the store listing language differs.

Mechanics, if you ever edit these by hand: on **App Information** and on the
**1.1.0 version page**, switch the language dropdown (top right of each
section) from *English (U.S.)* to *Spanish (Mexico)*, then **Save each page
separately** — the two pages have independent Save buttons, and switching
language without saving discards the edits.

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

### Novedades — 1.1.0

Same gating as the English block above: if the widget or Health bullets are
cut there, cut them here too, or the two localizations claim different builds.

```
• Widget en la pantalla de inicio — tus calorías y proteína de un vistazo
• Apple Health ahora importa pasos y energía activa, y tu nivel de actividad se corrige según lo que realmente hiciste
• Un pesaje atípico ya no arrastra tu tendencia de peso — se ignoran los valores fuera de rango
• Refinar metas carga tu peso más reciente de forma confiable
• Cada recordatorio de comida se puede desactivar por separado
• Las fechas ahora siguen el idioma de la app, no el del teléfono
• Califica Ignia sin salir de la app
• Correos de restablecimiento de contraseña rehechos
```

The date-localization bullet matters most to this audience: it is the bug
where a Spanish-language user saw English weekday and month names throughout
the app because the formatter read the phone's locale rather than the app's.

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

Captions are burned into the image, not an ASC field. Drop the raw captures in
`store-assets/raw/<locale>/` and run `node scripts/store-screenshots.mjs` — it
composites the caption band from the table above onto the brand canvas at
exactly 1320 × 2868. Editing copy means editing this table *and* the `SHOTS`
list in that script, then re-running it. See `store-assets/README.md`.

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
