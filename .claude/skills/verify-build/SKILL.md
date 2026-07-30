---
name: verify-build
description: Verify that the code still builds and typechecks across all four buildable units of this monorepo (Angular PWA, packages/core, functions, apps/mobile) without dumping thousands of log lines into context. Use before a deploy, before merging, after a dependency bump or a cross-cutting refactor, or whenever asked "does it still build?".
---

# Verify the build

Four independent units. A change to `packages/core` can break three of them, and
Angular/tsc failures print the same error dozens of times — which is why this
runs **in a subagent** and returns a verdict, not a log.

| Unit | Command | When it matters |
|---|---|---|
| Angular PWA (root) | `npm run build` | any `src/**` change; **required before every `firebase deploy`** |
| `@macrolog/core` | `npm --prefix packages/core run typecheck` | any `packages/core/**` change |
| Cloud Functions | `npm --prefix functions run build` | any `functions/src/**` change |
| Expo app | `npx tsc --noEmit -p apps/mobile/tsconfig.json` | any `apps/mobile/**` change |

Pick the smallest set that covers what changed. `packages/core` is imported by
**both** apps — a change there means running all four.

## How to run it

**Dispatch a subagent, do not run these inline.** A broken Angular build is
hundreds of duplicated lines; spending the rest of the session's context on them
is the failure this skill exists to prevent.

Use `model: haiku` — this is mechanical log parsing, not judgment — with a prompt
of this shape:

> Run these commands from `Z:\macro-app`, in order, and do not stop on the first
> failure: `<the commands>`. Report back ONLY: per command, pass/fail and the exit
> code; then, for failures, the distinct error lines deduplicated, capped at 20
> with a count of how many more were omitted. No summaries, no fix suggestions, no
> file contents. Under 200 words.

Then report the verdict to the owner in one or two lines, and fix the errors
yourself — the subagent reports, it does not repair.

## What `npm run build` actually does

It is **not** `ng build`. It is `ng build` → `scripts/prerender-seo.mjs` →
`scripts/sentry-release.mjs`. That matters:

- A green `ng build` with a failing prerender step is still a failed build.
- `sentry-release.mjs` no-ops with a log line when the `SENTRY_*` vars are absent.
  That is normal locally and is **not** a failure.
- The prod build is what emits `ngsw.json`. Deploying a dev build leaves the
  update banner firing for every user — never deploy from `npm run watch` output.

## Typecheck-only, when you just need speed

For a quick "did I break types" during an edit loop, `npm --prefix packages/core run typecheck`
and the mobile `tsc --noEmit` are seconds. The Angular app has no standalone
typecheck script — `npm run build` is the check. Do not add one without asking.

## Not this skill's job

- **Tests** — `npm test`, `npm run test:ledger`, `npm run test:rules`,
  `npm --prefix packages/core test`. Building is not passing.
- **Runtime verification** — see the `test-web-ui` skill. Compiling is not working.
- **EAS / native builds** — `eas build` is a remote, minutes-long, quota-consuming
  job. Never queue one to "check the build"; `tsc --noEmit` is the local proxy.
