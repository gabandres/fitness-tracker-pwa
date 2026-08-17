---
name: build-ios
description: Build and optionally submit an iOS binary on the MacBook Air (`ignia-mac`) over SSH, or decide that a JS-only change needs no build at all — a local EAS build that costs no EAS quota and no cloud queue. Use for "cut an iOS build", "build for TestFlight", "ship the iPhone app", or whenever a mobile fix needs to reach iOS testers. Android is the `build-android` skill, and it builds on the WINDOWS workstation — the Air is iOS-only since 2026-08-17.
---

# Build iOS on the Mac

`eas build -p ios --profile production --local` on `ignia-mac`, driven headlessly
over SSH. **Zero EAS quota, no cloud queue.** ~13–16 minutes green.

`REFERENCE.md` in this directory holds the evidence behind every rule below.
`docs/DEV_ENVIRONMENT.md` §3.8 and §3.10 hold the machine runbook — **read §3.10
before debugging any build failure**; every one seen so far is already there.

## Step 0 — do you need a build at all?

**A JS/TS-only change needs no binary.** Gate first, **on the Mac** (the hash is
machine-dependent) and **after prebuild**:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git checkout main && git pull --ff-only"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform ios" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hash))"
```

**Unchanged hash → `build-android` Steps 1–2**, which own the gate semantics and
the OTA procedure for both platforms. Do not re-derive them here. Note the OTA is
now **per-platform**: `--platform ios` from the Mac, and `--environment` is
required from SDK 55 on.

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

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git log --oneline -1 && git status --short | head -5
node -v; which fastlane
xcrun simctl list runtimes | grep -ci ios
df -h /System/Volumes/Data | awk 'NR==2{print \$4\" free\"}'"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas whoami"
```

| Check | If it fails |
|---|---|
| `git status` clean | `git stash push -u` — prebuild leaves generated artifacts |
| on the intended ref | a branch is fine; record **which** in `STATUS.md` |
| `which fastlane` | `brew install fastlane` — **never** the gem (system Ruby has a broken `ffi`) |
| iOS runtimes > 0 | `sudo xcodebuild -downloadPlatform iOS`. **watchOS runtime is also required** — the scheme embeds `IgniaWatch.app` and archiving needs the platform |
| disk ≥ ~17 GB | clear `~/Library/Developer/Xcode/DerivedData/*`. The Air is iOS-only now, so the whole disk is iOS's |
| `eas whoami` | copy `~/.expo/state.json` from the workstation (owner runs the `scp`) |

**Validate the Sentry token, don't just check the file exists** — a present-but-
stale token fails the build at a late task:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && set -a && . ./.env.local && set +a &&
  curl -sS -o /dev/null -w 'sentry HTTP %{http_code}\n' \
  -H \"Authorization: Bearer \$SENTRY_AUTH_TOKEN\" \
  https://sentry.io/api/0/organizations/gabriel-bermudez/projects/"
```

Anything but `200` is a stop.

## Step 2 — launch detached, with a sentinel

**Never run the build in an SSH foreground, and `caffeinate` is not a substitute
for `nohup`.** Caffeinate stops the Mac sleeping; it does not stop a closing SSH
session from killing the process group. An SSH-attached build dies with
`** BUILD INTERRUPTED ** / Process crashed` and **no `error:` line anywhere** —
a signature that reads like a linker crash and costs an hour of hunting a
compiler bug that is not there (measured 2026-08-17, SDK 57).

```sh
ssh ignia-mac "cat > ~/run-ios-build.sh <<'EOF'
#!/bin/zsh
cd ~/fitness-tracker-pwa/apps/mobile || exit 90
set -a; . ~/fitness-tracker-pwa/.env.local; set +a
echo \"IGNIA_BUILD_START \$(date -u +%FT%TZ)\"
npx eas build -p ios --profile production --local --non-interactive
echo \"IGNIA_BUILD_EXIT=\$?\"
EOF
chmod +x ~/run-ios-build.sh
rm -f ~/ios-build.log
nohup caffeinate -dims ~/run-ios-build.sh > ~/ios-build.log 2>&1 &
echo launched"

until ssh ignia-mac "grep -q IGNIA_BUILD_EXIT ~/ios-build.log" 2>/dev/null; do sleep 60; done
```

`caffeinate -dims` is **not optional** — the dock can drop power while still
working as a dock, putting the Air on battery where sleep is allowed.

On failure, filter the log — it is ~1200 lines and will blow up context:

```sh
ssh ignia-mac "grep -nE '❌|error:|Exit status|must be installed' ~/ios-build.log \
  | grep -viE 'npm warn|deprecated|RUN_EXPO_DOCTOR' | tail -10"
```

## Step 3 — verify the artifact, gate on the exit code

Exit 0 from the build is necessary, not sufficient.

```sh
scp scripts/verify-mobile-artifact.mjs scripts/native-expectations.json ignia-mac:/tmp/
ssh ignia-mac "node /tmp/verify-mobile-artifact.mjs ~/fitness-tracker-pwa/apps/mobile/build-<ts>.ipa"
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
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile &&
  npx eas submit -p ios --profile production --path build-<ts>.ipa --non-interactive"
```

No credential overrides needed. ~3 minutes.

**Then verify in ASC — the CLI exit code has lied in both directions.** Apple
takes 5–15 min to process and the build is absent from `/v1/builds` until
ingestion starts, so poll:

```sh
node -e "
import('file:///Z:/macro-app/scripts/asc-client.mjs').then(async ({api, APP_ID}) => {
  const r = await api('GET', '/v1/builds?filter[app]='+APP_ID+'&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate');
  for (const b of r.data) console.log(b.attributes.version, b.attributes.processingState);
});"
```

`PROCESSING` is **not** terminal — wait for `VALID`.

**Do not touch an `IN_REVIEW` submission.** Swapping its build is cancel →
re-point → resubmit, the cancel is irreversible, and it cost ~19 h of queue
position once.

## After shipping

Update the fingerprint table in `apps/mobile/AGENTS.md` (value read from the
artifact), then `STATUS.md`. `ios.latestBuild` in `public/app-version.json` is
derived from the **App Store** version in `READY_FOR_SALE`, never a TestFlight
build. **A mobile fix reaches nobody until a binary ships** — name the cohort out
loud when reporting.
