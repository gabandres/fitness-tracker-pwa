# Mobile release readiness (App Store / Play)

Status of shipping the Expo app to stores. **Code-doable items are done or
tracked here; the rest are owner-gated** (need your Apple/Google/EAS accounts).

## ✅ Done in code
- Bundle IDs (`app.macrolog.mobile`), version `1.0.0`, icons, adaptive icon, splash.
- `eas.json` build profiles (development / preview / production) + submit.
- Google Auth client IDs wired (`app.json` → `extra.googleAuth`).
- Permission hygiene: camera usage string set; **microphone/RECORD_AUDIO removed**
  (`recordAudioAndroid:false`, `microphonePermission:false`) — the app only scans
  barcodes, so the unused mic permission (a review-rejection + missing-usage-string
  risk) is gone.

## 🚫 Owner-gated blockers (cannot be done from code alone)

1. **Apple Developer Program** ($99/yr) + an App Store Connect app record. Play
   Console ($25 one-time) for Android.
2. **EAS build + credentials.** `expo login`, then `eas build -p ios --profile production`
   (and `-p android`). First iOS build provisions signing certs interactively.
   This is also what unblocks testing the native-gated features below (they can't
   run in stock Expo Go): Google Sign-In, ML Kit label OCR.
3. **Sign in with Apple — REQUIRED.** Apple guideline 4.8: because the app offers
   Google sign-in, it MUST also offer Sign in with Apple or review will reject it.
   - Code (I can do): add `expo-apple-authentication`, an Apple button on the
     sign-in screen, wire to Firebase `OAuthProvider('apple.com')`.
   - Owner: enable the Apple provider in Firebase Auth; add the Sign-in-with-Apple
     capability + a Services ID in the Apple Developer portal.
4. **In-App Purchase for Pro — REQUIRED, biggest effort.** App Store forbids
   Stripe web checkout for digital subscriptions; it must go through StoreKit IAP.
   - Owner: create auto-renewable subscription products in App Store Connect
     (and Play Billing for Android).
   - Code: adopt RevenueCat (recommended) or `react-native-iap`, then a mobile
     Pro-gating path that trusts the store receipt instead of the Stripe
     subscription doc. This is a real project, not a config tweak.
5. **App privacy details ("nutrition label").** App Store Connect + Play Data
   Safety form. We collect **health data** (weight, body metrics) — must be
   declared accurately. Privacy policy URL exists (`/privacy`).
6. **Store listing assets.** Screenshots (per device class), description,
   keywords, support URL, marketing URL.

## Recommended order
Apple Dev + Play accounts → first EAS dev build (test native features) →
Apple Sign-In → IAP/Pro rework → store metadata + privacy labels → submit.

Until IAP + Apple Sign-In land, the app is **not submittable** to the App Store.
Android has no Apple-Sign-In equivalent requirement but still needs Play Billing
for Pro.
