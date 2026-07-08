# Ignia — App Store / Play listing + privacy labels (v1 draft)

Draft metadata for the first (free) submission. Edit to taste; character
limits noted. Support/marketing/privacy URLs assume `ignia.fit` is live.

## Names & URLs
- **Seller / developer name:** the owner's **individual legal name** (no LLC —
  decided 2026-07-07). This shows publicly on both stores. App is still "Ignia".
- **App Store listing title (≤30):** `Ignia — Calories & Training` (27) — the
  bare word "Ignia" was already reserved by another developer in App Store
  Connect, so the unique listing title carries a descriptor + leads with the
  training differentiator. **On-device the app still reads "Ignia"** (from
  `app.json` name / CFBundleDisplayName) — unaffected.
- **App name (on-device / build):** Ignia
- **Subtitle** (iOS, ≤30 chars): `Protein tracker & fasting` (25) — complements
  the title so "protein tracker" + "fasting" stay keyword-indexed (title already
  carries calories + training).
- **Promotional text** (iOS, ≤170, editable without review): `Track calories,
  protein, and your training in one simple, private app. No ads, no clutter —
  just the numbers that move the needle.`
- **Support URL:** https://ignia.fit  ·  **Marketing URL:** https://ignia.fit
- **Privacy Policy URL:** https://ignia.fit/privacy
- **Primary category:** Health & Fitness  ·  **Secondary:** Food & Drink

## Keywords (iOS, ≤100 chars, comma-sep, no spaces)
`calorie,protein,macro,tracker,food,diet,weight,fasting,workout,gym,cut,tdee,fitness,nutrition`

## Description (App Store / Play, ≤4000)
```
Ignia is a fast, private calorie + protein tracker for people who lift and
people in a cut — without the bloat of other apps.

• Log meals in seconds and see calories and protein left for the day at a glance
• Set a goal (lose, maintain, gain) and get a target that adapts to your weight
• Track workouts alongside your nutrition — most trackers ignore training
• Log body weight, measurements, water, sleep, and fasting windows
• Clean, calm design. No ads. No selling your data.

Ignia keeps the numbers that actually move the needle front and center, and
leaves out everything that doesn't.

Free to use. (A Pro tier with extra features is coming.)
```

## What's New (v1.0.0)
`First release of Ignia — calorie & protein tracking, workouts, body metrics,
fasting, and a clean daily dashboard.`

## Spanish localization (ASC = "Spanish (Mexico)"; serves the es-PR audience)
Apple has no `es-PR`; add the **Spanish (Mexico)** localization. Copy is neutral
Latin-American / PR-friendly (entreno, pesas, déficit). Screenshots can be reused
(localized screenshots not required).

- **Name (≤30):** `Ignia — Calorías y Entreno` (26)
- **Subtitle (≤30):** `Proteína, ayuno y entreno` (25)
- **Promotional text (≤170):** `Registra calorías, proteína y tu entrenamiento en una app tranquila y privada. Sin anuncios ni relleno — solo los números que de verdad importan.`
- **Keywords (≤100):** `calorías,proteína,macros,contador,comida,dieta,peso,ayuno,pesas,gym,entreno,nutrición,tdee`
- **Description (≤4000):**
```
Ignia es un contador de calorías y proteína rápido y privado, para quienes levantan pesas y quienes están en déficit — sin el relleno de otras apps.

• Registra comidas en segundos y ve de un vistazo cuántas calorías y proteína te quedan hoy
• Fija una meta (bajar, mantener, subir) y recibe un objetivo que se ajusta a tu peso
• Registra tus entrenamientos junto a tu nutrición — la mayoría de los trackers ignoran el entrenamiento
• Anota tu peso, medidas, agua, sueño y ventanas de ayuno
• Diseño limpio y tranquilo. Sin anuncios. Sin vender tus datos.

Gratis. Sin anuncios. Sin suscripciones.
```
- **What's New / Novedades (1.0.0):** `Primer lanzamiento de Ignia — registro de calorías y proteína, entrenamientos, métricas corporales, ayuno y un panel diario limpio.`

## Age rating
- iOS: likely **4+** (no objectionable content). Answer "No" to all restricted
  content questions.
- Play content rating questionnaire: general/Everyone.

## Privacy labels (be accurate — health data is sensitive)

**Data collected & linked to the user's identity:**
| Data | ASC category | Play Data Safety | Purpose |
|------|--------------|------------------|---------|
| Email address | Contact Info → Email | Personal info → Email | Account / App functionality |
| Weight, body measurements, body-fat | Health & Fitness | Health & fitness | App functionality |
| Food/calorie logs, workouts, fasting, water, sleep | Health & Fitness / Other usage data | Health & fitness | App functionality |
| User ID (Firebase UID) | Identifiers | App activity / IDs | App functionality |
| Crash / diagnostics (Sentry, if DSN set) | Diagnostics | App info & performance → Crash logs | App functionality |

**Key answers:**
- **Used to track you across apps/sites?** No.
- **Used for third-party advertising?** No.
- **Data sold?** No.
- **Data encrypted in transit?** Yes (HTTPS/Firebase).
- **Can users request deletion?** Yes — in-app account deletion + GDPR flow
  (`functions/src/gdpr.ts`).
- **Sign in with Apple** present → offer Apple's "Hide My Email" is supported by
  the provider automatically.

> Auth providers: Email/Password, Google, Apple. Because Google sign-in is
> offered, **Sign in with Apple is required** (guideline 4.8) — it's wired.

## Screenshots needed (owner, from a device/simulator)
iPhone 6.9" + 6.5" (required), iPad 13" if `supportsTablet`. Suggested shots:
Today dashboard (rings), meal logging, Trends, Train session, Body/weight.
Android: phone + 7"/10" tablet. Capture on the flame-splash + a seeded account.
