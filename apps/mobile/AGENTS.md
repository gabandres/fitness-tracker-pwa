# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code (installed SDK is `expo@^57`; keep this URL in sync with `apps/mobile/package.json`).

# Entry point is NOT `expo-router/entry`

`package.json` `main` is a custom **`index.js`** at the app root. It imports
`expo-router/entry` for its side effect (routing behaves identically) and then
registers the Android home-screen widget's task handler — which must run at
module scope, before React mounts, because Android can wake the widget when the
UI was never started. Don't "fix" `main` back to `expo-router/entry`; it
silently kills the widget on Android. See `WIDGET.md`.

# `src/app/` holds ROUTES AND NOTHING ELSE — not even tests

Expo Router builds its route tree from a Metro `require.context` over
`src/app`, and [its regex excludes only `+api` and `+html`](https://docs.expo.dev/router/reference/testing/).
Every other file there is treated as a route **and bundled into the app**. A
colocated `*.test.tsx` therefore drags `@testing-library/react-native` into the
production bundle, which requires Node's `console`, which Metro cannot resolve:

```
Unable to resolve module console from @testing-library/react-native/dist/helpers/logger.js
```

Mobile tests live in **`src/__tests__/`** (or beside a non-route module, like
`src/components/SignInMethodsCard.test.tsx`) and import the screen through the
alias — `@/app/(app)/train`, never `./train`.

**`tsc --noEmit` and `jest` both pass while this is broken.** They do not run
Metro. On 2026-08-06 it took two EAS builds to the *Bundle JavaScript* phase
before anything noticed — a latent break from 2026-08-05, since no EAS build
had run in between. The cheap local gate is a real bundle, and it costs
nothing:

```sh
cd apps/mobile && npx expo export --platform android --output-dir <tmp>
```

**Run that before queueing any EAS build.** (Errored builds did not consume
plan quota in that incident — measured 7/15 before and after — but they cost
the queue wait, which on the Android free tier has run to two hours.)

# An OTA update that misses everyone looks EXACTLY like one that worked

This app uses **EAS Update**. A JS-only change ships with `eas update` and needs
no build — but delivery is gated on `runtimeVersion`, which is the
**`fingerprint` policy** (`app.json`), derived from the native dependency graph.

**If the fingerprint changed, `eas update` still succeeds.** It publishes under a
*new* runtime version that no installed binary matches, so every tester silently
stays on old code. Nothing errors. There is no warning. The only signal is that
the bug you "fixed" keeps getting reported.

## The fingerprint is a property of the MACHINE, not just the commit

**Run the gate — and `eas update` itself — on the machine that BUILDS that
platform. Since 2026-08-17 that is not one machine:**

| Platform | Built on | Gate + `eas update` from |
|---|---|---|
| **Android** | the Windows workstation (vc 31+) | **Windows** |
| **iOS** | `ignia-mac` | **`ignia-mac`** |

**Bare `eas update` publishes BOTH platforms and is therefore correct on
NEITHER machine — always pass `--platform`.** `.claude/hooks/guard_eas_update.py`
enforces the whole table; it blocks the bare form everywhere and blocks each
platform from the wrong host.

The rule below is why, and it still holds — only the "which machine" answer
changed. The same commit fingerprints differently on the two machines:

| Machine | commit `c3a7333a`, android | ios |
|---|---|---|
| **`ignia-mac`** | `5758fe4f…` | `6c756c19…` |
| Windows workstation | `c0b85c15…` | `781be0c8…` |

Three commit-independent causes, found by diffing the two `sources` arrays
(516 entries on Windows, 286 on the Mac):

- ~~a stale **`apps/mobile/android/`** prebuild dir exists on Windows only — it is
  gitignored, so nothing syncs or removes it, and `dir:android` is hashed;~~
  **DISPROVEN 2026-08-17 — `dir:android` is listed as a source but contributes
  NOTHING to the hash.** Measured on the Windows workstation by generating with
  the directory present and again with it moved aside: `3d3bc410…` both times,
  521 sources vs 520. Almost certainly because `android/` is wholly gitignored
  and the fingerprinter honours that. Two builds from *different* `android/`
  contents (a stale vc-10 prebuild and a fresh vc-31 one, differing in
  versionCode, AndroidManifest.xml and gradle.properties) also embedded the
  identical fingerprint. So this is not a cause of Windows/Mac divergence, and
  deleting `android/` before a gate run is a no-op. **The general rule, measured
  2026-08-17: a `dir:` source hashes only git-TRACKED content.** Confirmed a
  second way on `dir:modules/quick-add-tile/android`, which unlike `android/` is
  a tracked directory: its 299-file untracked Gradle `build/` output was moved
  aside and the hash stayed `3d3bc410…` at 521 sources. So Gradle output sitting
  inside a hashed directory cannot strand an OTA, and neither can any other
  untracked file — "is it gitignored" was the narrower version of this;
- **CRLF vs LF** in tracked files — measured 2026-08-17 and it is **exactly two
  files**, `.gitignore` and `targets/widget/expo-target.config.js`, which are
  CRLF in the Windows worktree and LF on the Mac. `.gitattributes` already says
  `* text=auto eol=lf`, and the index is LF throughout; these two simply predate
  that file and git does not re-checkout on an attribute change. **Fixing them is
  a worktree-only act — no commit — but it MOVES the Windows fingerprint**, so do
  it in the same change as an SDK bump or another native change that moves it
  anyway, never on its own;
- ~~divergent `node_modules`, which changes which config-plugin files are walked.~~
  **DISPROVEN 2026-08-17.** The two trees are not divergent. The Windows iOS
  `sources` array carries **228 entries the Mac's does not** — every one of them a
  transitive dependency of a config plugin under a *nested* `node_modules`
  (`@bacons/apple-targets/node_modules/@expo/plist/…`, `@bacons/xcode/node_modules/xmlbuilder/…`).
  **All 228 files were then confirmed present on the Mac** (`present=228
  missing=0`), with identical `@expo/fingerprint` 0.15.5, identical
  `@bacons/apple-targets` 5.0.0 and a byte-identical `package-lock.json` that
  itself prescribes those nested paths. The Mac's array contains **zero** sources
  Windows lacks. So this is not an install difference: `@expo/fingerprint` walks
  the config-plugin require graph *across* nested package boundaries on Windows
  and stops at them on macOS. Aligning Node/npm cannot converge the two hashes,
  and `npm ci` is not a fix for a mismatch.

**Consequence: cross-host fingerprint parity is not achievable and is no longer a
goal.** It also does not need to be. Since 2026-08-17 each platform is built,
gated and published on one host — Android on Windows, iOS on the Mac — so each
hash only ever has to match binaries produced by the same machine, which it does:
measured that day, Windows/Android returns `3d3bc410…` (= live vc 31, read from
the `.aab`) and Mac/iOS returns `886bf0b3…` (= build 55, read from the `.ipa`).
**A hash is valid only against artifacts from the machine that produced it**;
comparing across hosts is meaningless, not merely inconvenient.

The corollary is a live hazard: because the 228-entry gap is `@expo/fingerprint`
behaviour rather than repo state, **an upgrade of that package can move the
Windows hash with no change to this repo at all** — silently stranding every
Android OTA. Re-read the gate against the shipped `.aab` after any bump of
`expo-updates`/`@expo/fingerprint`, not just after a code change.

**Ground truth is inside the artifact — read it, don't compute it:**

```sh
unzip -p build-<ts>.aab base/assets/fingerprint          # Android
unzip -o -q build-<ts>.ipa -d /tmp/ipax && \
  cat /tmp/ipax/Payload/*.app/EXUpdates.bundle/fingerprint   # iOS
```

`Expo.plist` only says `EXUpdatesRuntimeVersion = file:fingerprint`; the value
is in that file. Verified 2026-08-07: vc 13's `.aab` holds `5758fe4f…` and
build 25's `.ipa` holds `6c756c19…` — the Mac's numbers, not this machine's.

**This already cost three updates.** Every OTA published on 2026-08-07 before
22:00 went out under `c0b85c15…`/`781be0c8…` (confirmed with
`eas update:list`), which is the *Windows* fingerprint and matches neither
verified binary. The "fleet split across two runtime versions" written up that
day was largely this artifact: one machine's number was being compared against
another machine's. The 22:00 update is the first one published from the Mac and
the first that provably matches a shipped binary.

So the gate before every publish runs **on that platform's build host** — iOS on
the Mac, Android on Windows:

```sh
# iOS — on ignia-mac
ssh ignia-mac "cd ~/fitness-tracker-pwa && git checkout main && git pull --ff-only"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform ios"

# Android — on the Windows workstation
cd apps/mobile && npx expo-updates fingerprint:generate --platform android
```

Compare the `hash` against the fingerprint read out of the binary testers are
running. **Same → the update lands. Different → it reaches nobody and you need a
build.** Note `node_modules` is an input: an `npm install` on the build host can
move the fingerprint away from an already-shipped binary, so check the gate
*before* installing, not after.

~~**Generate it AFTER `expo prebuild`, or it does not match the artifact.**~~
**WITHDRAWN the same day — this rule was a misreading.** It was inferred from one
observation: with a stale `android/` on disk the CLI returned `5621a4fa…`, and
after a prebuild it returned `d8741525…`, matching the AAB. Prebuild was the
visible act in between, so it got the blame.

The vc 33 build then measured the gate **before and after `expo prebuild` and got
`c1c010ac…` both times.** Prebuild does not move the hash. What moved it in the
original observation was `apps/mobile/.gitignore` flipping between CRLF and LF —
see the line-endings section at the end of this file, which reproduces both values
on demand by touching nothing else.

Keep the underlying habit for a better reason: **read the fingerprint out of the
artifact, never compute it.** A computed hash can disagree with a shipped binary
for reasons that leave `git status` clean, and the artifact is the only value
that cannot.

Fingerprints of the binaries carrying `expo-updates` (update these when new ones
ship):

| Platform | Binary | Fingerprint | Source | Note |
|---|---|---|---|---|
| Android | **OTA #3 on vc 37** (2026-08-21) | `ae526937893adb7f7349321b05caf2732da9658b` | `eas update` output | update group `1a1168fa-116e-4d5b-8681-9c1d72ea8fed`, android update `01a0240e-7d5d-7e50-9ada-8e841113c8a9`, from `c10d5422`. The Train session reducer (seven `useTrain` callbacks → one `dispatch` over a pure `applySessionAction` in core), the `TdeeResult` discriminated union, and `useCoreSnapshot` behind five hooks. **Gate run BEFORE publishing and it matched vc 37's `.aab` exactly.** **VERIFIED ON DEVICE, and this is the first OTA whose verification ran against the published code rather than ahead of it** — the LG G6 pulled `01a0240e` (`isUpdateAvailable=false` after a server check proves it launched), then `16-train-terms` and `18-train-template` both passed, exit 0, zero failures. 16 is the flow that matters here: it drives add-exercise, the RIR picker (a deferred `patchSet` asserted back on screen), set-kind and discard — the whole `dispatch` path. 18 covers the template editor, which this change did NOT touch. `WHATS_NEW_VERSION` NOT bumped: nothing here is user-facing |
| iOS | **OTA #3 on build 60** (2026-08-21) | `7b347b0f24ace4cdc1fb24c7f972f67768641161` | `eas update` output | update group `e04af5fd-0203-41fe-a17f-c576dc76dd29`, iOS update `01a0241b-1e59-7d3d-9ff0-5a93b96d66ba`, from `c10d5422`, published from `ignia-mac`. Same change as the Android row, published only AFTER the G6 run passed. Gate run on the Mac first and it matched build 60's `.ipa` value exactly — every commit is `.ts`/`.tsx`, so neither runtime moved. The Mac's tree showed dirty (`*` on the commit) from untracked `.ipa` and prebuild `Info.plist` files; `git status --untracked-files=no` was empty, so the published JS is `c10d5422`. **Public iOS (build 55, `886bf0b3…`) is a different runtime and does NOT receive this** |
| Android | **OTA #2 on vc 37** (2026-08-20) | `ae526937893adb7f7349321b05caf2732da9658b` | `eas update` output | update group `fa69a969-4354-4cdc-9aab-ab77f3667e45`, android update `01a020f9-6629-71cf-ae3e-d9af64d343b0`, from `bda83ea0`. The estimator follow-ups: precision gate on the recalibration card, window widening (63 then 84 logged days) instead of acting on an interval wider than 250 kcal, and the `holding` line on Today. **Second OTA of the same day, deliberately** — the soak was cut short because a 12-tester alpha has almost no statistical power to find a 1-in-N crash, and all three changes are stability-positive. **Verified on device**: both ids in the G6's `dev.expo.updates` log, Today renders. `WHATS_NEW_VERSION` NOT re-bumped — yesterday's banner already tells this story and re-firing it would nag anyone who just dismissed it |
| iOS | **OTA #2 on build 60** (2026-08-20) | `7b347b0f24ace4cdc1fb24c7f972f67768641161` | `eas update` output | update group `ffcf0a40-29dc-4f48-a11d-0fd7de7ea145`, iOS update `01a020fb-1325-7dd6-941c-c7870f6f5967`, from `bda83ea0`, published from `ignia-mac`. Same change as the Android row. Gate run on the Mac first and it still matched build 60 — all three commits are `.ts`/`.tsx`, so neither runtime moved |
| Android | **OTA on vc 37** (2026-08-20) | `ae526937893adb7f7349321b05caf2732da9658b` | `eas update` output | update group `e331a9d5-55b9-4d02-b9f9-127b35f74cb5`, android update `01a02056-ee73-76ed-8b5f-e2be541ab6bd`, branch `production`, from `e838dd3e`. **The maintenance fix** (`145221e2`): measured TDEE is now computed per contiguous-logging run and pooled by `1/SE²`, so a gap in the log no longer lets the days just after it set the whole number. Gate run before publishing and it matched vc 37's `.aab` value exactly. **Verified ON DEVICE, not just published** — both the group and the update id appear in the LG G6's own `dev.expo.updates` log, so it downloaded and launched rather than merely existing on the server. Same runtime as vc 37, so it reaches the alpha fleet on next launch |
| iOS | **OTA on build 60** (2026-08-20) | `7b347b0f24ace4cdc1fb24c7f972f67768641161` | `eas update` output | update group `022aa8c9-82c1-481c-9cac-6e0e563541f5`, iOS update `01a0205c-b21c-7151-b15f-891c3347e59b`, branch `production`, from `e838dd3e`, published from `ignia-mac`. Same change as the Android OTA above. Gate run **on the Mac** before publishing and it matched build 60's `.ipa` value exactly. The Mac's tree showed dirty (`*` after the commit) — untracked `.ipa` artifacts and prebuild-generated `Info.plist` files only, no tracked modifications, so the published JS is `e838dd3e`. **Public iOS (build 55, `886bf0b3…`) is a different runtime and does NOT receive this**; it arrives there when 1.2.1 releases |
| Android | **vc 37** (2026-08-19) | `ae526937893adb7f7349321b05caf2732da9658b` | **read from the `.aab`** | `main` (`4ec7d2d7`), alpha, 1.2.1 — **exists only to undo a fingerprint cost, and it reopens BOTH channels.** The ABI cut (`1ddb51fa`) wrote `reactNativeArchitectures` into `plugins/withGradleJvmArgs.js`, whose file *contents* are hashed (`expoConfigPlugins`), so an Android-only tweak also moved **iOS** off build 60's `7b347b0f…` — and build 60 is the binary in App Store review. Restoring the plugin byte-for-byte returns iOS to `7b347b0f…` (measured on `ignia-mac`) and Android to `ae526937…`, hence this binary. The ABI cut is preserved, rehomed to step 1b of `patch-android-release.mjs` → the **gitignored** `android/gradle.properties`, which is not a fingerprint source; the `.aab` carries exactly `base/lib/arm64-v8a` + `base/lib/armeabi-v7a` at 66 MB, so the rehome is proven from the artifact, not inferred. `BUILD SUCCESSFUL in 8m 56s`; verifier green on all five checks. **`eas submit` FAILED and exited 0** — `Google Api Error: This Edit has been deleted` after `Fastlane supply failed`, Play's edit expiring mid-upload of the 66 MB bundle; the androidpublisher API still read vc 36, which is how it was caught, and the retry landed. A fourth distinct way that command lies. **Behaviourally identical to vc 36** — nothing to re-QA that vc 36 did not already need. **vc 36 is now an orphan runtime** |
| Android | **vc 35** (2026-08-19) | `ae526937893adb7f7349321b05caf2732da9658b` | **read from the `.aab`** | `main` (`d1cc34ec`), alpha, 1.2.1 — **reopens the Android OTA channel**, shut since the 1.2.1 marketing bump (`f33f9a60`) moved the tree off vc 34's `b6f97259…`. Carries the template-editor scroll fix, the hero-ring rework, `FEATURES.tips=false` embedded, and the "Add exercise…" spacing fix. `BUILD SUCCESSFUL in 16m 4s` on the Windows workstation; verifier green (signer `CN=Macro Log Dev`, `expo-channel-name` production, both quick-add services). Live on the alpha track — confirmed from the **androidpublisher API**, while `eas submit` sat on `- Submitting` throughout and told you nothing. **Behaviour UNVERIFIED**; `18-train-template` is the flow to re-run first, since vc 35 is what fixes the bug it dies on. Three launch attempts failed first and ALL exited 0 — see `build-android/REFERENCE.md`, *Three commands that FAILED and exited 0* |
| Android | **OTA on vc 35** (2026-08-19) | `ae526937893adb7f7349321b05caf2732da9658b` | `eas update` output | update group `b6f1f303-e4ca-4fb0-bd42-5446aa9a1032`, branch `production`, from `6b052378`. Food-search latency: servings now ship with each search hit so tapping a result makes no `getFoodDetail` call (that callable is separately cold and fired exactly once per log, so it never warmed — 2.83–3.79 s, every time). Same runtime as vc 35, so it reaches the alpha fleet on the launch after they install it. **The server half needed no client at all** and is live for everyone on every platform |
| iOS | **OTA on build 60** (2026-08-19) | `7b347b0f24ace4cdc1fb24c7f972f67768641161` | `eas update` output | update group `baa41698-0d79-4b6c-a835-fb5027d8a733`, branch `production`, from `8b69c606`, published from `ignia-mac`. Same change as the Android OTA above; same runtime as build 60, so no binary was needed. Gate run on the Mac before publishing and it matched build 60's `.ipa` value exactly |
| Android | **vc 34** (2026-08-18) | `b6f97259a3c21c116602159fb0848d2b846b03da` | **read from the `.aab`** | current `main` (`2b06a375`), alpha, 1.2.0 — **the binary that reopens the Android OTA channel**, shut since 08-17 when `plugins/withGradleJvmArgs.js` moved the hash. Carries the whole Train template rebuild. Verifier green: signer `CN=Macro Log Dev`, `expo-channel-name` production, both quick-add services through the manifest merge. `BUILD SUCCESSFUL in 22m 21s` on the **Windows** workstation. Two things cost time and are worth knowing: `expo prebuild --clean` deletes `android/local.properties`, and this box's exported `ANDROID_HOME` points at a directory that **does not exist** — the real SDK is `Z:\packagesndroid-sdk`, a short path chosen to clear MAX_PATH — so Gradle fails with "SDK location not found", which reads like a missing install. The first Play submit also died on a transient `Some of the Android App Bundle uploads are not completed yet`; alpha was still vc 33, so the retry was safe and worked. **Behaviour PARTLY VERIFIED 2026-08-19** on an LG VS988 (LG G6, Android 9 / API 28) over adb — the Maestro suite now has an Android host. Suite **14 of 17**; open: `06-scan-intro`, `15-search`, `18-train-template`. The hero rings render and animate correctly here, which is what proved the iOS ring bug was not cross-platform. **Google Sign-In on this Play-signed install FAILS** with `ApiException: INTERNAL_ERROR` (8) — not `DEVELOPER_ERROR`; the vc 34 signing cert (`1483ddc3…`, the *previous* Play key), its OAuth Android client, the `webClientId`, clock and network all check out, and the failure is inside Google's own picker. Captures were NOT collected, so `coverage.md` rows are deliberately not flipped |
| Android | **OTA on vc 34** (2026-08-19) | `b6f97259a3c21c116602159fb0848d2b846b03da` | `eas update` output | update group `c8b3b423-a49b-4094-9dda-716a3cb2587f`, branch `production`, from `735d9b3d`. **Pauses the tip jar** (`FEATURES.tips=false`) while operations transfer to Bermudez Systems LLC — see `STATUS.md` §3. Same runtime as vc 34, so it reaches the whole alpha fleet on next launch. The matching **iOS publish LANDED** the same day — update group `c8b3b423-a49b-4094-9dda-716a3cb2587f`, runtime **`886bf0b3…`**, i.e. the runtime the live App Store **build 55** ships, so public iOS users are gated off. This cell said the iOS publish was PENDING until 2026-08-19; `eas update:list --branch production` disproved it. **Still open:** that OTA went ONLY to `886bf0b3`. TestFlight **build 58** runs `b3c50e91…` and never received it, so 58 testers still see a tip button for consumables that are `DEVELOPER_REMOVED_FROM_SALE`. The 1.2.1 binary embeds `FEATURES.tips=false`, which closes it |
| iOS | **OTA on build 58** (2026-08-18) | `b3c50e914fd4e477e36c486bf3ff189a157da586` | `eas update` output | update group `66e6f663-61d1-4b62-a6d4-b9942d2bf420`, branch `production`, from `1fc9bbb1`. Same runtime as build 58, which is the point — **adding `react-native-sortables` did NOT move the fingerprint**, because it is pure JS and autolinks no native module, so the drag-to-reorder work shipped without a binary. Build 58 was added to **Public Beta Testers** the same day (57 was the group's newest before that), so the update reaches them on the launch after they install 58. Verified before publishing: `Sortable.Flex` mounts and the template editor renders inside it, on the simulator, driven by Maestro |
| Android | **vc 33** (2026-08-17) | `c1c010ac57c8a0bf7fc416f4bf59c7aca045255f` | **read from the `.aab`** | current `main`, alpha, 1.2.0 — **replaces vc 32**, which was orphaned by CRLF normalization (see the line-endings section). Carries the preset/custom-food write fix. Verifier green; `BUILD SUCCESSFUL in 25m48s`. Built from a fully LF-normalized tree, so this hash is reproducible from the commit — unlike vc 32. **Superseded as an OTA target the moment `plugins/withGradleJvmArgs.js` changed** (Gradle memory fixes, same day): the plugin list is hashed, so the tree now reads `641cf5d4…` and no Android OTA reaches vc 33 until the next build. **Behaviour UNVERIFIED** — still no device QA on any SDK 57 Android binary |
| iOS | **build 60** (2026-08-19) | `7b347b0f24ace4cdc1fb24c7f972f67768641161` | **read from the `.ipa`** | `main` (`f0130b01`), **1.2.1** — the first binary off the 1.2.0 version string. Built LOCALLY on `ignia-mac` (`eas build --local`), zero EAS quota, verifier green (all four targets, both `.lproj`, Live Activities, appex entitlements). **Why 1.2.1 exists at all:** builds 55/57/58 ALL carry `1.2.0`, and an App Store version only accepts builds whose version string matches it, so no TestFlight build could ever be promoted — shipping SDK 57 required a fresh marketing version, not a promotion. Carries the iOS hero-ring fix (`react-native-svg` does not receive Reanimated animated-prop updates under Fabric), `FEATURES.tips=false` embedded (build 58's runtime never got that OTA), and the template-editor spacing fix. **Behaviour UNVERIFIED** until the rings are confirmed on a real device |
| iOS | **build 58** (2026-08-18) | `b3c50e914fd4e477e36c486bf3ff189a157da586` | **read from the `.ipa`** | current `main` (`f432b301`), 1.2.0 — **the binary that reopens the iOS OTA channel.** Build 57's runtime had been unreachable since the `withGradleJvmArgs.js` change (see its row); this one is built FROM that tree, so its fingerprint equals the gate's and a JS fix can reach it over the air. Carries the two shipped layout fixes found by the Maestro sweep — the body-fat percentage rendering outside its card, and Today's list having no bottom padding under the tab bar — plus the RIR VoiceOver label. Built locally on `ignia-mac` in ~24 min; slower than the usual 13–16 because `DerivedData` was empty and the desktop session was contending for CPU (load average 72, DisplayLink compositing at 84%). Verifier green on all four targets. **On TestFlight, `VALID`** (uploaded 2026-08-18T11:37:45-07:00) — the iOS OTA channel is reopened. It took two attempts, and **the first one is the lesson**: `eas submit … --non-interactive` launched at 12:28 **hung at `- Submitting`** and was still alive 1h35m later at `0:10.90` CPU, state `S`, with 58 absent from `/v1/builds` entirely — against a documented ~3 min submit. The stall is silent twice over: the invocation piped through `tail`, so nothing printed, and killing the pipeline made it **exit 0**, which a background-task watcher duly reported as success. A re-run from the same `.ipa` uploaded fine. **Poll ASC for the build; never read the submit CLI's exit code** — `REFERENCE.md` already says it has lied in both directions, and this is a third way. Run it detached (`nohup … &`) so a closing SSH session cannot signal it. Note the CLI kept printing `- Submitting` for ~30 min *after* Apple had already marked the build `VALID`; the poller, not the upload, is what hangs. Separately, 1.2.0 still holds build 55 in `WAITING_FOR_REVIEW` and is deliberately untouched — a build sitting on TestFlight cannot change what Apple is reviewing, so submitting 58 was safe, but swapping 1.2.0's build is not. **Behaviour UNVERIFIED** — still no device QA on any SDK 57 binary, and that is now the only thing between this and a release |
| iOS | **build 57** (2026-08-17) | `25e953e95c7925010c0fad214d433b8c0c70a65f` | **read from the `.ipa`** | current `main`, 1.2.0 — **the first Expo SDK 57 iOS binary** (RN 0.86.2, React 19.2). Built locally on `ignia-mac`, verifier green on all four targets. **`IN_BETA_TESTING` externally**: added to *Public Beta Testers* and beta review came back `APPROVED` immediately, since beta approval carries within an already-reviewed version. **Its runtime is its own** — the SDK bump moved it off builds 50–55's `886bf0b3…`, so no OTA crosses in either direction. **And no OTA reaches build 57 either, as of 2026-08-17** — measured 2026-08-18, gate `b3c50e91…` against `25e953e9…` read out of the `.ipa`. The cause is the same `plugins/withGradleJvmArgs.js` change already noted on the vc 33 row: it is an **Android-only** plugin, the plugins array is hashed as part of `app.json`, and it moved BOTH hashes. That consequence was recorded for Android and not for iOS, so the iOS channel read as open when it had been shut for a day. **Both platforms now need a binary before any JS fix reaches a tester.** **Build 56 does not exist**: the first attempt was killed by a closing SSH session (`BUILD INTERRUPTED`) and `autoIncrement` burns a number per attempt. Does **not** disturb the 1.2.0 submission, which still holds build 55 and `WAITING_FOR_REVIEW`. **Behaviour UNVERIFIED** — no device QA on any SDK 57 binary |
| Android | **vc 32** (2026-08-17) | `d8741525dbf428d6e994ec120108e333e385eab9` | **read from the `.aab`** | branch `chore/expo-sdk-57`, alpha, 1.2.0 — **the first Expo SDK 57 binary** (RN 0.86.2, React 19.2). Built and signed on the Windows workstation, verifier green (signer `CN=Macro Log Dev`, `expo-channel-name` production, both quick-add services present). `BUILD SUCCESSFUL in 19m18s`. **Its runtime is its own** — an SDK bump moves the hash, so no OTA reaches vc 30/31 from here or vice versa, and the Android fleet now spans three runtimes. **NOT built from `main`**: the SDK 57 branch is deliberately unmerged while iOS 1.2.0 is in review. **Behaviour UNVERIFIED** — no device QA, and the check that matters most is **Google Sign-In on a Play install**, broken twice historically and structurally invisible on a local build |
| iOS | **build 55** (2026-08-15) | `886bf0b3d384b8a43477730cdd0124572b954711` | **read from the `.ipa`** | current `main`, TestFlight `VALID`, 1.2.0 — **the App Store candidate: attached to 1.2.0, `WAITING_FOR_REVIEW`, manual release.** It exists because **build 54 was the wrong binary and the artifact proved it**: 54 was cut from `ea96f48` and the verification-email fix landed in `86183368` after, so 54's `main.jsbundle` held **zero** `sendVerificationEmail` against one `sendPasswordReset`. 55 holds `sendVerificationEmail` 1 / `sendOwnedVerificationEmail` 1. **Grep the bundle, not the commit log** — a build is only as current as the JS baked into it, and `git log` on the Mac cannot tell you what a finished `.ipa` contains. Same fingerprint as 50–54 (JS-only), so no OTA is stranded either way |
| iOS | build 54 (2026-08-15) | `886bf0b3d384b8a43477730cdd0124572b954711` | **read from the `.ipa`** | **superseded and NOT shipped** — swapped out of the 1.2.0 submission the same day for predating the verification-email fix (see build 55). Structurally green; it was the *content* that was wrong, which no verifier checks | current `main` (`ea96f48`), TestFlight `VALID`, 1.2.0 — **the App Store candidate: `WAITING_FOR_REVIEW`, manual release.** Contains no code change over build 53; it exists because 53's *embedded* JS predates the TDEE discontinuity fix (`866369ba`, merged 8 h after 53 was uploaded), so 53 carries that fix only over the air and a fresh App Store install would run the 1,700-kcal bug for one session. **Fingerprint identical to 50–53** — JS-only, so the 08-14 OTA already reaches it and no OTA is stranded by it. Internal group only; 53 remains the external TestFlight build |
| iOS | **build 53** (2026-08-14) | `886bf0b3d384b8a43477730cdd0124572b954711` | **read from the `.ipa`** | current `main`, TestFlight, 1.2.0, **`IN_BETA_TESTING` externally — the build every tester should be on.** **`transferCurrentComplicationUserInfo` does NOT wake a WidgetKit complication** — it wakes a ClockKit one, and this complication has never been ClockKit. Apple FB12926788, open since 2023-08. That ends the real-time-to-the-wrist goal; the replacement is a PULL, `WKApplicationDelegate` + `scheduleBackgroundRefresh` (~hourly for an app in the dock), reading `receivedApplicationContext`, which holds the phone's latest value whether or not any wake happened. Staleness bounded at ~1h instead of "until you open the watch app". The SwiftUI `.backgroundTask(.watchConnectivity)` modifier was removed with it — `handle(_:)` owns every background task now, and two owners means `setTaskCompletedWithSnapshot` twice, a crash on a background wake. Also drops `@MainActor` from `LogQuickAddSlotIntent.perform()`, which was queueing the widget's redraw behind React Native's startup, and records `perform()` duration + warm/cold to the App Group. **Behaviour UNVERIFIED** |
| iOS | build 52 (2026-08-14) | `886bf0b3d384b8a43477730cdd0124572b954711` | **read from the `.ipa`** | superseded by 53, TestFlight, 1.2.0 — **the widget quick-add stops waiting on the network.** `applyOptimistically` ran *after* both round trips despite its name, and since build 50 also behind `assertToWatch`'s 3s activation wait. The write path is now `stage` (synchronous: bump the snapshot, request the reload, park the row) → `commit` (network, unpark, watch push last). The widget intent uses `logDeferred` and returns in milliseconds, which matters because a `reloadTimelines` requested from inside `perform()` is deferred (FB11522170) while the reload the system performs **on return** is the reliable one. The park moved *before* the attempt — a write-ahead log — so returning early cannot lose a row: `flushPendingLogs` replays it under the same id, an idempotent overwrite. Carries builds 50 and 51 in full. **Same fingerprint as 50/51** — `targets/`-only Swift |
| iOS | **build 51** (2026-08-14) | `886bf0b3d384b8a43477730cdd0124572b954711` | **read from the `.ipa`** | TestFlight `VALID`, 1.2.0 — **the watch stopped spending its reload budget on bytes it already had.** `store()` wrote and called `reloadAllTimelines()` unconditionally: `start()` on every launch, and `ingest()` **twice per background wake**. That is metered at 40–75/day, and once spent WidgetKit throttles and the face stops moving — indistinguishable from a delivery that never arrived. Deduped now, matching what the phone has done since 2026-08-10. Adds watch-side instrumentation: which callback stored (`userInfo` can only come from `transferCurrentComplicationUserInfo`, so it proves the wake) and when the complication last built a timeline, both on the mirror screen. **Fingerprint IDENTICAL to build 50** — the change is Swift under `targets/` only, which is the documented rule holding again |
| iOS | build 50 (2026-08-14) | `886bf0b3d384b8a43477730cdd0124572b954711` | **read from the `.ipa`** | superseded by 51/52, TestFlight `VALID`, 1.2.0, **internal group only** — **the watch real-time push (ADR-0023)**. A meal logged with the app closed now reaches the wrist: the assert parks its envelope and waits for `WCSession` activation instead of dropping it, `WatchLinkSession` drains that park on `activationDidCompleteWith`, and the widget chip's intent conforms to `LiveActivityIntent` so it runs in the app's process where a session exists. **Its runtime is its OWN** — `modules/watch-link/ios` changed, and that directory IS hashed, so no OTA reaches build 49 from here and vice versa. Verifier green on all four targets; `systemProtocols: SessionStarting` is present on `LogQuickAddSlotIntent` and on no other intent, which is the `LiveActivityIntent` conformance surviving extraction into **both** the app's and the appex's metadata. **Behaviour UNVERIFIED** — no complication has been watched to move after a meal logged outside the app |
| iOS | build 49 (2026-08-13) | `1e9840b69350067e4927bc698fd497d1aa5167d4` | **read from the `.ipa`** | superseded by 50, TestFlight, 1.2.0, `IN_BETA_TESTING`. Wide face gains the progress bars, the chip column stops clipping long preset names, and quick-add chips are readable on **tinted/clear Home Screens**: those modes render `.accented`, flattening every colour into one tint, so a filled capsule and its label resolved to the same colour and the text vanished into its own background. Verified from device screenshots — the chips drew as solid blobs. Stroked instead of filled whenever rendering is not full colour. **Shares 46's runtime**, which is the `targets/`-Swift rule holding across builds 46→49. Builds 47 and 48 exist: 47 removed a `ForEach` over duplicate identities that crashed the wide face, 48 was superseded before submission |
| Android | **vc 30** (2026-08-13) | `6519916642c291db8255d433bf651e26c66a28b4` | **read from the `.aab`** | current `main`, alpha, 1.2.0 — **N4b, the wide widget face**. `resizeMode` was absent from the generated provider XML, which Android defaults to `none`, so the launcher would not let anyone drag the widget wider; it is now `horizontal\|vertical`, and `widgetInfo.width` (always available in the task handler, never read) drives a row layout at ≥220dp. Verifier green: signer `CN=Macro Log Dev`, `expo-channel-name` production, both quick-add services survived the manifest merge. versionCode read from Play, **not** from the build log |
| iOS | **build 46** (2026-08-13) | `1e9840b69350067e4927bc698fd497d1aa5167d4` | **read from the `.ipa`** | current `main`, TestFlight, 1.2.0 — same change as vc 30: `.systemMedium` plus a purpose-built `HomeWideView`. **Its fingerprint moved off build 44/45's `3752c757…` because `app.json` is hashed as a whole** — the Android-only `resizeMode` key moved the *iOS* hash too, the documented trap running in the other direction. So no OTA reaches 44/45 from here, and this cohort split is real rather than a Windows/Mac artefact. Verifier green on all four targets. **Behaviour UNVERIFIED** — no wide widget has been placed on a home screen |
| iOS | **build 45** (2026-08-11) | `3752c757fc2882fa432c09d36715d9cd1bb61911` | **read from the `.ipa`** | current `main`, TestFlight, 1.2.0 — adds the **Siri** quick-add watch push. **Its fingerprint is IDENTICAL to build 44's**, which is the `targets/`-Swift rule holding: the only change is Swift under `_shared/`, so one `eas update` reaches 44 and 45 together. Verifier green on all four targets. **Behaviour UNVERIFIED** — no spoken quick-add has been watched to move a complication |
| iOS | **build 44** (2026-08-10) | `3752c757fc2882fa432c09d36715d9cd1bb61911` | **read from the `.ipa`** | current `main`, TestFlight, 1.2.0 — **the watch complication fix**: the phone now asserts over both WatchConnectivity queues and the watch app finally implements `didReceiveUserInfo`, which is where `transferCurrentComplicationUserInfo` lands. Built locally, verifier green on all four targets. **Its runtime is its OWN** — see the `modules/` rule below; an OTA aimed at build 41 does not reach it and vice versa. Builds 42 and 43 do not exist (a cloud attempt that died in *Configure expo-updates*, and a local one killed by the deleted watchOS runtime). **Behaviour is UNVERIFIED**: no complication has been watched to refresh on a wrist |
| Android | **vc 29** (2026-08-09) | `ca2dc124281f48e63c17111214f0ee8dfdc34784` | **read from the `.aab`** | current `main`, alpha, 1.2.0 — same commit as iOS build 41 (the `ignia://` scheme restore moved BOTH fingerprints, since `app.json` is hashed whole). vc 28 does not exist: that attempt died on `No space left on device` mid-CMake — the disk was carrying iOS build 41's DerivedData at the time; clear it before an Android build |
| iOS | **build 41** (2026-08-09) | `1d89fedf59c7975b06c43762cc6414547845c9fe` | **read from the `.ipa`** | current `main`, TestFlight, 1.2.0 — **restores the `ignia://` URL scheme**, unregistered since build 29's CFBundleURLTypes "de-duplication", which left the widget's face tap opening nothing on builds 29–40. Verified by `verify-mobile-artifact.mjs`, which now requires both schemes with whole-line matching |
| iOS | build 40 (2026-08-09) | `c9abb3165ad1c381a0607f98e1886b267aab1ba3` | **read from the `.ipa`** | current `main`, TestFlight, 1.2.0 — the dictation mic + the R1 sheet redesign. **Builds 38 and 39 are on TestFlight but MUST NOT be tested**: both lack `NSMicrophoneUsageDescription` (expo-camera's `microphonePermission: false` DELETES the key another plugin wrote), so the first mic tap crashes them. 39 was submitted before being verified — the mistake `scripts/verify-mobile-artifact.mjs` now makes structurally impossible |
| Android | vc 27 (2026-08-09) | `f1786d8e7087437f23670cf3dbad03302f50c276` | **read from the `.aab`** | current `main`, alpha, 1.2.0 — same content as build 40. Emulator-verified: full regression sweep 15/15 screens |
| iOS | build 37 (2026-08-08) | `84dafba371a083476d795b1e7408a51d1d6fb59b` | **read from the `.ipa`** | current `main`, TestFlight, **version 1.2.0**. Fixes the widget quick-add button (extension-process keychain, ADR-0020 amendment), adds the quick-add outbox and es-PR Siri phrases. Builds 33–36 do not exist — four attempts at one config plugin |
| iOS | build 31 (2026-08-08) | `fb7398e51984ecb39f1bb411329ef293fc96e095` | **read from the `.ipa`** | current `main`, TestFlight. **Behaviourally identical to build 30 on iOS** — it exists only to re-align the iOS runtime after `plugins/withGradleJvmArgs.js`, an Android-only plugin, moved the iOS hash. That is the `app.json` rule below, in the other direction. Carries N3, still **UNVERIFIED** |
| iOS | build 30 (2026-08-08) | `249ba992975203bb91c23aaddd5bab9d54d034fe` | **read from the `.ipa`** | superseded by 31. First binary with the fasting Live Activity (N3, ADR-0021), built off branch `n3-live-activity`. `NSSupportsLiveActivities` in `app.json` is what moved its fingerprint; the Swift that matters never would have |
| Android | vc 26 (2026-08-08) | `79e92d26082607ab50b8836f2e70155cfc090c4d` | **read from the `.aab`** | current `main`, alpha — carries the offline quick-add fix. An `eas update` is published against this runtime |
| Android | vc 25 (2026-08-08) | `7a0e4edf389423589c41b692db34e34984ea22cc` | **read from the `.aab`** | current `main`, alpha — version **1.2.0**. The first Android binary anything has ever launched: emulator-verified (`.maestro/README.md`) |
| Android | vc 24 (2026-08-08) | `01edf656412ecaab3a16363617f6f7f642fbe535` | **read from the `.aab`** | current `main`, alpha — carries `plugins/withGradleJvmArgs.js`, and **proved it**: built with no heap flags in `GRADLE_OPTS` and 0 OOMs. vc 22/23 do not exist (wrapper missing `JAVA_HOME`, then `ANDROID_HOME`) |
| Android | vc 21 (2026-08-08) | `f101b1d4e942c2ad032786b27821807ee3cfb6cd` | **read from the `.aab`** | superseded within the hour — N3's `NSSupportsLiveActivities` moved the **Android** hash, which is the measurement in the `app.json` note below. Its versionCode was 21, not the 20 the plan expected |
| iOS | build 29 (2026-08-08) | `d0487ca7bfb2e7ac64ad12e03a88d452ed51ce9d` | **read from the `.ipa`** | superseded by 30, TestFlight — adds spoken preset names ("log overnight oats in Ignia"). **Its runtime is its own**: deleting the inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN` key moved it off `4734a4b6…`, because `eas.json` IS hashed even though Swift is not |
| iOS | build 28 (2026-08-08) | `4734a4b6ae3cb652db2a4f920ee0b7ed8c073429` | **read from the `.ipa`** | superseded by 29. The build that made Siri work at all, and **the first iOS binary whose write path was exercised on hardware** — a Siri phrase logged a real row. Shares 27's runtime, so one `eas update` reaches both |
| iOS | build 27 (2026-08-07) | `4734a4b6ae3cb652db2a4f920ee0b7ed8c073429` | **read from the `.ipa`** | superseded. **Its Siri half never registered** — see the required-parameter trap above. Identical fingerprint to 28 because the fix was Swift-only |
| Android | vc 18 (2026-08-07) | `cc3da8b9a22df7180c55e6cab5cd8decccdb98bb` | **read from the `.aab`** | superseded by vc 21; carries the Quick Settings tile |
| iOS | build 25 (2026-08-07) | `6c756c19b3e35948b85e42a3b337eec588128d3c` | **read from the `.ipa`** | superseded by 27; still what un-updated testers run |
| iOS | build 24 | `781be0c885005e1d02bcf41408988c6622ff222e` | Windows `fingerprint:generate` — **unverified** | **THE LIVE APP STORE BINARY** (1.1.0, `READY_FOR_SALE` since 2026-08-08) until 1.2.0/build 54 is approved and released. Every member of the public runs this. Its runtime is a Windows-generated hash nobody has confirmed, so **no OTA should be assumed to reach it** — the public has been reachable only by a store release since 08-08 |
| Android | vc 13 (2026-08-07) | `5758fe4f232d5e6fe1ca369299512cfec0d39e13` | **read from the `.aab`** | superseded by vc 18; still what un-updated testers run |
| Android | vc 11 | `c0b85c15e6631d99e8ccef61867d937389094ae6` | Windows `fingerprint:generate` — **unverified** | superseded |

**A build log's versionCode line is not evidence either.** vc 18's build printed
*"Incrementing versionCode from 18 to 19"* and `[CONFIGURE_ANDROID_VERSION]
Version code: 19`, and the artifact it produced is **versionCode 18** — proven by
`androidpublisher`'s `bundles` list, whose `sha256` for vc 18 matches the local
`.aab` byte for byte. The log line describes the *remote counter* being advanced
for the next build, not what got baked in. So the same rule that applies to
fingerprints applies here: read it from the artifact or from Play, never from the
build output.

Also note `autoIncrement` burns a number per **attempt**: vc 14–17 do not exist,
consumed by three Gradle failures (unset `ANDROID_HOME`, a missing
`com.facebook.react` classpath entry in the new local module, and a Kotlin static
resolved through the wrong class). iOS **build 26** does not exist either, for the
same reason — one Swift failure, described below.

**iOS build 43 does not exist** (2026-08-10). A **local** build on `ignia-mac`,
killed at *Run fastlane* by `watchOS 26.5 must be installed in order to archive
the scheme` — the watchOS simulator runtime had been deleted hours earlier during
a disk sweep, on the wrong reasoning that the SDK surviving in Xcode.app was
enough. The scheme embeds `IgniaWatch.app` and archiving needs the platform.
`DEV_ENVIRONMENT.md` §3.10 now carries the corrected rule and the two checks that
falsely look authoritative.

**iOS build 42 does not exist** (2026-08-10). An EAS **cloud** build, queued only
because `ignia-mac` was offline, errored ~2 minutes in at *Configure expo-updates*
— before any Swift compiled, so it is evidence about the cloud worker and not
about the commit. Two things worth keeping from it: the `EXPO_ASC_*` override in
`CLAUDE.local.md` **works** (all four targets printed *All credentials are ready
to build*, no 401), and the build reported runtime version `721f39e507ba…`, which
is neither the Mac's `1d89fedf…` nor the Windows workstation's — **the EAS worker
is a third machine with a third fingerprint**, so a cloud artifact would have
shipped under a runtime no installed binary matches even had it succeeded. Build
locally.

**An App Shortcut may not carry a REQUIRED parameter, and breaking that rule
registers nothing at all.** iOS validates `AppShortcutsProvider` on the device at
registration time, reports nothing when it fails, and one invalid shortcut
invalidates the whole provider — so the app simply never appears in the Shortcuts
app and every phrase answers *"I can't help with that"*.

**Nothing upstream catches it.** The build is clean, there is no warning, and
`Metadata.appintents` still extracts perfectly into the binary — build 27's
archive holds a flawless `autoShortcutProviderMangledName`, both `autoShortcuts`,
all three intents and their phrase templates. Verifying the metadata is present
therefore proves nothing about whether Siri will ever see it; that check passed on
the binary that shipped broken.

The rules, from [WWDC22 *Implement App Shortcuts with App
Intents*](https://developer.apple.com/videos/play/wwdc2022/10170/): parameters
"should be defined as optional so the app can gracefully handle cases where users
don't specify them in the initial phrase", and they "are not meant for open-ended
values". Build 27 broke both — `LogPresetIntent.preset` was required and named in
no phrase, `LogMacrosIntent.calories` was required *and* an arbitrary number.

Declaring them optional costs nothing: disambiguate against `suggestedEntities()`,
or demand the value with `requestValue`, and the domain invariant is enforced in
`perform()` where it belongs rather than in the declaration.

**Swift block comments NEST, and it cost a build.** `/**` … `*/` nests, and
backticks mean nothing to the lexer, so a literal `_shared/` + `*` written inside
a doc comment opens a nested comment that never closes. It is reported as
`unterminated '/*' comment` against the **last brace in the file**, hundreds of
lines from the cause, and it cascades into `cannot find <Type> in scope` errors in
every other target. This is exactly why `Glance.swift` explains the same glob in
`//` line comments — those do not nest. Do not write that glob inside a block
comment.

**Only the rows marked "read from the artifact" are evidence.** Build 24 and vc 11
are Windows-generated hashes recorded before the machine-dependence above was
known, and their artifacts have since been overwritten on the Mac, so they cannot
be checked. Treat them as unknown, not as fact: since the Windows/Mac divergence
is commit-independent, they most likely carry Mac values nobody recorded. If it ever matters, rebuild at that commit on the Mac and read the
artifact — do not re-derive on Windows.

That also means the earlier claim that **the fleet spans two runtime versions per
platform** is not established. It was the Windows number for one binary compared
against the Mac number for another. A genuine split is still possible — two
binaries built from different commits normally *do* differ — but publishing
twice "to cover both" is only worth doing once both halves have been read out of
their artifacts. Otherwise the second publish targets a runtime nobody runs.

**2026-08-09: the gate was run at commit `43f15149` and both platforms matched
their live artifacts exactly** — android `ca2dc124…` (vc 29), ios `1d89fedf…`
(build 41) — so the OTA published that day lands on the current cohort. One
precondition was recorded here as load-bearing and **turned out not to be**: the
Mac had an `apps/mobile/android/` prebuild dir at the time (created to build a
QA APK for the Maestro emulator), and it was deleted before generating on the
belief that `dir:android` is hashed. It is not — see the struck-through bullet
above, measured 2026-08-17. Deleting it changed nothing; the gate would have
returned the same hash either way. Harmless as a habit, but do not reach for it
as an explanation when a fingerprint fails to match, and do not spend a step on
it. Nor on `node_modules`, disproven the same day: the only surviving repo-state
cause is CRLF-vs-LF in two files, and the rest is `@expo/fingerprint` behaving
differently per OS — see the bullets above.

Do not assume "published" means "delivered"; check which runtime version the
update went out under:

```sh
npx eas update:list --branch production --limit 3   # prints the runtime version
```

Both new binaries were built locally on `ignia-mac` at **zero EAS quota**
(`build-ios` / `build-android` skills, `DEV_ENVIRONMENT.md` §3.10–3.11).

**Changes the fingerprint** (⇒ needs a build): any dependency carrying native
code, native config in `app.json` (permissions, icons, splash, plugins,
entitlements), an Expo SDK upgrade. A pure-JS dependency usually does not — but
"usually" is why you run the command instead of reasoning about it.

**`modules/*/ios` IS hashed, even though `targets/` is not — measured 2026-08-10.**
The two look interchangeable and are not. An Expo Module is a **directory source**
in the fingerprint (`modules/watch-link/ios`, `modules/quick-add-credentials/ios`
and `modules/fasting-live-activity/ios` all appear in `sources` as `dir:` entries),
so editing one line of Swift there moves the runtime version. An apple-target under
`targets/` does not. Build 44 changed Swift in **both** places and came out on
`3752c757…`, off build 41's `1d89fedf…` — so the OTA published earlier that day
against `1d89fedf…` does not reach it. Read the sources when in doubt:

```sh
npx expo-updates fingerprint:generate --platform ios \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).sources.filter(x=>x.type==='dir').map(x=>x.filePath).join('\n')))"
```

**Swift and Kotlin under `targets/` do NOT change it, and that inverts the gate.**
Measured 2026-08-08: `QuickAddIntents.swift` was edited and iOS build **28** came
out carrying the change — `isOptional` flipped in the shipped
`Metadata.appintents` — while the fingerprint stayed `4734a4b6…`, byte-identical
to build 27's. Confirmed three ways: both `.ipa`s and a fresh
`fingerprint:generate`. This line previously claimed the opposite.

So for a native-source change the gate gives the **wrong** answer: an unchanged
hash normally reads as "ship it over the air", and here that publishes an update
containing no Swift at all — landing successfully, reporting success, and fixing
nothing. **The gate answers "will an OTA reach these binaries", never "is an OTA
sufficient".** Only the second question matters once you have touched native
source, and the hash cannot answer it: if the change is under `targets/` or
`modules/`, it needs a build no matter what the gate says.

The upside of the same fact: builds 27 and 28 share runtime `4734a4b6…`, so a
single `eas update` reaches both cohorts.

**`app.json` is hashed as a WHOLE, so a key for one platform moves the other
platform's fingerprint too.** Measured 2026-08-08: adding `NSSupportsLiveActivities`
under `ios.infoPlist` — a key Android cannot read and no Android file mentions —
moved the **Android** hash to `5d911df8…`, off live vc 21's `f101b1d4…`. vc 21
existed specifically to end Android's OTA stranding, and it was re-stranded about
forty minutes later by an iOS-only line. **Generate BOTH platforms after any
`app.json` edit**, not just the one you meant to change. The same applies to the
`plugins` array, including `./plugins/*` — `withGradleJvmArgs.js` is an
Android-only plugin and it moves the iOS hash.

**Does NOT change it** (⇒ ships over the air): `.ts`/`.tsx`/`.js` source, UI,
styles, business logic, i18n strings, Metro-bundled assets.

Two more things worth knowing: testers get an update on the **next** launch, not
the current one (it downloads in the background and applies on the following
start), and a bad update is undone with `eas update:roll-back-to-embedded`, which
returns everyone to the JS baked into their binary.

See the `build-android` skill for the full decision.

# Telling users an update exists — two mechanisms, one banner

`UpdateBanner` on Today is the only surface that tells a user their app is
stale. It covers both mechanisms, and they fail in opposite ways:

| Case | Source of truth | What the user does |
|---|---|---|
| **OTA** (JS only) | `expo-updates` — bundle already downloaded | one tap, reloads in place |
| **Binary** (native) | `public/app-version.json` on the hosting site | leaves for the store |

The OTA half is self-maintaining: `expo-updates` knows a bundle is pending and
the banner clears itself when tapped.

**The binary half cannot maintain itself, and that is its whole risk.** If
`latestVersionCode` lags what Play ships there is no error, no warning, and no
visible difference from a working feature: every install just keeps believing it
is current. Two things cover it, and neither is your memory:

```sh
node scripts/app-version-sync.mjs           # derive it from the live Play tracks
node scripts/app-version-sync.mjs --check    # report drift, change nothing
```

`npm run doctor` runs the `--check` path (*app-version.json matches what Play
ships*) and **fails** on drift, naming the fix. Never hand-edit the number —
`androidpublisher` is the authority, the same one the signing-cert check uses.
Deploying is still a separate act: `firebase deploy --only hosting`, or the
corrected file reaches nobody.

`ios.latestBuild` is `0`, which disables the iOS prompt on purpose. TestFlight
builds run ahead of the App Store, so pointing a store user at a build they
cannot install is worse than saying nothing. Set it to the **live App Store
build** — never the TestFlight one — if the iOS prompt is ever wanted.

# This app is in production

Treat every change here as a production change: this app is on the iOS App Store.

**Do not read a version number out of `app.json` — it is not evidence of what
shipped.** Which version is live, which build backs it, and what is merged but
not yet in any binary all live in **`STATUS.md`**, which carries the command to
re-check each one. Nothing in this folder should restate them; a second copy is
how "planned" and "shipped" became indistinguishable here before.

## A hashed file's LINE ENDINGS can move the fingerprint with no commit at all

**Measured 2026-08-17, and it stranded a shipped binary.** `apps/mobile/.gitignore`
is a `file:` fingerprint source *and* one of the two files this repo checks out as
CRLF on Windows. vc 32 was built while it was CRLF, so the `.aab` embeds
`d8741525…`. A later `git commit` normalized it to LF — `.gitattributes` says
`* text=auto eol=lf`, and git had been warning *"CRLF will be replaced by LF the
next time Git touches it"* — and the Android fingerprint moved to `0c82dbc1…`.

Proven by flipping only that file's line endings back and forth:

| `apps/mobile/.gitignore` | android fingerprint |
|---|---|
| CRLF (48 lines) | `d8741525…` — what vc 32 ships |
| LF (55 lines) | `0c82dbc1…` — the normalized, correct tree |

Everything else was ruled out first by measurement: the JS change itself (stash
in/out, identical hash), root `engines`, the `android/` prebuild dir, and the 39
Gradle output directories the build writes inside `node_modules/*/android`. Even
checking out the exact build commit `c75352ef` gave `0c82dbc1…`, which is what
proves the drift is worktree state and not repo content.

**Three consequences.**

1. **`git status` stays clean through this.** Nothing signals the drift — the
   index was always LF; only the worktree changed. A gate run days after a build
   can silently disagree with the binary for no reason a diff will show.
2. **vc 32 is an ORPHAN runtime.** Its hash is only reproducible from a CRLF
   worktree, which is a state `.gitattributes` actively removes. **No OTA from a
   correct tree can ever reach vc 32** — do not try to recreate the CRLF to
   publish one; the next git operation undoes it. It needs a replacement build.
3. **iOS is unaffected.** Build 57 was produced on `ignia-mac`, where the checkout
   is LF already, so its `25e953e9…` was computed from the same normalized state
   the tree is in now.

The durable fix is that the worktree now matches the index. Re-normalizing is a
one-time event; once every hashed file is LF the class is closed. If a
fingerprint ever fails to match for no visible reason, **check line endings on
`.gitignore` and `targets/widget/expo-target.config.js` before anything else.**
