---
name: build-android
description: Ship an Android change — decide between an over-the-air EAS Update (free, instant, no build) and a real build, run the fingerprint gate that decides whether an OTA can land, and submit to the Play alpha track. Use for "ship this to Android", "cut an Android build", "push a fix to testers", or any mobile fix headed for Play. iOS is the `build-ios` skill (also local, also on the Mac).
---

# Ship an Android change

**Start by asking whether you need a build at all.** Most fixes do not. Both
Android and iOS now build locally on `ignia-mac` at **zero EAS quota**, so a
needless build costs ~11 minutes rather than a queue slot — but an OTA published
against a changed fingerprint reaches **nobody** while reporting success, and
that is the expensive direction.

## Step 1 — the fingerprint gate

**Run it on `ignia-mac`. Never on the Windows workstation.** The fingerprint is a
property of the machine as well as the commit — a gitignored `apps/mobile/android/`
dir that exists only on Windows, CRLF-vs-LF, and divergent `node_modules` all feed
it. Every binary is built on the Mac, so the Mac's number is the one they carry.
Three OTAs were published against Windows numbers on 2026-08-07 and reached
nothing.

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git checkout main && git pull --ff-only"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform android" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hash))"
```

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

This step owns OTA publishing for **both** platforms — `eas update` publishes for
both at once. `build-ios` links here rather than repeating it.

**Publish from `ignia-mac`**, for the same machine-dependence reason as the gate.

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
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas update --branch production --message '<what changed>'"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas update:list --branch production --limit 3"
```

`--message` is for **you**, in the EAS dashboard. Users never see it.

- Testers get it on the **next** launch, not the current one.
- Undo with `eas update:roll-back-to-embedded` — returns everyone to the JS baked
  into their binary.
- Branch/channel names match the `eas.json` build profiles.
- Free tier is **1,000 monthly active users**; the tester base is single digits.

## Step 3 — a real Android build, on the Mac, free

`ignia-mac` is the **only** machine here that can build Android at all — see the
closed-avenues table at the end. Zero EAS quota. ~11 minutes warm.
`DEV_ENVIRONMENT.md` §3.11 has the runbook.

### Preflight

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git log --oneline -1 && git status --short | head -5
df -h / | awk 'NR==2{print \$4\" free\"}'
ls apps/mobile/android 2>/dev/null && echo 'STALE PREBUILD DIR — delete it'"
```

- **Disk ≥ 20 GB.** Gradle caches and outputs add ~5 GB. `~/.gradle` is ~5.5 GB and
  is a cache — safe to delete, at the cost of a slow next build. Clear Xcode
  DerivedData first; it is cheaper to lose.
- **`apps/mobile/android/` must not exist.** EAS treats a present native dir as
  bare-workflow and carries stale config forward, reproducing the missing-channel
  bug below.

### Launch detached, with a sentinel

**Never run the build in the foreground of an SSH session** — the connection
dropping kills it, and a dead SSH is indistinguishable from a finished process.

```sh
ssh ignia-mac "cat > ~/run-android-build.sh <<'EOF'
#!/bin/zsh
cd ~/fitness-tracker-pwa/apps/mobile || exit 90
set -a; . ~/fitness-tracker-pwa/.env.local; set +a
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=\$HOME/Library/Android/sdk
export PATH=\"\$JAVA_HOME/bin:\$ANDROID_HOME/platform-tools:\$PATH\"
export GRADLE_OPTS='-Dorg.gradle.internal.http.socketTimeout=60000 -Dorg.gradle.internal.http.connectionTimeout=60000'
echo \"IGNIA_ANDROID_START \$(date -u +%FT%TZ)\"
npx eas build -p android --profile production --local --non-interactive
echo \"IGNIA_ANDROID_EXIT=\$?\"
EOF
chmod +x ~/run-android-build.sh
rm -f ~/android-build.log
nohup caffeinate -dims ~/run-android-build.sh > ~/android-build.log 2>&1 &
echo launched"

