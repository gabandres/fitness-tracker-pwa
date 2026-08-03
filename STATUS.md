# STATUS — what is true right now

**Updated:** 2026-08-03 · **Owns:** current state only. Not history (`CHANGELOG.md`),
not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`).

If a statement here conflicts with any other file in this repo, **this file wins** —
or the other file is stale and should be deleted. Every claim below has a
verification command; if you are about to scope work off a claim, run the command
first. Three separate times this project scoped already-shipped features as new
work because a plan doc was read as a status doc.

---

## 1. Live right now

| Surface | State | Verify |
|---|---|---|
| Web PWA `ignia.fit` | **Live**, bilingual (EN + es-PR), **105** prerendered pages (en 52 / es 53), 114-URL sitemap | `npm run build` prints both counts |
| iOS App Store | **1.0.0, build 7** (uploaded 2026-07-20, `READY_FOR_SALE`), from commit `168e0394` | ASC command below |
| iOS 1.1.0 | **Binary exists at last: build 13** (EAS `5949a3ea`, commit `458d60db`, 2026-08-03), submitted to TestFlight. Version page still `PREPARE_FOR_SUBMISSION` — **not submitted to App Review**. First production binary that actually contains the widget's `ExtensionStorage` pod (`Installing ExtensionStorage (1.0.0)` in its build log) — **and the widget is now confirmed working from it on a physical iPhone (2026-08-03): kcal left + protein left, updating after a logged meal** | ASC command below |
| Android / Play | **Not launched.** Play Console account exists, **developer verification complete** and `fit.ignia.app` **package name registered** (both 2026-07-31), proven with an APK signed by `apps/mobile/credentials/dev.keystore` (alias `macrolog-dev`, SHA-256 `75:4B:03:19:…:F6:D8`) — **that keystore is now load-bearing app identity; it is git-ignored and exists in one place**. App entry created (`4975181896468259775`). **The first AAB is uploaded and the whole app is IN REVIEW at Google** as of 2026-08-02 — versionName 1.1.0 / **versionCode 4**, EAS build `2d36d121`, on the **Closed testing - Alpha** track (id `4699799777678836720`), 177 countries, signed by that same key (verified with `keytool -printcert -jarfile`). 14 changes went in one submission because it is the app's first: store listing, content rating, data safety, health declaration, the release itself. Reviews are quoted at up to 7 days. Tester list `Ignia Beta Testers` holds **6 emails; 12 are required** **Personal developer account → production access requires closed testing with 12 testers opted in 14 CONTINUOUS days** ([policy](https://support.google.com/googleplay/android-developer/answer/14151465)); the clock cannot start until a build is in a closed track, so the AAB is the critical path, not the paperwork | Play Console → Android developer verification → Package names |
| Cloud Functions / rules | Deployed, project `fitness-tracker-gb-1775407101` | `firebase deploy --only functions --dry-run` |

**The `1.1.0` trap.** `app.json` says 1.1.0 and ASC has a 1.1.0 version page, but
**EAS has never built a 1.1.0 iOS binary**. Anything a doc describes as "shipped in
1.1.0" shipped in **1.0** or has not shipped at all. Do not trust a version number
in prose; ask ASC:

```sh
node -e "import('./scripts/asc-client.mjs').then(async({api,APP_ID})=>{const r=await api('GET','/v1/apps/'+APP_ID+'/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState');r.data.forEach(v=>console.log(v.attributes.versionString,v.attributes.appStoreState))})"
```

## 2. Written, merged, and in **no** binary

All of this is on `main` and reaches nobody until the next iOS build. Do not
re-scope it as new work; do not describe it to users as available.

- **Sentry + Google sign-in diagnostics (mobile)** — the Expo app had no error
  reporting of any kind, which is why the Play sign-in break below took a day to
  find. Sentry project **`ignia-mobile`** (org `gabriel-bermudez`, id
  `4511848397996032`); DSN wired into `apps/mobile/app.json`, ingestion verified
  end-to-end with a test event 2026-08-03. Google sign-in failures now carry the
  native code (`DEVELOPER_ERROR`, `PLAY_SERVICES_NOT_AVAILABLE`, …) instead of
  collapsing to one sentence. **Reaches nobody until a new Android build.**
  The web Sentry project was renamed `macrolog` → **`ignia-web`** in the same
  pass; its project id and DSN are unchanged, so `src/environments/environment.ts`
  needed no edit.
- **Home-screen widget — Android half only** (`apps/mobile/src/widgets/`). It is
  in Play vc 4 (in review), but nobody has put it on an Android home screen, and
  its task handler registers through the custom `index.js` — a path no device has
  exercised. **The iOS widget is no longer in this list: it is verified working
  on a physical iPhone from TestFlight build 13 (2026-08-03), including refresh
  after a meal.**
- **The Apple Watch complication and its transport** — the watch app
  (`targets/watch/`), the face complication (`targets/watch-widget/`), the
  three iOS **Lock Screen** accessory families, one shared Swift contract
  (`targets/_shared/Glance.swift`), and the repo's first custom Expo Module
  (`modules/watch-link/`) carrying the snapshot over
  `WCSession.updateApplicationContext`. **None of it has ever been
  compiled** — Windows, no Xcode, and `expo prebuild -p ios` does not run
  here. What *was* verified locally: `tsc` clean, both `expo-target.config.js`
  files evaluate to the right entitlements, and
  `expo-modules-autolinking search -p apple` resolves `watch-link` →
  `WatchLinkModule` (the check that would have caught the `ExtensionStorage`
  disappearance in §3). Blocked on a Mac for #46/#47. The credentials half is **cleared** —
  all four targets have App Store profiles as of 2026-08-03 (§3).
- **Health activity import** (steps / active energy → `dailyActivity`). Import +
  display only; deliberately does **not** feed measured-mode TDEE.
- **Per-meal reminder settings** (fixes the un-silenceable 1:30pm lunch nudge).
- **In-app rating prompt** (`84898243`).
- **Date localization** — dates followed the phone's locale, not the app's, so a
  Spanish user saw English weekday and month names throughout (`5028a9e8`).
- **Weigh-in outlier rejection** — one stray reading could rewrite the whole weight
  trend and drag the measured target to the floor (`946e7250`).
- **The Refine Targets catch** (`4f91b1f0`). Only the client half is pending: the
  `dailyWeights` index that commit added is *deployed*, and it already repaired
  Refine Targets for users on 1.0 without an app update.

Verify anything in this list with `git log 168e0394..HEAD -- <path>` — that range is
exactly "merged since the live binary". For a single commit, the sharper test is
`git merge-base --is-ancestor <sha> 168e0394` (exit 0 = it is *in* the live binary).

**Three items were wrongly listed here on 2026-07-29** and are called out so the
mistake is not re-made: the **recipe-URL import UI**, the **mobile verify-email
gate** (`a0049b84`), and **the App Review fixes from the two 1.0 rejections**
(`97662575`, `eb922813`, `04f30dcc`) are all **in 1.0**. The last of those is
provable without git: 1.0 is `READY_FOR_SALE`, and it only got there by passing the
review those commits fixed.

## 3. The binding constraint: iOS builds

- iOS cannot be built on this machine. Windows, no Xcode. There is no local path.
- iOS builds come from **EAS cloud, free tier**: 15 iOS builds/month, low-priority
  queue, 1 concurrent, 45-minute timeout. There are **two** ceilings, not one —
  a **30/month account total** and a **15/month per platform** sub-cap. Read
  both; the account total is the one that runs out first if the two platforms
  are used unevenly.
- **iOS 5/15, Android 3/15, account 8/30 for the 2026-08-01 → 2026-09-01
  period — measured 2026-08-03 from the API.** The counter is not the
  constraint this period.
- **The queue is the real cost, and it is not metered.** An Android build on
  2026-08-03 waited **2h05m** for a worker, ran Gradle for five minutes, and
  died on an HTTP 401 from Sentry's source-map upload. Both the build and the
  afternoon were gone. **Anything knowable before submitting must be checked
  before submitting** — `npm run doctor` now validates `SENTRY_AUTH_TOKEN`
  against the Sentry API for exactly this reason.

```sh
cd apps/mobile && npx eas-cli account:usage gabandres --non-interactive
```

  That command is the only authoritative source — `build:list` counts builds
  *started*, which over-counts (it includes errored builds) and cannot show the
  limit or the period boundary. It is easy to miss because it does not appear in
  `eas-cli --help`, which lists only the `account` topic.
- Android **APKs** build locally and free, via Gradle directly — *not* through
  `eas build --local`, which refuses to run on Windows. See §7. **Android AABs do
  not build here at all** — see the `bundleRelease` note in §4; they come from EAS,
  which has its own 15/month Android allowance.
- **Credentials are issued, `production` included — that blocker is fully gone
  as of 2026-08-03.** The scheme now has **four** targets and every one of them
  has an active App Store provisioning profile, all sharing one distribution
  certificate:

  | Target | Bundle id | Profile |
  |---|---|---|
  | Ignia | `fit.ignia.app` | `4N7B4FLGN4` |
  | Today | `fit.ignia.app.widget` | `S3KXW76C96` |
  | IgniaWatch | `fit.ignia.app.watchkitapp` | `534KZZ4G6U` |
  | IgniaWatchComplication | `fit.ignia.app.watchkitapp.watchkitextension` | `GTRBXF4G5D` |

  Distribution certificate `D48CC6237D` (serial `164DA7AA…`), expires
  **2027-07-07** — the same one that signed live 1.0 and TestFlight build 13.
  Targets **share** the cert and need **separate profiles**; do not mint a
  second cert, Apple caps them at 2 per account.

  Both watch targets reported `Synced capabilities: Enabled: App Groups` and
  `Linked: group.fit.ignia.app`. That is the explicit entitlement declaration in
  the two `expo-target.config.js` files doing its job — the plugin's
  `appGroupsByDefault` flag does **not** cover watch targets, and without those
  blocks the complication would ship unable to read what the watch app writes.

  **`.complication` is an unusable App ID suffix.** Apple's portal refuses any
  identifier whose final segment is `complication` — verified three times
  against the ASC API under two different parents, while `.watchkitextension`,
  `.face` and `.glance` all registered fine. The error says *"is not available.
  Please enter a different string"*, which reads like the name is taken and is
  not. Registering the parent first does not help.

  Run **once per distribution type** without `--non-interactive` and answer the
  Apple prompts. **ad-hoc** done 2026-08-01, **App Store** done 2026-08-03.
  EAS cannot mint credentials unattended: it refuses in non-interactive mode,
  *before* creating the build, so failed attempts cost no quota. Setting the ASC
  API key env vars does **not** help either — a `development`/`preview` build is
  **internal distribution**, which needs an ad-hoc profile, which needs a human
  to pick devices.

  The 2026-08-02 `production` failure at
  `Failed to register bundle identifier fit.ignia.app.widget` is what this pass
  cleared.

  That failure is **not** an ASC key problem, and the key's role is not the
  explanation (`47Z9RY8MT5` is Admin, and it answers ASC version queries fine —
  checked the same day). The failing call is a **Developer Portal** write, where
  EAS falls back to Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA. No
  API key covers that step. Credential failures cost **no build quota** — they
  happen before the build is created. `device:list` still needs
  `--apple-team-id AE6TTXW92K` when non-interactive.
- One iPhone is registered for ad-hoc distribution (UDID `00008140-0016199614C3801C`).
- **Two `development` builds exist.** `c539ab49` (commit `bb80759b`) was the first
  time the widget Swift ever compiled. **`de8fabd0` (commit `2a50e6e2`) is the one
  to install** — it carries the widget fix below. Install page:
  `https://expo.dev/accounts/gabandres/projects/macro-log/builds/de8fabd0-597c-4ebd-8f61-ccc75ec59dc5`

  These are dev-client builds, so the app shell needs `npx expo start --dev-client`
  to load JS; the widget itself is native and renders without Metro once the app has
  written data.
