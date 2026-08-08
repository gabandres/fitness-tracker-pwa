---
name: build-ios
description: Build and optionally submit an iOS binary on the MacBook Air (`ignia-mac`) over SSH, or decide that a JS-only change needs no build at all — a local EAS build that costs no EAS quota and no cloud queue. Use for "cut an iOS build", "build for TestFlight", "ship the iPhone app", or whenever a mobile fix needs to reach iOS testers. Android is the `build-android` skill (also local, also on the Mac).
---

# Build iOS on the Mac

`eas build -p ios --profile production --local` on `ignia-mac`, driven headlessly
over SSH. **Costs zero EAS build quota and skips the free-tier queue.** ~13–16
minutes green. `docs/DEV_ENVIRONMENT.md` **§3.8** (SSH setup) and **§3.10**
(archiving, prerequisites, power) hold the runbook — read §3.10 before debugging
any failure; every failure seen so far is already written down there.

## Step 0 — do you need a build at all?

**A JS/TS-only change needs no binary.** EAS Update ships it in seconds. Run the
fingerprint gate — **on `ignia-mac`, never on Windows**, because the fingerprint
is machine-dependent and a Windows number matches no binary:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git checkout main && git pull --ff-only"
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform ios" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).hash))"
```

**Unchanged hash → the `build-android` skill, Step 1 and Step 2**, which own the
gate's semantics and the full OTA procedure for *both* platforms (`eas update`
publishes for both at once). Do not re-derive them here.

**Two things from there that are easy to miss on iOS specifically:**

- **The gate answers "will an OTA reach these binaries", never "is an OTA
  sufficient".** Swift under `targets/` does **not** move the fingerprint
  (measured 2026-08-08 across two `.ipa`s), so a Swift-only fix reads as
  "shippable over the air" and the resulting update contains no Swift at all. If
  you touched `targets/` or `modules/`, you need a build regardless of the hash.
- **Bump the what's-new banner** (`apps/mobile/src/lib/whatsNew.ts` →
  `WHATS_NEW_VERSION`, plus `whatsNew.body` in both locales). App Store "What's
  New" attaches to **binary releases only**, so for an OTA the banner is the only
  thing a user ever sees, and changing the copy without bumping the constant shows
  nobody anything.

Everything below is for changes that genuinely touch the native surface.

## Step 1 — preflight (always; seconds, and it has caught real blockers)

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git log --oneline -1 && git status --short | head -5
node -v; which fastlane
xcrun simctl list runtimes | grep -ci ios
df -h / | awk 'NR==2{print \$4\" free\"}'"

ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas whoami"
```

| Check | Required | If it fails |
|---|---|---|
| `git status` clean | yes | `git stash push -u` — prebuild leaves generated artifacts; safe to stash |
| on the intended ref | yes | a branch is fine; record **which** in `STATUS.md` |
| `which fastlane` | yes | `brew install fastlane` — **never** the gem (§3.9: system Ruby has a broken `ffi`) |
| iOS runtimes count > 0 | yes | `sudo xcodebuild -downloadPlatform iOS`; an empty list means the platform component is missing even though `-showsdks` lists the SDK |
| disk | **~17 GB is enough** | 25 GB is the comfortable figure; a build has completed at 17 GB with ~1 GB of headroom left. Clear `~/Library/Developer/Xcode/DerivedData/*` first — cheaper to lose than `~/.gradle` (5.5 GB), which Android needs |
| `eas whoami` | yes | copy `~/.expo/state.json` from the workstation (owner must run the `scp`) |
| `.env.local` on the Mac | for shippable builds | carries `SENTRY_AUTH_TOKEN` |

**Validate the Sentry token rather than checking the file exists** — a
present-but-stale token fails the build, which is how Android build `9e3df4e3`
died after a two-hour queue:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && set -a && . ./.env.local && set +a &&
  curl -sS -o /dev/null -w 'sentry HTTP %{http_code}\n' \
  -H \"Authorization: Bearer \$SENTRY_AUTH_TOKEN\" \
  https://sentry.io/api/0/organizations/gabriel-bermudez/projects/"
```

Anything but `200` is a stop.

## Step 2 — launch detached, with a sentinel

**Never run the build in the foreground of an SSH session** — the connection
dropping kills it, and §3.9 is explicit that a dead SSH and a finished process are
indistinguishable to a `pgrep` check.

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

`caffeinate -dims` is **not optional**: the dock can drop power delivery while
still working as a dock (§3.10), which puts the Air on battery where sleep is
allowed.

A green build takes **~13–16 minutes**. A prerequisite failure takes under three,
so a fast exit means "read the log", not "something went badly wrong".
`› Linking Ignia/Today » Today` in the log is the useful early signal that the
widget extension's Swift compiled.

On failure, filter the log — it is ~1200 lines and will blow up context:

```sh
ssh ignia-mac "grep -nE '❌|error:|Exit status|must be installed' ~/ios-build.log \
  | grep -viE 'npm warn|deprecated|RUN_EXPO_DOCTOR' | tail -10"
