#!/bin/zsh
# aab-preflight.sh <aab>: what every Android build must pass before it goes to Play (internal testing or production).
# Non-zero exit: don't upload. Needs bundletool and keytool (both on the Mac). See the mobile-release skill.
# Master copy: ~/.claude/skills/mobile-release/aab-preflight.sh. Every app's scripts/aab-preflight.sh is the same file.
set -u
export PATH=/opt/homebrew/opt/openjdk@17/bin:/opt/homebrew/bin:$PATH  # keytool and bundletool, also when run over ssh
for t in keytool bundletool; do command -v $t >/dev/null || { echo "aab-preflight: $t not found"; exit 2; }; done
AAB=${1:?usage: scripts/aab-preflight.sh <aab>}
[ -f "$AAB" ] || { echo "aab-preflight: not found: $AAB"; exit 2; }
FILES=$(unzip -Z1 "$AAB")
manifest() { bundletool dump manifest --bundle "$AAB" --xpath "$1" 2>/dev/null; }
fail=0
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }

echo "aab-preflight $(basename "$AAB"): $(manifest /manifest/@package) $(manifest /manifest/@android:versionName) ($(manifest /manifest/@android:versionCode)), targetSdk $(manifest /manifest/uses-sdk/@android:targetSdkVersion)"

# Play refuses a debug-signed upload; the upload key's certificate is the app's own.
CERT=$(echo "$FILES" | grep -m1 -E '^META-INF/[^/]+\.(RSA|EC|DSA)$')
SIGNER=$([ -n "$CERT" ] && unzip -p "$AAB" "$CERT" | keytool -printcert 2>/dev/null | sed -n 's/^Owner: //p' | head -1)
if [ -z "$SIGNER" ]; then bad 'not signed'
elif [[ "$SIGNER" == *"Android Debug"* ]]; then bad "signed with the debug key ($SIGNER): Play rejects it"
else ok "signed by $SIGNER"; fi

if [ "$(manifest /manifest/application/@android:debuggable)" = "true" ]; then bad 'android:debuggable="true": a debug build'
else ok 'not debuggable'; fi

# A debug or dev-client build has no embedded JS and needs Metro to start.
if echo "$FILES" | grep -qx 'base/assets/index.android.bundle'; then ok 'embedded JS bundle (Release build)'
else bad 'no base/assets/index.android.bundle: this is a debug build'; fi

# Without crash reporting a tester's crash reaches nobody.
if echo "$FILES" | grep -E '^base/dex/classes[0-9]*\.dex$' | while read -r dex; do unzip -p "$AAB" "$dex"; done | LC_ALL=C grep -qa 'Lio/sentry/'; then
  ok 'Sentry SDK in the app'
else bad 'no Sentry SDK in the app: crash reporting is missing (wire @sentry/react-native as Callbook does)'; fi

# Play requires 16 KB page support (Android 15+ devices): every arm64 native library's LOAD segments aligned to 16 KB.
LIBS=$(echo "$FILES" | grep -E '^base/lib/arm64-v8a/.+\.so$')
UNALIGNED=$(echo "$LIBS" | while read -r so; do [ -n "$so" ] || continue
  unzip -p "$AAB" "$so" | python3 -c '
import struct, sys
b = sys.stdin.buffer.read()
if b[:4] != b"\x7fELF" or b[4] != 2: sys.exit(0)
phoff, = struct.unpack_from("<Q", b, 0x20); phentsize, phnum = struct.unpack_from("<HH", b, 0x36)
aligns = [struct.unpack_from("<Q", b, phoff + i * phentsize + 0x30)[0] for i in range(phnum) if struct.unpack_from("<I", b, phoff + i * phentsize)[0] == 1]
sys.exit(1 if aligns and min(aligns) < 0x4000 else 0)' || echo "${so##*/}"; done)
if [ -z "$LIBS" ]; then ok 'no arm64 native libraries'
elif [ -z "$UNALIGNED" ]; then ok "16 KB page aligned ($(echo "$LIBS" | wc -l | tr -d ' ') arm64 libraries)"
else bad "not 16 KB page aligned, Play rejects it: $(echo $UNALIGNED | tr '\n' ' ')"; fi

[ $fail -eq 0 ] && echo "aab-preflight: passed" || echo "aab-preflight: FAILED, do not upload"
exit $fail
