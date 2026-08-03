# STATUS — what is true right now

**Updated:** 2026-08-02 · **Owns:** current state only. Not history (`CHANGELOG.md`),
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
| iOS 1.1.0 | **Metadata shell only** — `PREPARE_FOR_SUBMISSION`, **no binary attached** | ASC command below |
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

- **Home-screen widget**, iOS (SwiftUI, `apps/mobile/targets/widget/index.swift`)
  and Android (TSX). Never compiled, never rendered anywhere — no device, no
  simulator. Highest-risk item in the next binary.
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
  queue, 1 concurrent, 45-minute timeout.
- **The quota reset landed. iOS 2/15, Android 1/15 for the 2026-08-01 →
  2026-09-01 period — measured 2026-08-02 from the API.** The counter is not the
  constraint this period.

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
- **Credentials are issued now — that one-time blocker is gone.** The scheme has
  **two** targets, and `fit.ignia.app.widget` had never had credentials (its bundle
  ID did not exist in the Apple portal at all). EAS cannot mint them unattended: it
  refuses in non-interactive mode, *before* creating the build, so failed attempts
  cost no quota. Setting the ASC API key env vars does **not** help either — a
  `development`/`preview` build is **internal distribution**, which needs an ad-hoc
  profile, which needs a human to pick devices.

  Run **once** without `--non-interactive` and answer the Apple prompts. That was
  done 2026-08-01; the widget bundle ID is registered and the profiles are stored,
  so **later builds can go back to `--non-interactive`**. `device:list` still needs
  `--apple-team-id AE6TTXW92K` when non-interactive.
- One iPhone is registered for ad-hoc distribution (UDID `00008140-0016199614C3801C`).
- **Two `development` builds exist.** `c539ab49` (commit `bb80759b`) was the first
  time the widget Swift ever compiled. **`de8fabd0` (commit `2a50e6e2`) is the one
  to install** — it carries the widget fix below. Install page:
  `https://expo.dev/accounts/gabandres/projects/macro-log/builds/de8fabd0-597c-4ebd-8f61-ccc75ec59dc5`

  These are dev-client builds, so the app shell needs `npx expo start --dev-client`
  to load JS; the widget itself is native and renders without Metro once the app has
  written data.
