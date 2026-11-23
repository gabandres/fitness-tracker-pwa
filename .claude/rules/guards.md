---
paths:
  - ".claude/**"
---

# The PreToolUse guards (`.claude/hooks/`)

Each guard corresponds to a failure that has really happened here and that is **invisible to tsc, the unit tests, and
the tool's own exit code** — which is why prose alone did not prevent them.

- `guard_firebase_deploy.py` — until ADR-0036 a dev/stale hosting deploy also left the PWA update banner firing for
  every returning user.
- `guard_eas_update.py` — blocks a publish from a host not in its `OWNER` table; **OTAs for both platforms go out from
  the Windows PC, checkout `Z:\fitness-tracker-pwa`** (the table also allows `mac`, a session on the build Mac or a
  command sent to it with `mac run` / `mac bg` / `ssh buildmac`: both hosts compute the same fingerprints,
  `patches/@expo+fingerprint+0.20.14.patch`, and export the same bundles, `apps/mobile/metro.config.js`). The first
  Mac was sold 2026-11-13; from 2026-08-17 to 2026-11-12 the hosts were split per platform. The fingerprint was
  machine-dependent; a publish whose hash matches no binary exits 0 and reaches **nobody**.

They match **invocations, not mentions** — echoing, grepping or heredoc'ing one of these commands is allowed, and
`npm run build && firebase deploy` (the documented one-liner) passes because the chain rebuilds first.

`python3 .claude/hooks/test_guards.py` (`python` on Windows) is the case matrix; run it after touching a guard or
`.claude/settings.json`. Its last block runs the exact `settings.json` command strings through a shell, because a hook
whose interpreter is missing exits 127, which Claude Code reads as "allow": the commands try `python3` and fall back
to `python` (the Windows Store `python3` stub fails the probe). A guard that fires on the happy path is a guard that
gets deleted.
