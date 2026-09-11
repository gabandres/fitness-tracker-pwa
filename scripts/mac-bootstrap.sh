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
# platform downloads all go through sudo; `eas login`, `fdesetup disable` and the
# auto-login password prompt are interactive.
# Closed-lid, no-display, Ethernet-first, never-sleeps, comes-back-from-any-reboot
# is the target state (steps 5–5d); the reasoning is in §3.15.
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
# Apple's WWDR intermediates are NOT on a clean macOS (only the expired 2013 CA is), and Xcode adds
# them only when an Apple account signs in — which this box never does. Without them the
# distribution cert imports but never validates: "hasn't been imported successfully" (§3.10).
for c in AppleWWDRCAG3 AppleWWDRCAG4 AppleWWDRCAG6; do
  curl -sSfo "/tmp/$c.cer" "https://www.apple.com/certificateauthority/$c.cer" \
    && sudo security add-certificates -k /Library/Keychains/System.keychain "/tmp/$c.cer" 2>/dev/null || true
done
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version | sed -n 1p   # not head: SIGPIPE + pipefail killed the 2026-09-10 run here

step "1. Homebrew"
if ! command -v /opt/homebrew/bin/brew >/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"
# fastlane: eas build --local archives through gym; cocoapods on Homebrew Ruby (the system
# Ruby's ffi is broken); openjdk+bundletool for Maestro/aab reads; jq for the gate below.
brew install fnm cocoapods fastlane gh openjdk bundletool jq
# Tailscale: if the GUI app is already installed and signed in (the 2026-09-10 rebuild did it by
# hand), reuse it — a second, open-source tailscaled next to it fights over the tun device.
# Otherwise the open-source one is headless-friendly (`tailscale up` prints an auth URL).
[ -d /Applications/Tailscale.app ] || brew install tailscale

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

step "5. SSH key + never sleep on AC (closed lid, no display: a sleeping Mac is unreachable)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
grep -qF "$WINDOWS_KEY" "$HOME/.ssh/authorized_keys" 2>/dev/null || echo "$WINDOWS_KEY" >> "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
sudo pmset -c sleep 0 disksleep 0 displaysleep 0
sudo pmset -c disablesleep 1                 # AC only — lid-close must not sleep it; battery keeps stock
# -c, never -a: if the charger drops, a clean sleep that resumes on power beats a drained battery
# and a forced shutdown on a box nobody can see. womp = wake on network access (Ethernet only,
# and moot while it never sleeps); the two keepalives stop idle SSH/tmux sessions being reaped.
sudo pmset -c womp 1 tcpkeepalive 1 ttyskeepawake 1
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

step "5b. Ethernet first, Wi-Fi as fallback (a USB-C adapter on its own port; power stays on the Apple brick)"
# Service names are adapter-specific ("USB 10/100/1000 LAN", "Thunderbolt Ethernet", "AX88179A"…),
# so match by kind rather than name. No adapter plugged in: nothing changes, Wi-Fi keeps working.
WIRED=(); REST=()
while IFS= read -r svc; do
  svc="${svc#\*}"                                   # a leading * marks a disabled service
  [ -z "$svc" ] && continue
  if echo "$svc" | grep -qiE 'ethernet|lan|usb' && ! echo "$svc" | grep -qiE 'wi-?fi|bluetooth|bridge|vpn|tailscale'; then
    WIRED+=("$svc")
  elif [ "$svc" != "Wi-Fi" ]; then
    REST+=("$svc")
  fi
done < <(networksetup -listallnetworkservices | tail -n +2)
if [ "${#WIRED[@]}" -gt 0 ]; then
  networksetup -ordernetworkservices "${WIRED[@]}" "Wi-Fi" "${REST[@]}" 2>/dev/null \
    || echo "!! could not reorder services; do it in System Settings → Network → ⋯ → Set Service Order"
  echo "service order:"; networksetup -listnetworkserviceorder | grep -E '^\(' | head -4
