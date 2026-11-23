# Build infrastructure — ceilings, credentials, and traps

Extracted from `STATUS.md` §3 on 2026-08-15. **Builds are no longer the binding
constraint**, which is why this is reference material rather than status: both
platforms build locally on **the build Mac** at zero EAS quota, and JS-only
changes need no build at all.

> **Where things run.** The Windows PC holds the code and publishes OTAs (it
> computes the Mac's fingerprints and exports its bundles since 2026-11-12,
> `apps/mobile/AGENTS.md`). The build Mac (since 2026-11-22) does iOS builds and
> uploads and, by default, Android release builds (ADR-0042); the PC's raw-Gradle
> Android path (vc 31–45) is the fallback while the Mac is away, unverified since.
> The PC reaches the Mac only through `mac sync` / `mac run '…'` /
> `mac bg <name> '…'` + `mac wait <name>`, its clone is
> `~/Repos/fitness-tracker-pwa`. Machines, setup and where secrets sit:
> `Z:\machines\README.md`. The first Mac, an M1 Air, built both platforms from
> 2026-08 until its sale on 2026-11-13; the measurements below are its.

Operational runbook: `docs/DEV_ENVIRONMENT.md` §3.10 (iOS) / §3.11 (Android),
plus the `build-ios` and `build-android` skills. Current fingerprints: the
table in `apps/mobile/AGENTS.md`; every build/OTA reading with its post-mortem:
`apps/mobile/docs/fingerprint-ledger.md`.

## The default path: local, free

**Every duration below was measured on the first Mac, an M1 Air** (8 cores,
16 GB). They are not a baseline for the build Mac — re-measure with
`node scripts/time-mobile-builds.mjs` (`docs/COMMANDS.md`) and name the machine
in the number, or a faster laptop reads as a regression.

- **iOS — `eas build --local` on the Mac.** 15m57s cold, ~11m warm. Four targets
  verified nested in the `.ipa`. It also sidesteps the ASC 401 that breaks
  non-interactive *cloud* builds, so the ASC `.p8` never leaves the workstation.
- **Android — `eas build --local` on the Mac.** The Mac is the only machine here
  that can produce a *shippable* AAB, because `eas build --local` is the only
  path that writes the EAS Update channel into `AndroidManifest.xml`. Raw
  `./gradlew bundleRelease` compiles and signs correctly and yields an **OTA-dead
  binary** — that is what vc 10 was, and the `build-android` skill forbids it.
  The **10m36s cold / 1m51s incremental** figures were measured through raw
  Gradle, so read them as the compile cost of this app's native graph, not as a
  sanctioned release path.
- **Android APKs** build locally and free on either host via Gradle directly; on
  Windows that is the only path (`eas build --local` refuses to run there), on the
  Mac it is the local-iteration path and `eas build --local` is the release path.
