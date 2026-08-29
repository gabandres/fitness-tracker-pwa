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

## A FAILED build leaves a stale fingerprint that the NEXT build reuses

**Measured 2026-08-29, on vc 40.** This is the worst shape a build bug can take:
every check passes and the artifact is silently unshippable.

What happened, in order:

1. Merged the Block Store module. Tree fingerprint `5facf778…`.
2. `bundleRelease` → **FAILED** at `:block-store:compileReleaseKotlin`. It had
   already written `base/assets/fingerprint` before dying.
3. Fixed the Kotlin (one line).
4. `bundleRelease` → **BUILD SUCCESSFUL**, 14m 13s, 59.7 MB `.aab`.
5. `verify-mobile-artifact.mjs` → **all structural checks passed**, and printed
   the artifact fingerprint `5facf778…`.
6. Recomputed the tree: **`d7ea3629…`**. They do not match.

The fingerprint task was `UP-TO-DATE` from the failed run, so the successful
`.aab` advertises a runtime belonging to the **pre-fix tree — the one that does
not compile**. Nothing can ever OTA to that binary: `eas update` computes
`d7ea3629…` from source, the binary asks for `5facf778…`, and the publish
succeeds and reaches nobody. That is the exact failure the Step 1 gate exists to
prevent, arriving through a door the gate does not watch.

**Two things this also settles:**

- **A local module's Kotlin source IS a fingerprint input.** The one-line fix
  moved `5facf778…` → `d7ea3629…`. (`targets/` Swift famously does not — do not
  generalise from that to `modules/`.)
- **`expo prebuild` and `patch-android-release.mjs` do NOT move it.** Both ran
  between steps 1 and 2, and the value at step 2 was still `5facf778…`. This
  agrees with `dir:android` having been investigated and disproven.

**The rule: after ANY build that follows a failed one, compare the artifact's
fingerprint to the tree's before trusting the artifact.**

```sh
# what the artifact advertises
unzip -p apps/mobile/android/app/build/outputs/bundle/release/app-release.aab \
  base/assets/fingerprint
# what the tree hashes now — on the host that BUILDS this platform
cd apps/mobile && npx expo-updates fingerprint:generate --platform android
```

Differ → `./gradlew clean` and rebuild. There is no cheaper fix: the stale asset
is `UP-TO-DATE` by Gradle's own accounting, so an ordinary re-run will not
regenerate it.

**Why `verify-mobile-artifact.mjs` did not catch it:** it prints the artifact's
fingerprint but has nothing to compare it against, by design — it is a
single-artifact checker. Its own closing line is the right instinct applied to
the wrong axis: *"This proves nothing about BEHAVIOUR."* It also proves nothing
about **freshness**.

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

> ### ⚠️ `plugins/withGradleJvmArgs.js` IS FROZEN — do not edit it, not even a comment
>
> Its file **contents** are a hashed fingerprint source (reason
> `expoConfigPlugins`), so any byte changed there moves **both** platforms'
> runtime versions and shuts **both** OTA channels. Measured 2026-08-19: adding
> one key moved Android `ae526937…` → `f0f6cff9…`; adding **only a comment**
> moved it to `e84ab503…`. It has cost a channel twice — the Gradle memory fixes
> on 08-17, and the ABI cut on 08-19, which shut iOS against build 60 while that
> build was in App Store review.
>
> **Its docstring is knowingly out of date and is left that way on purpose.** It
> still says the ABI count "belongs to local iteration" and that "all ABIs must
> be restored for a release". That is wrong — the release set is two — but
> correcting the prose would strand every shipped binary, which costs far more
> than a stale comment. The current truth lives in `SKILL.md` and in
> `apps/mobile/scripts/patch-android-release.mjs`. **If a docs audit flags this
> file, the correct action is to leave it alone and cite this box.**
>
> Editing it is only ever correct as part of a change that ships a new binary on
> **both** platforms in the same sitting.

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

---

## A half-evicted Gradle transform cache fails the LAST native link

Measured 2026-08-17 on the vc 33 rebuild. After 16m19s — through every ABI, at
`:app:buildCMakeRelWithDebInfo[x86]` linking `libappmodules.so`, the final native
step — the build died with:

```
clang++: error: no such file or directory:
  .../transforms/<hash>/workspace/transformed/fbjni-0.7.0/prefab/modules/fbjni/libs/android.x86/libfbjni.so
  .../react-android-0.86.2-release/prefab/modules/jsi/libs/android.x86/libjsi.so
  .../react-android-0.86.2-release/prefab/modules/reactnative/libs/android.x86/libreactnative.so
ninja: build stopped: subcommand failed.
```

