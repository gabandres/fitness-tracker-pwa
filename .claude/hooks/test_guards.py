#!/usr/bin/env python3
"""Test matrix for the project PreToolUse guards.

    python3 .claude/hooks/test_guards.py   (or `python` on Windows)

Run from the repo root. Every case here is either a real failure the guard
exists to catch, or a false positive the guard produced while being written --
the mention-vs-invocation cases are not hypothetical, they blocked this file's
own earlier revisions twice.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HOOKS = os.path.join(ROOT, ".claude", "hooks")

D = "guard_firebase_deploy.py"
E = "guard_eas_update.py"
WINENV = {"GUARD_HOST": "windows"}  # rows that describe a Windows session; the matrix runs on both hosts since 2026-09-28
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
# provably has no build-info.json, so the outcome no longer depends on the machine.
MISSING_DIST = {"GUARD_DIST_ROOT": os.path.join(ROOT, ".claude", "hooks", "no-such-dist")}
case(D, cmd("firebase deploy && npm run build"), "deploy with NO dist (unbuilt)", "BLOCK", MISSING_DIST)
case(D, cmd("firebase deploy --only hosting"), "deploy hosting with NO dist", "BLOCK", MISSING_DIST)
case(D, cmd("firebase deploy --only functions"), "functions-only ignores dist", "allow", MISSING_DIST)

print("\n-- eas update --")
case(E, cmd("echo 'npx eas update --branch production'"), "echo mentioning eas update", "allow")
case(E, cmd("npx eas update:list --branch production --limit 2"), "update:list (read-only)", "allow")
case(E, cmd("npx eas build -p ios --local"), "eas build", "allow")
# Split build host 2026-08-17 .. 2026-09-28 (Android on Windows, iOS on the Mac);
# since vc 46 (2026-09-28) BOTH platforms build and publish on the Mac.
# Bare `eas update` publishes BOTH, so it is correct on NEITHER machine — this is
# the case that was legal for the app's entire life until now.
case(E, cmd("cd apps/mobile && npx eas update --branch production"), "bare update on Windows (no --platform)", "BLOCK", WINENV)
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --branch production"'), "bare update via ignia-mac (no --platform)", "BLOCK")
case(E, cmd("cd apps/mobile && npx eas update --platform all --branch production"), "--platform all", "BLOCK")
# Android belongs to the Mac since vc 46. Every allowed publish must also carry
# --environment, which eas-cli requires from Expo SDK 55 (this app is on 57).
case(E, cmd("cd apps/mobile && npx eas update --platform android --branch production --environment production"), "android bare from Windows (wrong host since vc 46)", "BLOCK", WINENV)
case(E, cmd("cd apps/mobile && npx eas update -p android --branch production --environment production"), "android bare from Windows, short -p (wrong host)", "BLOCK", WINENV)
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform android --branch production --environment production"'), "android via ignia-mac (owner)", "allow")
# iOS still belongs to the Mac.
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform ios --branch production --environment production"'), "ios via ignia-mac (owner)", "allow")
# Correctly routed, but missing the SDK 55+ required flag.
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform android --branch production"'), "android via ignia-mac, no --environment", "BLOCK")
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform android --branch production --environment=production"'), "--environment= form", "allow")
case(E, cmd("cd apps/mobile && npx eas update --platform ios --branch production"), "ios from Windows (wrong host)", "BLOCK", WINENV)

# A session running ON ignia-mac (T3 Code / Remote Control) -- both platforms are local there.
MACENV = {"GUARD_HOST": "mac"}
case(E, cmd("cd apps/mobile && npx eas update --platform ios --branch production --environment production"), "ios directly on the Mac (owner)", "allow", MACENV)
case(E, cmd("cd apps/mobile && npx eas update --platform android --branch production --environment production"), "android directly on the Mac (owner)", "allow", MACENV)
case(E, cmd('ssh ignia-mac "cd ~/x && npx eas update --platform ios --branch production --environment production"'), "ios via ssh, from the Mac itself", "allow", MACENV)
case(E, cmd("cd apps/mobile && npx eas update --platform ios --branch production"), "ios on the Mac, no --environment", "BLOCK", MACENV)
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

# -- the REAL hook path: the command strings in .claude/settings.json --
# Every case above calls the guards with sys.executable, so it cannot see the
# failure that switched all three guards off on the Mac until 2026-10-15:
# settings.json said `python`, which does not exist there (only python3), the
# hook exited 127, and Claude Code treats any exit other than 2 as "allow".
# These rows run the exact settings.json command through a shell, the way the
# harness does, on whatever interpreter the host has -- plus a host where
# `python3` exists but fails (the Windows Store stub) and only `python` works.
print("\n-- settings.json hook commands (the path Claude Code actually runs) --")
SH = shutil.which("bash") or shutil.which("sh")
SETTINGS = json.load(open(os.path.join(ROOT, ".claude", "settings.json"), encoding="utf-8"))
HOOK_CMDS = {}
for grp in SETTINGS["hooks"]["PreToolUse"]:
    for h in grp["hooks"]:
        for g in (D, E, F):
            if g in h["command"]:
                HOOK_CMDS[g] = h["command"]
BLOCKING = {
    D: (cmd("firebase deploy --only hosting"), MISSING_DIST),
    E: (cmd("cd apps/mobile && npx eas update --platform all --branch production"), None),
    F: (edit("Z:/macro-app/src/app/services/foo.service.ts", IMP), None),
}


def shell_case(hook, label, path_prefix=None):
    if hook not in HOOK_CMDS:
        failures.append(label)
        print("FAIL %-46s %s" % (label, "not wired in settings.json"))
        return
    tool_input, env = BLOCKING[hook]
    e = {**os.environ, **(env or {}), "CLAUDE_PROJECT_DIR": ROOT}
    if path_prefix:
        e["PATH"] = path_prefix + os.pathsep + e.get("PATH", "")
    r = subprocess.run([SH, "-c", HOOK_CMDS[hook]], input=json.dumps({"tool_input": tool_input}),
                       capture_output=True, text=True, encoding="utf-8", cwd=ROOT, env=e)
    got = "BLOCK" if r.returncode == 2 else "allow (exit %d)" % r.returncode
    ok = got == "BLOCK"
    if not ok:
        failures.append(label)
    print("%s %-46s %s" % ("ok  " if ok else "FAIL", label, got))


if SH is None:
    print("skip: no bash/sh on PATH to run the settings.json commands")
else:
    for g in (D, E, F):
        shell_case(g, "settings.json blocks: " + g)
    if os.name != "nt":
        # A host whose python3 is a broken stub and whose python is real.
        stub = tempfile.mkdtemp()
        with open(os.path.join(stub, "python3"), "w") as fh:
            fh.write("#!/bin/sh\necho 'Python was not found' >&2\nexit 9009\n")
        os.chmod(os.path.join(stub, "python3"), 0o755)
        os.symlink(sys.executable, os.path.join(stub, "python"))
        for g in (D, E, F):
            shell_case(g, "stub python3, real python: " + g, stub)
        shutil.rmtree(stub)

print("")
if failures:
    print("%d FAILED: %s" % (len(failures), "; ".join(failures)))
    sys.exit(1)
print("all guard cases pass")
