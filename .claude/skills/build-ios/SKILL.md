---
name: build-ios
description: Decide whether an iOS change needs a binary at all (a JS-only change ships as an OTA from the Windows PC via `build-android`), and the runbook for building and submitting an iOS binary locally on the build Mac (driven from the PC with `mac`) at no EAS quota. Use for "cut an iOS build", "build for TestFlight", "ship the iPhone app", or whenever a mobile fix needs to reach iOS testers. Android is the `build-android` skill; do not run both platform builds on the Mac at once (16 GB).
---

# Build iOS on the build Mac

`eas build -p ios --profile production --local` on the build Mac, sent from the
PC with `mac bg`. **Zero EAS quota, no cloud queue.** ~13–16 minutes green (on
the first Mac). The machine, `mac` and its rules: `Z:\machines\README.md`;
`docs/DEV_ENVIRONMENT.md` §3 says how `mac` is used here. OTAs do not need the
Mac: they publish from the Windows PC (`build-android` Step 2).

`REFERENCE.md` in this directory holds the evidence behind every rule below.
`docs/DEV_ENVIRONMENT.md` §3.10 holds the archive traps — **read it before
debugging any build failure**; every one seen so far is already there. The build
Mac came 2026-11-22: whether it has the watchOS platform an archive needs is not
yet recorded, so Step 1 checks it.

## Step −1 — is the Apple membership mid-change?

**An Apple Developer membership that is being assigned, converted or renewed has
its benefits DISABLED for the duration, and that takes Certificates, Identifiers
& Profiles down with it. While the portal is down, `eas build -p ios` cannot
provision and FAILS — locally as well as in the cloud, because signing needs the
portal either way.**

The failure reads like a credentials bug (a 401, or a bundle identifier it
"cannot register"), which is the same shape as the two credential traps in
`CLAUDE.local.md` that *do* have fixes. Those fixes will not help here; nothing
in this repo can. Check before spending a Mac build:

- **`STATUS.md` §3** — the transfer/migration row says whether one is running.
- ASC itself stays UP throughout, so **releasing an already-built binary and
  publishing an `eas update` OTA are unaffected** — an OTA touches no cert. That
  is the whole workaround: ship JS, and land any binary you expect to need
  *before* telling Apple to start.

Do not assume such a window is short. Two developers publicly report migrations
still running at 17 days and 3+ weeks (developer.apple.com threads 816092 and
814367).

## Step 0 — do you need a build at all?

**A JS/TS-only change needs no binary.** Gate first, **on the Windows PC**
(checkout `Z:\fitness-tracker-pwa`, Git Bash) — since 2026-11-12 it computes the
Mac's fingerprints exactly (`apps/mobile/AGENTS.md`):

```sh
cd /z/fitness-tracker-pwa && git checkout main && git pull --ff-only
cd apps/mobile && npx expo-updates fingerprint:generate --platform ios \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hash))"
```

**Unchanged hash → `build-android` Steps 1–2**, which own the gate semantics and
the OTA procedure for both platforms. Do not re-derive them here. The OTA is
**per-platform** (`--platform ios`), and `--environment` is required from SDK 55
on.

Two that bite on iOS specifically:

- **Swift under `targets/` does not move the fingerprint, but `modules/*/ios`
  does.** So a Swift-only fix can read as "shippable over the air" while the OTA
  would carry no Swift at all. **Touched `targets/` or `modules/`? Build,
  whatever the hash says.**
- **Bump the what's-new banner** (`apps/mobile/src/lib/whatsNew.ts` →
  `WHATS_NEW_VERSION`, plus `whatsNew.body` in both locales). App Store "What's
  New" attaches to binary releases only, so for an OTA the banner is all a user
  sees — and changing the copy without bumping the constant shows nobody anything.

## Step 1 — preflight (seconds, and it has caught real blockers)

`mac status` first (reachable, someone at the keyboard, disk, jobs running).
Then, from the PC (`mac run` syncs the working tree first):

```sh
mac run 'git log --oneline -1 && git status --short | head -5
node -v; which fastlane
xcrun simctl list runtimes | grep -ciE "ios|watchos"; xcodebuild -showsdks | grep -i watchos
df -h /System/Volumes/Data | awk "NR==2{print \$4\" free\"}"
cd apps/mobile && npx eas whoami'
```

