---
name: build-android
description: Ship an Android change — decide between an over-the-air EAS Update (free, instant, no build) and a real build, run the fingerprint gate that decides whether an OTA can land, and submit to the Play alpha track. Use for "ship this to Android", "cut an Android build", "push a fix to testers", or any mobile fix headed for Play. Android builds on the WINDOWS workstation; iOS is the `build-ios` skill, on the Mac.
---

# Ship an Android change

**Start by asking whether you need a build at all.** Most fixes do not. Android
builds locally on this **Windows workstation** and iOS on `ignia-mac`, both at
**zero EAS quota**, so a needless build costs ~10 minutes rather than a queue
slot — but an OTA published against a changed fingerprint reaches **nobody**
while reporting success, and that is the expensive direction.

## Step 1 — the fingerprint gate

**Run it on the machine that BUILDS Android — since 2026-08-17 that is this
Windows workstation, not the Mac.** The fingerprint is a property of the machine
as well as the commit, so a hash generated anywhere else is a number that matches
no Android binary. Three OTAs were published against the wrong machine's numbers
on 2026-08-07 and reached nothing; the rule is unchanged, only the answer to
"which machine" is.

```sh
cd apps/mobile && npx expo-updates fingerprint:generate --platform android \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hash))"
```

**Why the two hosts disagree** — measured 2026-08-17, and two of the three causes
this file used to list are false:

- **CRLF vs LF**, in exactly two files: `.gitignore` and
  `targets/widget/expo-target.config.js`. Real, but worktree-only.
- ~~a gitignored `apps/mobile/android/` dir that exists only on Windows~~ —
  **disproven.** A `dir:` source hashes only git-*tracked* content, so an
  untracked or ignored directory contributes nothing. Deleting `android/` before
  a gate run is a no-op.
- ~~divergent `node_modules`~~ — **disproven.** Windows walks 228 config-plugin
  files the Mac does not, and all 228 were confirmed present on the Mac, at
  identical versions from a byte-identical lockfile. It is `@expo/fingerprint`
  behaving differently per OS, so aligning Node/npm cannot converge the hashes
  and `npm ci` is not a fix for a mismatch.

**Do not try to make the two agree.** Each platform is gated and published on its
own build host, and that is sufficient. Full write-up in `apps/mobile/AGENTS.md`.

Compare against the fingerprint of the binary testers are running — the table in
`apps/mobile/AGENTS.md`, whose "read from the artifact" rows are the only ones
that count.

| Result | Meaning |
|---|---|
| **Same hash** | an OTA will reach that binary → Step 2 is *available* |
| **Different hash** | an OTA reaches nobody → you need a build, Step 3 |

### The gate answers one question, and it is not the one you want

**It answers "will an OTA reach these binaries". It never answers "is an OTA
sufficient".** Those come apart, and the way they come apart is silent:

**Swift and Kotlin under `targets/` do NOT move the fingerprint.** Measured three
ways on 2026-08-08 (both `.ipa`s plus a fresh generate): `QuickAddIntents.swift`
was edited, iOS build 28 shipped the change, and the hash stayed byte-identical
to build 27's. So for a native-source change the gate reads "same hash → ship it
over the air", and that OTA contains **no Swift at all** — it publishes, it
succeeds, it reports success, and it fixes nothing.

> **If you touched anything under `targets/` or `modules/`, you need a build, no
> matter what the hash says.** Ask the gate only *which binaries* an update can
> reach.

**`app.json` is hashed as a whole, so a key for one platform moves the other
platform's fingerprint too.** Measured 2026-08-08: adding `NSSupportsLiveActivities`
under `ios.infoPlist` moved the **Android** hash off live vc 21's, re-stranding
Android's OTA channel about forty minutes after vc 21 was built to fix exactly
that. Check both platforms after any `app.json` edit, not just the one you meant
to change.

**Also moves it:** any dependency carrying native code, `eas.json`, an Expo SDK
upgrade, the `plugins` array (including `./plugins/*`). A pure-JS dependency
usually does not — run the command rather than reasoning about it.

**Does not move it:** `.ts`/`.tsx`/`.js`, UI, styles, business logic, i18n
strings, Metro-bundled assets.

## Step 2 — OTA (no build, no queue, no review)

This step owns OTA publishing for **both** platforms; `build-ios` links here
rather than repeating it. But it is now **two publishes, not one**.

**Bare `eas update` publishes BOTH platforms, and under a split build host it is
correct on NEITHER machine** — always pass `--platform`, and run each from the
host that builds it: **Android from Windows, iOS from `ignia-mac`**.
`.claude/hooks/guard_eas_update.py` enforces the whole table and blocks the bare
form everywhere.

