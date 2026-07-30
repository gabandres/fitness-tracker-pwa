---
name: work-an-issue
description: Take a GitHub issue in gabandres/fitness-tracker-pwa from "assigned" to "merged, with evidence" — read the ticket, reproduce bugs before fixing, implement, verify, comment the evidence back on the issue, open the PR, and keep STATUS.md in sync so `npm run doctor` stays green. Use for "implement #47", "fix issue 36", "what's open?", "open a PR for this", or any request driven by an issue number.
---

# Work an issue end to end

Triggers: `implement #47`, `fix issue 36`, `work the next task`, `what's open?`,
`open a PR for #12`, `add my findings to #31`.

Repo: **`gabandres/fitness-tracker-pwa`**, default branch `main`, `gh` CLI
already authenticated.

## This skill does not create issues

Issue and map creation, ticket taxonomy, and roadmap decomposition belong to the
**`wayfinder`** skill — that is what the `wayfinder:map` / `wayfinder:task` /
`wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` labels are.
This skill starts once a ticket exists and ends when it is merged.

- `wayfinder:map` = a container for tasks, not work. Do not "implement" a map.
- `wayfinder:task` = the unit of deliverable work. **Every open one must be cited
  in `STATUS.md` §4** — `npm run doctor` enforces it (see the gate below).

## 1. Read the ticket, and read what it is blocked on

```sh
gh issue view <n> --comments
gh issue list --state open --limit 30 --json number,title,labels
```

`STATUS.md` §4 ("Open work, and what each is actually blocked on") is the
authoritative narrative — the issue body says *what*, §4 says *whether it can
even be started*. Read §4 before touching code. A large share of open tickets
here are blocked on the iOS build constraint (§3), not on code.

## 2. For a bug: reproduce first. It is a gate.

No code changes until you have watched the reported behavior fail.

1. Boot the emulator loop (`npm run dev`, user `e2e@test.com` / `UserTest123`)
   and drive the exact path from the report — see the `test-web-ui` skill.
   Never reproduce against production data.
2. **Capture a control** next to the failure — the nearest case that works. Without
   it you cannot separate a broken feature from bad data.
3. Record before/after and a screenshot. That becomes the issue comment.
4. Only then find the root cause.

Traps that produce false results here:
- **Service worker staleness.** An "it's still broken" on ignia.fit is a stale
  `ngsw` bundle until proven otherwise. Hard-reload first.
- **`permission-denied` after a rules edit** usually means rules are not deployed
  yet, not that the code is wrong.
- **Web-only repro on a shared-logic bug.** If the logic lives in `packages/core`,
  reproduce on both frontends or say explicitly that you only checked one.

If you cannot reproduce, stop and report what you tried, what you saw instead, and
what you'd need. Never patch an unconfirmed defect. "Works as expected, with
evidence" is a valid outcome and gets commented on the issue.

## 3. Implement

Branch off `main` with the repo's existing naming — `feat/`, `fix/`, `refactor/`,
`chore/` + a short topic (`fix/history-window-off-by-one`). Follow the repo's
architectural seams: `LEDGER_PORT` and all adapters (not just Firebase), store
facets over direct Firestore reads, shared math into `packages/core`, both
locales in that platform's key shape, both feature-flag platforms when a gate
changes.

## 4. Verify before you claim anything

- `verify-build` skill for the units the change touched.
- Layer tests: `npm test`, `npm run test:ledger`, `npm run test:rules`,
  `npm --prefix packages/core test`.
- `test-web-ui` skill for any visible surface.
- `npm run doctor` (full, with cloud checks) — CI only runs `--no-cloud`, so the
  released-ruleset / deployed-functions / free-tier / issue-tracker checks are
  yours to run from the workstation.

Then re-run the exact repro steps from §2 on a clean load and confirm the behavior
actually changed.

## 5. Evidence back on the issue

```sh
gh issue comment <n> --body "..."
```

One comment: what changed (as `path:line`), how it was verified, the before/after
observation, and anything that stayed broken. Keep it short — this is a record for
the owner, not a report to a stakeholder.

**Screenshots cannot be attached from the CLI.** GitHub has no public upload API
for issue attachments, so `gh` cannot inline an image. Playwright MCP writes
captures to `.playwright-mcp/` (git-ignored on purpose) — reference the local
path in the comment and let the owner drag the file in if the image matters.
Do not commit screenshots to the repo to work around this.

## 6. PR, CI, merge

```sh
gh pr create --base main --title "fix(history): ..." --body "Closes #<n>

<what + why, 3 lines max>"
```

- Commit and PR titles are conventional-commit style with a scope
  (`feat(tdee):`, `fix(mobile):`, `refactor(ledger):`) — match the log.
- `Closes #<n>` in the body is what links and auto-closes the issue.
- **CI on a PR** runs `doctor --no-cloud` → unit tests → functions build (only if
  `functions/**` changed) → a real production app build. **CI never deploys** —
  releases are pushed manually from the workstation.
- Add the **`eas-build`** label to the PR only when a mobile binary is genuinely
  wanted from it; it queues an EAS build.
- Doc-only pushes to `main` skip CI by design (`paths-ignore`), so a STATUS.md-only
  commit will show no run. That is not a broken pipeline.
- Push to `main` directly only if the owner explicitly asks.

## 7. The gate everyone forgets: STATUS.md §4

`npm run doctor` check 5 fails if either:
- §4 cites an issue number that is **no longer open**, or
- an open **`wayfinder:task`** issue is **absent** from `STATUS.md`.

So closing a task means editing §4 **in the same PR** that closes it. If the work
landed but ships in no binary yet (anything under `apps/mobile/**`), it moves to
§2 ("Written, merged, and in no binary") rather than disappearing.

## 8. After the merge

- **`CHANGELOG.md`** — one entry, newest first, for anything user-visible. This is
  the release-notes artifact; there is no wiki.
- **An ADR** (`docs/adr/`) only if the change established a *decision* others must
  follow later. Bug fixes do not earn one.
- **Delete the plan document** if the work had one. Outcome → `CHANGELOG.md`,
  reasoning → ADR, current state → `STATUS.md`. Git keeps the original.

## Answering "what's open?"

Lead with `STATUS.md` §4, not `gh issue list` — the list gives titles, §4 gives
what is actually startable today. Call out which items are blocked on the iOS
build constraint so the owner is not offered work that cannot move.
