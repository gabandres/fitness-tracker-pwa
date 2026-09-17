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

**Measure the export before deleting it.** Nothing else in this repo can see
bundle size — not `tsc`, not the 340 jest tests, not Maestro, not the
fingerprint gate — and it is paid by every tester on every OTA download and
every cold start:

```sh
node scripts/perf-budget.mjs --platform android --export-dir <tmp>
```

The bundle went **11,095,849 → 13,140,531 bytes (+2.0 MB, +18%)** in the single
publish that shipped the food index, and drifted another **142,341** in the day
after with nobody noticing — which is how it was found. Baselines live in
`scripts/perf-budget.json` and a breach is either a regression to find or a
growth to accept on the record (`npm run perf:budget -- --update`, and say why
in the commit message). Raising `headroomPct` to make it pass defeats the point.

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
build.** `node_modules` is NOT an input (blamed twice, disproven 2026-08-17 —
see "What does NOT move it" below); the repo-state cause that IS real is CRLF
vs LF, end of this file. Run the gate on a clean `npm ci` tree anyway.

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

**Current fingerprints — one row per platform. REPLACE a row when a new binary
ships; never add rows here.** Every OTA and build since 2026-08, with its group
id, commit, evidence and post-mortem, is the ledger in
`docs/fingerprint-ledger.md` (newest first) — **append there.** This table is
the value other files mean by "the fingerprint read out of the shipped
artifact"; which version is *live* is `STATUS.md`'s question.

| Platform | Binary | Runtime fingerprint | Read from |
|---|---|---|---|
| Android | vc 45 / 1.2.3 — Play production + alpha | `15c1cfc8aaa0951e882c278af5c1256de5836194` | the `.aab` |
| iOS | build 64 / 1.2.3 — App Store | `52802bba95ac0ac3f4cfd053d6ee61c354cc18d9` | the `.ipa` |

Both channels are OPEN on those hashes; the newest OTA on each is `478e00b4`
(2026-09-16, third publish — the OTA auto-apply no longer eats a reviewed photo
scan). **Only a value read from the artifact is evidence** — a build
log, a locally generated hash, or an old Windows-computed number is not.

**What MOVES the fingerprint (⇒ a build per platform):**

- Any dependency with native code; an Expo SDK bump.
- `app.json`, hashed **as a whole** — an iOS-only key moved the Android hash and
  an Android-only permission moved the iOS hash, off the public binary each
  time. **Generate BOTH platforms after any `app.json` edit.** Same for the
  `plugins` array, `./plugins/*` included. (history: fingerprint-ledger.md,
  "hashed as a WHOLE")
- The `version` field in `app.json` — a version bump shuts both channels until a
  new binary per platform exists. (history: "version bump moved BOTH")
- `eas.json`, even a `submit` profile. Do not edit it between a build and its
  OTAs. (history: "`eas.json` is hashed too")
- `modules/*/ios` — an Expo Module is a `dir:` source; one Swift line there
  moves the runtime. (history: "`modules/*/ios` IS hashed")
- **Android-only permissions never go in `app.json`.** They go in step 4b of
  `patch-android-release.mjs` (writes the gitignored manifest; `dir:` sources
  hash only tracked files). `scripts/native-expectations.json`
  `requiredPermissions` + `verify-mobile-artifact.mjs` are the only check that
  the permission actually shipped. (history: "Android-only permissions")

**What does NOT move it:** `.ts`/`.tsx`/`.js`, UI, styles, i18n, Metro assets
(⇒ OTA). Also NOT the `android/` prebuild dir and NOT `node_modules` — both were
blamed and disproven; the only repo-state cause ever found is CRLF-vs-LF (end of
this file). (history: "2026-08-09: the gate was run")

**Swift/Kotlin under `targets/` does NOT move it, and that INVERTS the gate.**
An unchanged hash reads as "ship it OTA", but the OTA carries no native code and
fixes nothing while reporting success. The gate answers "will an OTA reach these
binaries", never "is an OTA sufficient" — a change under `targets/` or
`modules/` needs a build no matter what the hash says. (history: "inverts the
gate")

**Build numbers:**

- A build log's `Incrementing versionCode` / `Version code: N` line is the remote
  counter, not the artifact. Read vc from the `.aab` or from Play's `bundles`
  sha256. (history: "versionCode line is not evidence")
- `autoIncrement` burns a number per **attempt** — vc 14–17 and iOS builds 26,
  42, 43 do not exist. Gaps are normal. (history: "do not exist")
- **The EAS cloud worker is a third machine with a third fingerprint.** A cloud
  artifact lands on a runtime no installed binary matches. Build locally: iOS on
  `ignia-mac` (needs the watchOS platform installed — the scheme embeds
  `IgniaWatch.app`, `DEV_ENVIRONMENT.md` §3.10), Android on Windows.

**Delivery:**

- `eas submit -p android` is 0-for-2 on bundles over 60 MB (Play's edit expires
  mid-upload). Use `scripts/play-upload-bundle.mjs … --track alpha --commit`,
  THEN `play-production-release.mjs --complete --commit --vc N` — the promoter
  404s if run before the upload. (history: "0-for-2")
- iOS `eas submit` works; altool is the fallback. **A build of a RELEASED version
  can never enter external TestFlight** — only the newest unreleased version's
  build can. (history: "closed for beta review")
- "Published" ≠ "delivered": `npx eas update:list --branch production --limit 3`
  prints the runtime version it went out under. Devices apply an update on the
  **next** launch. Undo a bad one with `eas update:roll-back-to-embedded`.

**iOS native traps (each cost a build):**

- App Shortcut parameters must be **optional**; one required parameter silently
  invalidates the whole `AppShortcutsProvider` — no warning, `Metadata.appintents`
  still extracts, Siri answers "I can't help with that". (history: "App
  Shortcut")
- Swift block comments **nest**: a `_shared/` + `*` glob inside `/** */` is an
  `unterminated '/*' comment` reported at the file's last brace, cascading into
  `cannot find <Type> in scope` everywhere. Write such globs in `//` comments.
  (history: "block comments NEST")

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
