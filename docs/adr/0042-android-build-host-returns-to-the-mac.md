# ADR-0042: Android's build host returns to `ignia-mac`, and the route is raw Gradle

- **Status:** accepted 2026-09-17 — **capability verified, cutover NOT executed.**
  Android still builds and OTAs from the Windows workstation until the cutover in
  §Consequences 1 is done. Supersedes the "permanently" in ADR-less
  `docs/DEV_ENVIRONMENT.md` §3.11 and `docs/build-infrastructure.md`.
- **Date:** 2026-09-17
- **Touches:** no application code. `docs/DEV_ENVIRONMENT.md` §3.11/§3.16,
  `docs/build-infrastructure.md`, `apps/mobile/AGENTS.md` (host table),
  `.claude/skills/build-android/`, `.claude/hooks/guard_eas_update.py`,
  `apps/mobile/.maestro/README.md`,
  `apps/mobile/scripts/patch-android-release.mjs` (comment only),
  `apps/mobile/plugins/withGradleJvmArgs.js` (comment only).

## Context

On 2026-08-17 Android's build host moved to the Windows workstation and the Air's
Android toolchain was deleted. The stated reason was choice; the operative reason
was disk — `~/Library/Android` (3.3 GB), `~/.gradle` and `~/.android` (2.9 GB)
had to go to get the volume back over the ~17 GB iOS floor.

**That constraint no longer exists.** Measured 2026-09-17 on `ignia-mac` after a
reclaim pass: **43 GB free → 92 GB free**, against a full Android toolchain
costing ~22 GB standing. What was reclaimed, and it was all waste:

