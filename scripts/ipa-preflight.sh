#!/bin/zsh
# ipa-preflight.sh <ipa>: what every iOS build must pass before it goes to App Store Connect (TestFlight or review).
# Non-zero exit: don't upload. Each check is a build that once reached testers broken; see the mobile-release skill.
# Master copy: ~/.claude/skills/mobile-release/ipa-preflight.sh. Every app's scripts/ipa-preflight.sh is the same file.
set -u
IPA=${1:?usage: scripts/ipa-preflight.sh <ipa>}
[ -f "$IPA" ] || { echo "ipa-preflight: not found: $IPA"; exit 2; }
DEV=${DEVELOPER_DIR:-$(xcode-select -p)}
FILES=$(unzip -Z1 "$IPA")
APP=$(echo "$FILES" | grep -m1 -E '^Payload/[^/]+\.app/$')  # the app itself, not a watch app or extension inside it
PLIST=$(unzip -p "$IPA" "${APP}Info.plist" 2>/dev/null | plutil -p - 2>/dev/null)
[ -n "$APP" ] && [ -n "$PLIST" ] || { echo "ipa-preflight: no Payload/<name>.app/Info.plist in $IPA"; exit 2; }
fail=0
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }
val() { echo "$PLIST" | sed -n "s/^  \"$1\" => \"\(.*\)\"\$/\1/p"; }

echo "ipa-preflight $(basename "$IPA"): $(val CFBundleIdentifier) $(val CFBundleShortVersionString) ($(val CFBundleVersion))"

# iOS 27 kills an app without the UIScene life cycle at launch, before any JS runs; iOS 26 simulators never show it.
if echo "$PLIST" | grep -q '^  "UIApplicationSceneManifest" =>'; then ok 'UIScene life cycle (UIApplicationSceneManifest)'
else bad 'no UIApplicationSceneManifest: iOS 27 kills this app at launch (copy plugins/scene-lifecycle from Callbook)'; fi

# A beta Xcode's build can go to TestFlight but never to review; the release and beta build numbers look alike.
built=$(val DTXcodeBuild)
release=$(DEVELOPER_DIR=$DEV xcodebuild -version 2>/dev/null | awk '/Build version/ {print $3}')
if [ -n "$built" ] && [ "$built" = "$release" ] && [[ "$DEV" != *[Bb]eta* ]]; then ok "release Xcode ($built)"
else bad "built with Xcode $built; the release Xcode at $DEV is ${release:-unknown}: rebuild with DEVELOPER_DIR set to it"; fi

# Without crash reporting a tester's crash reaches nobody unless they tap Share (Inkvolt build 1).
# Linked statically (Ignia) or as Sentry.framework: look for the SDK's class in the executable or the framework.
EXE=$(val CFBundleExecutable)
if echo "$FILES" | grep -q "^${APP}Frameworks/Sentry.framework/" || unzip -p "$IPA" "${APP}${EXE}" | LC_ALL=C grep -qa SentrySDK; then
  ok 'Sentry SDK in the app'
else bad 'no Sentry SDK in the app: crash reporting is missing (wire @sentry/react-native as Callbook does)'; fi

# A debug or dev-client build has no embedded JS and shows a red screen away from Metro.
if echo "$FILES" | grep -qxF "${APP}main.jsbundle"; then ok 'embedded JS bundle (Release build)'
else bad 'no main.jsbundle: this is a debug build, it needs Metro to start'; fi

[ $fail -eq 0 ] && echo "ipa-preflight: passed" || echo "ipa-preflight: FAILED, do not upload"
exit $fail
