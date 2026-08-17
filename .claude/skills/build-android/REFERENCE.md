# build-android — evidence and incident history

`SKILL.md` carries the procedure and the rules. This file carries **why each rule
exists**: the measurement, the incident, or the wrong conclusion it replaced.
Read it when a rule looks arbitrary, when something fails in a way the procedure
does not cover, or before re-proposing an approach the table below says is closed.

---

## The fingerprint gate

**The gate answers "will an OTA reach these binaries". It never answers "is an
OTA sufficient".** Those come apart silently.

**Swift and Kotlin under `targets/` do NOT move the fingerprint.** Measured three
ways on 2026-08-08 (both `.ipa`s plus a fresh generate): `QuickAddIntents.swift`
was edited, iOS build 28 shipped the change, and the hash stayed byte-identical
to build 27's. So for a native-source change the gate reads "same hash → ship it
over the air", and that OTA contains **no Swift at all** — it publishes, it
succeeds, it reports success, and it fixes nothing. **`modules/*/ios` IS hashed
even though `targets/` is not** (measured 2026-08-10, build 44).

**`app.json` is hashed as a whole**, so a key for one platform moves the other's
hash. Measured 2026-08-08: adding `NSSupportsLiveActivities` under `ios.infoPlist`
moved the **Android** hash off live vc 21's, re-stranding Android's OTA channel
about forty minutes after vc 21 was built to fix exactly that.

**Generate AFTER `expo prebuild`.** Measured 2026-08-17 on the SDK 57 build: with
a stale `android/` on disk the CLI returned `5621a4fa…`; the AAB built minutes
later from the same commit embedded `d8741525…`; re-running post-prebuild matched
the artifact. `git status` was clean throughout, so nothing tracked moved — it is
generated autolinking state (`contents:expoAutolinkingConfig:android` being the
candidate). A pre-prebuild reading describes a tree the build overwrites.

**Why the two hosts disagree — two of the three published causes were wrong**
(all measured 2026-08-17):

| Cause | Verdict |
|---|---|
| CRLF vs LF | **real**, and it is exactly two files: `.gitignore` and `targets/widget/expo-target.config.js`. Worktree-only; the index is LF |
| a Windows-only `apps/mobile/android/` prebuild dir | **disproven.** A `dir:` source hashes only git-*tracked* content. Proven twice: generating with `android/` present and moved aside gave `3d3bc410…` both times, and the tracked `dir:modules/quick-add-tile/android` was unmoved by hiding its 299-file untracked Gradle `build/` output |
| divergent `node_modules` | **disproven.** Windows walks 228 config-plugin files the Mac does not — every one a transitive dep under a *nested* `node_modules`. All 228 were then confirmed present on the Mac (`present=228 missing=0`), at identical versions from a byte-identical lockfile that itself prescribes those paths. It is `@expo/fingerprint` behaving differently per OS |

So the hosts **cannot** be made to agree and do not need to. The residual hazard
runs the other way: because the gap is tooling behaviour rather than repo state,
**bumping `@expo/fingerprint` can move the Windows hash with no change to this
repo**, silently stranding every Android OTA. Re-read the gate against the
shipped `.aab` after any `expo-updates` bump.

**Three OTAs were lost to this on 2026-08-07**, published under one machine's
number and compared against another's. They exited 0, printed a group id, and
reached zero devices.

---

## Build traps

**`SENTRY_AUTH_TOKEN` fails the build at the very end.** `@sentry/react-native`
uploads source maps as a Gradle task. Measured 2026-08-17: 1089 tasks executed,
all the C++ compiled, then `error: Auth token is required for this request` at
**8m42s**. The token is in the git-ignored `.env.local`, and a plain
PowerShell/Gradle invocation does not read it — the Mac's wrapper sources it
explicitly and the Windows path had no equivalent. `npm run doctor` is **green**
throughout, because it validates the token in `.env.local`, not whether Gradle
can see it. In the cloud the same defect cost build `9e3df4e3` a two-hour queue
wait before an HTTP 401.

**`./gradlew --stop` before every build.** A daemon from an earlier build holds
handles on `node_modules/*/android/build`; the failure is `Unable to delete file
'…classes.jar'` at an arbitrary task, an error that looks nothing like its cause.
`--no-daemon` does not help — it avoids *creating* a daemon, not the running ones.

