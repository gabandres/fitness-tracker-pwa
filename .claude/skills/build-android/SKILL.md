---
name: build-android
description: Ship an Android change — decide between an over-the-air EAS Update (free, instant, no build) and a real build, run the fingerprint gate that decides whether an OTA can land, and submit to the Play alpha track. Use for "ship this to Android", "cut an Android build", "push a fix to testers", or any mobile fix headed for Play. Android builds on the WINDOWS workstation; iOS is the `build-ios` skill, on the Mac.
---

# Ship an Android change

**Android builds on this Windows workstation, iOS on `ignia-mac`** (since
2026-08-17). Both are local and cost zero EAS quota.

`REFERENCE.md` in this directory holds the evidence behind every rule below — the
measurement, the incident, the wrong conclusion it replaced. **Read it when a rule
looks arbitrary, when a failure is not covered here, or before re-proposing
anything.** Do not re-derive; it has all been measured once already.

## Step 1 — the fingerprint gate

A JS-only change ships over the air. An OTA published against a *changed*
fingerprint **succeeds and reaches nobody** — that is the expensive direction.

```sh
cd apps/mobile && npx expo-updates fingerprint:generate --platform android \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hash))"
```

Compare against the binary testers run — the table in `apps/mobile/AGENTS.md`,
whose **"read from the artifact"** rows are the only ones that count.

| Result | Meaning |
|---|---|
| Same hash | an OTA reaches that binary → Step 2 is *available* |
| Different hash | an OTA reaches nobody → build, Step 3 |

Rules, all measured (`REFERENCE.md` → *The fingerprint gate*):

- **Generate on the machine that BUILDS that platform.** A hash from the wrong
  host matches no binary. (Prebuild does *not* affect it — a rule saying so was
  written and withdrawn on 2026-08-17; the real mover was line endings.)
- **A computed hash can drift with a clean `git status`.** `.gitignore` and
  `targets/widget/expo-target.config.js` are hashed sources *and* the two files
  Windows checks out as CRLF; git normalizing them moves the fingerprint with no
  commit. If a gate disagrees for no visible reason, check line endings first.
- **The gate answers "will an OTA reach these binaries", never "is an OTA
  enough".** If you touched `targets/` or `modules/`, you need a build whatever
  the hash says — `targets/` Swift does not move it, and an OTA carries no native
  code.
- **`app.json` is hashed whole** — an iOS-only key moves the Android hash.
  Generate both platforms after any edit to it.
- **Also moves it:** native dependencies, `eas.json`, the `plugins` array, an SDK
  upgrade. **Does not:** `.ts`/`.tsx`/`.js`, UI, styles, i18n, Metro assets.
- **Do not try to make the two hosts agree.** They cannot; they do not need to.

## Step 2 — OTA (no build, no queue, no review)

Owns OTA publishing for **both** platforms; `build-ios` links here. It is **two
publishes**, each from its own host.

Announce it first — an OTA reaches the device with no store involvement, so the
in-app banner is the **only** user-facing channel:

| What | Where |
|---|---|
| Version constant (bumping it is what makes the banner fire) | `apps/mobile/src/lib/whatsNew.ts` → `WHATS_NEW_VERSION` |
| Copy, both locales, flat keys | `apps/mobile/src/i18n/{en,es-PR}.ts` → `whatsNew.*` |
| Web equivalent, nested keys | `src/app/components/whats-new-banner/whats-new-banner.component.ts` |

Run the Metro gate — `tsc` and `jest` both pass while bundling is broken:

```sh
cd apps/mobile && npx expo export --platform android --output-dir <tmp>
```

```sh
# Android — here
cd apps/mobile && npx eas update --platform android --branch production \
  --environment production --message '<what changed>'
# iOS — on the Mac
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas update --platform ios \
  --branch production --environment production --message '<what changed>'"
# confirm WHICH RUNTIME each went out under
cd apps/mobile && npx eas update:list --branch production --limit 3
```

- **`--platform` is mandatory** — bare `eas update` publishes both and is correct
  on neither host. **`--environment` is mandatory** from SDK 55 on.
  `.claude/hooks/guard_eas_update.py` enforces both.
- Testers get it on the **next** launch. Undo with
  `eas update:roll-back-to-embedded`. `--message` is for the dashboard, not users.

## Step 3 — build, on Windows, free

`eas build --local` refuses to run on Windows, so raw Gradle is the only path —
and it omits three things that each fail **silently**: the EAS Update channel
(shipped once as vc 10), release signing, and the versionCode.
`patch-android-release.mjs` supplies all three.