| | |
|---|---|
| `~/build-artifacts/eas-1.2.*` (callbook local-build workspaces, Sept 11–12) | 30.4 GB |
| `~/.maestro/tests` (134 run dirs; Maestro's 14-day purge does not keep up) | 23 GB |
| watchOS 26.5 simulator runtime (27.0 already installed) | 8.1 GB |
| two Callbook simulators | 7.2 GB |
| CocoaPods + Homebrew caches | 4.2 GB |

The 2026-08-17 decision also rested on a second claim that is now known to be
narrower than it read: that keeping Android on Windows costs only the
`patch-android-release.mjs` hack. It also costs **two fingerprint authorities,
two OTA hosts, a `--platform`-scoping rule, a guard hook to enforce it, and an
Android emulator that lives on a machine which does not build Android** — the
emulator has been on the Mac since 2026-08-08 while the binaries it tests were
built 2,000 km of pipeline away.

## Decision

**1. Android builds on `ignia-mac`.** Both platforms on one host, one fingerprint
authority per platform on the same machine.

**2. The route is raw Gradle — "Route B":**

```
./gradlew --stop
npx expo prebuild -p android --clean --no-install     # --no-install is LOAD-BEARING, see T1
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
node scripts/patch-android-release.mjs <versionCode> production
cd android && ./gradlew bundleRelease
node scripts/verify-mobile-artifact.mjs <aab>          # must exit 0
```

**3. `verify-mobile-artifact.mjs` is not optional.** Route B fakes three things
that each fail silently — the EAS Update channel (shipped once as vc 10), release
signing, and the versionCode. The verifier is the only thing standing between
those and Play. Route B is adopted *with* that gate, not instead of it.

**4. Route A (`eas build --local -p android`) is verified working and NOT
adopted.** This reverses `7b1da42c`, a parallel session on the Windows
workstation that reached the same host conclusion the same day and wrote
"`eas build --local` is the sanctioned path" into the `build-android` skill.
The owner chose Route B on build time and artifact size, knowing Route A's ABI
set is controllable (T7) and that Route A cannot silently omit the channel, the
signing or the versionCode. **That is the whole reason decision 3 makes the
verifier non-optional** - Route B keeps a class of silent failure that Route A
does not have, and the gate is what pays for it.

Two things from `7b1da42c` stand and are not re-litigated here: its
`STATUS.md` cutover checklist, and its finding that
`plugins/withGradleJvmArgs.js` is **FROZEN** - any byte including a comment
moves both platforms. That session and this one hit T8 independently, hours
apart, which is the best evidence there is that the rule needed writing down.

Its `--no-install` omission did NOT stand: that trap (T1) was still live in the
sanctioned procedure and landed separately as `ffe87d59` so it would not wait on
this ADR.

**The grounds, stated honestly.** The measured gap is **15m04s / 62.6 MB
(Route B) against 10m25s / 73.5 MB (Route A)** on the same machine the same day,
and the two runs are not like-for-like: Route B's was a cold `--clean` build with
an emulator and a simulator resident, Route A's was warm. An earlier draft of
this ADR justified the choice as "Route B compiles two ABIs where Route A
compiles four" - **that is false and T7 disproves it.** The decision is the
owner's and stands; it should not be defended with the ABI argument.

## Evidence — all measured 2026-09-17 on `ignia-mac` (M1 Air, 8 cores, 16 GB)

**Route B, `./gradlew bundleRelease`:**

| | |
|---|---|
| Result | **BUILD SUCCESSFUL in 15m 04s**, 1403 tasks, all executed (cold, after `--clean`) |
| AAB | 62.6 MB (Windows measures 66 MB on the same route) |
| ABIs | `armeabi-v7a` + `arm64-v8a` — exactly what step 1b writes |
| **Signer** | `CN=Macro Log Dev, OU=Mobile, O=Macro Log, L=San Juan, ST=PR, C=US`, SHA-256 `75:4B:03:19:71:6B:B8:6B:…` — **byte-identical to `credentials/dev.keystore`** |
| Channel | `expo-channel-name: production` in the shipped manifest |
| versionCode | 46 (live was 45; raw Gradle never touches the remote counter) |
| Sentry | sourcemaps uploaded — `SENTRY_AUTH_TOKEN` reaches Gradle on macOS via `.zshenv` |
| Verifier | all 10 structural checks green |

`patch-android-release.mjs` ran **unmodified** on macOS. All twelve mutations
applied, including the Health Connect manifest work and `MainActivity.kt`.

**Route A, `eas build --local -p android --profile preview`:** BUILD SUCCESSFUL
in 10m 25s (including a 2.4 GB NDK re-download), APK 73.5 MB, channel injected
automatically, versionCode read from remote without incrementing.

**Emulator and device QA, no phone involved:**

| | |
|---|---|
| AVD `pixel_api36` (Pixel 7, Android 16 / API 36, `google_apis/arm64-v8a`) | cold-boots **headless in ~30 s** |
| Acceleration | `Hypervisor.Framework OS X Version 27.0`, arm64 |
| APK install | 3.7 s |
| `maestro test .maestro/android-smoke.yaml` | **8/8 steps, 25 s** |

## Consequences

**1. The Android OTA channel closes until one binary ships from the Mac.** The
Mac's Android fingerprint is `7514d026…`; the live runtime (vc 45, Windows) is
`15c1cfc8…`. They do not match and cannot be made to — the Windows/macOS
divergence is `@expo/fingerprint` walking nested `node_modules` on one host and
stopping at them on the other (`apps/mobile/AGENTS.md`). So the cutover is:

- cut an AAB on the Mac from a clean tree, verifier-green;
- ship it to the Play alpha track and let testers take it;
- only then publish Android OTAs from the Mac.

Until that lands, **Android OTAs still come from Windows.** Do not flip the
`AGENTS.md` host table or `guard_eas_update.py` before the binary is live.

**2. After the cutover, four things collapse into one.** `--platform`-scoped
publishing stops being a correctness requirement, the two-row host table becomes
one row, `guard_eas_update.py`'s host enforcement becomes redundant, and the
fingerprint gate has one place to run.

**3. `withGradleJvmArgs.js` actually works here.** There is no
`~/.gradle/gradle.properties` on `ignia-mac`, so nothing shadows the project
file: the daemon runs `-Xmx6g -XX:MaxMetaspaceSize=2g` as intended. On Windows
the user-level file pins it to `MaxMetaspaceSize=1024m` and the plugin is inert.
Moving hosts silently *fixes* the metaspace guard that vc 32 and vc 33 passed
only by luck.

**4. Both NDKs are required — 27.0.12077973 AND 27.1.12297006, 2.4 GB each.**
The Expo/RN graph resolves 27.1; something else in it pins 27.0. Deleting either
costs a re-download mid-build. Verified by deleting 27.0 and watching Gradle
re-fetch it.

**5. The Mac is not slower in any way that matters.** 15m 04s here against
Windows' 10m 29s for the same route looks worse, but the Mac's run had an Android
emulator and an iOS simulator resident and a concurrent Maestro flow; treat it as
an upper bound, not a measurement. Native compilation is emulated on **both**
hosts — Google ships no `darwin-arm64` NDK host toolchain and no `windows-arm64`
one either, so the Rosetta argument does not distinguish them.

## Traps found while proving this — each cost real time

**T1 — `expo prebuild` without `--no-install` runs `npm install`, and that moves
BOTH fingerprints.** This is the expensive one. Measured end to end:

```
before (clean tree)   ios 52802bba…  android 7514d026…    ← matches live build 64
after prebuild        ios 700258fd…  android d98ccb24…    ← both channels shut
after `npm ci`        ios 52802bba…  android 7514d026…    ← restored exactly
```

`docs/build-infrastructure.md` already says only Windows may run `npm install`
and the Mac runs `npm ci` and nothing else. **The `build-android` skill's own
Step 3 violates it** — it says `npx expo prebuild -p android --clean` with no
`--no-install`. Harmless on Windows, which is allowed to resolve; on the Mac that
one missing flag silently shuts both OTA channels. Ruled out as causes by
measurement, so nobody re-derives them: the `android/` prebuild directory
(moved aside, hash unchanged — AGENTS.md's "`dir:` sources hash only git-TRACKED
content" holds on macOS) and the four untracked `targets/*/Info.plist` files.

**One honest caveat on the attribution.** A raw Gradle build also writes into
`node_modules/*/android/build/`, and that happened between the two readings, so
`npm install` is not *isolated* from it by this measurement alone. `npm install`
is the sound attribution because AGENTS.md measured that untracked content inside
a hashed `dir:` source contributes nothing (tested on `dir:modules/quick-add-tile/android`
with 299 untracked files), while `npm install` genuinely changes which files
exist under nested `node_modules` — which is the exact mechanism behind the
228-entry Windows/macOS gap. The cheap test that would settle it: gate a clean
tree, run `bundleRelease` with NO prebuild, gate again. If it moves, Route B is
self-poisoning and every build must be followed by `npm ci` before the gate.

**T2 — `verify-mobile-artifact.mjs` prints the runtime fingerprint but does not
validate it.** The vc 46 AAB built from the polluted tree embeds `2162d8e0…`,
matches no gate reading and no live binary, and the verifier passed it **green on
all ten checks**. The safety net has a hole exactly where T1 bites. Until the
verifier takes an expected hash, the gate must be run separately and compared by
hand.

**T3 — the emulator needs `-gpu host`; `swiftshader_indirect` kills it.**
`.maestro/README.md` prescribes `-gpu swiftshader_indirect`. On this host the
emulator drops to `offline` the moment the app launches, with
`ERROR | Failed to find ColorBuffer: 85`, and Maestro dies at `launchApp` with
`device offline` — which reads as a broken build. `-gpu host` uses Metal, works
headless over SSH, and passed first try.

**T4 — `adb install` returns before Android finishes the package update, and the
update kills the app.** The first Maestro flow after an install dies at its first
assertion. The tell is in logcat, not on screen:
`PackageUpdatedTask: Package updated: mOp=UPDATE packages=[fit.ignia.app]`
followed by `Zygote: Process N exited due to signal 9 (Killed)`. Hit twice,
diagnosed as a UI regression the first time. Let the install settle, then run.

**T5 — `expo prebuild` deletes `android/local.properties`.** The skill already
warns, but its restore line writes the Windows path `sdk.dir=Z:/packages/android-sdk`.
On the Mac it is `sdk.dir=$HOME/Library/Android/sdk`, and getting it wrong
reports "SDK location not found", which reads like a missing SDK install.

**T6 — `patch-android-release.mjs` section 3 is labelled "WINDOWS ONLY" and is
not platform-gated.** It rewrote `sentry.gradle` to an absolute path on macOS and
logged `(Windows fix)`. Harmless — the build succeeded and Sentry uploaded — but
the comment is wrong and will mislead the next reader.

**T7 — Route A's ABI set IS controllable, contrary to first reading.**
`ORG_GRADLE_PROJECT_reactNativeArchitectures` reaches Gradle through
`eas build --local` and is not a tracked or hashed file, so it moves no
fingerprint. Proven from the artifact, not the log: with it set to `arm64-v8a`
the APK carries `lib/arm64-v8a/` only at 73.5 MB, against a control from the same
day carrying all four at 161 MB. The workspace `gradle.properties` still *reads*
four ABIs and the per-ABI CMake tasks still *appear* in the log — a project
property overrides the file without rewriting it, and dependency modules
configure their own CMake regardless. **Neither is evidence about what gets
packaged.** This is the repo's own rule biting: ground truth is inside the
artifact, read it, do not compute it. Recorded because it was the basis on which
Route A was first (wrongly) said to be locked at four ABIs.

**T8 — a COMMENT-ONLY edit to a config plugin moves BOTH fingerprints, and it
happened while writing this ADR.** The consequence "`withGradleJvmArgs.js` is
live on the Mac" (Consequence 3) was first written as a comment block *inside*
`plugins/withGradleJvmArgs.js`. Not a line of code changed — only the docblock.
Measured immediately after:

```
before the comment edit   android 7514d026…   ios 52802bba…   <- matches live build 64
after the comment edit    android 637cc0a5…   ios <moved>      <- both channels shut
after `git checkout --`   android 7514d026…   ios 52802bba…   <- restored exactly
```

This is incident `1ddb51fa` (2026-08-19) reproduced, and it is worse than that
one in a useful way: `1ddb51fa` at least changed behaviour. This changed
**nothing but prose** and still cost both channels. `app.json`'s `plugins` array
is hashed by the *contents* of each plugin file, so a typo fix, a reformat or a
comment is indistinguishable from a rewrite.

**So the note about the plugin lives HERE, in this ADR, and not in the plugin.**
The same applies to every other file `app.json` lists as a plugin. If a plugin's
docblock is genuinely wrong, fix it in the same change as a native bump that
moves the hash anyway — the identical rule `docs/build-infrastructure.md`
already gives for the two CRLF files.

Verified in the same pass: editing `apps/mobile/scripts/patch-android-release.mjs`,
`apps/mobile/AGENTS.md`, `apps/mobile/.maestro/README.md` and anything under
`docs/` moves **neither** hash. Only the plugin did.

## Addendum — the regression suite run against Android, 2026-09-17

The suite had never run on Android. `android-smoke.yaml`'s own header called
itself "the first automated test that has ever run against a real Android
build", and that was still the high-water mark. It ran here because
`~/qa-pass.txt` is on this box, so `android-signin.yaml` could establish the
session the other 22 flows assume (`clearState: false`).

| Platform | Device | Result |
|---|---|---|
| iOS 27.0 | `Ignia-QA` (iPhone 17) | **21/21 in 17m 21s** |
| Android | `pixel_api36` (Pixel 7, API 36, headless) | **19/21** |

Android is *faster* on the short flows — `01-today` 8s vs 18s on iOS,
`04-settings` 20s vs 25s. The 60s settings-scroll budgets tuned for the LG G6
are comfortable here.

**Neither failure is an app regression and neither is caused by the host move.**
Both are the suite meeting a device geometry it was never tuned on, and one of
them is a real test defect that iOS has been passing by luck.

### A1 — `19-glossary`: the backdrop tap is tuned for 18:9 and this AVD is 20:9

Confirmed from the hierarchy at the failing step: the glossary sheet is **still
open** (`"What these numbers mean"` and every ON TRENDS term are on screen), so
the tab bar is covered and `tapOn: 'Trends'` cannot find it. The flow's Android
branch taps the backdrop at `50%,5%`, a value its own comment says was measured
on the **LG G6, 360x720dp (18:9)**. `pixel_api36` is **411x914dp (20:9)**, and
that comment states the constraint outright: the panel's top edge is not the
same *fraction* of screen height on different aspect ratios. The flow predicts
the exact symptom it produced - "the sheet stays open over the tab bar, and the
run dies two steps later on `tapOn: 'Trends'`, which reads like a broken tab
bar." Either add a third gated branch for 20:9, or pin the Android suite to an
18:9 AVD.

### A2 — `18-train-template` taps the wrong "QA Tpl Check", and ADR-0041 is why

This one is a genuine test defect, it is **self-poisoning**, and it is the
source of every "stranded workout" seen while diagnosing it.

The flow creates the template, saves it, then does
`scrollUntilVisible` / `tapOn: '.*QA Tpl Check.*'` and asserts
`template-ex-toggle-0`. After ADR-0041 the template name is on the Train tab
**twice**:

```
NEXT UP · QA Tpl Check · never done · [Start workout]     <- ADR-0041's new hero
Templates · Starters · + New
QA Tpl Check · 1 exercise / 3 sets / never done           <- the row the flow wants
```

Maestro takes the FIRST match, so the tap lands on the NEXT UP hero and **starts
a workout** instead of opening the editor. `template-ex-toggle-0` never exists,
the flow dies, and the workout it just started is left in progress - which then
hides the idle view and makes the NEXT run fail at a different, more confusing
place. ADR-0041 shipped 2026-09-16 and is the change that put the name on screen
twice; the flow has been ambiguous ever since and **passes on iOS only by luck
of hierarchy ordering.** The fix is to disambiguate the selector (a testID on
the Templates-section row, or a `below:`-constrained match), not to touch the
app.

### A3 — a Maestro tap can report COMPLETED while hitting nothing

Found while hardening A2's leftover-session guard, and it is the more portable
lesson. Maestro's own log said it tapped `discard-workout` at bounds
`[63,1543][306,1698]` and reported **COMPLETED**; the button was actually at
`[63,1467][306,1622]`. The scroll's momentum was still settling when the
hierarchy was captured, so the tap landed ~76px BELOW the button, on nothing.
`adb shell input tap` at the true centre discarded the session instantly, which
is what proves the button was never broken.

**A tap that hits empty space still reports COMPLETED.** Any
`scrollUntilVisible` immediately followed by a `tapOn` needs
`waitToSettleTimeoutMs`; Maestro's own failure hint says so and it is easy to
scroll past. Added to the guards in `16-train-terms` and `18-train-template`.

### A4 — the leftover-session guard in 16 and 18 was inverted (fixed)

Both flows guarded with `when: visible: id: 'discard-workout'`, which is FALSE
exactly when the guard is needed: Discard is the last element in the session's
scroll view, so with a session in progress it is below the fold and the block
silently skips itself. `21-train-cardio` and `22-train-rest-pause` had already
been hardened to key on `notVisible: start-workout` and SCROLL to Discard; 16
and 18 had not. Both now match, plus A3's settle timeout.

### A5 — `20-units-metric` PASSES on Android, and that is evidence

`.maestro/README.md` records that flow 20 fails on **iOS** because the Body hero
renders `184.1 lb` as ONE text node and `assertVisible:` text params are
full-match regexes. It passes on Android, so Android renders those as separate
nodes. That confirms the platform difference the README describes and settles
the flow-20 comment the README already flags as wrong ("Maestro matches
substrings" - it does not).

### A6 — two credentials are missing on this host

`scripts/qa-regression-verify.mjs cleanup` cannot run here: `Could not load the
default credentials`. Application Default Credentials are not configured
(`gcloud auth application-default login`, interactive). `ASC_ISSUER_ID` is
likewise absent from the repo-root `.env.local`, so `app-version-sync.mjs`
reports `ios unchecked`. Neither blocks a build; both block a cleanup or an
ASC query, and both should be part of the dedicated-box setup in §3.15.
