---
name: build-ios
description: Build and optionally submit an iOS binary on the MacBook Air (`ignia-mac`) over SSH, or decide that a JS-only change needs no build at all — a local EAS build that costs no EAS quota and no cloud queue. Use for "cut an iOS build", "build for TestFlight", "ship the iPhone app", or whenever a mobile fix needs to reach iOS testers. Android is the `build-android` skill (also local, also on the Mac).
---

# Build iOS on the Mac

`eas build -p ios --profile production --local` on `ignia-mac`, driven headlessly
over SSH. **Costs zero EAS build quota and skips the free-tier queue** — the two
reasons this path exists. A failure here is cheap; a failed cloud build costs a
queue slot and up to two hours of waiting.

The runbook lives in `docs/DEV_ENVIRONMENT.md` **§3.8** (SSH setup) and **§3.10**
(archiving, prerequisites, power). Read §3.10 before debugging any build failure —
every failure seen so far is already written down there.

## First: do you need a build at all?

**A JS/TS-only change needs no binary on either platform.** EAS Update ships it in
seconds. Run the fingerprint gate before assuming otherwise — an update published
against a changed fingerprint SUCCEEDS and reaches nobody:

```sh
cd apps/mobile && npx expo-updates fingerprint:generate --platform ios
```

Unchanged hash → go to **`build-android` skill, Step 2**, which owns the full OTA
procedure for *both* platforms (`eas update` publishes for both at once). Do not
re-derive it here; one copy, and that is where it lives.

**Two things from there that are easy to miss on iOS specifically:**

- **Bump the what's-new banner** (`apps/mobile/src/lib/whatsNew.ts` →
  `WHATS_NEW_VERSION`, plus `whatsNew.body` in both locales). App Store "What's
  New" attaches to **binary releases only**, so for an OTA it is the only thing a
  user ever sees. Changing the copy without bumping the constant shows nobody
  anything.
- **A device is OTA-capable only once it is RUNNING a binary containing
  `expo-updates`** — iOS build 24 (2026-08-07) is the first. Testers on anything
  older must install from TestFlight once.

Everything below is for changes that genuinely touch the native surface.

## Step 1 — preflight (always; it is seconds and it has caught real blockers)

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git log --oneline -1 && git status --short | head -5
node -v; which fastlane
xcrun simctl list runtimes | grep -ci ios
df -h / | awk 'NR==2{print \$4\" free\"}'"