**`--environment` is required.** eas-cli's own help: *"Required for projects
using Expo SDK 55 or greater."* This app is on 57, so a publish without it simply
errors — the guard blocks it too, so that anything reaching EAS actually runs.

**Before publishing: tell the user what changed.** Store release notes — App Store
"What's New", Play release notes — attach to **binary releases only**. An OTA
reaches the device with no store involvement, so the in-app banner is the **only**
user-facing channel. Skip it and people get silently-changed software.

| What | Where |
|---|---|
| Version constant | `apps/mobile/src/lib/whatsNew.ts` → `WHATS_NEW_VERSION` |
| Copy (both locales, flat keys) | `apps/mobile/src/i18n/{en,es-PR}.ts` → `whatsNew.title`, `whatsNew.body` |
| Web equivalent (nested keys) | `src/app/components/whats-new-banner/whats-new-banner.component.ts` |

It re-shows when `WHATS_NEW_VERSION` differs from the stored `whatsNew.seen`, so
**bumping the constant is what makes it fire** — changing only the copy shows
nobody anything. One summary sentence, not a changelog. The mobile and web
constants track their own seen-values and drift independently; bump both when a
change spans platforms.

Run the Metro gate first — `tsc` and `jest` both pass while a bundling break is
latent (`apps/mobile/AGENTS.md`; it cost two EAS builds to learn):

```sh
cd apps/mobile && npx expo export --platform android --output-dir <tmp>
```

Then publish, and **verify which runtime it went out under**:

```sh
# Android — on this Windows workstation
cd apps/mobile && npx eas update --platform android --branch production \
  --environment production --message '<what changed>'

# iOS — on the Mac
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas update --platform ios \
  --branch production --environment production --message '<what changed>'"

# then confirm WHICH RUNTIME each went out under
cd apps/mobile && npx eas update:list --branch production --limit 3
```

`--message` is for **you**, in the EAS dashboard. Users never see it.

- Testers get it on the **next** launch, not the current one.
- Undo with `eas update:roll-back-to-embedded` — returns everyone to the JS baked
  into their binary.
- Branch/channel names match the `eas.json` build profiles.
- Free tier is **1,000 monthly active users**; the tester base is single digits.

## Step 3 — a real Android build, on WINDOWS, free

**This workstation is the Android build host, permanently (2026-08-17), and the
Mac can no longer do it at all** — its Android toolchain was deleted in the same
change (`~/Library/Android`, `~/.gradle`, `~/.android` and both `android/` dirs).
So the `eas build --local` runbook that used to live here is not deprecated, it
is unrunnable; it is gone rather than demoted. Zero EAS quota, ~10 minutes.

`eas build --local` **refuses to run on Windows** (`eas-cli`'s `checkRuntime.ts`:
*"Android builds are supported only on Linux and macOS"*), so raw Gradle is the
only path here. Raw Gradle omits three things EAS Build does for free, and **all
three fail silently**:

| Missing | Consequence |
|---|---|
| EAS Update **channel** in `AndroidManifest.xml` | the binary calls `u.expo.dev` with no `expo-channel-name` and can never update. This shipped as vc 10 |
| release **signing** | the generated template points `release` at the *debug* keystore, and Play rejects debug-signed uploads |
| **versionCode** | `appVersionSource: "remote"` leaves it at `1` |

`apps/mobile/scripts/patch-android-release.mjs` supplies all three, which is why
it is no longer obsolete. **`verify-mobile-artifact.mjs` is the gate that catches
exactly these defects — it must exit 0.**

### The procedure

```sh
cd apps/mobile/android && ./gradlew --stop || true   # BEFORE the clean; see below
cd .. && npx expo prebuild -p android --clean
node scripts/patch-android-release.mjs <versionCode> production
cd android && ./gradlew bundleRelease
node ../../../scripts/verify-mobile-artifact.mjs \
  app/build/outputs/bundle/release/app-release.aab      # MUST exit 0
```

**Run Gradle detached** (`run_in_background`) — the build outruns a 10-minute
foreground tool timeout, and a timeout kill is indistinguishable from a failure.

### `SENTRY_AUTH_TOKEN` must reach Gradle, or you lose the whole build at the end

`@sentry/react-native` uploads source maps as a **Gradle task**, so a missing or
stale token **fails the build** — and it fails at
`:app:createBundleReleaseJsAndAssets_SentryUpload_…`, i.e. *after* every native
task has already run. Measured 2026-08-17 on the SDK 57 bump: 1089 tasks
executed, all the C++ compiled, then `error: Auth token is required for this
request` at **8m42s**.

