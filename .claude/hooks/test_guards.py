#!/usr/bin/env python3
"""Test matrix for the project PreToolUse guards.

    python .claude/hooks/test_guards.py

Run from the repo root. Every case here is either a real failure the guard
exists to catch, or a false positive the guard produced while being written --
the mention-vs-invocation cases are not hypothetical, they blocked this file's
own earlier revisions twice.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HOOKS = os.path.join(ROOT, ".claude", "hooks")

D = "guard_firebase_deploy.py"
E = "guard_eas_update.py"
F = "guard_firestore_import.py"

failures = []


def run(hook, tool_input, env=None):
    r = subprocess.run(
        [sys.executable, os.path.join(HOOKS, hook)],
        input=json.dumps({"tool_input": tool_input}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=ROOT,
        env={**os.environ, **(env or {})},
    )
    return "BLOCK" if r.returncode == 2 else "allow"


def case(hook, tool_input, label, expect, env=None):
    got = run(hook, tool_input, env)
    ok = got == expect
    if not ok:
        failures.append(label)
    print("%s %-46s %s" % ("ok  " if ok else "FAIL", label, got))


def cmd(c):
    return {"command": c}


def edit(path, text):
    return {"file_path": path, "new_string": text}


print("\n-- firebase deploy: invocation vs mention --")
case(D, cmd("echo 'firebase deploy --only hosting'"), "echo mentioning deploy", "allow")
case(D, cmd("grep -rn 'firebase deploy' docs/"), "grep for deploy", "allow")
case(D, cmd("cat <<'EOF'\nfirebase deploy --only hosting\nEOF"), "heredoc containing deploy", "allow")

print("\n-- firebase deploy: scope --")
case(D, cmd("firebase deploy --only functions"), "functions only", "allow")
case(D, cmd("firebase deploy --only firestore:rules"), "rules only", "allow")
case(D, cmd("firebase deploy --only hosting --dry-run"), "dry-run", "allow")

print("\n-- firebase deploy: build freshness --")
case(D, cmd("npm run build && firebase deploy"), "documented build && deploy", "allow")
case(D, cmd("npm run build && firebase deploy --only hosting"), "build && deploy hosting", "allow")
# The guard's contract is "does this dist verify", NOT "did you build" -- so a
# deploy with a verifying dist on disk is allowed whatever the command order.
# These two cases used to assert the opposite and therefore passed only when
# dist was stale or absent; they went red after any build, which is a red matrix
# that means nothing. GUARD_DIST_ROOT points the guard at a directory that
# provably has no ngsw.json, so the outcome no longer depends on the machine.
MISSING_DIST = {"GUARD_DIST_ROOT": os.path.join(ROOT, ".claude", "hooks", "no-such-dist")}
case(D, cmd("firebase deploy && npm run build"), "deploy with NO dist (unbuilt)", "BLOCK", MISSING_DIST)
case(D, cmd("firebase deploy --only hosting"), "deploy hosting with NO dist", "BLOCK", MISSING_DIST)
case(D, cmd("firebase deploy --only functions"), "functions-only ignores dist", "allow", MISSING_DIST)

print("\n-- eas update --")
case(E, cmd("echo 'npx eas update --branch production'"), "echo mentioning eas update", "allow")
case(E, cmd("npx eas update:list --branch production --limit 2"), "update:list (read-only)", "allow")
case(E, cmd("npx eas build -p ios --local"), "eas build", "allow")
# Split build host since 2026-08-17: Android is built on Windows, iOS on the Mac.
# Bare `eas update` publishes BOTH, so it is correct on NEITHER machine — this is
# the case that was legal for the app's entire life until now.
case(E, cmd("cd apps/mobile && npx eas update --branch production"), "bare update on Windows (no --platform)", "BLOCK")
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --branch production"'), "bare update via ignia-mac (no --platform)", "BLOCK")
case(E, cmd("cd apps/mobile && npx eas update --platform all --branch production"), "--platform all", "BLOCK")
# Android belongs to Windows now. Every allowed publish must also carry
# --environment, which eas-cli requires from Expo SDK 55 (this app is on 57).
case(E, cmd("cd apps/mobile && npx eas update --platform android --branch production --environment production"), "android from Windows (owner)", "allow")
case(E, cmd("cd apps/mobile && npx eas update -p android --branch production --environment production"), "android from Windows, short -p", "allow")
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform android --branch production --environment production"'), "android via ignia-mac (wrong host)", "BLOCK")
# iOS still belongs to the Mac.
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform ios --branch production --environment production"'), "ios via ignia-mac (owner)", "allow")
# Correctly routed, but missing the SDK 55+ required flag.
case(E, cmd("cd apps/mobile && npx eas update --platform android --branch production"), "android from Windows, no --environment", "BLOCK")
case(E, cmd("cd apps/mobile && npx eas update --platform android --branch production --environment=production"), "--environment= form", "allow")
case(E, cmd("cd apps/mobile && npx eas update --platform ios --branch production"), "ios from Windows (wrong host)", "BLOCK")
# Mentions, not invocations. The `|` inside a quoted regex used to split into a
# phantom segment starting with `eas update` and block a plain grep (2026-08-17).
case(E, cmd('grep -nE "ssh ignia-mac.*(eas update|gradlew)" docs/COMMANDS.md'), "grep whose PATTERN mentions eas update", "allow")
case(E, cmd("rg 'eas update --platform android' docs/"), "rg for the publish command", "allow")
case(E, cmd('ssh ignia-mac "grep -n \'eas update\' notes.md"'), "grep ON the Mac, still a mention", "allow")

print("\n-- firebase/firestore import --")
SPEC = "import { Timestamp } from 'firebase/firestore';"
IMP = "import { doc } from 'firebase/firestore';"
case(F, edit("Z:/macro-app/src/app/services/foo.service.ts", IMP), "src/app service (second SDK copy)", "BLOCK")
case(F, edit("Z:/macro-app/src/app/ledger/infrastructure/x.ts", IMP), "src/app ledger adapter", "BLOCK")
case(F, edit("Z:/macro-app/apps/mobile/src/lib/ledger.ts", IMP), "apps/mobile (intentional, ADR-0016)", "allow")
case(F, edit("Z:/macro-app/functions/src/x.ts", IMP), "functions (firebase-admin)", "allow")
case(F, edit("Z:/macro-app/src/app/x/y.spec.ts", SPEC), "spec file", "allow")
case(F, edit("Z:/macro-app/src/app/x/y.emulator.test.ts", SPEC), "emulator test", "allow")
case(F, edit("Z:/macro-app/src/app/services/foo.service.ts", "const x = 1;"), "unrelated edit to same file", "allow")

print("")
if failures:
    print("%d FAILED: %s" % (len(failures), "; ".join(failures)))
    sys.exit(1)
print("all guard cases pass")
