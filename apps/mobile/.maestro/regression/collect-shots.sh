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

D=$(ls -dt "$RUNS"/*/ | head -1)
OUT="$(cd "$(dirname "$0")" && pwd)/shots"
mkdir -p "$OUT"
find "$D" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$OUT"/ \;
echo "collected $(ls "$OUT" | wc -l | tr -d ' ') shots from $D"