The token lives in the git-ignored `.env.local` at the repo root, and **a plain
PowerShell/Gradle invocation does not read it** — the Mac's wrapper sources it
explicitly (`set -a; . .env.local; set +a`) and the Windows path had no
equivalent, which is the whole trap. Load it, without ever printing it:

```js
// run-gradle.mjs — node run-gradle.mjs
import { spawnSync } from 'node:child_process';
process.loadEnvFile('Z:/macro-app/.env.local');
// absolute path: `cmd /c` does not resolve gradlew.bat from cwd
spawnSync('cmd.exe', ['/c', 'Z:\\macro-app\\apps\\mobile\\android\\gradlew.bat', 'bundleRelease'],
  { cwd: 'Z:/macro-app/apps/mobile/android', stdio: 'inherit', env: process.env });
```

`npm run doctor` (group 3) validates the `.env.local` copy against the Sentry
API. It is **green when the token is good but absent from Gradle's environment**,
so a passing doctor does not predict this failure — the two check different
things. There are three copies of this token (local, EAS ×2, GitHub) and nothing
syncs them; `CLAUDE.local.md` has the rotation procedure and the standing
instruction not to rotate it.

**`./gradlew --stop` is not optional.** A daemon left from an earlier build holds
handles on `node_modules/*/android/build`, and the failure is `Unable to delete
file '…classes.jar'` at an arbitrary task — an error that looks nothing like its
cause. `--no-daemon` does **not** help: it avoids *creating* a daemon, not the
ones already running.

Since SDK 57 `expo prebuild` **clears the native directory by default**, so
`--clean` is now redundant (harmless, and worth keeping as documentation of
intent). Pass `--no-clean` if you ever need to apply changes to an existing
`android/` instead.

To cut the build roughly fourfold, set `reactNativeArchitectures=arm64-v8a` in
the generated `android/gradle.properties` — `x86`/`x86_64` serve only emulators
and a few ChromeOS devices. Do it after prebuild; prebuild regenerates that file.
Ship all four ABIs for anything that goes to Play.

### The CMake warning is not a failure

CMake emits `CMAKE_OBJECT_PATH_MAX` against `react-native-keyboard-controller`'s
shadow node on every build here. This file once concluded from it that "every
avenue is closed" on Windows, which was **wrong** — it is a warning, not a fatal
error, and the builds succeed. What CMake actually says is that it cannot
*guarantee* correct object placement. Treat it as a reason to insist on **device
QA**, never as a reason not to build.

### Heap, metaspace and socket timeouts

Heap and metaspace live in `apps/mobile/plugins/withGradleJvmArgs.js`, not in a
hand-typed `GRADLE_OPTS` — an env var typed by hand works exactly as often as
someone remembers it. That plugin exists because a release build died on
`OutOfMemoryError: Metaspace` in
`:react-native-health-connect:lintVitalAnalyzeRelease` on 2026-08-08, and
`expo-build-properties` has no option for Gradle JVM args.

**Do not "fix" a toolchain problem by writing `org.gradle.java.home` or `sdk.dir`
into that plugin** — it hardcodes machine-specific paths into committed config
and breaks the EAS cloud fallback, which runs on Linux.

### Verify the artifact — run the script, gate on its exit code

Raw Gradle writes to the Gradle output path — there is no `build-<timestamp>.aab`
here, because that name is something `eas build --local` produces and this host
cannot run it. The checks are **code, not prose** (see the build-ios skill for
what prose cost on 2026-08-08):

```sh
node scripts/verify-mobile-artifact.mjs \
  apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
```

It asserts the signer is `CN=Macro Log Dev` (debug-signed is rejected by Play),
the `expo-channel-name` is present (absent = an OTA dead end, which shipped once
as vc 10), the quick-add services survived the manifest merge, and prints the
fingerprint **from the artifact** — the only value `AGENTS.md` may record.

**Non-zero exit → do not submit.** Step 4 is conditional on this exit code, and
never runs in the same command. New native service? Add it to
`scripts/native-expectations.json` in the same commit.

**Do NOT read the versionCode from the build log.** vc 18's log printed
*"Version code: 19"* and produced 18; the vc 21 build was expected to be 20. The
log describes the remote counter advancing for the *next* build. `autoIncrement`
also burns a number per **attempt**, so failed builds leave permanent gaps (vc
12, 14–17, 19, 20 and iOS build 26 do not exist). Read it from Play after
submitting.