until ssh ignia-mac "grep -q IGNIA_ANDROID_EXIT ~/android-build.log" 2>/dev/null; do sleep 60; done
```

`caffeinate -dims` is not optional: the dock can drop power delivery while still
working as a dock, which puts the Air on battery where sleep is allowed.

**`GRADLE_OPTS` carries only the socket timeouts.** Gradle has no default socket
timeout, and a dropped connection to Google's Maven once left a build hung for 19
minutes looking exactly like slow compilation. **Heap and metaspace are NOT here
any more** — they live in `apps/mobile/plugins/withGradleJvmArgs.js`, because an
env var typed by hand works exactly as often as someone remembers it. That plugin
exists because a release build died on `OutOfMemoryError: Metaspace` in
`:react-native-health-connect:lintVitalAnalyzeRelease` on 2026-08-08, and
`expo-build-properties` has no option for Gradle JVM args.

**On the Mac, use `eas build --local` — never raw `./gradlew bundleRelease`.**
Gradle compiles and signs fine and Play accepts the output — and the binary
**silently cannot receive OTA updates**, because `expo prebuild` does not read
`eas.json` and never writes the update channel into `AndroidManifest.xml`.
Nothing errors at build time or runtime. That shipped as vc 10 before anyone
checked, and is why vc 11 exists.

**On Windows the rule inverts, because `eas build --local` refuses to run there
at all.** Raw Gradle is the only path, and
`apps/mobile/scripts/patch-android-release.mjs` — **no longer obsolete as of
2026-08-17** — injects the channel, the release signing and the versionCode that
EAS Build would have. See "Windows CAN build Android" below for the full
procedure, and **gate on `verify-mobile-artifact.mjs` exiting 0**, which is the
check that catches exactly this defect.

### `JAVA_HOME` and `ANDROID_HOME` are NOT in the Mac's shell config

Verified 2026-08-08: neither appears in `~/.zshrc`, `~/.zprofile` or `~/.zshenv`.
Every successful Android build so far passed them inline. A `nohup`-ed wrapper
inherits nothing from an interactive shell, so **both must be exported inside the
script** — that is why they are in the template above, and removing either
reproduces a documented failure:

| Missing | Fails in | Message |
|---|---|---|
| `JAVA_HOME` | ~45 s | `Android Gradle plugin requires Java 17 to run. You are currently using Java 11` — the Mac's default JDK is Microsoft's 11 at `/Library/Java/JavaVirtualMachines/microsoft-11.jdk`, and `openjdk@17` is keg-only so `/usr/libexec/java_home -v 17` cannot find it |
| `ANDROID_HOME` | ~5 s | `SDK location not found` (this is `DEV_ENVIRONMENT.md` §3.11 trap 3 — it is what killed vc 12) |

Both are cheap failures in wall-clock and **both burn a versionCode**, because
`autoIncrement` counts attempts. Two were burned this way on 2026-08-08 alone,
by a version of this file that stated the `JAVA_HOME` rule in prose beside a
command that omitted it. A rule next to a command that contradicts it is worse
than no rule: the command is what gets run.

**Do not "fix" either by writing `org.gradle.java.home` or `sdk.dir` into
`withGradleJvmArgs.js`** — that hardcodes machine-specific paths into committed
config and breaks the EAS cloud fallback, which runs on Linux.

### Verify the artifact — run the script, gate on its exit code

`eas build --local` writes **`apps/mobile/build-<timestamp>.aab`**, not the Gradle
output path. The checks are **code, not prose** (see the build-ios skill for what
prose cost on 2026-08-08):

```sh
scp scripts/verify-mobile-artifact.mjs scripts/native-expectations.json ignia-mac:/tmp/
ssh ignia-mac "node /tmp/verify-mobile-artifact.mjs ~/fitness-tracker-pwa/apps/mobile/build-<ts>.aab"
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

### Signing

`credentialsSource: "local"` → `credentials/dev.keystore`, alias `macrolog-dev`.
**Never regenerate or replace it** — `fit.ignia.app` is registered with Play
against that cert and there is no recovery. It now exists on both machines;
locations and the disposal list are in `CLAUDE.local.md`.

### Windows CAN build Android — corrected 2026-08-17

This section used to read *"every avenue, closed"* and led with `MAX_PATH`. That
was **wrong**. `./gradlew bundleRelease` on the Snapdragon X Elite workstation
completed in **10m12s** and produced a verifier-green, signed, OTA-capable AAB
(vc 31, fingerprint `3d3bc410…`, all four ABIs).

