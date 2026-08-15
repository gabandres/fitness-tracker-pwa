#!/usr/bin/env python3
"""PreToolUse(Bash): stop an `eas update` published from Windows.

The EAS Update runtime fingerprint is MACHINE-DEPENDENT here. The same commit
fingerprints differently on this Windows workstation than on `ignia-mac`, because
of a Windows-only apps/mobile/android/ prebuild dir, CRLF-vs-LF in tracked files,
and divergent node_modules (516 fingerprint sources vs 286).

Every binary is built on the Mac, so the Mac's fingerprint is the one shipped
binaries carry. An update published from Windows therefore lands on a runtime
NOBODY IS RUNNING. It exits 0, prints a group id, and reaches zero devices --
indistinguishable from a working update. Three OTAs were lost that way in one day
(2026-08-07).

Publish from the Mac, gating first with
`npx expo-updates fingerprint:generate --platform <p>` and comparing against the
fingerprint read out of the shipped artifact (apps/mobile/AGENTS.md).

Read-only subcommands (`update:list`, `update:view`, `--help`) are allowed, and
anything already wrapped in an `ssh ignia-mac` invocation passes through.
"""
import json
import re
import sys

# Windows consoles default to cp1252; force UTF-8 so the block message does not
# come back mojibaked.
try:
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# `eas update` / `eas-cli update`, but not `update:list`, `update:view`, etc.
PUBLISH = re.compile(r"^eas(?:-cli)?\s+update(?!:)(?:\s|$)")


def strip_heredocs(cmd):
    """Remove heredoc BODIES -- they are data, not commands."""
    out, lines = [], cmd.split("\n")
    i = 0
    while i < len(lines):
        out.append(lines[i])
        m = re.search(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?", lines[i])
        if m:
            term = m.group(1)
            i += 1
            while i < len(lines) and lines[i].strip() != term:
                i += 1
        i += 1
    return "\n".join(out)


def command_segments(cmd):
    """Split a shell line into segments that could each START a command.

    A guard must fire on an INVOCATION, not a MENTION -- echoing or grepping for
    the command is not running it, and blocking that makes the guard
    untrustworthy, which is how guards get disabled.
    """
    parts = re.split(r"(?:\|\||&&|[;\n|&()])", strip_heredocs(cmd))
    out = []
    for p in parts:
        p = p.strip()
        while True:
            m = re.match(r"^(?:\w+=\S*|sudo|command|npx|time)\s+", p)
            if not m:
                break
            p = p[m.end():]
        if p:
            out.append(p)
    return out


data = json.load(sys.stdin)
cmd = ((data.get("tool_input") or {}).get("command") or "")

if not any(PUBLISH.match(s) for s in command_segments(cmd)):
    sys.exit(0)
if "--help" in cmd:
    sys.exit(0)
# Already delegated to the Mac.
if re.search(r"\bssh\s+ignia-mac\b", cmd):
    sys.exit(0)

print(
    "BLOCKED: `eas update` published from Windows reaches NOBODY.\n"
    "The runtime fingerprint is machine-dependent here; every shipped binary "
    "carries the fingerprint generated on `ignia-mac`, so a Windows-published "
    "update lands on a runtime no device is running. It exits 0 and prints a "
    "group id -- indistinguishable from success. Three OTAs were lost this way "
    "on 2026-08-07.\n\n"
    "Publish from the Mac, and gate first:\n"
    "  ssh ignia-mac \"cd ~/fitness-tracker-pwa/apps/mobile && "
    "npx expo-updates fingerprint:generate --platform ios\"\n"
    "  # compare against the artifact fingerprint in apps/mobile/AGENTS.md, then\n"
    "  ssh ignia-mac \"cd ~/fitness-tracker-pwa/apps/mobile && npx eas update ...\"",
    file=sys.stderr,
)
sys.exit(2)
