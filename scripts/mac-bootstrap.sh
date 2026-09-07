#!/bin/bash
# Bootstrap a FRESH macOS install into `ignia-mac`, the dedicated iOS build box.
# Runbook + ordering gates: docs/DEV_ENVIRONMENT.md §3.15. Idempotent — rerun freely.
#
# Run it from Windows against the fresh Mac (Remote Login already ON, the
# Windows key already in ~/.ssh/authorized_keys — the two physical steps):
#
#   ssh -t ignia-mac 'SENTRY_AUTH_TOKEN=<tok> bash -s' < scripts/mac-bootstrap.sh
#
# `-t` matters: Homebrew, pmset, the LaunchDaemon, Xcode's first launch and the
# platform downloads all go through sudo, and `eas login` is interactive.
# Xcode itself is NOT installed here — it comes from the App Store (Apple ID,
# GUI) or a developer.apple.com .xip; the script refuses to continue without it.
set -euo pipefail

REPO_URL="https://github.com/gabandres/fitness-tracker-pwa.git"
REPO_DIR="$HOME/fitness-tracker-pwa"
NODE_VERSION="24.12.0"                       # .nvmrc — a dedicated box has no reason to stay on 22
EXPECTED_IOS_FINGERPRINT="${EXPECTED_IOS_FINGERPRINT:-52802bba95ac0ac3f4cfd053d6ee61c354cc18d9}"  # build 64
WINDOWS_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMvWPFwbcvYTHl3rPeVI46d7pcqk7GkssktbQyzhMnBa ignia-build@windows'

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

step "0. Xcode present?"
if [ ! -d /Applications/Xcode.app ]; then
  echo "Xcode is not installed. Install Xcode 26.6 (NOT the 27 beta; SDK 57's floor is 26.4)"
  echo "from the App Store or a developer.apple.com .xip, then rerun." >&2
  exit 1
fi
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version | head -1

step "1. Homebrew"
if ! command -v /opt/homebrew/bin/brew >/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"
# fastlane: eas build --local archives through gym; cocoapods on Homebrew Ruby (the system
# Ruby's ffi is broken); openjdk+bundletool for Maestro/aab reads; jq for the gate below.
brew install fnm cocoapods fastlane gh openjdk bundletool jq tailscale
# Open-source tailscaled: headless-friendly (`tailscale up` prints an auth URL).
# Fallback if it misbehaves: `brew install --cask tailscale-app` and sign in in the GUI.

step "2. Node ${NODE_VERSION} via fnm"
eval "$(fnm env)"
fnm install "$NODE_VERSION"
fnm default "$NODE_VERSION"

step "3. ~/.zshenv (non-interactive SSH sources ONLY this file)"
cat > "$HOME/.zshenv" <<'EOF'
# Non-interactive ssh does NOT source .zprofile; .zshenv is sourced for every
# zsh invocation, so remote build commands find brew tools without a PATH export.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.maestro/bin:$PATH"
eval "$(fnm env)"
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
EOF

step "4. Maestro"
[ -x "$HOME/.maestro/bin/maestro" ] || curl -fsSL https://get.maestro.mobile.dev | bash

step "5. SSH key + never sleep on AC (Wi-Fi-only box: a sleeping Mac is unreachable)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
grep -qF "$WINDOWS_KEY" "$HOME/.ssh/authorized_keys" 2>/dev/null || echo "$WINDOWS_KEY" >> "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
sudo pmset -c sleep 0 disksleep 0 displaysleep 0
sudo pmset -c disablesleep 1                 # AC only — lid-close must not sleep it; battery keeps stock
sudo tee /Library/LaunchDaemons/fit.ignia.nosleep.plist >/dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>fit.ignia.nosleep</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
sudo launchctl bootout system/fit.ignia.nosleep 2>/dev/null || true
sudo launchctl bootstrap system /Library/LaunchDaemons/fit.ignia.nosleep.plist

step "6. Tailscale — same tailnet as Windows (gabandres@), or neither side sees the other"
sudo brew services start tailscale || true
if ! tailscale status >/dev/null 2>&1; then
  # TS_AUTHKEY (a pre-auth key from the admin console) makes this unattended; without it a URL prints.
  sudo tailscale up ${TS_AUTHKEY:+--auth-key "$TS_AUTHKEY"} --hostname ignia-mac
fi
tailscale status | head -3

step "7. Xcode platform components (~7 GB; an archive needs BOTH, -showsdks lies)"
sudo xcodebuild -downloadPlatform iOS
sudo xcodebuild -downloadPlatform watchOS

step "8. Repo — npm ci ONLY on the Mac; the lockfile is written on Windows"
[ -d "$REPO_DIR/.git" ] || git clone "$REPO_URL" "$REPO_DIR"
cd "$REPO_DIR" && git checkout main && git pull --ff-only && npm ci
if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  printf 'SENTRY_AUTH_TOKEN=%s\n' "$SENTRY_AUTH_TOKEN" > .env.local && chmod 600 .env.local
elif [ ! -f .env.local ]; then
  echo "!! .env.local missing — rerun with SENTRY_AUTH_TOKEN=... or write it by hand (mode 600)."
fi

step "9. EAS session"
cd "$REPO_DIR/apps/mobile"
if ! npx eas whoami >/dev/null 2>&1; then
  if [ -t 0 ]; then npx eas login; else echo "!! no tty — run 'npx eas login' over ssh -t, or set EXPO_TOKEN."; fi
fi
npx eas whoami || true

step "10. Verify — the four-command check proves prebuild; fastlane + destinations prove an archive can run"
node -v; npm -v; pod --version; fastlane --version 2>/dev/null | tail -1; xcodebuild -version | head -1
FP=$(npx expo-updates fingerprint:generate --platform ios | jq -r .hash)
echo "ios fingerprint: $FP"
if [ "$FP" = "$EXPECTED_IOS_FINGERPRINT" ]; then
  echo "MATCHES the live binary — the iOS OTA channel carries over; no new build needed for that."
else
  echo "!! DIFFERS from $EXPECTED_IOS_FINGERPRINT — cut a new iOS binary from THIS host before"
  echo "!! publishing any iOS OTA from it (docs/DEV_ENVIRONMENT.md §3.15)."
fi
echo
echo "Next: one full 'eas build --local' via the build-ios skill to prove the archive path end to end."