```

`expo-doctor` reporting 17/18 on `@types/jest` is **known and non-fatal**.

## Step 3 — verify the artifact, not just the exit code

Exit 0 is necessary, not sufficient. A silently-dropped watch app or widget still
exits 0.

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && rm -rf /tmp/ipacheck &&
  mkdir -p /tmp/ipacheck && unzip -q build-<ts>.ipa -d /tmp/ipacheck &&
  find /tmp/ipacheck/Payload -name '*.app' -o -name '*.appex' | sed 's|/tmp/ipacheck/Payload/||' &&
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' \
    /tmp/ipacheck/Payload/Ignia.app/Info.plist &&
  cat /tmp/ipacheck/Payload/*.app/EXUpdates.bundle/fingerprint"
```

Expected shape:

```
Ignia.app
Ignia.app/PlugIns/Today.appex                           ← iOS widget
Ignia.app/Watch/IgniaWatch.app                          ← watch app
Ignia.app/Watch/IgniaWatch.app/PlugIns/IgniaWatchComplication.appex
```

The fingerprint printed here is **the** value to record in `AGENTS.md`. Never a
locally generated hash.

**To check that a specific symbol made it in, use `strings`, not `nm`.** The
release binary is stripped enough that `nm -gU` and `otool -o` return nothing for
ObjC classes. Note also that Swift inlines string literals of ≤15 UTF-8 bytes, so
a short constant legitimately appears **once** where a longer one appears twice —
a count of 1 is not evidence of a missing copy.

**Verifying that metadata exists proves nothing about behaviour.** Build 27's
archive held a flawless `Metadata.appintents` — provider, both shortcuts, all
three intents, every phrase — on the binary that registered none of it on device.
Every native surface needs device or simulator QA; the archive cannot substitute.

**Live Activities are the exception worth knowing**: they render in the iOS
Simulator, so an ActivityKit surface can be exercised on the Mac at no quota
before or instead of trusting a binary. Every other native surface here has
needed real hardware.

## Step 4 — submit (only when asked; this is outward-facing)

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile &&
  npx eas submit -p ios --profile production --path build-<ts>.ipa --non-interactive"
```

Needs **no** credential overrides — submit uses its own working EAS-held key
(`R34S5HG5GX`), unlike the cloud *build* path. Takes ~3 minutes.

**Then verify in ASC, because the CLI exit code has lied in both directions** — it
reported failure for build 19 when the upload had succeeded. Apple takes 5–15 min
to process, and the build is absent from `/v1/builds` until ingestion starts, so
poll rather than reading once:

```sh
node -e "
import('file:///Z:/macro-app/scripts/asc-client.mjs').then(async ({api, APP_ID}) => {
  const r = await api('GET', '/v1/builds?filter[app]='+APP_ID+'&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate');
  for (const b of r.data) console.log(b.attributes.version, b.attributes.processingState);
});"
```

`PROCESSING` is **not** terminal — wait for `VALID`.

## Things that will bite

- **`autoIncrement: true` burns a build number per ATTEMPT, including failures.**
  Builds 20/21/22 and 26 do not exist. Harmless — ASC only needs increasing
  numbers — but the gaps are real, and the same applies to Android versionCodes.
- **Swift block comments NEST.** `/**` … `*/` nests and backticks mean nothing to
  the lexer, so a literal `_shared/` + `*` inside a doc comment opens a nested
  comment that never closes. It is reported as `unterminated '/*' comment` against
  the **last brace in the file**, hundreds of lines from the cause, and cascades
  into `cannot find <Type> in scope` across every other target.
- **`--local` does NOT hit the ASC 401** documented in `CLAUDE.local.md`. That is
  the *cloud* build path. No `EXPO_ASC_*` env vars, and the ASC `.p8` never needs
  to go on the Mac.
- **Do not touch an `IN_REVIEW` submission.** Swapping its build is cancel →
  re-point → resubmit; the cancel is irreversible and it already cost ~19 h of
  queue position once. A build sitting on TestFlight cannot change what Apple is
  reviewing, so never describe it as "in review".
- **A mobile fix reaches nobody until a binary ships.** Merging is not shipping —
  say which cohort, out loud, when reporting.
- After shipping: update the fingerprint table in `apps/mobile/AGENTS.md` and then
  `STATUS.md`, which is the file that says what is true right now. `ios.latestBuild`
  in `public/app-version.json` stays `0` on purpose — it must name the live **App
  Store** build, never a TestFlight one.
