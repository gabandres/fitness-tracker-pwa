# ADR-0011 — Native app store path: Capacitor shell + IAP

**Status:** Proposed (planning only — no code yet)
**Date:** 2026-06-19
**Related:** `docs/go-to-market.md`, ADR-0010 (Storage), the Stripe Pro flow
(`SubscriptionService`, `stripeRole` custom claim).

---

## Context

Ignia is an Angular + Firebase PWA, monetized on the web via Stripe
(Pro = the `stripeRole: "paid"` custom claim, read by `SubscriptionService.isPaid()`).
We want an iOS (and Google Play) presence to (a) reach users who only install
from stores and (b) monetize there.

Two hard constraints shape every decision:

1. **Apple Guideline 4.2** rejects "repackaged website" wrappers. A bare PWA
   wrapper risks rejection; the shell must expose real native capability.
2. **Apple Guideline 3.1.1**: digital subscriptions sold *inside* an iOS app
   must use **StoreKit IAP** — we cannot charge our Stripe price there. (The
   2025 external-link ruling was narrowed on appeal in Dec 2025; assume Apple
   IAP at the 15% Small Business rate, not Stripe.)

So this is not "wrap and ship." The real work is **native auth, native IAP,
and reconciling a second payment system with the existing Stripe entitlement.**

## Decision

Wrap the existing Angular build in **Capacitor** (not a rewrite), add the
native capabilities needed to clear 4.2, and sell Pro through **RevenueCat**
(which abstracts StoreKit + Google Play Billing and reconciles with our Stripe
web subscriptions under one entitlement).

Keep **one codebase**: the same Angular app runs as PWA (web) and inside the
Capacitor WebView (iOS/Android). Platform differences hide behind a thin
`PlatformService` (web vs native) and Capacitor plugins.

---

## Architecture

```
Angular app (existing)
  ├── web build  → Firebase Hosting (PWA, Stripe checkout)   [unchanged]
  └── native build → Capacitor WebView (iOS / Android)
        ├── @capacitor/* plugins (push, haptics, status bar, app, share, browser)
        ├── @capacitor-firebase/authentication  (native Google/Apple sign-in)
        ├── RevenueCat (@revenuecat/purchases-capacitor)  → StoreKit / Play Billing
        └── (optional) HealthKit / Health Connect bridge
```

### 1. Native capabilities to clear Guideline 4.2
Ship features a browser tab can't, so review sees "more than a website":
- **Native push** (daily reminders via FCM + APNs) — already have web push;
  add native.
- **Home-screen widget / Live Activity** (stretch) — strong 4.2 signal.
- **HealthKit (iOS) / Health Connect (Android)**: read bodyweight / write
  nutrition + workouts. High user value *and* the clearest 4.2 differentiator.
- Native camera path for photo/barcode (Capacitor Camera) instead of the web
  `getUserMedia` flow.
- Haptics, native share sheet for the share-card.

### 2. Auth
WKWebView breaks some Firebase web OAuth popup/redirect flows, and Apple
requires **Sign in with Apple** whenever other social logins are offered.
- Use `@capacitor-firebase/authentication` for **native Google + Apple**
  sign-in; bridge the credential into the existing Firebase Auth session so
  the rest of the app is unchanged.
- Email/password continues to work in-WebView.
- Gate: detect platform and swap the sign-in buttons.

### 3. Payments / IAP — the core work
- Adopt **RevenueCat**. Define one entitlement: `pro`.
- iOS: StoreKit products (annual + monthly, with intro 7-day trial).
  Android: matching Play Billing products. RevenueCat maps both to `pro`.
- **Entitlement unification** (critical): Pro can now come from *either*
  Stripe (web) or RevenueCat (mobile). Single source of truth = the Firebase
  custom claim.
  - Keep the existing `stripeRole: "paid"` claim for web.
  - Add a Cloud Function webhook for **RevenueCat events** → set/clear a
    `pro` claim (or reuse `stripeRole`) for that uid.
  - `SubscriptionService.isPaid()` returns true if *any* source grants Pro.
  - Pass the Firebase uid to RevenueCat as the `appUserID` so events map to
    the right account.
