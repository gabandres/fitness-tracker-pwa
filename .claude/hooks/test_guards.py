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


def run(hook, tool_input):
    r = subprocess.run(
        [sys.executable, os.path.join(HOOKS, hook)],
        input=json.dumps({"tool_input": tool_input}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=ROOT,
    )
    return "BLOCK" if r.returncode == 2 else "allow"


def case(hook, tool_input, label, expect):
    got = run(hook, tool_input)
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
case(D, cmd("firebase deploy && npm run build"), "deploy BEFORE build (wrong order)", "BLOCK")

print("\n-- eas update --")
case(E, cmd("echo 'npx eas update --branch production'"), "echo mentioning eas update", "allow")
case(E, cmd("cd apps/mobile && npx eas update --branch production"), "publish from Windows", "BLOCK")
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --branch production"'), "publish via ignia-mac", "allow")
case(E, cmd("npx eas update:list --branch production --limit 2"), "update:list (read-only)", "allow")
case(E, cmd("npx eas build -p ios --local"), "eas build", "allow")

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