Those exact files were present for vc 32 — its log shows them being hard-linked
(and falling back to a copy, because the Gradle cache is on `C:` and
`node_modules` is on `Z:`, so the link is cross-volume). Between the two builds
Gradle pruned the extracted contents while **keeping the transform directory and
its lock file**, so it still considered the transform up to date and never
re-extracted.

It reads like a toolchain or NDK problem and is neither. The fix is to delete the
two offending transform directories by their hash — the paths are in the error —
so Gradle re-runs the transform:

```sh
cd apps/mobile/android && ./gradlew --stop
rm -rf "C:/Users/gabri/.gradle/caches/<gradle-ver>/transforms/<hash>"
```

**`./gradlew --stop` does not always release the lock.** Both `.lock` files came
back `Device or resource busy` until the two lingering `java` processes — the
Gradle daemon (6.0 GB) and the Kotlin daemon (3.1 GB) — were killed outright.
Stopping them also returned ~9.5 GB of RAM, which is worth knowing on its own:
those daemons persist between builds holding their full heap.

**Do not "fix" this by dropping x86** — as a *cache-corruption* remedy. That is
what this paragraph is about, and it still holds: clearing the transform cache is
the fix, and changing the shipped ABI set to dodge a locked file is not.

The release ABI set **was** cut to two on 2026-08-19, on its own merits, and that
decision stands — the reasoning is in `SKILL.md` → *The release ABI set is TWO*.
It is not a coverage reduction: Play serves per-device splits, no phone runs
`x86`, and this project has no emulator host. What changed since this paragraph
was written is that vc 32's "all four ABIs" is no longer the baseline.

## The exit code of `cmd > log; echo $?` is the ECHO, not the build

Bitten twice in one session, on both platforms. A launcher that ends with
`echo "EXIT=$?"` piped or followed by anything else reports the *last* command's
status, so a failed build is announced as success — the iOS build reported exit 0
on a build that died, and so did the first vc 33 attempt. Write the sentinel
**into the log** and read it from there:

```sh
node run-gradle.mjs > build.log 2>&1; echo "GRADLE_EXIT=$?" >> build.log
```

The log is the honest record; the harness's exit code is not.

## Three commands that FAILED and exited 0 — all on 2026-08-19

Every one of these reported success. The lesson is the same each time: **verify
the artifact or the API, never the exit code.** That rule was already here for
`eas submit`; these are three more ways to arrive at it.

### `gradlew.bat` is "not recognized" from the Bash tool

`NoDefaultCurrentDirectoryInExePath` is set in the environment Git Bash hands to
Node on this workstation, so `cmd.exe` refuses to resolve an executable from the
current directory. The documented one-liner therefore fails with:

```
'gradlew.bat' is not recognized as an internal or external command
```

and the wrapper still exits 0, because the failure is inside `cmd.exe` and the
outer pipeline succeeds. It also fails a *second*, unrelated way when the
backslashes in the path are eaten by a shell layer, producing the tell-tale
`Z:macro-appappsmobileandroidgradlew.bat`.

Working invocation — unset the variable and use an explicit `.\`:

**Do not put the path in the command string at all — pass it as `cwd`.** The
recipe printed here used to be `cd /d Z:\macro-app\… && .\gradlew.bat`, and the
backslashes in it had *already been eaten* by the editor that wrote them, so the
doc handed out the broken form and it failed again on 2026-08-19. Every layer
between an agent and `cmd.exe` — a Bash-tool heredoc, a JS string literal, a
shell — takes one bite out of a backslash, and `\m`/`\a` are not valid JS escapes
so they silently collapse to `m`/`a`. The tell-tale is
`Z:macro-appappsmobileandroid`, and the visible symptom is cmd.exe's
`The system cannot find the path specified.` — which reads like a missing
directory, not a quoting bug.

Node normalises `cwd`, so forward slashes are safe there and `cmd.exe` never
sees the path:

```js
const env = { ...process.env };
delete env.NoDefaultCurrentDirectoryInExePath;
spawnSync('cmd.exe', ['/d', '/c', '.\\gradlew.bat bundleRelease'],
          { cwd: 'Z:/macro-app/apps/mobile/android', stdio: 'inherit', env });
