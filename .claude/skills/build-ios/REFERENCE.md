# build-ios — evidence and incident history

`SKILL.md` carries the procedure and the rules. This file carries **why each rule
exists**. Read it when a rule looks arbitrary, when a failure is not covered by
the procedure, or before re-proposing something. `docs/DEV_ENVIRONMENT.md` §3.8
(SSH setup) and §3.10 (archiving, prerequisites, power) hold the machine runbook —
every build failure seen so far is already written down in §3.10.

---

## Why the artifact verifier exists

Step 3 used to be a list of prose instructions. In **one evening (2026-08-08)
three binaries shipped missing things those instructions covered**: build 34
dropped `es-PR.lproj` silently, and builds 38/39 lacked
`NSMicrophoneUsageDescription` — which crashes the app on its first mic tap,
because `expo-camera`'s `microphonePermission: false` *deletes* the key another
plugin wrote. Build 39 was submitted before being checked at all. The checks are
code now, and Step 4 runs as a separate command conditional on Step 3's exit code,
because combining them is exactly how 39 reached TestFlight.

**Verifying that metadata exists proves nothing about behaviour.** Build 27's
archive held a flawless `Metadata.appintents` — provider, both shortcuts, all
three intents, every phrase — on the binary that registered none of it on device.
An App Shortcut may not carry a **required** parameter: iOS validates the provider
at registration time, reports nothing when it fails, and one invalid shortcut
invalidates the whole provider, so the app simply never appears in Shortcuts.

**Live Activities are the one surface that does not need hardware** — they render
in the iOS Simulator, so an ActivityKit change can be exercised on the Mac at zero
quota. Everything else native has needed a real device.

**To check a symbol made it in, use `strings`, not `nm`.** The release binary is
stripped enough that `nm -gU` and `otool -o` return nothing for ObjC classes.
Swift also inlines string literals of ≤15 UTF-8 bytes, so a short constant
legitimately appears **once** where a longer one appears twice — a count of 1 is
not evidence of a missing copy.

---

## The fingerprint gate, iOS specifics

Full semantics live in `build-android/REFERENCE.md`. Two that bite on iOS:

- **Swift under `targets/` does NOT move the fingerprint** (measured 2026-08-08
  across two `.ipa`s: `QuickAddIntents.swift` changed, build 28 shipped it, hash
  byte-identical to 27's). So a Swift-only fix reads as "shippable over the air"
  and the resulting OTA contains no Swift at all.
- **`modules/*/ios` IS hashed**, though `targets/` is not — measured 2026-08-10.
  An Expo Module is a `dir:` source, so one line of Swift there moves the runtime.
  Build 44 changed both and came out on a new hash, stranding that morning's OTA.

Also: **generate on the Mac and after prebuild.** A Windows-generated iOS hash
matches no binary, and a pre-prebuild reading describes a tree the build
overwrites (measured 2026-08-17 on Android; same tooling).

---

## Build failures already diagnosed

- **`watchOS <version> must be installed in order to archive the scheme`** — iOS
  build 43 died here. The watchOS *simulator runtime* had been deleted in a disk
  sweep on the reasoning that the SDK surviving in Xcode.app was enough. The scheme
  embeds `IgniaWatch.app` and archiving needs the platform. §3.10 has the two
  checks that falsely look authoritative.
- **Swift block comments NEST.** `/**` … `*/` nests and backticks mean nothing to
  the lexer, so a literal `_shared/` + `*` inside a doc comment opens a nested
  comment that never closes. Reported as `unterminated '/*' comment` against the
  **last brace in the file**, hundreds of lines from the cause, cascading into
  `cannot find <Type> in scope` across every other target.
- **A stale `SENTRY_AUTH_TOKEN` fails the build**, because `@sentry/react-native`
  uploads source maps as a build task. Android build `9e3df4e3` died on an HTTP
  401 *after* a two-hour cloud queue. Validate it, do not check the file exists.
- **`expo-doctor` reporting one failed check is known and non-fatal** — currently
  `@expo/config-plugins`, which two config plugins peer-depend on.
- **`** BUILD INTERRUPTED **` / `Process crashed` is an SSH-attached build being
  signalled, not a toolchain failure.** Measured 2026-08-17 on the first SDK 57
  iOS attempt, run over a plain backgrounded `ssh … caffeinate -dims npx eas
  build` instead of the `nohup` wrapper below. It died at `Linking Ignia » Ignia`
  with no `error:` line anywhere in 2680 lines, 18 GB free, DerivedData empty and
  no OOM — a signature that reads exactly like a linker crash and sends you
  hunting a compiler bug that does not exist. **`caffeinate` is not a substitute
  for `nohup`**: it stops the Mac sleeping, it does not stop a closing SSH session
  from killing the process group. Use the detached wrapper, always.
  A second trap rides along: if the launching command ends with
  `echo "EXIT=$?" | tee -a`, the *pipeline* exits 0, so the caller reports success
  on a failed build. The sentinel in the log is what tells the truth — read it,
  not the ssh exit code.
- A prerequisite failure exits in under three minutes; a green build is ~13–16.
  **A fast exit means "read the log", not "something went badly wrong".**
  `› Linking Ignia/Today » Today` is the early signal the widget's Swift compiled.

---

## Submission

- **`--local` does NOT hit the ASC 401** documented in `CLAUDE.local.md` — that is
  the *cloud build* path only. Submit uses its own working EAS-held key
  (`R34S5HG5GX`), so no `EXPO_ASC_*` overrides and the ASC `.p8` never needs to go
  on the Mac. Credential failures cost no build quota; they happen before the
  build is created.
- **The submit CLI's exit code has lied in both directions** — it reported failure
  for build 19 when the upload had succeeded. Apple takes 5–15 min to process and
  the build is absent from `/v1/builds` until ingestion starts, so poll ASC rather
  than reading once. `PROCESSING` is not terminal; wait for `VALID`.
- **`autoIncrement: true` burns a build number per ATTEMPT**, failures included —
  builds 20/21/22 and 26 do not exist. Harmless, but the gaps are real.
- **Do not touch an `IN_REVIEW` submission.** Swapping its build is cancel →
  re-point → resubmit; the cancel is irreversible and cost ~19 h of queue position
  once. A build sitting on TestFlight cannot change what Apple is reviewing, so
  never describe it as "in review".
- **The EAS cloud worker is a third machine with a third fingerprint** — build 42
  reported a runtime matching neither host, so a cloud artifact ships under a
  runtime no installed binary matches. Build locally.

---

## After shipping

`app-version.json` must name the live **App Store** release, never a TestFlight
build, since pointing a store user at a build they cannot install is worse than
saying nothing. Since 2026-09-05 that is enforced in the cloud: iOS is read from
Apple's public lookup (only a released version appears there), and the build
number legacy clients compare on comes from the version→build map the release
script records (`functions/src/app-version.ts`). There is no static file.

**A mobile fix reaches nobody until a binary ships.** Merging is not shipping —
name the cohort out loud when reporting.