CMake does still emit its `CMAKE_OBJECT_PATH_MAX` warning against
`react-native-keyboard-controller`'s shadow node — that is almost certainly where
the old conclusion came from. It is a **warning, not a fatal error**. What CMake
actually says is that it cannot *guarantee* correct object placement, so treat it
as a reason to insist on device QA, not as a reason not to build.

**`eas build --local` on the Mac is still the preferred path whenever the Mac can
build.** This one exists only because `eas build --local` refuses Android off
Linux/macOS (`eas-cli`'s `checkRuntime.ts`), so Windows cannot use it at all.

Raw Gradle omits two things EAS Build does for free, and **both fail silently**:

| Missing | Consequence |
|---|---|
| EAS Update **channel** in `AndroidManifest.xml` | binary calls `u.expo.dev` with no `expo-channel-name` and can never update. This shipped as vc 10 |
| release **signing** + **versionCode** | the template points `release` at the *debug* keystore, and `appVersionSource: "remote"` leaves versionCode at `1` |

`scripts/patch-android-release.mjs` handles all of it (it is no longer obsolete —
injecting the channel was the one thing it could not do). The procedure:

```sh
cd apps/mobile/android && ./gradlew --stop || true   # BEFORE the clean; see below
cd .. && npx expo prebuild -p android --clean
node scripts/patch-android-release.mjs <versionCode> production
cd android && ./gradlew bundleRelease
node ../../../scripts/verify-mobile-artifact.mjs <path-to.aab>   # MUST exit 0
```

**`./gradlew --stop` is not optional.** A daemon left from an earlier build holds
handles on `node_modules/*/android/build`, and the failure is `Unable to delete
file '…classes.jar'` at an arbitrary task — an error that looks nothing like its
cause. `--no-daemon` does **not** help: it avoids *creating* a daemon, not the
ones already running.

To cut the build roughly fourfold, set `reactNativeArchitectures=arm64-v8a` in
the generated `android/gradle.properties` — `x86`/`x86_64` serve only emulators
and a few ChromeOS devices. Do it after prebuild; prebuild regenerates that file.

**A Windows-built binary carries a Windows runtime version.** Shipping one splits
the OTA cohort and inverts the publish rule for Android — see `STATUS.md`, and
flip `.claude/hooks/guard_eas_update.py` in the same change.

Genuinely closed, still:

| Attempt | Why it fails |
|---|---|
| `eas build --local` on Windows | refuses outright: *"Android builds are supported only on Linux and macOS"* |
| `eas build --local` in WSL2 | **ARM64** machine (Snapdragon X Elite) → WSL is `aarch64`, and Google ships the SDK/NDK for `linux-x86_64` only ([tracker 227219818](https://issuetracker.google.com/issues/227219818), open) |
| `-DCMAKE_OBJECT_PATH_MAX=200` | Reaches CMake (verified in `CMakeCache.txt`), no effect — sources are out-of-tree, so CMake embeds the mangled absolute path. Moot now that the warning is known non-fatal |

### Fallback: the EAS cloud build

Only when the Mac is unreachable. Quota is **15/month** and the free-tier queue
has run to **two hours**. Check `SENTRY_AUTH_TOKEN` before queueing —
`@sentry/react-native` uploads source maps as a Gradle task, so a stale token
**fails the build**; build `9e3df4e3` died on an HTTP 401 after a two-hour wait.
`npm run doctor` group 3 validates the local copy.

## Step 4 — submit FROM WINDOWS

**The Mac cannot submit to Play.** It has `dev.keystore` but deliberately NOT
`credentials/play-service-account.json` — that key can publish to the live
listing, and the Mac already holds the signing keystore, the Sentry token and an
EAS session. Pull the AAB back rather than adding a fourth credential to someone
else's laptop.

**Windows ARM64 is not a barrier here.** The architecture limit is on *building*
(Google ships the Android SDK/NDK for `linux-x86_64` only); `eas submit` is a
Node CLI that uploads a file to the Play API and runs fine.

```sh
# on Windows
scp ignia-mac:~/fitness-tracker-pwa/apps/mobile/build-<ts>.aab "$TEMP/claude/ignia-vcN.aab"
cd apps/mobile && npx eas submit -p android --profile production --path "$TEMP/claude/ignia-vcN.aab" --non-interactive
```

~93 MB over Tailscale, a few seconds. Goes to the **alpha** track with
`releaseStatus: "completed"` (rolled out to the tester list, not a draft).
`eas submit` consumes **no build quota**.

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
