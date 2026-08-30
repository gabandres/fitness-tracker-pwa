---
name: verify-build
description: Verify that the code still builds and typechecks across all four buildable units of this monorepo (Angular web shell, packages/core, functions, apps/mobile) without dumping thousands of log lines into context. Use before a deploy, before merging, after a dependency bump or a cross-cutting refactor, or whenever asked "does it still build?".
---

# Verify the build

Four independent units. A change to `packages/core` can break three of them, and
Angular/tsc failures print the same error dozens of times — which is why this
runs **in a subagent** and returns a verdict, not a log.

| Unit | Command | When it matters |
|---|---|---|
| Angular web shell (root) | `npm run build` | any `src/**` change; **required before every `firebase deploy`** |
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
- The prod build is what writes `build-info.json` (last) and the prerendered
  pages. The deploy guard refuses a dist without it — never deploy from
  `npm run watch` output.

## Typecheck-only, when you just need speed

For a quick "did I break types" during an edit loop, `npm --prefix packages/core run typecheck`
and the mobile `tsc --noEmit` are seconds. The Angular app has no standalone
typecheck script — `npm run build` is the check. Do not add one without asking.

## Not this skill's job

- **Tests** — five suites, **1,262 tests**, all gated by CI as of 2026-08-09:

  | Suite | Command | Needs |
  |---|---|---|
  | Web shell (23) | `npm test` | — |
  | `packages/core` (648) | `npm --prefix packages/core test` | — |
  | **Expo app (129)** | `npm --prefix apps/mobile test` | — |
  | Functions + `firestore.rules` (260) | `npm run test:rules` | **JDK 21** |

  `test:rules` runs **every** functions spec, not only `firestore-rules.spec.ts`
  (which is 47 of the 260) — a distinction that produced a wrong baseline once.

  Building is not passing.

  **The two emulator suites need JDK 21 and this machine defaults to 17.** Both
  JDKs are installed; `java` on `PATH` resolves to the wrong one, and
  firebase-tools then refuses with *"no longer supports Java version before 21"*,
  which reads exactly like a missing install. `scripts/require-java21.mjs` now
  runs ahead of both suites and prints this fix — heed it rather than
  concluding the suite is broken, which has happened. Run the two suites
  **separately**: back to back, the second inherits the first's emulator port
  and reports a phantom failure. Per shell:

  ```sh
  export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot"
  export PATH="$JAVA_HOME/bin:$PATH"
  ```

  Note the **msys path form** (`/c/…`, not `C:/…`) — a Windows-style path in
  `PATH` is silently ignored by Git Bash and `java -version` keeps saying 17. Do
  not set `JAVA_HOME` globally: the Android Gradle build runs on 17. Full note in
  `docs/DEV_ENVIRONMENT.md` §0.

  **The Expo suite covers wiring and copy, never layout.** React Native Testing
  Library renders the element tree but runs no Yoga pass, so a view collapsed to
  zero height still "renders" and every assertion against it passes — that is
  exactly how a `flex: 1` bug hid measurement input from users while green. Layout
  belongs to the Maestro flows in `apps/mobile/.maestro/`, which are **not** in CI
  (they need a booted emulator) and should be run before an EAS build.
- **Runtime verification** — see the `test-web-ui` skill. Compiling is not working.
- **EAS / native builds** — `eas build` is a remote, minutes-long, quota-consuming
  job. Never queue one to "check the build"; `tsc --noEmit` is the local proxy.