- **Windows CAN build a signed AAB — and must never ship one.** Measured
  2026-08-17 on the Snapdragon X Elite X1E80100 workstation (12 cores, 32 GB):
  `./gradlew bundleRelease` exited 0 in **12m58s** near-warm (1307 tasks, 274
  executed) and produced a 93 MB signed `app-release.aab`. The older claim here
  that "AABs do not build on Windows at all" was **wrong** — the New
  Architecture C++ compiled fine. What is true is that the artifact is
  unshippable, for a reason unrelated to the toolchain: `eas build --local`
  refuses Android off Linux/macOS (`eas-cli`'s `checkRuntime.ts`), and it is the
  only path that writes the EAS Update channel. The AAB's manifest carries
  `expo.modules.updates.ENABLED` but **no `expo-channel-name` and no
  `EXPO_UPDATE_URL`** — read out of `base/manifest/AndroidManifest.xml`, i.e.
  the vc 10 defect reproduced. It also embeds a Windows fingerprint
  (`3d3bc41024f101326fba4a5ce3ff075cc342edab`) matching no published runtime.
  WSL2 is not the escape hatch either: this is an ARM64 box and Google ships the
  NDK for `linux-x86_64` only — and no `windows-arm64` host exists in any NDK
  release, r29 included, because Google cross-compiles the Windows toolchain
  from Linux with MinGW rather than building it on Windows. The x86_64 NDK runs
  here under emulation, which is where the build time goes.
- **Android's build host moved back to the Mac on 2026-09-17**, reversing
  the 2026-08-17 decision below (the first Mac's disk had been the reason).
  Its toolchain and the Android signing material on the build Mac:
  `Z:\machines\README.md`. One fact is this app's, not the machine's: the graph
  needs **NDK 27.0.12077973 AND 27.1.12297006** (it resolves 27.1 and something
  else pins 27.0; deleting either cost a mid-build re-download, measured
  2026-09-17). The release path there is **raw Gradle plus `patch-android-release.mjs`, with
  `verify-mobile-artifact.mjs` as a NON-OPTIONAL gate** — owner's decision
  2026-09-17, recorded in
  [ADR-0042](adr/0042-android-build-host-returns-to-the-mac.md), taken on build
  time and artifact size. Measured on the Mac that day: **15m04s, a 62.6 MB AAB,
  two ABIs, a signer byte-identical to `dev.keystore`, channel injected,
  verifier 10/10**; the patch script ran unmodified on macOS.

  `eas build --local -p android --profile production` is **also verified green
  there** (10m25s, channel injected automatically, ABI set controllable via
  `ORG_GRADLE_PROJECT_reactNativeArchitectures`, which is a shell variable and
  moves no fingerprint). It is the safer path — it cannot silently omit the
  channel, the signing or the versionCode, which is the class of bug that
  shipped vc 10 — and it is **deliberately not the default**. If the verifier is
  ever skipped, prefer it.

  **Cutover happened with vc 46 on 2026-09-28** (raw Gradle + the patch script on the first Mac; `eas build --local` alone skips the patch — `build-android` Step 3).
  (A pre-cutover plan for `OWNER["android"] = "windows"` sat here until 2026-11-19;
  the guard has allowed both hosts for both platforms since 2026-11-12.)
- **Android's build host was the Windows workstation from 2026-08-17 to
  2026-09-17.** `scripts/patch-android-release.mjs` supplied the channel, the
  release signing and the versionCode that `eas build --local` would have, and
  `verify-mobile-artifact.mjs` was the gate. A second build of the same tree with
  the channel injected came out **10m12s**, verifier-green, at vc 31.
  Consequences that outlive the move:
  - **Bare `eas update` publishes BOTH platforms.** Every publish must be
    `--platform`-scoped; the guard enforces it.
  - (Its other consequence, "the fingerprint follows the build host — publish
    from the machine that built the binary", stood until 2026-11-12, when
    Windows/Mac parity was achieved; `apps/mobile/AGENTS.md`.)
- **Most fixes need no build.** EAS Update ships JS/TS over the air in seconds.
  Run the fingerprint gate first (`docs/COMMANDS.md`).
- `dev.keystore`, `credentials.json`, the Sentry token and an EAS session are on
  the Windows PC, and copies on the build Mac (`Z:\machines\README.md`).

Root `engines` accepts `^22.13.0 || ^24.12.0 || ^26.0.0` (Node 26 added
2026-11-12); `.nvmrc` pins 24.12.0.

Pinning `engines` to 24 alone was tried first and is wrong: `eas build --local`
runs its own `INSTALL_DEPENDENCIES` step, so **every iOS build on the Mac printed
`npm warn EBADENGINE`** against a machine that is doing exactly what it is
supposed to. Harmless (nothing sets `engine-strict`), but a warning that fires on
the happy path is one people learn to ignore. RN 0.86 accepts `^20.19.4 ||
^22.13.0 || ^24.3.0`, so both hosts satisfy Expo SDK 57 as they stand.

**Exactly one machine resolves dependencies: the Windows PC (`winbox`, checkout
`Z:\fitness-tracker-pwa`) since 2026-11-13.** Only it runs `npm install` /
`expo install` / anything that rewrites `package-lock.json`; any other machine
runs `npm ci` (`mac sync` does that on the build Mac when the lockfile changed;
on the PC itself: `npm ci --ignore-scripts && npx patch-package &&
npm rebuild @firebase/util`, `apps/mobile/AGENTS.md`). Two machines both writing
the lockfile is how clones drift for real. This said "the lockfile author is
the Mac" (2026-10-21 → 11-13) and "Windows" before that, until 2026-11-19.
`node_modules` is **not** a fingerprint input (disproven 2026-08-17); run the gate
before a publish regardless — it is the hash, not the install, that decides.

`npx expo prebuild -p ios` does **not** work on Windows: since SDK 54 (still true
on 57) it skips it outright and exits non-zero. There is no local way to inspect the generated Podfile or
verify iOS autolinking here, which is why the widget's missing native module
could only be caught by shipping a build and reading a runtime probe.

## Cloud-build ceilings (fallback path only)

There are **two** ceilings, not one: a **30/month account total** and a
**15/month per-platform** sub-cap. The account total runs out first if the two
platforms are used unevenly.

**iOS 0/15 for the 2026-09-01 → 2026-10-01 period**, read from the API on
2026-09-03 by `npm run doctor` (the August period closed at iOS 13/15,
Android 6/15, 19/30 on the account total; every September binary so far —
vc 41–44, builds 62–63 — was built locally, so the new period is untouched).
`npm run doctor` audits that figure against `eas account:usage`; it is not
re-read here (no `eas` in this audit, 2026-11-19). Two caveats worth keeping. **The counter moved 11 → 13 with no new builds**, so it either lags or
the 08-18 reading was wrong — do not treat a rising number as evidence that
something built. And **the two sources disagree on the split**: `build:list`
says iOS 12 / Android 7 for this period while `account:usage` says iOS 13 /
Android 6. The totals agree at 19; only the attribution differs, and
`account:usage` is the one that bills. Android did not move on
2026-08-18 despite shipping vc 34, and iOS did not move for any of the six
builds that day either — all of them were LOCAL (`expo run:ios`, raw Gradle),
which is the whole point of the local hosts. `eas submit` costs no quota.
A cloud build is the iOS path only while the build Mac is away (it was the only
one from 2026-11-13 to 2026-11-22, with no Mac).

```sh
cd apps/mobile && npx eas-cli account:usage gabandres --non-interactive
```

That command is the only authoritative source. `build:list` counts builds
*started*, which over-counts and cannot show the limit or the period boundary.
It is easy to miss because it does not appear in `eas-cli --help`.

**Do NOT assume a failed build is free.** Measured 2026-08-06 by reconciling
`build:list` against `account:usage`: six Android builds were created that period
and five were counted. The uncounted one died early, in *Bundle JavaScript*;
another errored deep in the Gradle/Sentry step and **was** counted. The exemption
tracks how far the build got on the worker, not whether it succeeded. Treat every
queued build as a slot spent — the local bundle gate (`npx expo export`) saves
quota as well as the queue wait.

**A duplicate build is the cheapest way to lose a slot, and it is silent.** One
`eas build -p ios` invocation once produced two builds a minute apart on the same
commit; `autoIncrement` gives them different version codes, so nothing looks
wrong in `build:list` — only the usage counter notices. After any `--no-wait`
build, check `build:list --limit 2` before walking away.

**The queue is the real cost, and it is not metered.** An Android build waited
**2h05m** for a worker, ran Gradle for five minutes, and died on an HTTP 401 from
Sentry's source-map upload — `@sentry/react-native` uploads maps as a *Gradle
task*, so a bad token fails the build. Both the build and the afternoon were
gone. **Anything knowable before submitting must be checked before submitting**;
`npm run doctor` validates `SENTRY_AUTH_TOKEN` against the Sentry API for exactly
this reason.

**Credential failures cost no build quota** — they happen before the build is
created, so retrying is free.

## iOS credentials

All four targets have active App Store provisioning profiles, sharing one
distribution certificate:

| Target | Bundle id | Profile |
|---|---|---|
| Ignia | `fit.ignia.app` | `4N7B4FLGN4` |
| Today | `fit.ignia.app.widget` | `S3KXW76C96` |
| IgniaWatch | `fit.ignia.app.watchkitapp` | `534KZZ4G6U` |
| IgniaWatchComplication | `fit.ignia.app.watchkitapp.watchkitextension` | `GTRBXF4G5D` |

Distribution certificate `D48CC6237D` (serial `164DA7AA…`), expires
**2027-07-07** — the same one that signed live 1.0. Targets **share** the cert
and need **separate profiles**; do not mint a second cert, Apple caps them at 2
per account.

Both watch targets report `Synced capabilities: Enabled: App Groups` /
`Linked: group.fit.ignia.app` — the explicit entitlement declaration in the two
`expo-target.config.js` files doing its job. The plugin's `appGroupsByDefault`
flag does **not** cover watch targets, and without those blocks the complication
would ship unable to read what the watch app writes.

**`.complication` is an unusable App ID suffix.** Apple's portal refuses any
identifier whose final segment is `complication` — verified three times under two
different parents, while `.watchkitextension`, `.face` and `.glance` all
registered fine. The error says *"is not available. Please enter a different
string"*, which reads like the name is taken and is not.

**EAS cannot mint credentials unattended.** Run once per distribution type
*without* `--non-interactive` and answer the Apple prompts (ad-hoc done
2026-08-01, App Store 2026-08-03). Setting the ASC API key env vars does not
help: the failing call is a **Developer Portal** write, where EAS falls back to
Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA, and no API key covers
that step. A `development`/`preview` build is internal distribution, which needs
an ad-hoc profile, which needs a human to pick devices.

One iPhone is registered for ad-hoc distribution (UDID
`00008140-0016199614C3801C`).

## Android signing

`eas.json` `production` sets `android.credentialsSource: "local"` so EAS signs
with `credentials/dev.keystore` instead of minting a new upload key — **that line
is load-bearing; removing it silently changes app identity.** Local Gradle builds
neither read nor increment the EAS remote versionCode, so it has to be set by
hand after one, or the next cloud build re-mints a colliding number.

`bundleRelease` was once **dead on a Windows machine** (contradicted since 2026-08-17:
vc 31–45 built on Windows, above; this said "permanently dead" until 2026-11-19). The cap was **ninja**, not the registry —
the SDK's `cmake/3.22.1/bin/ninja.exe` is not long-path-aware and the
`react-native-keyboard-controller` object path is 348 chars. Relocating `.cxx`
cannot save it (the CMake target-dir prefix alone is 105 chars).

The four Android signing keys, and the two Google Sign-In outages caused by
reading the wrong one, are documented in `CLAUDE.local.md`.

## Resolved traps, kept because they will be re-hit

### Autolinking drops a pod silently when the deployment target is too low

The iPhone widget was dead for two builds because `ExtensionStorage`'s pod never
reached the Podfile. `ios.appleTeamId` was **not** the cause — that earlier
diagnosis was wrong. Proven by grepping the build logs: `ExtensionStorage`
appeared **zero times** in the entire `INSTALL_PODS` phase while ~34 other Expo
module pods installed normally.

Cause: `ExtensionStorage.podspec` declares `s.platform = :ios, '16.4'` and the app
was on SDK 54's default **15.1**. **Expo's autolinking silently drops modules
whose podspec floor is above the app's deployment target** — no warning, no build
failure, the pod simply never exists. Forcing the pod in explicitly is what
finally made it speak.

Fix: `ios.deploymentTarget: "16.4"` in `expo-build-properties`. This raised the
App Store minimum — iPhone 6s / 7 / SE-1 cap out at iOS 15 — accepted by the owner
2026-08-02 as the cost of the widget.

Also settled, so nobody re-investigates: the package resolves from the monorepo
root `node_modules` on the worker, so hoisting was never involved. Likewise not
involved: `appleTeamId`, the App Group entitlement, the legacy `"ios"` config key,
the pod cache, and the expo patch version (54.0.35 and 54.0.36 fail identically).

The general trap stands: this package fails *silently and completely* rather than
throwing, which is why the `__DEV__` probes in `src/lib/widget.ts` are kept. They
report, on first launch, which of "native module missing" / "not entitled to the
App Group" / "wrote fine" is true — three different fixes that otherwise look
identical.

The autolinking check that would have caught it:

```sh
npx expo-modules-autolinking search -p apple
```

### `.easignore` stops EAS reading `.gitignore` entirely

The build archive is **7.5 MB**, not 172 MB. EAS keeps `.git` in the archive
unless explicitly ignored, and this repo's history carries ~138 MB of
committed-then-deleted `node_modules` binaries. **Editing that file is
dangerous:** once it exists, EAS stops reading `.gitignore`, so every pattern
must be repeated there or the directory starts uploading.

### Mac disk: an iOS build needs ~17 GB free

**`df -h /` reads the sealed System snapshot and lies** — ask for
`/System/Volumes/Data`, and check the number before believing a build is blocked
on disk: this file once carried "~600 Mi free / 100% full" when the volume had
7.7 GiB, and clearing DerivedData alone returned 10.3 GiB. Do NOT delete
`apps/mobile/ios/Pods` (forces a `pod install`). `mac status` prints the build
Mac's free disk.

### `autoIncrement` burns a version number per *attempt*

Gaps in the build/versionCode sequence are normal and are not missing artifacts.
Several numbers on both platforms belong to attempts that died on environment
problems (unset `JAVA_HOME`, unset `ANDROID_HOME`, Gradle Metaspace OOM, a
watchOS simulator runtime deleted to free disk). The Metaspace one is closed
permanently by `plugins/withGradleJvmArgs.js`, which writes the heap flags into
`gradle.properties`.

### Colocated tests get bundled by Expo Router

`*.test.tsx` files inside `src/app/` are swept into Expo Router's route
`require.context` and bundled, which ERRORs the build in *Bundle JavaScript*.
Tests live in `src/__tests__/`. This broke dormant for a day because no EAS build
ran in between.

## Patched dependencies (`patches/`, since 2026-10-22)

`patch-package` runs as the root `postinstall`, so `npm ci` (here, and inside
`eas build --local`'s copy) re-applies every file in `patches/`. Two patches
(this said "one" until 2026-11-19; the other is `@expo+fingerprint+0.20.14.patch`,
`apps/mobile/AGENTS.md`). `@firebase+firestore+<version>.patch` is a fast path in the SDK's
`__PRIVATE_compareUtf8Strings` (ADR-0016 amendment 3) that halved a tab's
first-visit JS stall. The patch file is named for one exact version: **a
firebase upgrade must regenerate it** (edit the new `dist/common-*.rn.js`, run
`npx patch-package @firebase/firestore`, delete the old file), or `postinstall`
fails the install. `firestore-utf8-compare-patch.test.ts` fails if the patch is
missing from the build Metro bundles. It touches JS only, so it moves no
fingerprint.
