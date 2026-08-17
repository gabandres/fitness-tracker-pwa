#!/usr/bin/env python3
"""PreToolUse(Bash): stop an `eas update` published from the wrong machine.

The EAS Update runtime fingerprint follows the BUILD HOST, per platform. Since
2026-08-17 the two platforms are built on different machines:

    Android  ->  this Windows workstation   (vc 31+, fingerprint 3d3bc410...)
    iOS      ->  ignia-mac                  (build 55, fingerprint 886bf0b3...)

So there is no machine that can correctly publish both, and the old rule
("always publish from the Mac") is now wrong for Android. Publishing to the
wrong host lands the update on a runtime version NOBODY IS RUNNING: it exits 0,
prints a group id, and reaches zero devices -- indistinguishable from a working
update. Three OTAs were lost that way in one day (2026-08-07), back when the
mistake was possible in only one direction.

    platform    locally (Windows)    via `ssh ignia-mac`
    android     ALLOW                BLOCK
    ios         BLOCK                ALLOW
    all / none  BLOCK                BLOCK

**Bare `eas update` publishes BOTH platforms**, which under a split build host
is correct on neither machine -- it is blocked everywhere, and that is the rule
most likely to be tripped over, because it was safe for the app's whole life
until now.

Read-only subcommands (`update:list`, `update:view`, `--help`) are allowed.

Gate before publishing: compare `npx expo-updates fingerprint:generate
--platform <p>` against the fingerprint read out of the shipped artifact
(`apps/mobile/AGENTS.md`), on the machine that owns that platform.
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

# `--platform android`, `--platform=ios`, `-p android`. Deliberately NOT matching
# a bare `-p` inside some other word.
PLATFORM = re.compile(r"(?:--platform|(?<![\w-])-p)[=\s]+([a-zA-Z]+)")

MAC = re.compile(r"\bssh\s+ignia-mac\b")

# Which host owns which platform. Update this table when a build host moves --
# it is the single place the routing lives.
OWNER = {"android": "windows", "ios": "mac"}


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


def block(reason, fix):
    print(f"BLOCKED: {reason}\n\n{fix}", file=sys.stderr)
    sys.exit(2)


data = json.load(sys.stdin)
cmd = ((data.get("tool_input") or {}).get("command") or "")

if not any(PUBLISH.match(s) for s in command_segments(cmd)):
    sys.exit(0)
if "--help" in cmd:
    sys.exit(0)

m = PLATFORM.search(cmd)
platform = m.group(1).lower() if m else None
on_mac = bool(MAC.search(cmd))
here = "mac" if on_mac else "windows"

if platform not in OWNER:
    block(
        "`eas update` without a single --platform publishes BOTH platforms.\n"
        "Android is built on Windows and iOS on the Mac, so their runtime "
        "fingerprints differ and NO machine can publish both correctly. One "
        "half would land on a runtime nobody runs -- exit 0, a group id "
        "printed, zero devices reached.",
        "Publish them separately, each from its own host:\n"
        "  npx eas update --platform android --branch production ...\n"
        '  ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && '
        'npx eas update --platform ios --branch production ..."',
    )

owner = OWNER[platform]
if owner != here:
    if owner == "mac":
        fix = (
            'ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && '
            f'npx eas update --platform {platform} --branch production ..."'
        )
    else:
        fix = (
            "Run it directly on this Windows workstation (no ssh wrapper):\n"
            f"  cd apps/mobile && npx eas update --platform {platform} "
            "--branch production ..."
        )
    block(
        f"{platform} binaries are built on the "
        f"{'Mac' if owner == 'mac' else 'Windows workstation'}, but this "
        f"publish would run on the {'Mac' if here == 'mac' else 'Windows workstation'}.\n"
        "The runtime fingerprint follows the build host, so this update would "
        "land on a runtime no shipped binary carries and reach NOBODY -- "
        "indistinguishable from success.",
        f"Gate first, then publish from the owning host:\n  {fix}",
    )

sys.exit(0)