```sh
node scripts/app-version-sync.mjs --check            # live versionCode; pass the next one
cd apps/mobile/android && ./gradlew --stop || true   # NOT optional
cd .. && npx expo prebuild -p android --clean
# prebuild DELETES android/local.properties — restore it or Gradle reports
# "SDK location not found", which reads like a missing SDK install:
[ -f android/local.properties ] || echo "sdk.dir=Z:/packages/android-sdk" > android/local.properties
node scripts/patch-android-release.mjs <versionCode> production
# load .env.local so SENTRY_AUTH_TOKEN reaches Gradle, then bundleRelease:
node -e "process.loadEnvFile('Z:/macro-app/.env.local');require('child_process').spawnSync('cmd.exe',['/c','Z:\\\\macro-app\\\\apps\\\\mobile\\\\android\\\\gradlew.bat','bundleRelease'],{cwd:'Z:/macro-app/apps/mobile/android',stdio:'inherit',env:process.env})"
```

- **Run Gradle detached** (`run_in_background`) — ~20 min on SDK 57, well past a
  foreground timeout, and a timeout kill looks exactly like a failure.
- **`SENTRY_AUTH_TOKEN` must reach Gradle** or you lose the build at the *last*
  task, after all the C++. A plain PowerShell invocation does not read
  `.env.local`, and `npm run doctor` is green anyway.
- **`./gradlew --stop` first**, or a stale daemon fails a random task with
  `Unable to delete file '…classes.jar'`.
- `CMAKE_OBJECT_PATH_MAX` is a **warning**, not a failure. Build anyway; insist on
  device QA.
- **The release ABI set is TWO, and it lives in the plugin.**
  `plugins/withGradleJvmArgs.js` writes
  `reactNativeArchitectures=armeabi-v7a,arm64-v8a`, so a release build no longer
  compiles `x86`/`x86_64`. Each ABI is a full native compile, and on this
  workstation every one runs **emulated** — the NDK ships `windows-x86_64` only,
  there is no `windows-aarch64`, and this box is a Snapdragon X. Dropping the two
  ABIs nothing here runs roughly halves the native work. Play serves per-device
  splits, so they never cost a user a byte; `armeabi-v7a` stays because
  `minSdkVersion` is 26.

  For a **local check only**, override on the invocation — one ABI is
  [~75% off native build time](https://reactnative.dev/docs/build-speed):

  ```sh
  ./gradlew bundleRelease -PreactNativeArchitectures=arm64-v8a   # never submit this
  ```

  **Changing that plugin moves the fingerprint.** Measured 2026-08-19: adding one
  key moved the Android hash `ae526937…` → `f0f6cff9…`, and adding only a
  *comment* moved it to `e84ab503…`. It is a hashed source. That is why the cut
  shipped as part of **vc 36** rather than being slipped in between binaries —
  it shut the OTA channel against vc 35, deliberately, and vc 36 reopens it. Do
  not edit that file for a build-speed tweak without accounting for the channel.

### Verify — gate on the exit code

```sh
node scripts/verify-mobile-artifact.mjs \
  apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
```

Run it **from Git Bash** — it shells out to `unzip`/`sh`, which PowerShell does
not provide (it reports `spawnSync unzip ENOENT` and a bogus missing-fingerprint
error). It asserts the signer is `CN=Macro Log Dev`, `expo-channel-name` is
present, the quick-add services survived the manifest merge, and prints the
fingerprint **from the artifact** — the only value `AGENTS.md` may record.

**Non-zero exit → do not submit.** New native service? Add it to
`scripts/native-expectations.json` in the same commit.

**Never read the versionCode from the build log** — it prints the *next* number.

## Step 4 — submit

```sh
cd apps/mobile && npx eas submit -p android --profile production \
  --path android/app/build/outputs/bundle/release/app-release.aab --non-interactive
```

Goes to the **alpha** track, `releaseStatus: "completed"` — rolled out to the
tester list, not a draft. No build quota. The Mac must never submit: it lacks
`play-service-account.json` deliberately.

## After shipping

```sh
node scripts/app-version-sync.mjs        # derive from the live Play tracks
npm run build && firebase deploy --only hosting
```

`UpdateBanner` reads `app-version.json` to tell older installs a binary exists.
**Skip the deploy and it silently never fires.** Never hand-edit the number;
`npm run doctor` fails on the drift. A **prod** build is required — a dev build
skips `ngsw.json`.

Then update the fingerprint table in `apps/mobile/AGENTS.md` (value read from the
artifact) and `STATUS.md`. **A merged fix reaches nobody until it is in a binary
or an update** — say which, and which cohort, when reporting.

Shipping a binary does **not** deliver an OTA: a device becomes OTA-capable only
once running a binary containing `expo-updates`, and testers on an older
versionCode receive nothing until they install the new one.
