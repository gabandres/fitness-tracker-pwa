# ADR-0012 — Native iOS app via Expo (separate RN frontend, shared core)

**Status:** accepted
**Date:** 2026-06-28
**Related:** ADR-0011 (Capacitor — the rejected alternative), ADR-0002
(no-backend), ADR-0005 (store split). Supersedes ADR-0011's framework
choice; ADR-0011's IAP/4.2/RevenueCat analysis still applies if/when we
go to the public App Store.

---

## Context

We want Ignia on iPhone with genuine **native feel/perf** — a
nutrition app is list-heavy (day logs, history grids, exercise sets) and
WebView scrolling is the felt weakness. ADR-0011 chose **Capacitor**
(wrap the existing Angular build in a WebView, one codebase). That keeps
all code but ships the same WebView UI — it does not deliver native feel,
which is the *only* goal here. The other Capacitor reasons (App Store
approval, RN ecosystem) were considered and dropped: 4.2 approval comes
from native *capabilities* (HealthKit/push), not the framework, and is
out of scope for v1.

So we accept the cost Capacitor was meant to avoid: **a React Native UI
rewrite.** The PWA is NOT abandoned — it remains the primary web product
and the no-App-Store distribution path. We get two frontends over one
backend.

## Decision

Build a **separate Expo (React Native) app** for iOS that shares the
Firebase backend and the app's *pure logic* with the existing Angular
PWA, which is left untouched.

### Code layout — same repo, add-on workspaces
Angular stays at the repo root. Add npm workspaces:
- `packages/core/` — the **shared brain**: the pure `utils/` (day-summary,
  plate-math, tdee, weekly-insights, weekly-budget, body-fat, warmup,
  workout-progression, meal-draft, import-csv, …), `models/`, the domain
  types, and the **Firestore ledger core**. All framework-free TypeScript,
  already unit-tested. Both apps import it.
- `apps/mobile/` — the Expo app.

The ledger core ports as a **one-line import swap**: it imports
`addDoc`/`doc`/`getDoc`/`writeBatch`/… from `@angular/fire/firestore`,
which merely re-exports the identical Firebase JS SDK modular functions
from `firebase/firestore`. The `@angular/core` `InjectionToken` in
`ledger.port.ts` is stripped from the shared copy (the port becomes a
plain TS interface; Angular keeps its DI token in its own layer).

### Mobile stack
- **Firebase JS SDK** (the same SDK Angular uses), NOT
  `react-native-firebase` — chosen so the shared ledger core ports
  verbatim. Auth persists via
  `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })`.
  **Consequence:** Firestore durable offline persistence uses IndexedDB,
  which does not exist in React Native — mobile Firestore is
  **online-only** (in-session memory cache, no cross-launch offline).
  Acceptable for v1; revisit `react-native-firebase` if airplane-mode
  offline becomes a hard requirement.
- **Expo Router** (file-based nav), **NativeWind** (reuse the Tailwind
  vocabulary + paper palette `#f2ead7`), **hooks + Firestore `onSnapshot`**
  for data (thin `useToday`/`useHistory` hooks over the shared core; a
  small Zustand/Context store for auth/profile/units).

### Distribution & auth — free for now
v1 targets **the developer's own iPhone**, not the public App Store. This
deletes IAP/RevenueCat, Sign-in-with-Apple requirement, privacy labels,
and review (all deferred to a possible phase 2, where ADR-0011's analysis
returns). The existing Stripe `stripeRole: "paid"` claim grants Pro
automatically on sign-in — no purchase UI.

- **Now (free):** run in **Expo Go** (`npx expo start`, scan QR). The
  whole v1 stack is pure-JS / Expo-SDK and runs in Expo Go.
- **Auth in Expo Go:** native Google sign-in libraries **cannot run in
  Expo Go** (require a dev build, per current Expo docs). So the dev/owner
  account gets an **email/password credential linked to its existing
  Google account** (same uid, data, Pro claim; one-time Admin SDK
  `updateUser({password})`), and v1 signs in with email/password — no
  native module, fully free.
- **Later ($99/yr Apple Developer):** EAS Build → standalone app icon /
  TestFlight, and swap in native `@react-native-google-signin`. EAS builds
  in the cloud, so **no Mac is required**.

### v1 scope — the core daily loop only
Auth + Today (log/edit food, macro rings) + History + day detail + log
weight. **Deferred:** AI (Gemini chat/photo — also blocked natively
because the client Gemini key is HTTP-referrer-restricted; needs a CF
route or App Check), Train, Trends, Body photos, Recipes, Barcode, CSV,
Admin, push (needs APNs + a real build), i18n (English-only v1), IAP.
Marketing/SEO surfaces (landing, calculator, faq, vs-page, …) are
web-only and never ported.

## Considered Options

- **Capacitor (ADR-0011)** — reuses 100% of the Angular UI, zero rewrite.
  Rejected: it ships a WebView, which is the exact thing we want to escape.
- **`react-native-firebase`** — full native offline + push. Rejected for
  v1: different API surface breaks the one-line shared-core port and
  forces dev builds (no free Expo Go).
- **Reimplement the math in the Expo app** — rejected: doubles
  maintenance and risks silent divergence (e.g. TDEE formula drift);
  hence `packages/core`.

## Consequences

- **Two frontends, forever.** Every shared-logic change is one place
  (`packages/core`); every UI feature is now potentially two ports. New
  product features should land logic in `core` first.
- **Metro + monorepo** is the first thing that will bite — Expo's bundler
  needs `metro.config.js` `watchFolders`/`nodeModulesPaths` to resolve the
  workspace package. Budget setup time.
- The **PWA remains canonical** for web, SEO, and Stripe checkout. ADR-0002
  (no-backend) is unchanged — the Expo app is just another Firestore-direct
  client under the same security rules.
- Going to the **public App Store** re-activates the entire ADR-0011
  checklist (IAP, 4.2 capabilities, Apple sign-in) as explicit phase-2
  work, not a surprise.
