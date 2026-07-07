# Ignia v1 launch runbook (individual, Windows)

One ordered checklist from "store accounts approved" → "submitted." Assumes the
**individual** account decision (2026-07-07) and a **Windows** dev machine (no
Mac). Metadata/privacy-label *content* lives in `docs/APP_STORE_LISTING.md`; the
mobile build/permission status lives in `apps/mobile/MOBILE_RELEASE.md`. This
file is just the **order of operations + the Windows gotchas**.

Config baseline (from `apps/mobile/app.json`): app `Ignia`, version `1.0.0`,
bundle/package `fit.ignia.app`, `usesAppleSignIn: true`, prod build forces
`EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` (no photo-scan in v1).

---

## 0. In flight now (does not wait on account approval)
- [ ] **Apple Developer Program — Individual** enrollment submitted ($99/yr).
- [ ] **Google Play Console — Individual** account created ($25 one-time).
- [ ] **DECISION: set `supportsTablet: false`** in `app.json` for v1. With it
      `true`, App Store Connect **requires iPad 13" screenshots to submit** —
      which you can't capture without an iPad or a Mac simulator. The app is
      phone-first; dropping native iPad support removes an entire screenshot
      class and review surface. (Ask Claude to flip it — one line.)

## 1. Once Apple enrollment is APPROVED
- [ ] **Enable Apple as a sign-in provider** (code is already wired):
      - Firebase Console → Auth → Sign-in method → **Apple** → enable.
      - Apple Developer portal → Certificates, IDs & Profiles → the
        `fit.ignia.app` App ID → enable **Sign in with Apple** capability.
- [ ] **App Store Connect → create the app record** (name Ignia, bundle
      `fit.ignia.app`, primary language English, SKU any string).

## 2. First EAS build — FREE tier (test on a real device)
Windows can't build iOS locally (needs macOS), so iOS uses **EAS cloud, free
tier** (limited builds/mo, slow queue — fine).
- [ ] `cd apps/mobile && npx eas-cli login`
- [ ] `npx eas-cli build -p ios --profile development` → install on your iPhone
      via the EAS/Expo link. This is the **only** way to test Apple + Google
      sign-in (they can't run in Expo Go).
- [ ] Smoke on device: sign in with Apple, sign in with Google, log a meal, log
      weight. Confirm no crash.

## 3. Screenshots (the Windows-hard part)
App Store needs **actual app screenshots at exact pixel sizes** — a browser at
device dimensions is not accepted. Capture on a **physical iPhone**:
- [ ] Take a production (or preview) build to **TestFlight** (`eas submit` after
      §5) OR use the dev build already on your phone.
- [ ] Screenshot on device (Volume-Up + Side button), then AirDrop/email to PC.
- **iOS required:** iPhone **6.9"** set = **1290 × 2796** px (portrait). If ASC
      also asks for 6.5", use **1242 × 2688**. No iPad set if you set
      `supportsTablet: false` in §0.
- **Android (Play):** ≥2 phone screenshots, 1080 px+ on the short side.
- [ ] **Google Play feature graphic — 1024 × 500 PNG/JPG (REQUIRED to publish).**
      Easy to forget; Play won't let you submit without it. (Flame on paper bg.)
- Suggested shots (both stores): Today rings, meal logging, Trends, Train
      session, Body/weight — on a seeded account, flame splash.

## 4. Store metadata + privacy labels
Copy from `docs/APP_STORE_LISTING.md` verbatim:
- [ ] App name, subtitle, promo text, description, keywords, support +
      marketing URL (`https://ignia.fit`), **privacy policy URL**
      (`https://ignia.fit/privacy`).
- [ ] **Apple privacy "nutrition label"** + **Play Data Safety**: declare
      **Health & Fitness** (weight/body/logs) + **Email** + **UID** +
      diagnostics. **Do NOT declare Photos** (progress photos were cut).
      Answers: not used to track, no third-party ads, not sold, encrypted in
      transit, in-app deletion = yes, Hide-My-Email supported.
- [ ] Age rating: **4+** (Apple) / Everyone (Play) — "No" to all restricted
      content questions.
- [ ] Because Google sign-in is offered, **Sign in with Apple is required**
      (guideline 4.8) — it's wired; just make sure the Apple button shows.

## 5. Production build + submit
- [ ] iOS: `npx eas-cli build -p ios --profile production` (cloud free tier) →
      `npx eas-cli submit -p ios --latest` (uploads to App Store Connect).
- [ ] Android: `npx eas-cli build -p android --profile production --local`
      (free, unlimited, on Windows) → upload the `.aab` in Play Console, or
      `npx eas-cli submit -p android --latest`.
- [ ] App Store Connect: attach the build, screenshots, metadata → **Submit for
      Review**. Add review notes: free app, no IAP; test account creds if a
      reviewer needs one.
- [ ] Play Console: create the production release, attach `.aab`, complete the
      content-rating questionnaire + Data Safety → **Roll out**.

## 6. Post-submit
- [ ] Respond fast to any reviewer rejection (usual first-timers: privacy-label
      mismatch, sign-in test account, 4.8 Apple-button placement).
- [ ] After approval: verify a fresh install signs in + logs on both stores.

---

### Known blockers unique to this setup
- **No Mac** → iOS builds only via EAS cloud; iOS screenshots only via a
  physical iPhone. Budget the free-tier build queue wait.
- **Individual account** → your legal name is the public seller on both stores
  (accepted 2026-07-07).
- **Free v1, no IAP** → no StoreKit/Play-Billing products to configure. Pro +
  photo-scan are v1.1 (see `MOBILE_RELEASE.md`).
