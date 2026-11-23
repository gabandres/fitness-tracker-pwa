#!/bin/sh
# The check lives in @bermudez/mobile-kit (github.com/gabandres/mobile-kit, Z:\mobile-kit): one copy for every app.
# Change it there, tag a version, then move this app's pin in package.json.
kit="$(dirname "$0")/../node_modules/@bermudez/mobile-kit/ipa-preflight.sh"
[ -f "$kit" ] || { echo "ipa-preflight: @bermudez/mobile-kit is missing: npm install"; exit 2; }
if command -v zsh > /dev/null 2>&1; then exec zsh "$kit" "$@"; else exec bash "$kit" "$@"; fi
