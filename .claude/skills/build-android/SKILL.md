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

## Step 3 — a real Android build

**This is an EAS CLOUD build. There is no working local path on this hardware —
do not go looking for one.** Measured 2026-08-07:

| Attempt | Why it fails |
|---|---|
| `./gradlew bundleRelease` on Windows | Windows `MAX_PATH`. RN's New Architecture codegen embeds the full source path in the object path; `react-native-keyboard-controller` reaches 350 chars against a 260 limit ([upstream #1247](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1247), open, unfixed) |
| Shorter staging dir | Arithmetic kills it — the remainder past the prefix is 275 chars alone |
| `LongPathsEnabled` registry | Already `1`; the SDK ships ninja 1.10.2, which predates the opt-in |
| `-DCMAKE_OBJECT_PATH_MAX=200` | Reaches CMake (verified in `CMakeCache.txt`) and has no effect — sources are out-of-tree, so CMake embeds the mangled absolute path and the max doesn't rewrite it |
| `eas build --local` in WSL2 | This is an **ARM64** machine (Snapdragon X Elite), so WSL is `aarch64`, and Google ships the SDK/NDK for `linux-x86_64` only ([tracker 227219818](https://issuetracker.google.com/issues/227219818), open) |
| Android SDK on the Mac | Would work — macOS has no path limit — but needs `dev.keystore` copied there. That keystore is load-bearing app identity and exists in one place (`CLAUDE.local.md`). **Owner decision, not a default.** |

`apps/mobile/scripts/patch-android-release.mjs` exists from that investigation. It
prepares a prebuilt `android/` for signed local release (real signing config +
versionCode). **It does not make Windows work** — items 1 and 2 in it are
platform-neutral and are what a macOS local build would need.

So:

```sh
cd apps/mobile && npx eas build -p android --profile production
```

- Quota is **15/month**; free-tier queue has run to **two hours**.
- Signing uses `credentialsSource: "local"` → `credentials/dev.keystore`. Never
  regenerate or replace it: `fit.ignia.app` is registered with Play against that
  cert.
- `autoIncrement: true` with `appVersionSource: "remote"` — the counter lives on
  EAS, not in the repo. Read it with `eas build:version:get -p android`.
- **Check `SENTRY_AUTH_TOKEN` before queueing.** `@sentry/react-native` uploads
  source maps as a Gradle task, so a stale token FAILS the build — build
  `9e3df4e3` died on an HTTP 401 after a two-hour wait. `npm run doctor` group 3
  validates the local copy.

## Step 4 — submit

```sh
cd apps/mobile && npx eas submit -p android --profile production
```

Goes to the **alpha** track with `releaseStatus: "completed"` (rolled out to the
tester list, not a draft). Uses `credentials/play-service-account.json`.

**Verify at Play, not from the CLI** — the `androidpublisher` edits→tracks API is
the authority on what testers actually have:

```
GET androidpublisher/v3/.../tracks/alpha  →  status=completed, versionCodes=["N"]
```

## After shipping

- Update the fingerprint table in `apps/mobile/AGENTS.md` if a new binary shipped.
- Update `STATUS.md` — it is the file that says what is true right now.
- **A merged fix reaches nobody until it is in a binary or an update.** Say which,
  out loud, when reporting.
