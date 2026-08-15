#!/usr/bin/env python3
"""PreToolUse(Edit|Write): block a second Firebase SDK copy in the Angular bundle.

`@angular/fire` injects its own Firestore instance. Importing plain
`firebase/firestore` in app-bundle code pulls in a SECOND copy of the SDK, which
breaks `doc()` / instance identity. That broke production sign-in once, and it is
invisible to tsc, to the unit tests, and to a signed-out smoke test.

Scope is `src/` only:
  - `apps/mobile/` uses the Firebase JS SDK directly ON PURPOSE (it does not use
    the LEDGER_PORT seam) and must never be blocked.
  - `functions/` is firebase-admin, a different SDK entirely.
  - `*.spec.ts` / `*.test.ts` under src/ are allowed — they run in Node against
    the emulator, where the alias applies and there is no Angular injector.

Blocks the Edit/Write when the text being introduced adds the import. Use the
injected Firestore, or the `LEDGER_PORT` token (ADR-0009).
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

SPECIFIER = re.compile(r"""from\s+['"]firebase/firestore['"]""")

data = json.load(sys.stdin)
ti = data.get("tool_input") or {}
path = (ti.get("file_path") or "").replace("\\", "/")

# Only the Angular app bundle.
if "/src/" not in path and not path.startswith("src/"):
    sys.exit(0)
if "/apps/mobile/" in path or "/functions/" in path:
    sys.exit(0)
if re.search(r"\.(spec|test|emulator\.test)\.ts$", path):
    sys.exit(0)

# Look only at text being INTRODUCED, so an unrelated edit to a file that
# already contains the import is not blocked.
incoming = ti.get("new_string") or ti.get("content") or ""
if not SPECIFIER.search(incoming):
    sys.exit(0)

print(
    "BLOCKED: `from 'firebase/firestore'` in Angular app-bundle code "
    f"({path}).\n"
    "@angular/fire injects its own SDK instance; a second copy breaks doc()/"
    "instance identity and has broken prod sign-in before.\n"
    "Use the injected Firestore, or go through LEDGER_PORT "
    "(src/app/ledger/ports/ledger.port.ts, ADR-0009). "
    "See CLAUDE.md 'Single Firebase SDK copy rule'.\n"
    "Legitimately exempt: apps/mobile/**, functions/**, and *.spec.ts/*.test.ts.",
    file=sys.stderr,
)
sys.exit(2)
