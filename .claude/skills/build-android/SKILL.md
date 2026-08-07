---
name: build-android
description: Ship an Android change — decide between an over-the-air EAS Update (free, instant, no build) and a real EAS cloud build, run the fingerprint gate that decides which is valid, and submit to the Play alpha track. Use for "ship this to Android", "cut an Android build", "push a fix to testers", or any mobile fix headed for Play. iOS is the `build-ios` skill (local, on the Mac).
---

# Ship an Android change

**Start by asking whether you need a build at all.** Most fixes do not. Getting
this fork wrong in either direction is expensive: a needless build burns quota
and up to two hours of queue, and an OTA published against a changed fingerprint
reaches **nobody** while reporting success.

## Step 1 — the fingerprint gate (ALWAYS; it decides everything after)

```sh
cd apps/mobile && npx expo-updates fingerprint:generate --platform android
```

Compare the `hash` to the fingerprint of the binary testers are running (recorded
in `apps/mobile/AGENTS.md`).

| Result | Meaning | Go to |
|---|---|---|
| **Same hash** | JS-only change | Step 2 — OTA, free and instant |
| **Different hash** | native surface changed | Step 3 — real build, costs quota |

**Never skip this because the diff "looks like JS".** `eas update` succeeds
either way; a mismatched runtime version publishes into the void and every tester
silently keeps the old code. There is no error to notice.

Changes the fingerprint: any dependency with native code, native config in
`app.json` (permissions, icons, splash, plugins, entitlements), an Expo SDK
upgrade, widget/watch Swift or Kotlin. A pure-JS dependency usually does not —
run the command rather than reasoning about it.

## Step 2 — OTA (no build, no queue, no review)

```sh
cd apps/mobile && npx eas update --branch production --message "<what changed>"
```

Free tier is **1,000 monthly active users** (unique devices downloading ≥1 update
per month); the tester base is single digits, so this costs nothing today.

- Testers get it on the **next** launch, not the current one.
- Undo with `eas update:roll-back-to-embedded` — returns everyone to the JS baked
  into their binary.
- Branch/channel names match `eas.json` build profiles: development / preview /
  production.

