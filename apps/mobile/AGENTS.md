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
| Android | **vc 18** (2026-08-07) | `cc3da8b9a22df7180c55e6cab5cd8decccdb98bb` | **read from the `.aab`** | current `main`, alpha — carries the Quick Settings tile |
| iOS | **build 25** (2026-08-07) | `6c756c19b3e35948b85e42a3b337eec588128d3c` | **read from the `.ipa`** | current `main` |
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
resolved through the wrong class).

**Only the two rows marked "read from the artifact" are evidence.** The other two
are Windows-generated hashes recorded before the machine-dependence above was
known, and their artifacts have since been overwritten on the Mac, so they cannot
be checked. Treat them as unknown, not as fact: since the Windows/Mac divergence
is commit-independent, build 24 and vc 11 most likely carry Mac values nobody
recorded. If it ever matters, rebuild at that commit on the Mac and read the
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
entitlements), an Expo SDK upgrade, the widget/watch Swift or Kotlin. A pure-JS
dependency usually does not — but "usually" is why you run the command instead of
reasoning about it.

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