- **RESOLVED 2026-08-03 — kept because the trap is subtle and will be re-hit.**
  The widget now works on a physical iPhone from build 13; the fix below is what
  did it. Read this if autolinking ever drops a pod again.

  **The widget was dead because `ExtensionStorage`'s pod never reached the Podfile
  on EAS — and `ios.appleTeamId` was NOT the cause.** That earlier diagnosis was
  wrong; `2f7d0b0e` fixed a real warning but not this. Proven 2026-08-02 by
  grepping the build logs: `ExtensionStorage` appears **zero times** in the entire
  `INSTALL_PODS` phase of both `de8fabd0` (expo 54.0.35) and `f897f42f`
  (54.0.36), while ~34 other Expo module pods install normally. The device probe
  agrees — 42 native modules registered, that one absent.

  **The cause is a deployment-target mismatch, found 2026-08-02.**
  `ExtensionStorage.podspec` declares `s.platform = :ios, '16.4'`; the app was on
  SDK 54's default **15.1**. Expo's autolinking **silently drops** modules whose
  podspec floor is above the app's deployment target — no warning, no build
  failure, the pod simply never exists. Forcing the pod in explicitly is what
  finally made it speak: `CocoaPods could not find compatible versions for pod
  "ExtensionStorage" … they required a higher minimum deployment target`
  (build `ab70e74f`, the only one that has ever failed here).

  Fix: `ios.deploymentTarget: "16.4"` in `expo-build-properties`. **This raises the
  App Store minimum** — iPhone 6s / 7 / SE-1 cap out at iOS 15 and will no longer
  be offered updates. Accepted by the owner 2026-08-02 as the cost of the widget.
  The temporary force-link plugin was **deleted** in the same commit: with the
  target raised, autolinking adds the pod itself, and a second explicit `pod` line
  would be a duplicate declaration.

  Also settled by that build, so nobody re-investigates: the package resolves from
  the **monorepo root** `node_modules` on the worker (the plugin logged the path),
  so hoisting was never involved. Likewise not involved: `appleTeamId`, the App
  Group entitlement, the legacy `"ios"` config key, the pod cache, and the expo
  patch version — 54.0.35 and 54.0.36 fail identically.

  The general trap stands: this package fails *silently and completely* rather
  than throwing, which is why the `__DEV__` probes in `src/lib/widget.ts` are kept.
  They report, on first launch, which of "native module missing" / "not entitled to
  the App Group" / "wrote fine" is true — three different fixes that otherwise look
  identical. Reading them cost one build and settled what two builds of guessing
  had not.