Run the Metro gate first — `tsc` and `jest` both pass while a bundling break is
latent (see this folder's `AGENTS.md`, which cost two EAS builds to learn):

```sh
npx expo export --platform android --output-dir <tmp>
```

## Step 3 — a real Android build: build it on the Mac, free

**Proven 2026-08-07: `ignia-mac` builds Android.** 89 MB `.aab` in 13m03s cold,
120 native `.so` libraries including `arm64-v8a/libappmodules.so` — the exact
artifact whose compilation is impossible on this Windows box. **Zero EAS quota.**
See `DEV_ENVIRONMENT.md` §3.11.

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git pull --ff-only && cd apps/mobile && \
  export GRADLE_OPTS='-Dorg.gradle.internal.http.socketTimeout=60000 -Dorg.gradle.internal.http.connectionTimeout=60000' && \
  eas build -p android --profile production --local --non-interactive"
```

**Use `eas build --local`. NEVER raw `./gradlew bundleRelease`.** Gradle compiles
and signs fine and Play accepts the output — and the binary **silently cannot
receive OTA updates**, because `expo prebuild` does not read `eas.json` and so
never writes the update channel into `AndroidManifest.xml`. The app then calls
`u.expo.dev` with no `expo-channel-name` header and EAS has no branch to serve it.
Nothing errors at build time or runtime. That shipped as **vc 10** before anyone
checked, and is why **vc 11** exists. `eas build --local` runs the real EAS
pipeline locally, so it injects the channel, resolves signing from
`credentialsSource: "local"`, and increments the versionCode from the remote
source. (`apps/mobile/scripts/patch-android-release.mjs` hand-wired those for the
raw-Gradle experiment and is now obsolete.)

**If `apps/mobile/android/` exists from a previous hand-run, delete it first** —
EAS treats a present native dir as bare-workflow and carries the stale config
forward, reproducing the bug.

Three more things that will bite, all measured:

- **`JAVA_HOME` must be the explicit Homebrew path.** `openjdk@17` is keg-only, so
  `/usr/libexec/java_home -v 17` cannot see it and silently yields Java 11 —
  `sdkmanager` and Gradle then die with `UnsupportedClassVersionError` (class file
  61 vs 55). Use
  `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`.
- **Gradle has NO default socket timeout.** A dropped connection to Google's Maven
  left a build hung for 19 minutes looking exactly like slow compilation — the
  tell is a socket in `CLOSE_WAIT` and zero writes into `android/app/build`. Pass
  it via `GRADLE_OPTS` as above, since EAS drives Gradle itself.
- **Disk.** The SDK is only ~3 GB, but Gradle caches and outputs added ~5 GB on
  first build. Watch it if the Mac carries both platforms.

**Verify before submitting — three cheap checks:**

```sh
keytool -printcert -jarfile <aab> | grep Owner   # NOT "CN=Android Debug"
unzip -p <aab> base/manifest/AndroidManifest.xml | strings | grep expo-channel-name
eas build:version:get -p android
```

**Do NOT try to build Android locally on Windows.** Every avenue is closed, and
each one costs 6+ minutes to rediscover:

| Attempt | Why it fails |
|---|---|
| `./gradlew bundleRelease` on Windows | `MAX_PATH`. RN New Architecture codegen embeds the full source path in the object path; `react-native-keyboard-controller` reaches 350 chars against a 260 limit ([upstream #1247](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1247), open, unfixed) |
| Shorter staging dir | Arithmetic kills it — the remainder past the prefix is 275 chars alone |
| `LongPathsEnabled` registry | Already `1`; the SDK ships ninja 1.10.2, which predates the opt-in |
| `-DCMAKE_OBJECT_PATH_MAX=200` | Reaches CMake (verified in `CMakeCache.txt`), no effect — sources are out-of-tree, so CMake embeds the mangled absolute path and the max does not rewrite it |
| `eas build --local` in WSL2 | **ARM64** machine (Snapdragon X Elite) → WSL is `aarch64`, and Google ships the SDK/NDK for `linux-x86_64` only ([tracker 227219818](https://issuetracker.google.com/issues/227219818), open) |

### Fallback: the EAS cloud build

Only when the Mac is unreachable.

```sh
cd apps/mobile && npx eas build -p android --profile production
```

- Quota is **15/month**; free-tier queue has run to **two hours**.
- `autoIncrement: true` with `appVersionSource: "remote"` — the counter lives on
  EAS, not the repo. Read it with `eas build:version:get -p android`. A local
  Gradle build does NOT increment it; set it by hand with
  `eas build:version:set` or the next cloud build re-mints a colliding number.
- **Check `SENTRY_AUTH_TOKEN` before queueing.** `@sentry/react-native` uploads
  source maps as a Gradle task, so a stale token FAILS the build — build
  `9e3df4e3` died on an HTTP 401 after a two-hour wait. `npm run doctor` group 3
  validates the local copy.

### Signing, either path

`credentialsSource: "local"` → `credentials/dev.keystore`, alias `macrolog-dev`.
**Never regenerate or replace it**: `fit.ignia.app` is registered with Play against
that cert and there is no recovery. `apps/mobile/scripts/patch-android-release.mjs`
wires it into a prebuilt `android/` (real release signing config + versionCode),
because Expo's template points `release` at the **debug** keystore — an AAB signed
that way is the wrong upload cert and Play rejects it. Verify before submitting:

```sh
keytool -printcert -jarfile <aab> | grep -i 'Owner\|SHA'
# CN=Android Debug  →  WRONG, unsigned-for-Play
```

## Step 4 — submit FROM WINDOWS, not from the Mac

**The Mac cannot submit to Play.** It has `dev.keystore` but deliberately NOT
`credentials/play-service-account.json` — that key can publish releases to the
live listing, and the Mac already holds the signing keystore, the Sentry token
and an EAS session. Pull the AAB back instead of adding a fourth credential to
someone else's laptop:

```sh
# on Windows
scp ignia-mac:~/fitness-tracker-pwa/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab <tmp>/ignia-vcN.aab
cd apps/mobile && npx eas submit -p android --profile production --path <tmp>/ignia-vcN.aab
```

89 MB over Tailscale, a few seconds. Goes to the **alpha** track with
`releaseStatus: "completed"` (rolled out to the tester list, not a draft).

`eas submit` consumes **no build quota** — it is a separate service from
`eas build`. Submitting freely is fine.

**Verify at Play, not from the CLI** — the `androidpublisher` edits→tracks API is
the authority on what testers actually have:

```
GET androidpublisher/v3/.../tracks/alpha  →  status=completed, versionCodes=["N"]
```

### Shipping a binary does NOT deliver an OTA update

Two separate things, and conflating them wastes a release:

- A device only becomes OTA-capable once it is **running a binary that contains
  `expo-updates`**. Testers on an older versionCode receive nothing until they
  install the new one from Play — which is their action, not yours.
- Publishing the binary does not publish an update. `eas update` is a separate
  command, run when you actually have a JS change to ship.

## After shipping

- Update the fingerprint table in `apps/mobile/AGENTS.md` if a new binary shipped.
- Update `STATUS.md` — it is the file that says what is true right now.
- **A merged fix reaches nobody until it is in a binary or an update.** Say which,
  out loud, when reporting.