cd apps/mobile && ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx eas whoami"
```

Every line must answer:

| Check | Required | If it fails |
|---|---|---|
| `git status` clean | yes | `git stash push -u` — prebuild leaves artifacts (`targets/**/Info.plist`, a rewritten `package.json`); they are generated, safe to stash |
| repo at origin/main | yes | `git pull --ff-only` |
| `which fastlane` | yes | `brew install fastlane` — **never** the gem (§3.9: system Ruby has a broken `ffi`) |
| iOS runtimes count > 0 | yes | `sudo xcodebuild -downloadPlatform iOS` — see §3.10; an empty list means the platform component is missing even though `-showsdks` lists the SDK |
| disk ≥ 25 GB | yes | clear DerivedData: `rm -rf ~/Library/Developer/Xcode/DerivedData/*` |
| `eas whoami` | yes | copy `~/.expo/state.json` from the workstation (owner must run the `scp`) |
| `.env.local` on the Mac | for shippable builds | carries `SENTRY_AUTH_TOKEN`; without it the source-map upload phase runs tokenless |

**Validate the Sentry token rather than checking the file exists** — a present-but-stale
token fails the build, which is exactly how Android build `9e3df4e3` died:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && set -a && . ./.env.local && set +a &&
  curl -sS -o /dev/null -w 'sentry HTTP %{http_code}\n' \
  -H \"Authorization: Bearer \$SENTRY_AUTH_TOKEN\" \
  https://sentry.io/api/0/organizations/gabriel-bermudez/projects/"
```

Anything but `200` is a stop.

## Step 2 — launch detached, with a sentinel

**Never run the build in the foreground of an SSH session** — the connection dropping
kills it, and §3.9 is explicit that a dead SSH and a finished process are
indistinguishable to a `pgrep` check. Write a wrapper that prints an explicit sentinel:

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
```

`caffeinate -dims` is **not optional**: the dock can drop power delivery while still
working as a dock (§3.10), which puts the Air on battery where sleep is allowed.

Then poll for the sentinel — a background `until` loop, not a fixed sleep:

```sh
until ssh ignia-mac "grep -q IGNIA_BUILD_EXIT ~/ios-build.log" 2>/dev/null; do sleep 60; done
```

A green build takes **~16 minutes**. A prerequisite failure takes under three, so a
fast exit means "read the log", not "something went badly wrong".

On failure, filter the log — it is ~1200 lines and will blow up context:

```sh
ssh ignia-mac "grep -nE '❌|error:|Exit status|must be installed' ~/ios-build.log \
  | grep -viE 'npm warn|deprecated|RUN_EXPO_DOCTOR' | tail -10"
```

`expo-doctor` reporting 17/18 on `@types/jest` is **known and non-fatal** — ignore it.

## Step 3 — verify the artifact, not just the exit code

Exit 0 is necessary, not sufficient. **Confirm all four targets nest correctly**; a
silently-dropped watch app or widget still exits 0:

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && rm -rf /tmp/ipacheck &&
  mkdir -p /tmp/ipacheck && unzip -q build-*.ipa -d /tmp/ipacheck &&
  find /tmp/ipacheck/Payload -name '*.app' -o -name '*.appex' | sed 's|/tmp/ipacheck/Payload/||' &&
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' \
    /tmp/ipacheck/Payload/Ignia.app/Info.plist"
```

Expected shape:

```
Ignia.app
Ignia.app/PlugIns/Today.appex                           ← iOS widget
Ignia.app/Watch/IgniaWatch.app                          ← watch app
Ignia.app/Watch/IgniaWatch.app/PlugIns/IgniaWatchComplication.appex
```

## Step 4 — submit (only when asked; this is outward-facing)

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile &&
  npx eas submit -p ios --profile production --path build-<ts>.ipa --non-interactive"
```

Needs **no** credential overrides — submit uses its own working EAS-held key
(`R34S5HG5GX`), unlike the cloud *build* path. Takes ~3 minutes.

**Then verify in ASC, because the CLI exit code has lied in both directions** — it
reported failure for build 19 when the upload had succeeded. Apple takes 5–15 min to
process, and the build is absent from `/v1/builds` until ingestion starts:

```sh
node -e "
import('file:///Z:/macro-app/scripts/asc-client.mjs').then(async ({api, APP_ID}) => {
  const r = await api('GET', '/v1/builds?filter[app]='+APP_ID+'&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate');
  for (const b of r.data) console.log(b.attributes.version, b.attributes.processingState);
});"
```

`PROCESSING` is **not** terminal — wait for `VALID`.

## Things that will bite

- **`autoIncrement: true` burns a build number per ATTEMPT, including failures.** Three
  failed runs consumed 20/21/22 before the first green build landed on 23. Harmless
  (ASC only needs increasing numbers) but the gaps are real.
- **`--local` does NOT hit the ASC 401** documented in `CLAUDE.local.md`. That is the
  *cloud* build path. No `EXPO_ASC_*` env vars, and **the ASC `.p8` never needs to go
  on the Mac**.
- **A mobile fix reaches nobody until a binary ships.** Merging is not shipping — say
  this out loud when reporting.
- **iOS only.** Android also builds on the Mac now — `build-android` skill and
  `DEV_ENVIRONMENT.md` §3.11 — and it is the *only* machine that can, since
  Windows cannot compile RN's New Architecture C++ at all (`MAX_PATH`). Android
  signs with `dev.keystore`, which now lives on **both** machines
  (`CLAUDE.local.md` — load-bearing app identity, disposal list there too).
- After shipping, update `STATUS.md` — it is the file that says what is true right now.
