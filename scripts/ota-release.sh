#!/usr/bin/env bash
# Publish the committed JS to both live runtimes, one runtime per command.
#
#   bash scripts/ota-release.sh [--dry-run] "<what changed>"
#
# Run it in Git Bash on the publishing machine (`winbox`), from a clean tree.
# It refuses rather than publish something no binary will take:
#   1. clean tree, and both runtime constants still in apps/mobile/AGENTS.md
#   2. core tests, mobile tsc and mobile jest green at this commit, and React
#      Compiler skipping no more functions than it did
#   3. the iOS tree fingerprint equals the live binary's
#   4. a real Android export, measured against scripts/perf-budget.json
# Then: publish iOS, pin app.json to the Android artifact runtime, publish
# Android, restore app.json, read both groups back from EAS and write the two
# ledger rows. `--dry-run` does 1-4 and the pin/restore, and publishes nothing.
#
# Why each step exists: the `build-android` skill. Rollback: `eas update:republish
# --group <the previous group>` per platform (the ledger row names it).
set -u

# The two binaries that take OTAs. A new binary changes these two blocks AND
# the table in apps/mobile/AGENTS.md; step 1 fails until both agree.
IOS_RT="e6d2973e85038818ae56e1db6d9bd0fe1aaa016c"
IOS_BIN="build 75 / 1.2.11"
AND_RT="e989353d992e38a829ca883290f99d5ad08d4479"
AND_BIN="vc 53 / 1.2.10"
# Functions React Compiler skips today (apps/mobile/scripts/react-compiler-report.mjs).
COMPILER_SKIPS_MAX=7

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
MSG="${1:-}"
[ -n "$MSG" ] || { echo 'usage: bash scripts/ota-release.sh [--dry-run] "<what changed>"' >&2; exit 64; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO/apps/mobile"
LOG="$(mktemp -d)"
die() { echo "REFUSED: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
cd "$REPO" || exit 1

step "1. tree and runtimes"
[ -z "$(git status --porcelain)" ] || die "the tree is not clean (git status --short)"
SHA="$(git rev-parse HEAD)"
echo "HEAD $(git rev-parse --short=8 HEAD) on $(git rev-parse --abbrev-ref HEAD)"
grep -q "$IOS_RT" apps/mobile/AGENTS.md || die "IOS_RT is not in the apps/mobile/AGENTS.md table"
grep -q "$AND_RT" apps/mobile/AGENTS.md || die "AND_RT is not in the apps/mobile/AGENTS.md table"

step "2. tests"
STAMP="$(git rev-parse --git-dir)/ota-tests-green"
if [ "$(cat "$STAMP" 2>/dev/null)" = "$SHA" ]; then
  echo "green at this commit already (stamp)"
else
  npm --prefix packages/core test >"$LOG/core.log" 2>&1 || { tail -30 "$LOG/core.log"; die "packages/core tests are red"; }
  echo "core: $(grep -E '^ *Tests ' "$LOG/core.log" | tail -1)"
  (cd "$APP" && npx tsc --noEmit) >"$LOG/tsc.log" 2>&1 || { tail -30 "$LOG/tsc.log"; die "mobile tsc is red"; }
  echo "mobile tsc: clean"
  if (cd "$APP" && npx jest --silent) >"$LOG/jest.log" 2>&1; then
    echo "mobile jest: $(grep -E '^Tests:' "$LOG/jest.log")"
  else
    # This PC is shared with other sessions, and some suites assert on wall-clock
    # time. The suites that failed get ONE more run, one at a time: a real
    # failure fails again, a starved timer does not. Both runs are named.
    grep -E '^FAIL' "$LOG/jest.log" | sort -u
    echo "re-running the failed suites one at a time"
    (cd "$APP" && npx jest --silent --onlyFailures --runInBand) >"$LOG/jest-retry.log" 2>&1 || { grep -E '^(FAIL|Tests:|Test Suites:)' "$LOG/jest-retry.log" | sort -u; die "mobile jest is red twice ($LOG/jest.log, $LOG/jest-retry.log)"; }
    echo "mobile jest: $(grep -E '^Tests:' "$LOG/jest.log") — the failed suites passed when run alone: $(grep -E '^Tests:' "$LOG/jest-retry.log")"
  fi
  # A hook React Compiler newly skips re-renders unmemoized, and tsc, jest and
  # lint all stay green. COMPILER_SKIPS_MAX only goes down.
  (cd "$APP" && node scripts/react-compiler-report.mjs --max "$COMPILER_SKIPS_MAX") >"$LOG/compiler.log" 2>&1 || { tail -25 "$LOG/compiler.log"; die "React Compiler skips more than $COMPILER_SKIPS_MAX functions"; }
  echo "react compiler: $(tail -1 "$LOG/compiler.log")"
  echo "$SHA" >"$STAMP"
fi

step "3. iOS fingerprint gate"
HASH="$(cd "$APP" && npx expo-updates fingerprint:generate --platform ios 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).hash)})")"
echo "tree: $HASH"
[ "$HASH" = "$IOS_RT" ] || die "the iOS fingerprint is not $IOS_BIN's ($IOS_RT). docs/COMMANDS.md, 'OTA — the fingerprint gate', names the file that moved it"

step "4. Android export and size budget"
OUT="$(mktemp -d)"
(cd "$APP" && npx expo export --platform android --output-dir "$OUT") >"$LOG/export.log" 2>&1 || { tail -30 "$LOG/export.log"; die "expo export failed"; }
node scripts/perf-budget.mjs --platform android --export-dir "$OUT" >"$LOG/budget.log" 2>&1
BUDGET=$?
tail -6 "$LOG/budget.log"
[ "$BUDGET" = "0" ] || die "the bundle is over budget (find the growth, or accept it on the record: npm run perf:budget -- --update)"

# From here app.json gets pinned; restore it however the script ends.
restore() { git -C "$REPO" checkout -q -- apps/mobile/app.json; }
trap restore EXIT

publish() { # <platform>
  (cd "$APP" && npx eas update --platform "$1" --branch production --environment production --non-interactive --message "$MSG") >"$LOG/publish-$1.log" 2>&1
  local code=$?
  grep -iE "runtime version|update group ID|^Platform|error" "$LOG/publish-$1.log"
  [ "$code" = "0" ] || die "eas update --platform $1 exited $code ($LOG/publish-$1.log)"
}

step "5. iOS publish"
if [ "$DRY" = "1" ]; then echo "dry run: not published"; else publish ios; fi

step "6. Android publish, pinned to $AND_BIN"
node -e "
const fs = require('fs');
const f = process.argv[1];
const s = fs.readFileSync(f, 'utf8');
const block = /\"runtimeVersion\": \{\s*\"policy\": \"fingerprint\"\s*\}/;
if (!block.test(s)) { console.error('runtimeVersion block not found in app.json'); process.exit(1); }
fs.writeFileSync(f, s.replace(block, '\"runtimeVersion\": \"' + process.argv[2] + '\"'));
" "$APP/app.json" "$AND_RT" || die "could not pin app.json"
grep -q "\"runtimeVersion\": \"$AND_RT\"" "$APP/app.json" || die "the pin did not land in app.json"
if [ "$DRY" = "1" ]; then echo "dry run: pinned, not published"; else publish android; fi
restore
trap - EXIT
[ -z "$(git status --porcelain)" ] || die "app.json was not restored (git status --short)"
echo "app.json restored"

step "7. read back and ledger"
if [ "$DRY" = "1" ]; then
  echo "dry run: nothing to read back. Gates passed at $(git rev-parse --short=8 HEAD)."
  exit 0
fi
(cd "$APP" && npx eas update:list --branch production --limit 6 --non-interactive --json 2>/dev/null) >"$LOG/list.json"
node scripts/ota-ledger.mjs --list "$LOG/list.json" --message "$MSG" --sha "$(git rev-parse --short=8 HEAD)" \
  --ios-runtime "$IOS_RT" --ios-binary "$IOS_BIN" --android-runtime "$AND_RT" --android-binary "$AND_BIN" \
  || die "published, but the read-back or the ledger write failed: check 'npx eas update:list --branch production' by hand"
echo
echo "Done. Commit apps/mobile/docs/fingerprint-ledger.md, then CHANGELOG.md and STATUS.md §1 (the OTA row)."
