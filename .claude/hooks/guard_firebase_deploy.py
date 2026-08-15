#!/usr/bin/env python3
"""PreToolUse(Bash): refuse `firebase deploy` of hosting from a stale/dev dist.

Two documented failures, both silent:

  1. A DEV build skips `ngsw.json`, which leaves the service-worker update banner
     firing for every returning user. CLAUDE.md: "Always run a PROD build before
     firebase deploy."
  2. `npm run build` is more than `ng build` -- scripts/sentry-release.mjs
     mutates dist AFTER Angular hashed it (sourcemap debug IDs, map strip), and
     ngsw.json is regenerated as the final step. Shipping a dist whose ngsw.json
     disagrees with its own files gives returning users a service worker whose
     hashes do not match what the server serves.

So the check is not "did you build" but "does this dist verify" -- the same SHA1
sweep documented in docs/COMMANDS.md, plus a staleness check against src/.

Only fires for deploys that actually include hosting. `--only functions`,
`--only firestore:rules`, etc. pass straight through.
"""
import hashlib
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

DIST = os.path.join("dist", "fitness-tracker-pwa", "browser")
NGSW = os.path.join(DIST, "ngsw.json")


def strip_heredocs(cmd):
    """Remove heredoc BODIES -- they are data, not commands.

    `cat > f <<'EOF' ... EOF` can contain any text at all, including a line that
    begins with the very command being guarded. Segmenting that text produced two
    false blocks while this hook was being tested, which is exactly the noise
    that gets a guard deleted.
    """
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

    A guard must fire on an INVOCATION, not a MENTION. `echo "firebase deploy"`,
    a grep for it, or a heredoc containing it are not deploys, and blocking those
    makes the guard untrustworthy -- which is how guards get disabled. (This one
    blocked its own test suite before the anchor was added.)

    Splitting on the operators that begin a new command and anchoring the match
    at the start of a segment is right for every real invocation, and fails safe:
    a construction exotic enough to hide the command from this split also hides
    it from a human reviewer.
    """
    parts = re.split(r"(?:\|\||&&|[;\n|&()])", strip_heredocs(cmd))
    out = []
    for p in parts:
        p = p.strip()
        # Strip leading env assignments and neutral prefixes.
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

segments = command_segments(cmd)
deploy_at = next(
    (i for i, s in enumerate(segments) if re.match(r"firebase\s+deploy\b", s)), None
)
if deploy_at is None:
    sys.exit(0)
if "--dry-run" in cmd:
    sys.exit(0)

# `npm run build && firebase deploy` is the documented one-liner (CLAUDE.md).
# The dist on disk is stale *now* and fresh by the time deploy runs, so judging
# it here would block the correct command -- and a guard that fires on the
# documented happy path is a guard that gets removed. Only inspect dist when
# nothing in this same chain rebuilds it first.
if any(
    re.match(r"(?:npm|pnpm|yarn)\s+run\s+build\b|ng\s+build\b", s)
    for s in segments[:deploy_at]
):
    sys.exit(0)

# Does this deploy touch hosting?
only = re.search(r"--only[= ]([^\s;&|]+)", cmd)
if only and "hosting" not in only.group(1):
    sys.exit(0)


def block(msg):
    print(
        "BLOCKED: " + msg + "\n"
        "Run `npm run build` (a PROD build -- it also runs prerender-seo.mjs and "
        "sentry-release.mjs, and regenerates ngsw.json last) before deploying "
        "hosting. A dev build skips ngsw.json and leaves the update banner "
        "firing for every returning user.\n"
        "Verifier: docs/COMMANDS.md -> 'Web build + deploy'.",
        file=sys.stderr,
    )
    sys.exit(2)


if not os.path.isfile(NGSW):
    block(NGSW + " is missing -- this dist was not produced by a prod build.")

try:
    table = json.load(open(NGSW, encoding="utf-8"))["hashTable"]
except Exception as e:
    block("%s is unreadable (%s)." % (NGSW, e))

bad = []
for url, want in table.items():
    f = os.path.join(DIST, url.lstrip("/").replace("/", os.sep))
    try:
        got = hashlib.sha1(open(f, "rb").read()).hexdigest()
    except Exception:
        bad.append(url)
        continue
    if got != want:
        bad.append(url)

if bad:
    block(
        "ngsw.json disagrees with its own dist -- %d file(s) bad, e.g. %s."
        % (len(bad), ", ".join(bad[:3]))
    )

# Stale check: any source newer than the manifest means this dist predates the
# code being deployed.
newest, newest_f = 0.0, None
for root, dirs, files in os.walk("src"):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
    for fn in files:
        if not fn.endswith((".ts", ".html", ".scss", ".css", ".json")):
            continue
        p = os.path.join(root, fn)
        try:
            m = os.path.getmtime(p)
        except OSError:
            continue
        if m > newest:
            newest, newest_f = m, p

built = os.path.getmtime(NGSW)
if newest > built:
    age = int((newest - built) / 60)
    block(
        "dist is STALE -- %s is %d min newer than %s. "
        "The build predates the code you are deploying." % (newest_f, age, NGSW)
    )

sys.exit(0)