else
  echo "no wired adapter detected — Wi-Fi only until one is plugged in (rerun afterwards)"
fi

step "5c. No unattended reboots: macOS updates and App Store auto-update OFF (Xcode would move to 27 on its own)"
sudo softwareupdate --schedule off
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -bool false
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled -bool true   # still SEE them
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate ConfigDataInstall -bool true       # XProtect etc., no reboot
sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false
# Apply updates yourself, over SSH, on your schedule: softwareupdate -l; sudo softwareupdate -i -a -R

step "5d. FileVault OFF + auto-login, so ANY reboot comes back on its own (the only physical trip left is a hard hang)"
# The box holds a Sentry token and an EAS session after the wipe — both revocable in minutes, no
# keystore — so encryption buys little and costs a typed password at every boot. Auto-login refuses
# to enable while FileVault is on, and decryption after `fdesetup disable` runs in the background,
# so this step is two runs apart on a disk that was encrypted: disable, wait, rerun.
if fdesetup status | grep -q 'FileVault is On'; then
  if [ -t 0 ]; then
    echo "FileVault is ON — disabling (asks for your login password; decryption continues in the background)."
    sudo fdesetup disable
    echo "!! Rerun this script once 'fdesetup status' says Off — auto-login cannot be set until then."
  else
    echo "!! FileVault is ON and there is no tty to disable it. Rerun over 'ssh -t'."
  fi
elif fdesetup status | grep -q 'Decryption in progress'; then
  echo "!! FileVault still decrypting; rerun later to set auto-login."
else
  if sysadminctl -autologin status 2>&1 | grep -qi "$USER"; then
    echo "auto-login already set for $USER"
  elif [ -t 0 ]; then
    echo "Enabling auto-login for $USER (needs the login password once; it is stored by macOS, not by this script):"
    read -rs -p "login password for $USER: " AUTOLOGIN_PW; echo
    sudo sysadminctl -autologin set -userName "$USER" -password "$AUTOLOGIN_PW"
    unset AUTOLOGIN_PW
    sysadminctl -autologin status 2>&1 | tail -1
  else
    echo "!! no tty — set auto-login later: sudo sysadminctl -autologin set -userName $USER -password <pw>"
  fi
fi

step "6. Tailscale — same tailnet as Windows (gabandres@), or neither side sees the other"
if [ -d /Applications/Tailscale.app ]; then
  # GUI app: expose its CLI so `tailscale status` works over SSH; the node is already up.
  # A wrapper, not a symlink: the app binary aborts ("bundleIdentifier is unknown to the registry")
  # when invoked through a symlink. Fresh macOS has no /usr/local/bin and it is not on this
  # non-interactive PATH, so create it and add it.
  sudo mkdir -p /usr/local/bin
  printf '#!/bin/sh
exec /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
' | sudo tee /usr/local/bin/tailscale >/dev/null
  sudo chmod 755 /usr/local/bin/tailscale
  export PATH="/usr/local/bin:$PATH"
else
  sudo brew services start tailscale || true
  if ! tailscale status >/dev/null 2>&1; then
    # TS_AUTHKEY (a pre-auth key from the admin console) makes this unattended; without it a URL prints.
    sudo tailscale up ${TS_AUTHKEY:+--auth-key "$TS_AUTHKEY"} --hostname ignia-mac
  fi
fi
tailscale status | sed -n 1,3p

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
node -v; npm -v; pod --version; fastlane --version 2>/dev/null | tail -1; xcodebuild -version | sed -n 1p
echo "power:    $(pmset -g | grep -E '^\s*(disablesleep|sleep|womp|tcpkeepalive)\b' | tr -s ' ' | tr '\n' ' ')"
echo "filevault: $(fdesetup status | head -1)   autologin: $(sysadminctl -autologin status 2>&1 | tail -1)"
echo "updates:  schedule $(softwareupdate --schedule | awk '{print $NF}')"
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