| Check | If it fails |
|---|---|
| `git status` clean | prebuild leaves generated artifacts in the Mac clone. Clearing them is fine for `eas build --local`, which prebuilds, and it BREAKS `npx expo run:ios`, which does not: `expo run:ios` only prebuilds when `ios/` is absent, so with `ios/` already on disk it skips prebuild and Xcode then fails with `Build input file cannot be found: targets/widget/Info.plist` (error 65) — the untracked target plists the cleanup took away. Measured 2026-08-19 (with `git stash push -u`; recovered with `git stash apply`, not a rebuild) |
| on the intended ref | `mac sync` sends the PC's working tree; record **which** commit in `STATUS.md` |
| `which fastlane` | `brew install fastlane` — **never** the gem (system Ruby has a broken `ffi`) |
| iOS **and watchOS** platforms present | `sudo xcodebuild -downloadPlatform iOS` / `watchOS` (sudo: `Z:\machines\README.md`). The scheme embeds `IgniaWatch.app`, so archiving needs the watchOS platform |
| disk ≥ ~17 GB | clear `~/Library/Developer/Xcode/DerivedData/*`; more in `DEV_ENVIRONMENT.md` §3.9 |
| `eas whoami` | the Mac is not logged in to Expo: ask the owner |

**Validate the Sentry token, don't just check the file exists** — a present-but-
stale token fails the build at a late task:

```sh
mac run -n 'set -a && . ./.env.local && set +a &&
  curl -sS -o /dev/null -w "sentry HTTP %{http_code}\n" \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  https://sentry.io/api/0/organizations/gabriel-bermudez/projects/'
```

Anything but `200` is a stop.

## Step 2 — launch detached

**Never run the build attached (`mac run`, or a plain ssh).** A closing session
kills the process group, and an attached build dies with `** BUILD INTERRUPTED **
/ Process crashed` and **no `error:` line anywhere** — a signature that reads
like a linker crash and costs an hour of hunting a compiler bug that is not there
(measured 2026-08-17, SDK 57). `mac bg` runs the job detached, kept awake, with
its exit code recorded:

```sh
mac bg ios-build 'cd apps/mobile && set -a && . ../../.env.local && set +a &&
  npx eas build -p ios --profile production --local --non-interactive'
mac wait ios-build          # as a background command, never a polling loop
```

`mac wait` prints one line, and the log's end only on failure. For more, filter
— the log is ~1200 lines and will blow up context:

```sh
mac run -n 'grep -nE "❌|error:|Exit status|must be installed" ~/build-logs/fitness-tracker-pwa.ios-build.log \
  | grep -viE "npm warn|deprecated|RUN_EXPO_DOCTOR" | tail -10'
```

(`mac log ios-build 200` reads the raw end.)

## Step 3 — verify the artifact, gate on the exit code

Exit 0 from the build is necessary, not sufficient. The scripts are already in
the Mac clone (`mac sync`):

```sh
mac run -n 'node scripts/verify-mobile-artifact.mjs apps/mobile/build-<ts>.ipa'
```

It asserts all four nested targets, every required Info.plist key (a missing usage
string is a **crash**, not a warning), both `.lproj` bundles, the appex's
entitlements, and prints the runtime fingerprint **from the artifact** — the only
value `AGENTS.md` may record.

**Non-zero exit → do not submit. No exceptions**, and Step 4 runs as a *separate*
command conditional on this exit code. A new native capability adds its plist key
or entitlement to `scripts/native-expectations.json` in the same commit.

**Green metadata proves nothing about behaviour.** Every native surface needs
device QA — except Live Activities, which render in the Simulator.

## Step 4 — submit (only when asked; outward-facing)

```sh
mac run -n 'cd apps/mobile &&
  npx eas submit -p ios --profile production --path build-<ts>.ipa --non-interactive'
```

No credential overrides needed. ~3 minutes.

**Then verify in ASC — the CLI exit code has lied in both directions.** Apple
takes 5–15 min to process and the build is absent from `/v1/builds` until
ingestion starts, so poll (on the PC):

```sh
node -e "
import('file:///Z:/fitness-tracker-pwa/scripts/asc-client.mjs').then(async ({api, APP_ID}) => {
  const r = await api('GET', '/v1/builds?filter[app]='+APP_ID+'&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate');
  for (const b of r.data) console.log(b.attributes.version, b.attributes.processingState);
});"
```

`PROCESSING` is **not** terminal — wait for `VALID`.

**Do not touch an `IN_REVIEW` submission.** Swapping its build is cancel →
re-point → resubmit, the cancel is irreversible, and it cost ~19 h of queue
position once.

## After shipping

Prepend a row to `apps/mobile/docs/fingerprint-ledger.md`, replace the iOS row
of the current-state table in `apps/mobile/AGENTS.md` if a new binary shipped
(value read from the artifact), then `STATUS.md`. `app-version.json` needs no deploy: it is served
from Firestore, iOS derived hourly from Apple's public lookup (marketing
version), and `asc-release-version.mjs` records the version→build map for the
pre-2026-09-05 binaries at submission (`functions/src/app-version.ts`). **A
mobile fix reaches nobody until a binary ships** — name the cohort out loud
when reporting.
