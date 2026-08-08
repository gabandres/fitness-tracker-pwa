# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code (installed SDK is `expo@^54`; keep this URL in sync with `apps/mobile/package.json`).

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

**Run the gate — and `eas update` itself — on `ignia-mac`. Never on the Windows
workstation.** The same commit fingerprints differently on the two machines:

| Machine | commit `c3a7333a`, android | ios |
|---|---|---|
| **`ignia-mac`** | `5758fe4f…` | `6c756c19…` |
| Windows workstation | `c0b85c15…` | `781be0c8…` |

Three commit-independent causes, found by diffing the two `sources` arrays
(516 entries on Windows, 286 on the Mac):

- a stale **`apps/mobile/android/`** prebuild dir exists on Windows only — it is
  gitignored, so nothing syncs or removes it, and `dir:android` is hashed;
- **CRLF vs LF** in tracked files (`.gitignore`, `targets/widget/expo-target.config.js`
  both hash differently) — Windows checks out CRLF;
- divergent `node_modules`, which changes which config-plugin files are walked.

Since **every binary is built on the Mac**, the Mac's value is the one the
binaries carry, and a hash generated anywhere else is a number that matches
nothing.

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

So the gate before every publish is, **on the Mac**:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git checkout main && git pull --ff-only"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform android"
```

Compare the `hash` against the fingerprint read out of the binary testers are
running. **Same → the update lands. Different → it reaches nobody and you need a
build.** Note the Mac's `node_modules` is an input: an `npm install` there can
move the fingerprint away from an already-shipped binary, so check the gate
*before* installing, not after.

Fingerprints of the binaries carrying `expo-updates` (update these when new ones
ship):

| Platform | Binary | Fingerprint | Source | Note |
|---|---|---|---|---|
| iOS | **build 30** (2026-08-08) | `249ba992975203bb91c23aaddd5bab9d54d034fe` | **read from the `.ipa`** | branch `n3-live-activity`, TestFlight — the fasting Live Activity (N3, ADR-0021). **The feature is UNVERIFIED**: no Lock Screen has counted. `NSSupportsLiveActivities` in `app.json` is what moved the fingerprint; the Swift that matters never would have |
| Android | **vc 21** (2026-08-08) | `f101b1d4e942c2ad032786b27821807ee3cfb6cd` | **read from the `.aab`** | current `main`, alpha — **the binary that ends Android's OTA stranding**: vc 18's `cc3da8b9…` no longer matches source, so every Android `eas update` was publishing to nobody. Its versionCode is **21, not the 20 the plan expected** — read from Play, `autoIncrement` burned another number on the Metaspace OOM |
| iOS | build 29 (2026-08-08) | `d0487ca7bfb2e7ac64ad12e03a88d452ed51ce9d` | **read from the `.ipa`** | superseded by 30, TestFlight — adds spoken preset names ("log overnight oats in Ignia"). **Its runtime is its own**: deleting the inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN` key moved it off `4734a4b6…`, because `eas.json` IS hashed even though Swift is not |
| iOS | build 28 (2026-08-08) | `4734a4b6ae3cb652db2a4f920ee0b7ed8c073429` | **read from the `.ipa`** | superseded by 29. The build that made Siri work at all, and **the first iOS binary whose write path was exercised on hardware** — a Siri phrase logged a real row. Shares 27's runtime, so one `eas update` reaches both |
| iOS | build 27 (2026-08-07) | `4734a4b6ae3cb652db2a4f920ee0b7ed8c073429` | **read from the `.ipa`** | superseded. **Its Siri half never registered** — see the required-parameter trap above. Identical fingerprint to 28 because the fix was Swift-only |
| Android | vc 18 (2026-08-07) | `cc3da8b9a22df7180c55e6cab5cd8decccdb98bb` | **read from the `.aab`** | superseded by vc 21; carries the Quick Settings tile |
| iOS | build 25 (2026-08-07) | `6c756c19b3e35948b85e42a3b337eec588128d3c` | **read from the `.ipa`** | superseded by 27; still what un-updated testers run |
| iOS | build 24 | `781be0c885005e1d02bcf41408988c6622ff222e` | Windows `fingerprint:generate` — **unverified** | in App Review |
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