**Heap and metaspace live in `apps/mobile/plugins/withGradleJvmArgs.js`**, not in
a hand-typed `GRADLE_OPTS`. That plugin exists because a release build died on
`OutOfMemoryError: Metaspace` in
`:react-native-health-connect:lintVitalAnalyzeRelease` on 2026-08-08, and
`expo-build-properties` has no option for Gradle JVM args. **Do not** write
`org.gradle.java.home` or `sdk.dir` into it — that hardcodes machine paths into
committed config and breaks the Linux cloud fallback. Gradle also has **no default
socket timeout**: a dropped connection to Google's Maven once left a build hung
for 19 minutes looking exactly like slow compilation.

**The CMake warning is not a failure.** `CMAKE_OBJECT_PATH_MAX` fires against
`react-native-keyboard-controller`'s shadow node on every build here. This skill
once concluded from it that Windows could not build Android at all — **wrong**,
and it cost weeks. CMake is saying it cannot *guarantee* object placement: a
reason to insist on device QA, not a reason not to build.

**Build times, measured 2026-08-17 on the Snapdragon X Elite (12 cores, 32 GB):**
SDK 54 took **10m12s**. SDK 57 took **19m18s** for 322 executed tasks with 1071
up-to-date, and a genuine cold run is ~25–30 min — it pulls **NDK 27** (~1 GB on
first use), and because the Gradle cache is on `C:` while `node_modules` is on
`Z:`, every prefab `.so` logs `Hard link … failed. Doing a slower copy instead`,
once per ABI.

---

## Avenues that are genuinely closed on Windows

Kept because each was tried, and the first two will be re-proposed.

| Attempt | Why it fails |
|---|---|
| `eas build --local` on Windows | refuses outright: *"Android builds are supported only on Linux and macOS"* (`eas-cli` `checkRuntime.ts`) |
| `eas build --local` in WSL2 | **ARM64** machine → WSL is `aarch64`, and Google ships the SDK/NDK for `linux-x86_64` only ([tracker 227219818](https://issuetracker.google.com/issues/227219818), open, "[no current plans](https://github.com/android/ndk/discussions/1692)") |
| `-DCMAKE_OBJECT_PATH_MAX=200` | reaches CMake (verified in `CMakeCache.txt`) and does nothing — sources are out-of-tree, so CMake embeds the mangled absolute path. Moot now the warning is known non-fatal |

`MAX_PATH` is a common React Native bug that would break an x86 Windows box
identically. What ARM64 removes is the *workaround* (WSL2), not the capability.

---

## versionCode

**Never read it from the build log.** vc 18's log printed *"Version code: 19"* and
produced 18; the vc 21 build was expected to be 20. The log describes the remote
counter advancing for the *next* build. Under `eas build`, `autoIncrement` burns a
number per **attempt**, so failed builds leave permanent gaps — vc 12, 14–17, 19,
20 and iOS build 26 do not exist.

On the Windows path there is no `autoIncrement`: the number is whatever you passed
to `patch-android-release.mjs`, so nothing is burned by a failure and nothing is
reserved. Read the live value first (`node scripts/app-version-sync.mjs --check`).

---

## Signing

`credentialsSource: "local"` → `credentials/dev.keystore`, alias `macrolog-dev`.
**Never regenerate or replace it** — `fit.ignia.app` is registered with Play
against that cert and there is no recovery path. It exists on both machines;
locations and the disposal list are in `CLAUDE.local.md`.

`fit.ignia.app` is enrolled in Play App Signing **and** its Quantum-ready beta, so
there are four certs, not one, and **all must be registered in Firebase** or
Google Sign-In fails with `DEVELOPER_ERROR` on Play installs while working
perfectly on every local build. That broke twice (2026-08-03 and 08-05). Full
table in `CLAUDE.local.md`; `npm run doctor` checks it.

---

## The EAS cloud fallback

Only when local is impossible. Quota is **15/month** and the free-tier queue has
run to **two hours**. Check `SENTRY_AUTH_TOKEN` before queueing. Note the cloud
worker is a **third machine with a third fingerprint** — iOS build 42 reported a
runtime matching neither host, so a cloud artifact ships under a runtime no
installed binary matches.
