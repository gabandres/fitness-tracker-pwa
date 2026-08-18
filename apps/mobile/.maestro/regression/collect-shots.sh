#!/bin/zsh
# Copy the LATEST run's takeScreenshot output into this directory's shots/.
#
# Maestro 2.x does NOT treat the path in `takeScreenshot:` as repo-relative —
# it writes under ~/.maestro/tests/<timestamp>/<flow>/takeScreenshot/<path>, a
# directory it purges after 14 days. Without this step the suite's audit
# evidence never reaches the repo, and "review every screenshot" points at a
# folder that does not exist. Run it after every suite run.
#
# This lived at ~/qa-collect-shots.sh on one laptop until 2026-08-18. That made
# the documented review step depend on a file in one machine's home directory,
# outside version control, on a laptop this project does not own. It is in the
# repo now; `shots/` itself stays gitignored, because the captures are evidence
# for one run rather than source.
set -eu

RUNS=~/.maestro/tests
[ -d "$RUNS" ] || { echo "no Maestro runs at $RUNS" >&2; exit 1; }

# The newest run dir is NOT necessarily ours. `ignia-mac` is a SHARED laptop,
# and on 2026-08-18 another project's Maestro suite started 73 seconds after
# this one — `ls -dt | head -1` picked ITS run, whose flows are named
# `01-appointment`, `05-territory`, `08-visit-outcomes`. Nothing of theirs was
# copied that time only because their flows take no screenshots; the same
# command would otherwise have pulled another person's app captures into this
# repo. So: take the newest run that actually contains one of OUR flows, or an
# explicit run directory as $1.
D="${1:-}"
if [ -z "$D" ]; then
  for c in $(ls -dt "$RUNS"/*/); do
    if [ -d "$c/01-today" ] || [ -d "$c/18-train-template" ]; then D="$c"; break; fi
  done
fi
[ -n "$D" ] || { echo "no run of THIS suite found under $RUNS" >&2; exit 1; }
OUT="$(cd "$(dirname "$0")" && pwd)/shots"
mkdir -p "$OUT"
find "$D" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$OUT"/ \;
echo "collected $(ls "$OUT" | wc -l | tr -d ' ') shots from $D"
