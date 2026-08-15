# Build infrastructure — ceilings, credentials, and traps

Extracted from `STATUS.md` §3 on 2026-08-15. **Builds are no longer the binding
constraint**, which is why this is reference material rather than status: both
platforms build locally on the MacBook Air (`ignia-mac`) at zero EAS quota, and
JS-only changes need no build at all.

Operational runbook: `docs/DEV_ENVIRONMENT.md` §3.10 (iOS) / §3.11 (Android),
plus the `build-ios` and `build-android` skills. Fingerprints and per-build
artifact readings: `apps/mobile/AGENTS.md`.

## The default path: local, free

- **iOS — `eas build --local` on the Mac.** 15m57s cold, ~11m warm. Four targets
  verified nested in the `.ipa`. It also sidesteps the ASC 401 that breaks
  non-interactive *cloud* builds, so the ASC `.p8` never leaves the workstation.
- **Android — `./gradlew bundleRelease` on the Mac.** 10m36s cold, **1m51s
  incremental**, signed with the real upload key. **The Mac is the ONLY machine
  here that can do this**: Windows cannot compile RN's New Architecture C++ at
  all (260-char `MAX_PATH` vs a 350-char object path; upstream
  react-native-keyboard-controller#1247, open), and WSL2 cannot either — this is
  an ARM64 box and Google ships the NDK for `linux-x86_64` only.
- **Android APKs** build locally and free on Windows via Gradle directly (*not*
  through `eas build --local`, which refuses to run on Windows). AABs do not
  build on Windows at all.
- **Most fixes need no build.** EAS Update ships JS/TS over the air in seconds.
  Run the fingerprint gate first (`docs/COMMANDS.md`).
- The Mac holds `dev.keystore`, `credentials.json`, the Sentry token and an EAS
  session — locations and disposal list in `CLAUDE.local.md`.

`npx expo prebuild -p ios` does **not** work on Windows: SDK 54 skips it outright
and exits non-zero. There is no local way to inspect the generated Podfile or
verify iOS autolinking here, which is why the widget's missing native module
could only be caught by shipping a build and reading a runtime probe.

## Cloud-build ceilings (fallback path only)

There are **two** ceilings, not one: a **30/month account total** and a
**15/month per-platform** sub-cap. The account total runs out first if the two
platforms are used unevenly.

**iOS 8/15, Android 6/15 for the 2026-08-01 → 2026-09-01 period**, read from the
API on 2026-08-15. `npm run doctor` audits this line against
`eas account:usage` and fails on drift — so it is a claim, not a note. The
counter is not the constraint this period.

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

`bundleRelease` is **permanently dead on the Windows machine**: `LongPathsEnabled=1`
and a reboot changed nothing, because the cap is **ninja**, not the registry —
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