- The build archive is **7.5 MB**, not 172 MB — see `.easignore`, added 2026-08-01.
  EAS keeps `.git` in the archive unless explicitly ignored, and this repo's history
  carries ~138 MB of committed-then-deleted `node_modules` binaries. **Editing that
  file is dangerous:** once it exists, EAS stops reading `.gitignore` entirely, so
  every pattern must be repeated there or the directory starts uploading.
- Budget **two** builds for the next release: one `development` for device QA (spent,
  above), one `production`. Shipping never-executed Swift straight to review is how
  the last two rejections happened, and each rejection cost a build anyway.

```sh
cd apps/mobile && npx eas-cli build:list --platform ios --limit 5   # what exists
```

## 4. Open work, and what each is actually blocked on

| # | Work | Blocked on |
|---|---|---|
| — | Next iOS binary (everything in §2) | Nothing structural. Build 13 exists, is on TestFlight, and its widget is verified on device — the device-QA gate this row used to name is **cleared**. What remains is submitting the 1.1.0 version page to App Review (it is still `PREPARE_FOR_SUBMISSION`), or cutting a newer build first if more of §2 should ride along. Quota and credentials are both resolved |
| — | Verify the **Android** widget on a device | Nobody has put it on an Android home screen. It is in Play vc 4, and its task handler registers through the custom `index.js` — a path no device has exercised. The iOS half is **done**: verified on a real iPhone 2026-08-03 from TestFlight build 13, kcal left + protein left, **and the numbers moved after a logged meal**, which proves the whole chain rather than the render alone |
| #46 | Read the watch layouts on a simulator | **a Mac with Xcode** (currently: borrow one). Its stated precondition — "the build session has written the watch Swift" — is now **met**: the real layouts exist, so the sitting is the readout it was designed to be |
| #47 | Compile the generated watch targets in Xcode | **a Mac with Xcode.** Now runs against **real code instead of stubs**: `targets/_shared/Glance.swift` is referenced from all three Apple targets, so the `_shared` cross-target membership question — the load-bearing one for holding the Swift mirror at a single copy — is answered by whether the project builds, with no `ProbeShared.swift` needed. `probe/watch-compile-47` is superseded by `feat/watch-complication`; keep it only for the throwaway `ViewThatFits` probe |
| — | App Store screenshots | owner, on device (`store-assets/README.md`) |
| — | Play launch — **first AAB** | **DONE** (2026-08-02). Local `bundleRelease` is **permanently dead on this machine**: `LongPathsEnabled=1` and a reboot changed nothing, because the cap is **ninja**, not the registry — the SDK's `cmake/3.22.1/bin/ninja.exe` is not long-path-aware, and the `react-native-keyboard-controller` object path is 348 chars. Relocating `.cxx` cannot save it (the CMake target-dir prefix alone is 105 chars). **AABs come from EAS.** `eas.json` `production` now sets `android.credentialsSource: "local"` so EAS signs with `credentials/dev.keystore` instead of minting a new upload key — **that line is load-bearing; removing it silently changes app identity.** Artifact: EAS build `4b513a00`, vc 3, signer SHA-256 `75:4B:03:19:…:F6:D8` |
| — | Play launch — **upload the AAB to a closed track** | **DONE** (2026-08-02). vc 4 is on Closed testing - Alpha and submitted; the app is in Google review. Play does not accept an app's *first* upload through the Developer API, so this one went through the console UI. **vc 3 was discarded, not shipped** — it declared three health READ permissions the app never requests, and Play's health declaration demands a written justification per read permission. `07ce8e99` removed them; vc 4 declares 11 health permissions (5 read, 6 write). Do not resurrect vc 3 |
| — | Play launch — **the health declaration** | **DONE**, and it is per-permission prose that will need editing whenever the health permission set changes. Declared features: Activity and fitness, Nutrition and weight management, Sleep management — no Medical, no research. Each of the 5 read permissions has a justification stating the in-app surface, that data stays in the user's own account, and that it is never sold, shared, or used for ads. Active calories and steps additionally state they are display-only and excluded from the calorie target, which is true and is the honest answer to "why do you read activity" |
| — | Play launch — **`eas submit` for every upload after the first** | **DONE 2026-08-03 — the service account works** (`play-check` returns HTTP 200 on `applications/fit.ignia.app/reviews`). `eas.json` `submit.production.android` points at `apps/mobile/credentials/play-service-account.json` — **track `alpha` (= closed), `releaseStatus: "draft"`, so a submit uploads without rolling out to testers; it still has to be promoted in the console.** **Google DELETED the "Setup → API access" page** — do not go looking for it, and ignore any doc that says to link a Google Cloud project, [that requirement is gone](https://developers.google.com/android-publisher/getting_started). The only steps are: enable `androidpublisher.googleapis.com` on the GCP project (done), then **Users and permissions → Invite user** with the service-account email. Granted: app-scoped to Ignia, *Release apps to testing tracks* + *Manage testing tracks and edit tester lists*; deliberately **not** production release or financial data. Took effect immediately, not the documented 24h |
| — | Play launch — **Google Sign-In was broken for 100% of Play installs** | **FIXED 2026-08-03, server-side, no build.** `fit.ignia.app` is enrolled in **Play App Signing**: Google strips the upload signature and re-signs every AAB with its own key before distribution. Android Google Sign-In authorizes the caller by *package name + signing-certificate SHA-1*, so a Play install presents **`8261e9d8c06a85725d84a5f53e24326e81a83cd4`** — which was not registered in Firebase. Play Services rejected the call with `DEVELOPER_ERROR` before it ever reached Firebase Auth, and the app rendered that as "Could not sign in. Please try again." Fixed by `firebase apps:android:sha:create` on app `1:647810616435:android:a6f4c5f9e200b3332c2e06`. **The trap: this is invisible to every build you test locally**, because those carry the upload key (`3ce15e38…`), which *was* registered — it breaks only for people who install from the store. It looked like a per-user bug for a day: one tester failed, another had "succeeded", but that second account was created 2026-08-01, a day before any AAB existed on Play, so he was never on a Play-signed build at all. **Whenever the signing key changes — key rotation, a new upload key, a second app — re-check `firebase apps:android:sha:list` against Play Console → Protected with Play → Play Store protection → Manage Play app signing** (the old "App integrity" page now just redirects there; the real URL is `.../app/<appId>/keymanagement`) |
| — | Play launch — **tester feedback URL** | **Saved but NOT submitted.** `https://ignia.fit/support` (same page the App Store listing uses) is staged on the closed track as "Change feedback channel", showing under *Changes not yet submitted for review*. Held back deliberately: the app's first review was already in flight, and whether a second submission joins that review or restarts it is not established. Submit it after approval — one click on **Submit 1 change for review** |
| — | Play launch — **12 testers × 14 consecutive days** | **owner, and this is now the only thing left.** The email list `Ignia Beta Testers` has **6 of 12**. The build is in review; once it is approved the opt-in link goes live at `https://play.google.com/apps/testing/fit.ignia.app`. Personal account, so production access is gated on 12 testers staying opted in 14 CONTINUOUS days |
| — | Play launch — **Data safety form** | **DONE** (2026-08-01, filled directly in the console). Declares Personal info (Name, Email, User IDs) + Health and fitness (Health info, Fitness info); collected, **not shared**, required, App functionality + Account management. Nothing else. The saved draft had over-declared Photos, Crash logs, Device IDs, User-generated content and Other personal info — all cleared, each checked against the Android app (no analytics/crash SDK, no push token, photo-scan flag-off, RevenueCat is iOS-gated so it never configures on Android). CSV import was tried twice and failed with a generic "Couldn't upload"; the console UI worked |
| — | Play launch — **Advertising ID declaration** | **DONE** — declared **No**. App content now reads "You're all caught up" |
| — | Play launch — **delete-account URL** | **DONE and LIVE.** Verified 2026-08-01 and it *failed* — signed out, the page said only "sign in first to delete your account". `fb7d24d1` adds an unconditional "How to delete your account" section (iOS path, web path, and an email path for users who can't sign in) plus what is erased vs. what survives in backups, both locales. Deployed to `ignia.fit/privacy` and confirmed in a browser |
| — | Play launch — **store listing graphics** | **DONE.** `scripts/play-store-assets.mjs` generates all of them from artwork already in the repo → `store-assets/play/`. Play needs 16:9 or 9:16 and the captures are 1:2.17, so each is fitted onto a 1080×1920 canvas in the brand panel colour (the art already sits on that colour, so the letterboxing is invisible). Icon 512², feature graphic 1024×500, five phone screenshots — all uploaded and saved |

**Apple glanceable surfaces (map #31).** 14 of its 16 tickets are **closed** —
transport, staleness, layouts, tap targets, review surface and sign-out privacy
were decided first, and the on-device widget verification closed 2026-08-03. What remains is
**#46 and #47, both of which need a Mac** — the two things on the whole map that
cannot be done on this machine.

The building is done. `apps/mobile/targets/` now holds `_shared`, `widget`,
`watch` and `watch-widget`, plus `apps/mobile/modules/watch-link` for the phone
half of the transport. **What is unproven is narrow and specific: none of that
Swift has ever been through a compiler.** Do not read "written" as "works" — the
iPhone widget was written, merged, and silently broken for two builds because a
pod never linked.

**The credentials gate is real and is not the Mac.** The scheme gains **two new
bundle ids** (`fit.ignia.app.watchkitapp` and
`fit.ignia.app.watchkitapp.complication`), neither of which exists in the Apple
portal. §3 already records that EAS cannot mint those unattended — it refuses in
non-interactive mode, and the failing call is a Developer Portal write where EAS
falls back to Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA, which no
ASC API key covers. `production` still has not had its interactive pass; this
adds two more ids to it. Credential failures cost **no build quota** — they
happen before the build is created.

## 5. Decided and deliberately not happening

Do not re-propose these without new information; the reasoning is in the linked ADR
or research note.

- **Pro tier / IAP / Stripe** — dormant, flag-gated off. v1 is free. (ADR-0015)
- **AI photo-scan** — deferred to a paid tier; runtime cost gate. (ADR-0015)
- **App Intents / Siri Shortcuts** — decided **no** for this batch, 2026-07-23.
- **Watch app reading Firestore directly** — structurally unavailable; no watchOS
  Firestore client. (`docs/research/watch-complication-transport.md`)
- **Activity feeding measured-mode TDEE** — would double-count. Formula mode only.
- **Shared subscription cache in mobile** — per-hook subscriptions are intentional.
  (ADR-0016)
- **A 4th scheduled Cloud Function** — Cloud Scheduler's free 3 jobs are spent; fold
  into `hourly-tasks.ts`.

## 6. App Store submission — standing rules

Carried over from the two 1.0 rejections. These are permanent, not a checklist to
do once.

- **Accounts are Individual, not an entity** — Apple Developer Individual ($99/yr,
  no D-U-N-S) and Play Individual ($25 one-time), decided 2026-07-07 after dropping
  the Wyoming-LLC plan. The owner's legal name shows publicly as seller. Known
  accepted risk: guideline 5.1.1(ix) prefers a legal entity for health apps that
  touch HealthKit; enforcement is inconsistent and a reviewer *can* raise it.
- **Always hand Apple `review@ignia.fit`** in the Demo Account fields — it is
  pre-verified and seeded. A fresh account is walled out by the email-verification
  gate, and 2.1 demo-account failures are Apple's largest rejection bucket. Never
  point them at `demo@ignia.fit` (screenshots only). Confirm it can still write
  before submitting.
- **Notes for Review must name the specific changes.** Generic text gets rejected
  under 2.3.1.
- **`supportsTablet` stays `false`.** Apple reviews on iPad anyway (that is how the
  1.0 layout clipping surfaced), but flipping it true obliges an iPad design pass
  *and* iPad screenshots — more rejection surface, not less.
- **Keep `NSPhotoLibraryUsageDescription`** even though photo-scan is unreachable:
  `expo-image-picker` is still linked, and a *missing* purpose string is an
  automated ITMS-90683 rejection. An extra one is never punished.
- **Privacy labels must match reality** — health data + email, no Photos.

## 7. Commands that answer questions faster than reading

**The emulator suites (`test:ledger`, `test:rules`) need JDK 21+.** `firebase-tools`
dropped Java <21, and this machine's PATH `java` is 17, so both suites fail with
`firebase-tools no longer supports Java version before 21` — a toolchain error that
reads like a broken test. JDK 21 **is** installed; just point at it first:

```sh
export PATH="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin:$PATH"
```

Run the two suites **separately**, not back to back — the second one inherits the
first's emulator port before it is released and reports a phantom failed file.


```sh
npm start                  # web dev (emulators: npm run dev)
npm test                   # web unit tests
npm --prefix packages/core test
cd apps/mobile && npx expo start

# Android release APK on Windows (free, unlimited).
# `bundleRelease` does NOT work here — ninja's 260-char cap, see §4. AABs: EAS.
cd apps/mobile && npx expo prebuild -p android --no-install
cd android && ./gradlew.bat assembleRelease --no-daemon \
  -Pandroid.injected.signing.store.file=<abs path to credentials/dev.keystore> ...
```

**`npx expo prebuild -p ios` does NOT work on Windows** — SDK 54 skips it outright
(`Skipping generating the iOS native project files. Run npx expo prebuild again
from macOS or Linux`, then exits non-zero). An earlier version of this file claimed
it ran here and proved the Xcode project generates; it does not, and there is no
local way to inspect the generated Podfile or verify iOS autolinking. That is why
the widget's missing native module could only be caught by shipping a build and
reading a runtime probe.

## 8. Where things live (and what gets deleted)

| Question | File |
|---|---|
| What is this repo, how do I work in it | `CLAUDE.md` |
| What does this word mean | `CONTEXT.md` |
| **What is true right now** | **this file** |
| Why is it built this way | `docs/adr/` |
| What shipped, when | `CHANGELOG.md` (+ `CHANGELOG-archive.md`) |
| What did we research | `docs/research/` — each file opens with its verdict |
| What's still wrong in the UX | `UX_AUDIT.md` |
| Store listing field values | `docs/app-store-metadata.md` |
| Machine-local credential paths | `CLAUDE.local.md` (git-ignored) |

**The rule that keeps this from happening again: a plan document is deleted the day
its work ships.** Its outcome belongs in `CHANGELOG.md`, its reasoning in an ADR, its
current state here. Git keeps the original forever; `git log --diff-filter=D
--name-only` finds it. Never leave a shipped plan in the tree with a "CORRECTION"
block on top — that is how a status doc and a wish list become indistinguishable.
