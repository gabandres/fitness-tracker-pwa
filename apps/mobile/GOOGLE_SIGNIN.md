# Google Sign-In — finishing the wiring

> ✅ **RESOLVED 2026-07-09.** The OAuth client IDs in `app.json`
> (`extra.googleAuth.iosClientId` `…66v806q2…`, `androidClientId` `…pg0gel6i…`,
> `webClientId` `…jkiccn16…`) and the reversed-client URL scheme in
> `ios.infoPlist.CFBundleURLTypes` are the **correct clients for `fit.ignia.app`**
> (verified against the Firebase `fit.ignia.app` Android/iOS apps' SDK config).
> They are NOT stale. The only thing missing was the **Android signing SHA-1** on
> the Android OAuth client, which caused `Error 400: invalid_request` /
> "Access blocked" on device. Fixed by adding the EAS keystore SHA-1
> `5C:85:B7:1A:87:9D:80:AE:93:8E:66:5B:1B:88:1F:D8:C7:45:4D:EA` to the Ignia
> Android app in Firebase (auto-provisions it onto the OAuth client). **No
> app.json change and no rebuild were needed** — it's a server-side change that
> propagates in minutes. If you ever rebuild with a *different* signing keystore,
> re-add that keystore's SHA-1 the same way (`apksigner verify --print-certs`).

The code is already merged (`src/lib/auth.tsx`, `src/app/sign-in.tsx`). The
"Continue with Google" button is **gated off in Expo Go** — it can only work
in a **development build** (or a store build), because Google OAuth needs a
stable redirect URI that the Expo Go shell can't provide.

To turn it on you need (1) three OAuth client IDs from Google Cloud, pasted
into `app.json`, and (2) a dev build. ~20 min, mostly waiting on the build.

## 1. Enable the provider (once)

Firebase Console → Authentication → Sign-in method → **Google** → Enable.
(Probably already on — the web PWA uses Google sign-in.)

## 2. Create the OAuth client IDs

Google Cloud Console → project **`fitness-tracker-gb-1775407101`** → APIs &
Services → **Credentials**. These IDs are public (ADR-0002) — safe to commit.

- **Web client** — already exists as *"Web client (auto created by Google
  Service)"*. Copy its Client ID → `webClientId`. Firebase validates the
  returned id token against this, so it's required even on native.
- **iOS client** — Create credentials → OAuth client ID → **iOS** →
  bundle ID `fit.ignia.app`. Copy → `iosClientId`. Note its
  **reversed** form `com.googleusercontent.apps.<id>` for step 3.
- **Android client** — Create → **Android** → package `fit.ignia.app`
  + the **SHA-1** of the build's keystore. With EAS-managed credentials,
  get it from `eas credentials` (Android → Keystore). Copy → `androidClientId`.

## 3. Paste IDs into `app.json`

Replace the three `REPLACE_WITH_…` placeholders under `expo.extra.googleAuth`.

For **iOS** also register the reversed client ID as a URL scheme so the
redirect lands back in the app:

```json
"ios": {
  "bundleIdentifier": "fit.ignia.app",
  "supportsTablet": true,
  "infoPlist": {
    "CFBundleURLTypes": [
      { "CFBundleURLSchemes": ["com.googleusercontent.apps.REVERSED_IOS_CLIENT_ID"] }
    ]
  }
}
```

(Android derives its redirect from the package name + SHA-1, so no extra
scheme is needed there.)

## 4. Make a dev build

```sh
npm i -g eas-cli
eas login
eas init           # links this app to your Expo account/project
eas build --profile development --platform android   # free, APK
# or, needs an Apple Developer account ($99/yr):
eas build --profile development --platform ios
```

`eas.json` already defines the `development` profile (dev client + internal
distribution). Install the resulting build on the device, then run
`npx expo start --dev-client` and open it from there — same QR/fast-refresh
loop as Expo Go, but the Google button now works.

## How the code behaves

- **Expo Go / placeholder IDs** → `googleAvailable` is false; tapping the
  button shows *"Google sign-in needs the installed app build."* No crash.
- **Dev/store build with real IDs** → `promptAsync()` opens the Google
  consent screen, returns an `id_token`, and the app calls Firebase
  `signInWithCredential(GoogleAuthProvider.credential(idToken))`.

If a user already has an email/password account on the same address, Firebase
links or surfaces `account-exists-with-different-credential` (handled with a
friendly message in `sign-in.tsx`).
