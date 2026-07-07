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

## Account type: INDIVIDUAL (no LLC) — decided 2026-07-07

The Wyoming-LLC plan was **dropped** (foreign-LLC-in-PR yearly fees vs $0
income). Launching as a **sole individual** in the owner's own legal name.
Consequences to know before enrolling:

- **Apple: Individual enrollment** ($99/yr). **No D-U-N-S needed** — that was
  the org-only long pole, so this is the *faster* path. Your **legal name shows
  publicly as the seller** on the App Store (owner accepted this).
- **Google Play: Individual** developer account ($25 one-time). Google also
  shows your name (and, for the required contact, often an address) publicly.
- **No Stripe / no IAP in v1** — the app is free, so there is no payment entity
  to set up and no billing PII. (Pro + IAP is v1.1; revisit an entity then if
  revenue appears.)

## 🚫 Owner-gated blockers (need your Apple/Google/EAS accounts)

1. **Apple Developer Program — Individual** ($99/yr) + an App Store Connect app
   record. **Play Console — Individual** ($25 one-time) for Android.
2. **Enable Apple as a sign-in provider** — Firebase Console → Auth → Sign-in
   method → Apple (enable); Apple Developer portal → enable "Sign in with
   Apple" capability on the `fit.ignia.app` App ID. (Code is already in.)
3. **EAS build + credentials.** `eas login`, then
   `eas build -p ios --profile production` (and `-p android`). First iOS build
   provisions signing certs interactively. This is also the only way to test
   the native-gated features (Apple/Google sign-in) — they can't run in Expo Go.
   **See "Builds without paying EAS" below** — the free tier is enough.
4. **App privacy details ("nutrition label").** App Store Connect + Play Data
   Safety. We collect **health data** (weight, body metrics) + email — declare
   accurately. See `docs/APP_STORE_LISTING.md` for the exact mapping.
   (Progress photos were removed pre-launch — do **not** declare Photos.)
5. **Store listing assets.** Screenshots per device class, description,
   keywords, support + marketing URL. Draft copy in `docs/APP_STORE_LISTING.md`.

## Builds without paying EAS (owner is on Windows)

You do **not** need the paid EAS plan. Two facts drive this:

- **iOS builds require macOS somewhere.** You're on Windows, so
  `eas build --local` is **not possible for iOS** (no Xcode/macOS). Your only
  no-Mac iOS path is **EAS cloud build on the FREE tier**: a limited number of
  builds per month on a slower "free-tier" queue (you wait behind paid users).
  For an app that ships a few times a month, that is completely fine — slow ≠
  blocking. Do **not** buy the Production/paid plan for this.
  ```sh
  cd apps/mobile
  npx eas-cli login
  npx eas-cli build -p ios --profile production      # cloud, free tier
  npx eas-cli submit -p ios --latest                 # upload to App Store Connect
  ```
- **Android can build locally on Windows for free (unlimited).** With the
  Android SDK + JDK installed, `--local` runs on your machine, no EAS queue:
  ```sh
  npx eas-cli build -p android --profile production --local
  # → produces an .aab; upload it in Play Console, or:
  npx eas-cli submit -p android --latest
  ```
  Or just use the free EAS cloud tier for Android too if you don't want to set
  up the local Android toolchain.

Bottom line: **free EAS tier covers iOS; local build covers Android.** The
"infinite builds" paid plan only buys speed and concurrency you don't need yet.

## Deferred to v1.1 (post-launch)
- **Pro tier + StoreKit IAP** (RevenueCat or react-native-iap + receipt-trust
  gating; App Store Connect + Play Billing subscription products). The big one.
- **Photo-scan** (flip `EXPO_PUBLIC_FEATURE_PHOTO_SCAN`) after the Gemini
  vision-accuracy validation spike (30–50 real photos).
- App Check (abuse/quota protection) — see `docs/DEV_ENVIRONMENT.md`.

## Recommended order (v1)
Apple Dev (Individual) + Play (Individual) accounts → enable Apple provider
(Firebase + portal) → first EAS **free-tier** dev build (test Apple/Google
sign-in on device) → privacy labels + store metadata → `eas build --profile
production` (iOS cloud free-tier; Android `--local`) → `eas submit`.

**With free v1, the app IS submittable** once the account + Apple-provider +
metadata steps above are done — no IAP gate anymore.
