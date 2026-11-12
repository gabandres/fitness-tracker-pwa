#!/usr/bin/env python3
"""PreToolUse(Bash): stop an `eas update` published from the wrong machine.

The EAS Update runtime fingerprint is computed on the machine that publishes,
and a publish whose hash matches no shipped binary exits 0, prints a group id
and reaches zero devices -- indistinguishable from a working update. Three OTAs
were lost that way in one day (2026-08-07).

    platform    on Windows    on the Mac    via `ssh ignia-mac`
    android     ALLOW         ALLOW         ALLOW
    ios         ALLOW         ALLOW         ALLOW
    all / none  BLOCK         BLOCK         BLOCK

**2026-11-12: both machines compute the same fingerprints** (iOS build 75's
`e6d2973e...` on both) and export the same bundles, so either may publish
either platform. Until then the Windows hash differed -- `@expo/fingerprint`
0.20 matched backslash paths against forward-slash ignore globs and hashed ~283
extra config-plugin files, and two Sentry resolver tests missed on backslash
paths and bundled ~69 extra modules. `patches/@expo+fingerprint+0.20.14.patch`
and the Windows-only tests in `apps/mobile/metro.config.js` fix both. From
2026-08-17 to then the table was split (iOS Mac-only; Android Windows-only
through vc 45, Mac-only from vc 46 on 2026-09-28). ignia-mac is sold on
2026-11-13, which made Windows the publishing host.

The rule that makes this safe is the GATE, not this guard: before a publish,
compare `npx expo-updates fingerprint:generate --platform <p>` with the value
read out of the shipped artifact (`apps/mobile/AGENTS.md`), on the machine that
will publish. Android publishes pin `runtimeVersion` to the artifact value.

**Bare `eas update` publishes BOTH platforms** in one command, under one
machine's two computed hashes and with no per-platform pin -- it is blocked
everywhere.

"On the Mac" means a Claude session running ON a Mac. The local host is read
from `sys.platform`; `GUARD_HOST=mac|windows` overrides it for the test matrix.

Read-only subcommands (`update:list`, `update:view`, `--help`) are allowed.

`--environment` is also required, and this guard enforces it. eas-cli's own help
says *"Required for projects using Expo SDK 55 or greater"*, and this app is on
57 -- so every suggestion printed below carries it. That failure is loud rather
than silent, unlike the host routing above; it is checked here so that anything
this guard lets through is a command that actually runs.

"""
import json
import os
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

# `--environment production`, `--environment=production`. Required from SDK 55.
ENVIRONMENT = re.compile(r"--environment[=\s]+\S+")

# Which hosts may publish which platform. Update this table when the hosts stop
# computing the same fingerprint -- it is the single place the routing lives.
# Since 2026-11-12 the Windows PC (`winbox`, checkout `Z:\fitness-tracker-pwa`)
# computes the Mac's hashes for both platforms and exports the Mac's bundles
# (patches/@expo+fingerprint+0.20.14.patch, the Sentry tests in
# apps/mobile/metro.config.js), so both machines may publish both platforms.
# ignia-mac is sold 2026-11-13; its entry stays for whichever Mac comes next.
OWNER = {"android": {"mac", "windows"}, "ios": {"mac", "windows"}}

# The machine this hook is running on.
LOCAL_HOST = os.environ.get("GUARD_HOST") or (
    "mac" if sys.platform == "darwin" else "windows"
)


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


QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")


def split_quotes(cmd):
    """Blank out quoted spans, returning (outer, payloads).

    The segmenter splits on shell metacharacters, and it cannot tell a real `|`
    from one inside a quoted regex. Without this,
    `grep -nE "(eas update|gradlew)" docs/` splits into a phantom segment
    starting with `eas update` and the guard fires on a MENTION -- which this
    guard's whole contract forbids, and which happened on 2026-08-17.

    Quoted text is data, exactly like a heredoc body. The one case that must
    still see inside quotes is `ssh ignia-mac "... eas update ..."`, so the
    payloads are returned separately and segmented on their own -- reached only
    when `ssh ignia-mac` appears OUTSIDE the quotes.
    """
    payloads = []

    def repl(m):
        payloads.append(m.group(0)[1:-1])
        return " QUOTED "

    return QUOTED.sub(repl, cmd), payloads


def block(reason, fix):
    print(f"BLOCKED: {reason}\n\n{fix}", file=sys.stderr)
    sys.exit(2)


data = json.load(sys.stdin)
cmd = ((data.get("tool_input") or {}).get("command") or "")

outer, payloads = split_quotes(cmd)

# Publishing directly on this machine.
local_publish = any(PUBLISH.match(s) for s in command_segments(outer))
# Publishing on the Mac -- `ssh ignia-mac` must appear OUTSIDE the quotes, so a
# grep whose *pattern* mentions ssh cannot reach this branch.
mac_publish = bool(MAC.search(outer)) and any(
    PUBLISH.match(s) for p in payloads for s in command_segments(p)
)

if not (local_publish or mac_publish):
    sys.exit(0)
if "--help" in cmd:
    sys.exit(0)

m = PLATFORM.search(cmd)
platform = m.group(1).lower() if m else None
here = "mac" if mac_publish and not local_publish else LOCAL_HOST

if platform not in OWNER:
    block(
        "`eas update` without a single --platform publishes BOTH platforms.\n"
        "Each platform's live binaries carry their own runtime, and an Android "
        "publish pins runtimeVersion to the artifact value first -- one command "
        "for both would put at least one half on a runtime nobody runs: exit 0, "
        "a group id printed, zero devices reached.",
        "Publish them separately, one runtime per command (apps/mobile/AGENTS.md):\n"
        "  cd apps/mobile && npx eas update --platform ios --branch production "
        "--environment production ...\n"
        "  cd apps/mobile && npx eas update --platform android --branch production "
        "--environment production ...  (runtimeVersion pinned, then reverted)",
    )

owners = OWNER[platform]
if here not in owners:
    name = {"mac": "the Mac", "windows": "the Windows PC"}
    block(
        f"{platform} updates are published from "
        f"{' or '.join(name[o] for o in sorted(owners))}, but this publish "
        f"would run on {name[here]}.\n"
        "The runtime fingerprint depends on the machine, so this update would "
        "land on a runtime no shipped binary carries and reach NOBODY -- "
        "indistinguishable from success.",
        "Gate first (apps/mobile/AGENTS.md), then publish from a host in "
        "OWNER in .claude/hooks/guard_eas_update.py.",
    )

if not ENVIRONMENT.search(cmd):
    block(
        "`eas update` is missing --environment, which eas-cli requires for "
        "projects on Expo SDK 55 or greater. This app is on 57.",
        "Add the environment the update is published against:\n"
        f"  npx eas update --platform {platform} --branch production "
        "--environment production ...",
    )

sys.exit(0)