- **Don't double-charge / don't cross-sell the wrong store**: if a user is
  already Pro via Stripe, show "managed on web" on mobile (no IAP button);
  if Pro via IAP, the web shows "managed in the App Store." Reconcile by
  checking both before rendering the paywall.
- Restore purchases button (Apple requirement).

### 4. Push
- FCM already wired server-side. Add APNs key in Firebase, enable
  `@capacitor/push-notifications`, request permission natively, register the
  token. Reuse existing reminder Cloud Functions.

### 5. Service worker / offline
- `ngsw` (Angular SW) is for the PWA. Inside Capacitor the app is served from
  the bundle; a SW caching layer can fight Capacitor's WebView and break OTA.
  **Disable ngsw in the native build** (separate build config) and rely on
  Capacitor's bundled assets + Firestore offline persistence.

### 6. OTA updates (optional)
- Apple permits JS/asset OTA updates that don't change the app's purpose
  (Capgo / Appflow Live Updates). Useful to push fixes without a review cycle,
  but **never** ship native-capability or paywall changes via OTA. Optional,
  phase 2.

### 7. Deep links
- Universal Links (iOS) / App Links (Android) for the `?action=add`
  deep-link the PWA already supports.

---

## Build / release pipeline
- Add `ios/` and `android/` Capacitor projects (gitignored build artifacts).
- macOS + Xcode required for iOS builds/signing (CI: a macOS runner or local).
- Android: `$25` one-time Play fee; iOS: `$99/yr` Apple Developer.
- TestFlight (iOS) + Play internal testing tracks before public release.
- Keep the web CI deploy as-is; native builds are a separate lane.

---

## Phases & rough effort
1. **Capacitor shell + native build green** (app runs in WebView, splash,
   status bar, safe areas). ~2–3 days.
2. **Native auth** (Google + Apple sign-in bridged to Firebase). ~2–3 days
   (Apple sign-in + cert setup is the fiddly part).
3. **RevenueCat IAP + entitlement reconciliation** (products, paywall swap,
   webhook → claim, restore, dual-source `isPaid`). ~4–6 days. **Highest risk.**
4. **4.2 capability** (HealthKit/Health Connect or widget + native push).
   ~3–5 days; required for confident approval.
5. **Store assets + review** (screenshots, privacy nutrition labels, app
   privacy, review notes explaining native value). ~2 days + review latency.

Call it **~3–4 focused weeks** for a defensible iOS submission; Android is a
fast-follow once Capacitor + RevenueCat exist.

---

## Costs
- Apple Developer Program: **$99/yr** (the trivial cost).
- Google Play: **$25 one-time**.
- RevenueCat: free under ~$2.5k monthly tracked revenue, then ~1%.
- Real cost = **engineering time** (above) + ongoing Firebase/Gemini usage as
  installs grow (keep AI Pro-gated with quotas).

## Risks
- **4.2 rejection** if native value is thin → mitigate with HealthKit + push +
  (ideally) a widget before submitting.
- **IAP review** rejections (missing restore, price mismatch, trial terms) →
  follow RevenueCat's iOS checklist.
- **Entitlement drift** (user Pro on web but not mobile or vice-versa) →
  single-claim source of truth + reconcile-before-paywall.
- **WebView ≠ Safari** quirks (camera, OAuth, SW) → the platform shims above.
- **Apple ↔ Epic** rules are still moving (Supreme Court petition, Apr 2026);
  build for IAP, watch for external-payment relaxation.

## Recommendation on sequencing
Per `go-to-market.md`: **don't start here.** Ship the cheap wins first
(PWA install, OFF search, paywall + pricing), validate that strangers pay on
web, and consider **Google Play via TWA** ($25, accepts PWAs) as the first
store. Invest in this iOS/Capacitor + IAP work only once web revenue or a
marketing channel justifies the ~3–4 weeks.