- **The widget is dead because `ExtensionStorage`'s pod never reaches the Podfile
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
| — | Next iOS binary (everything in §2) | **Device QA of the `development` build `c539ab49`** (§3), then one `production` build. Quota and credentials are both resolved |
| #36 | Verify the shipped widget on a physical iPhone | **Two attempts, both dead, and the real cause is now known** (§3): the `ExtensionStorage` pod never reaches the Podfile on EAS, so the native module is absent and every write is a silent no-op. `de8fabd0` was run on device 2026-08-02 and printed `NATIVE MODULE MISSING` with 42 modules linked. The cause is now known and fixed at the root (§3): the podspec's iOS 16.4 floor vs the app's 15.1. Next build must be checked **from its log** (`ExtensionStorage` in `INSTALL_PODS`) *before* anyone installs it. The widget is **small size only**, shows kcal *remaining*, and the gallery preview is hardcoded placeholders — only a home-screen instance proves the pipeline |
| #46 | Read the watch layouts on a simulator | **a Mac with Xcode** (currently: borrow one) |
| #47 | Compile the generated watch targets in Xcode | **a Mac with Xcode**; branch `probe/watch-compile-47` stages it |
| — | App Store screenshots | owner, on device (`store-assets/README.md`) |
| — | Play launch — **first AAB** | **DONE** (2026-08-02). Local `bundleRelease` is **permanently dead on this machine**: `LongPathsEnabled=1` and a reboot changed nothing, because the cap is **ninja**, not the registry — the SDK's `cmake/3.22.1/bin/ninja.exe` is not long-path-aware, and the `react-native-keyboard-controller` object path is 348 chars. Relocating `.cxx` cannot save it (the CMake target-dir prefix alone is 105 chars). **AABs come from EAS.** `eas.json` `production` now sets `android.credentialsSource: "local"` so EAS signs with `credentials/dev.keystore` instead of minting a new upload key — **that line is load-bearing; removing it silently changes app identity.** Artifact: EAS build `4b513a00`, vc 3, signer SHA-256 `75:4B:03:19:…:F6:D8` |
| — | Play launch — **upload the AAB to a closed track** | **DONE** (2026-08-02). vc 4 is on Closed testing - Alpha and submitted; the app is in Google review. Play does not accept an app's *first* upload through the Developer API, so this one went through the console UI. **vc 3 was discarded, not shipped** — it declared three health READ permissions the app never requests, and Play's health declaration demands a written justification per read permission. `07ce8e99` removed them; vc 4 declares 11 health permissions (5 read, 6 write). Do not resurrect vc 3 |
| — | Play launch — **the health declaration** | **DONE**, and it is per-permission prose that will need editing whenever the health permission set changes. Declared features: Activity and fitness, Nutrition and weight management, Sleep management — no Medical, no research. Each of the 5 read permissions has a justification stating the in-app surface, that data stays in the user's own account, and that it is never sold, shared, or used for ads. Active calories and steps additionally state they are display-only and excluded from the calorie target, which is true and is the honest answer to "why do you read activity" |
| — | Play launch — **`eas submit` for every upload after the first** | **owner, one-time console step.** The publisher service account exists (`play-publisher@fitness-tracker-gb-1775407101…`, key at `apps/mobile/credentials/play-service-account.json`, `androidpublisher.googleapis.com` enabled) and `eas.json` `submit.production.android` points at it — **track `alpha` (= closed), `releaseStatus: "draft"`, so a submit uploads without rolling out to testers; it still has to be promoted in the console.** Inert until: Play Console → Setup → API access → link project `fitness-tracker-gb-1775407101`, then grant that account release permission on the app |
| — | Play launch — **tester feedback URL** | **Saved but NOT submitted.** `https://ignia.fit/support` (same page the App Store listing uses) is staged on the closed track as "Change feedback channel", showing under *Changes not yet submitted for review*. Held back deliberately: the app's first review was already in flight, and whether a second submission joins that review or restarts it is not established. Submit it after approval — one click on **Submit 1 change for review** |
| — | Play launch — **12 testers × 14 consecutive days** | **owner, and this is now the only thing left.** The email list `Ignia Beta Testers` has **6 of 12**. The build is in review; once it is approved the opt-in link goes live at `https://play.google.com/apps/testing/fit.ignia.app`. Personal account, so production access is gated on 12 testers staying opted in 14 CONTINUOUS days |
| — | Play launch — **Data safety form** | **DONE** (2026-08-01, filled directly in the console). Declares Personal info (Name, Email, User IDs) + Health and fitness (Health info, Fitness info); collected, **not shared**, required, App functionality + Account management. Nothing else. The saved draft had over-declared Photos, Crash logs, Device IDs, User-generated content and Other personal info — all cleared, each checked against the Android app (no analytics/crash SDK, no push token, photo-scan flag-off, RevenueCat is iOS-gated so it never configures on Android). CSV import was tried twice and failed with a generic "Couldn't upload"; the console UI worked |
| — | Play launch — **Advertising ID declaration** | **DONE** — declared **No**. App content now reads "You're all caught up" |
| — | Play launch — **delete-account URL** | **DONE and LIVE.** Verified 2026-08-01 and it *failed* — signed out, the page said only "sign in first to delete your account". `fb7d24d1` adds an unconditional "How to delete your account" section (iOS path, web path, and an email path for users who can't sign in) plus what is erased vs. what survives in backups, both locales. Deployed to `ignia.fit/privacy` and confirmed in a browser |
| — | Play launch — **store listing graphics** | **DONE.** `scripts/play-store-assets.mjs` generates all of them from artwork already in the repo → `store-assets/play/`. Play needs 16:9 or 9:16 and the captures are 1:2.17, so each is fitted onto a 1080×1920 canvas in the brand panel colour (the art already sits on that colour, so the letterboxing is invisible). Icon 512², feature graphic 1024×500, five phone screenshots — all uploaded and saved |

**Apple glanceable surfaces (map #31).** 13 of its 16 tickets are **closed** — the
transport, staleness, layouts, tap targets, review surface and sign-out privacy are
all decided. What remains is #36/#46/#47 above. No watch Swift exists yet;
`apps/mobile/targets/` contains only `widget` (the stubs were removed in `f4f03f38`
until the work starts). "Mostly done" describes the deciding, not the building.

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
