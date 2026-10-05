# S20 handoff — 1.2.5 binary (2026-10-04, evening)

## State
- main has local checkpoint commit(s), NOT pushed. app.json: version 1.2.5, userInterfaceStyle automatic, predictiveBackGestureEnabled true (both fingerprints moved — no OTAs from this tree for build 67 / vc 46).
- Native iOS added (agent): modules/rest-timer-activity, modules/intent-inbox, modules/chart-accessibility; targets/widget/RestActivityWidget.swift; targets/_shared/{RestActivity,LiveActivityIntents,IntentInbox,AppActionIntents}.swift; FastActivityWidget End button + ignia://?fast=1; plugins/withAppShortcutsLocalization.js adds pt-BR (native-expectations.json requires pt-BR.lproj). Glance.swift pt-BR strings added by lead.
- Verified on Ignia-QA-26 sim: native formSheet (portal: src/lib/sheet-portal.ts + src/app/sheet.tsx), discard guard, ContextMenu (src/components/ContextMenu.tsx over expo-router native views; Link's display:contents hid rows from VoiceOver), dark mode, fit sheets above keyboard.
- What's new: items+copy written (hold/charts/offlineTrain) in 3 locales; WHATS_NEW_VERSION NOT yet bumped (bump right before the release build; it auto-opens and breaks Maestro).
- ASC release notes for 1.2.5 written in scripts/asc-release-version.mjs (mentions Lock Screen rest timer — keep only if Live Activity QA passes).

## In flight
- Regression agent fixing iOS Maestro suite (first run 3/21 passed; mostly flow drift: Maestro `back` is a no-op on iOS, grouped a11y labels, new routes).
- Android: prebuilt --clean, patched vc 47 production, `assembleRelease` running (/tmp/ignia/android-build.log). OnePlus on adb: 100.118.248.45:5555 (attach: zsh ~/Repos/poolflow/apps/mobile/scripts/phone.sh). Phone has local vc46 (installer pc) → upgrade in place.
- After any Gradle build: restore node_modules/@react-native-masked-view/masked-view/android/src/main/AndroidManifest.xml (npm ci or npm pack one-liner in docs/COMMANDS.md) before iOS fingerprint/build.

## Next (iOS ship)
1. Regression green → commit.
2. QA Live Activities on 2nd sim Ignia-QA (1E0A19F8-064D-485E-8CD0-81E76EE29C6D, iOS 27): app from /tmp/ignia/dd-native/... installed; sign in with .maestro/android-signin.yaml -e EMAIL=qa-test@ignia.fit -e PASSWORD="$(cat ~/qa-pass.txt)".
3. Bump WHATS_NEW_VERSION (e.g. '2026-10-05-native'), commit.
4. build-ios skill: preflight (disk ≥17GB, Sentry token 200), detached `eas build -p ios --profile production --local`, verify-mobile-artifact.mjs, `eas submit -p ios`, poll ASC VALID, `node scripts/asc-release-version.mjs --version 1.2.5 --build <N> --submit` (AFTER_APPROVAL default).
5. Fresh reviewer re-score of Today/add-meal/Train/Trends/Body; docs (UX_AUDIT S20, CHANGELOG, STATUS, fingerprint ledger, AGENTS table).
6. Android: install APK on OnePlus, test predictive back + sheets; then production AAB (bundleRelease vc 47) → play-upload-bundle.mjs → production promote.

## Review scores (start of S20)
Today 87.5, add-meal 87.8, Train 67, Trends 69.5, Body 71 (each agent implemented its list).
