#!/usr/bin/env python3
"""PreToolUse(Bash): refuse `firebase deploy` of hosting from a stale/dev dist.

Two documented failures, both silent:

  1. A DEV build is unoptimised, skips the prerendered SEO pages and the
     release stamp, and (until ADR-0036 retired the service worker) left the
     update banner firing for every returning user. CLAUDE.md: "Always run a
     PROD build before firebase deploy."
  2. `npm run build` is more than `ng build` -- scripts/prerender-seo.mjs writes
     the content pages and sitemap, and scripts/sentry-release.mjs mutates dist
     AFTER Angular hashed it (sourcemap debug IDs, map strip, the safety worker
     that unregisters old PWA installs) and writes `build-info.json` LAST.
     Shipping a dist without that file means one of those steps did not run.

So the check is not "did you build" but "does this dist carry the stamp the
prod build writes last", plus a staleness check against src/. Before
2026-08-30 the stamp was `ngsw.json` and the check was a SHA1 sweep of its
hashTable; the service worker went with the web logging app (ADR-0036), so the
stamp is now `build-info.json` -- docs/COMMANDS.md has the verifier.

Only fires for deploys that actually include hosting. `--only functions`,
`--only firestore:rules`, etc. pass straight through.
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

# GUARD_DIST_ROOT is a TEST SEAM, not a configuration knob. The check reads the
# real filesystem, so without it the matrix in test_guards.py asserts whatever
# dist happens to be on disk: the freshness cases passed only when dist was
# stale or absent, and went red the moment anyone ran a build. A guard whose
# test suite is red for a legitimate reason stops being read at all, which is
# the failure this file exists to prevent one level down.
# The default is anchored to CLAUDE_PROJECT_DIR, NOT to the process cwd.
#
# It used to be the bare relative path, and that made the guard fire on the
# documented happy path. A PreToolUse hook inherits the Bash session's cwd, and
# the session cwd is `apps/mobile` for most of a mobile release: the Metro gate
# and both `eas update` publishes all start with `cd apps/mobile`, and it
# persists. So `npm run build && firebase deploy --only hosting` -- run from the
# repo root, against a perfectly good dist -- resolved DIST to
# `apps/mobile/dist/...`, found nothing, and blocked with "this dist was not
# produced by a prod build". Measured 2026-08-19: two identical refusals with
# the file sitting on disk, and the fix was to `cd` the session back.
#
# That is the exact failure mode the header warns about one level up. A guard
# that blocks the correct command is worse than no guard, because the way past
# it is to stop believing it.
_PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
DIST = os.environ.get(
    "GUARD_DIST_ROOT",
    os.path.join(_PROJECT_DIR, "dist", "fitness-tracker-pwa", "browser"),
)
STAMP = os.path.join(DIST, "build-info.json")


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
        "sentry-release.mjs, which writes build-info.json last) before deploying "
        "hosting. A dev build ships no prerendered pages, no release stamp and "
        "no safety worker.\n"
        "Verifier: docs/COMMANDS.md -> 'Web build + deploy'.",
        file=sys.stderr,
    )
    sys.exit(2)


if not os.path.isfile(STAMP):
    block(STAMP + " is missing -- this dist was not produced by a prod build.")

try:
    stamp = json.load(open(STAMP, encoding="utf-8"))
except Exception as e:
    block("%s is unreadable (%s)." % (STAMP, e))

if not stamp.get("production"):
    block(STAMP + " says production=false -- this is a dev build.")

# The last two steps of the prod build each leave a file; both must be there.
for rel, step in (("sitemap.xml", "prerender-seo.mjs"), ("ngsw-worker.js", "sentry-release.mjs (safety worker)")):
    if not os.path.isfile(os.path.join(DIST, rel)):
        block("%s is missing from dist -- %s did not run." % (rel, step))

# Stale check: any source newer than the stamp means this dist predates the
# code being deployed.
newest, newest_f = 0.0, None
for root, dirs, files in os.walk(os.path.join(_PROJECT_DIR, "src")):
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

built = os.path.getmtime(STAMP)
if newest > built:
    age = int((newest - built) / 60)
    block(
        "dist is STALE -- %s is %d min newer than %s. "
        "The build predates the code you are deploying." % (newest_f, age, STAMP)
    )

sys.exit(0)