On the Windows path the versionCode is whatever you passed to
`patch-android-release.mjs`, since `autoIncrement` never runs — so nothing is
burned by a failed attempt, and nothing is reserved either. Read the live one
first (`node scripts/app-version-sync.mjs --check`) and pass the next number.

### Signing

`credentialsSource: "local"` → `credentials/dev.keystore`, alias `macrolog-dev`.
**Never regenerate or replace it** — `fit.ignia.app` is registered with Play
against that cert and there is no recovery. It now exists on both machines;
locations and the disposal list are in `CLAUDE.local.md`.

### Avenues that are genuinely closed on Windows

Kept because each was tried, and the first two will be re-proposed. **Note the
header above this one used to read "every avenue, closed" and lead with
`MAX_PATH` — that conclusion was wrong**, and it cost this project the belief
that Windows could not build Android at all for weeks.

| Attempt | Why it fails |
|---|---|
| `eas build --local` on Windows | refuses outright: *"Android builds are supported only on Linux and macOS"* (`eas-cli` `checkRuntime.ts`) |
| `eas build --local` in WSL2 | **ARM64** machine (Snapdragon X Elite) -> WSL is `aarch64`, and Google ships the SDK/NDK for `linux-x86_64` only ([tracker 227219818](https://issuetracker.google.com/issues/227219818), open) |
| `-DCMAKE_OBJECT_PATH_MAX=200` | Reaches CMake (verified in `CMakeCache.txt`), no effect — sources are out-of-tree, so CMake embeds the mangled absolute path. Moot now that the warning is known non-fatal |

### Fallback: the EAS cloud build

Only when the Mac is unreachable. Quota is **15/month** and the free-tier queue
has run to **two hours**. Check `SENTRY_AUTH_TOKEN` before queueing —
`@sentry/react-native` uploads source maps as a Gradle task, so a stale token
**fails the build**; build `9e3df4e3` died on an HTTP 401 after a two-hour wait.
`npm run doctor` group 3 validates the local copy.

## Step 4 — submit FROM WINDOWS

Since Android builds here, the AAB is already on this machine — there is nothing
to copy. The `scp ignia-mac:…` step this section used to open with belonged to
the Mac-build era and is gone.

**The Mac still must not submit**, if it ever builds one again: it has
`dev.keystore` but deliberately NOT `credentials/play-service-account.json`, a
key that can publish to the live listing. It already holds the signing keystore,
the Sentry token and an EAS session; a fourth credential does not go onto someone
else's laptop.

**Windows ARM64 is not a barrier here.** The architecture limit is on *building*
(Google ships the Android SDK/NDK for `linux-x86_64` only); `eas submit` is a
Node CLI that uploads a file to the Play API and runs fine.

```sh
cd apps/mobile && npx eas submit -p android --profile production \
  --path android/app/build/outputs/bundle/release/app-release.aab --non-interactive
```

Goes to the **alpha** track with `releaseStatus: "completed"` (rolled out to the
tester list, not a draft). `eas submit` consumes **no build quota**.

**Verify at Play, not from the CLI** — `androidpublisher` edits→tracks is the
authority on what testers have, and it is also where the real versionCode comes
from. The quickest read of both is the sync script:

```sh
node scripts/app-version-sync.mjs --check    # prints the live alpha versionCode
```

### Shipping a binary does NOT deliver an OTA update

- A device becomes OTA-capable only once it is **running a binary containing
  `expo-updates`**. Testers on an older versionCode receive nothing until they
  install the new one — their action, not yours.
- Publishing a binary does not publish an update. `eas update` is Step 2, run
  when you have a JS change to ship.

## After shipping

```sh
node scripts/app-version-sync.mjs        # derives the number from the live Play tracks
npm run build && firebase deploy --only hosting
curl -s https://ignia.fit/app-version.json
```

`UpdateBanner` on Today reads that file to tell older installs a new binary
exists. **Skip the deploy and it silently never fires** — no error, no warning,
every install quietly believing it is current, indistinguishable from never
having built the feature. Never hand-edit the number. `npm run doctor` fails on
the drift (*app-version.json matches what Play ships*), so the safety net is the
doctor run, not your memory. **A prod web build is required before
`firebase deploy`** — a dev build skips `ngsw.json`.

Then:

- Update the fingerprint table in `apps/mobile/AGENTS.md`, with the value read
  from the artifact.
- Update `STATUS.md` — it says what is true right now.
- **A merged fix reaches nobody until it is in a binary or an update.** Say which,
  and which cohort, out loud when reporting.