```

**Write that runner with a file-writing tool, never a heredoc.** Confirm it
survived the trip before spending the wall-clock: `grep gradlew <runner>` must
show a single backslash in `.\\gradlew.bat`'s source, and the failure costs 0
minutes, so it is cheap to discover — the expensive version is believing the
build started.

**Always `ls` the `.aab` afterwards.** A 16-minute build and a 3-second failure
look identical in a task notification.

### `expo prebuild --clean` fails `EBUSY` because the *shell* is standing in it

```
✖ Failed to delete android code: EBUSY: resource busy or locked, rmdir 'Z:\macro-app\apps\mobile\android'
```

Nothing is holding the directory — no daemon, no editor. The Bash tool's working
directory **persists between calls**, and `./gradlew --stop` is documented one
line above as `cd apps/mobile/android && ./gradlew --stop`. That leaves the
session parked inside the directory prebuild is about to delete, and Windows
will not remove a directory that is any process's cwd.

`cd` somewhere else first. If it is already wedged, PowerShell clears it:

```sh
# from a session whose cwd is NOT inside android/
Remove-Item -Recurse -Force Z:\macro-app\apps\mobile\android
```

This one does *not* exit 0 — it fails honestly — but it reads as a locked file
and sends you hunting for a daemon that is not there.

### `firebase deploy --only functions` dies on a 10s discovery timeout

```
Error: User code failed to load. Cannot determine backend specification. Timeout after 10000.
```

Also exits 0. It is **not** necessarily your code: module load was measured at
**417 ms** (`node -e "require('./functions/lib/index.js')"`) in the same session
the deploy failed. Environmental — the CLI spawns a local analysis server and
probes it. Retry with the documented escape hatch:

```sh
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:<name>
```

Confirm with `grep "Deploy complete"` on the log; the exit code proves nothing.
Time the module load first — if it is fast, stop reading your own diff.

### `guard_firebase_deploy.py` blocked a perfectly good hosting deploy

Fixed 2026-08-19, recorded because the *shape* will recur. The guard resolved
`dist/` relative to the process cwd, and a PreToolUse hook inherits the Bash
session's cwd — which is `apps/mobile` for most of a release, since the Metro
gate and both `eas update` publishes start with `cd apps/mobile` and it
persists. So a correct deploy from the repo root was refused with "this dist was
not produced by a prod build" while `ngsw.json` sat on disk at 16 KB.

It is anchored to `CLAUDE_PROJECT_DIR` now. If any guard ever fires on a command
you are sure is right, **check the session's working directory before believing
it** — and remember `python .claude/hooks/test_guards.py` passes either way,
because the matrix uses the `GUARD_DIST_ROOT` seam and never exercises the
default.

## What `expo prebuild --clean` costs, measured 2026-08-19

| Run | Wall clock |
|---|---|
| Full release build (`prebuild --clean` → `bundleRelease`), 2 ABIs | **10m 29s** |
| `bundleRelease` again on the same tree, no prebuild | **1m 41s** |
| **What `--clean` throws away** | **~8m 48s — 84% of the build** |

`--clean` deletes `android/` outright, so every native compile, Kotlin/Java
compile, dex and package step runs from zero. Gradle can reuse all of it.

**Two hazards that would make skipping it unsafe do NOT exist** — both checked
rather than assumed:

- `patch-android-release.mjs` is **idempotent**. Every mutation is guarded
  (`if (!props.includes('IGNIA_STORE_FILE'))`, `if (!gradle.includes(...))`,
  `if (manifest.includes(HEADERS_KEY))`) and logs *already present* on a second
  run. It does not double-append signing config.
- The versionCode rewrite is `/versionCode\s+\d+/`, **not** a match on the
  template's `1`. It re-stamps an already-patched `build.gradle` correctly.

**So keep `--clean` for a release whose native config moved, and skip it when
nothing native changed:** a retry after a failed build, a versionCode-only
rebuild or resubmit, or local iteration on a native change. That is where the
~9 minutes is pure waste.

The reason not to drop it wholesale is narrower than "safety": `android/` is
generated from `app.json` + the plugins array and is gitignored, so a stale
artifact from a *removed* plugin is invisible to `git status` and to every test.
`--clean` is what guarantees the tree matches the config. And note the release
path is normally only taken when the fingerprint moved — which means native
config changed — which is exactly when `--clean` earns its cost.

Caveat on the number: 1m 41s is a no-op incremental. A JS-only change adds the
bundle task, so expect a few minutes — still far below a full rebuild.
