# Mobile release readiness (App Store / Play)

Status of shipping the Ignia Expo app to stores. **v1 scope (decided
2026-07-05): FREE, no Pro tier → no StoreKit IAP.** Pro + photo-scan land in
v1.1. That removes the single biggest blocker from the first submission.

## ✅ Done in code
- Rebrand → **Ignia**; flame icons, adaptive icon, splash, favicon.
- Bundle IDs (`fit.ignia.app`), version `1.0.0`.
- `eas.json` build profiles (development / preview / production) + submit.
  Production build sets `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` so v1 ships without
  the (still-unvalidated) photo-scan; flip it on for v1.1 after the vision
  spike.
- Google Auth client IDs wired (`app.json` → `extra.googleAuth`).
- **Sign in with Apple (code) — DONE.** `expo-apple-authentication` +
  `usesAppleSignIn` capability + plugin (`app.json`); native Apple button on
  the sign-in screen (iOS-only, gated off in Expo Go); nonce via `expo-crypto`
  → Firebase `OAuthProvider('apple.com')` in `src/lib/auth.tsx`.
- Permission hygiene: camera usage string set; mic/RECORD_AUDIO removed.

## 🚫 Owner-gated blockers (need your Apple/Google/EAS accounts)

1. **Apple Developer Program** ($99/yr) + an App Store Connect app record.
   Play Console ($25 one-time) for Android.
2. **Enable Apple as a sign-in provider** — Firebase Console → Auth → Sign-in
   method → Apple (enable); Apple Developer portal → enable "Sign in with
   Apple" capability on the `fit.ignia.app` App ID. (Code is already in.)
3. **EAS build + credentials.** `eas login`, then
   `eas build -p ios --profile production` (and `-p android`). First iOS build
   provisions signing certs interactively. This is also the only way to test
   the native-gated features (Apple/Google sign-in) — they can't run in Expo Go.
4. **App privacy details ("nutrition label").** App Store Connect + Play Data
   Safety. We collect **health data** (weight, body metrics) + email — declare
   accurately. See `docs/APP_STORE_LISTING.md` for the exact mapping.
5. **Store listing assets.** Screenshots per device class, description,
   keywords, support + marketing URL. Draft copy in `docs/APP_STORE_LISTING.md`.

## Deferred to v1.1 (post-launch)
- **Pro tier + StoreKit IAP** (RevenueCat or react-native-iap + receipt-trust
  gating; App Store Connect + Play Billing subscription products). The big one.
- **Photo-scan** (flip `EXPO_PUBLIC_FEATURE_PHOTO_SCAN`) after the Gemini
  vision-accuracy validation spike (30–50 real photos).
- App Check (abuse/quota protection) — see `docs/DEV_ENVIRONMENT.md`.

## Recommended order (v1)
Apple Dev + Play accounts → enable Apple provider (Firebase + portal) → first
EAS dev build (test Apple/Google sign-in on device) → privacy labels + store
metadata → `eas build --profile production` → `eas submit`.

**With free v1, the app IS submittable** once the account + Apple-provider +
metadata steps above are done — no IAP gate anymore.
