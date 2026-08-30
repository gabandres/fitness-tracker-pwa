---
name: quick-things
description: Batch workflow for shipping several small fixes or polish items in one sitting. Trigger when the owner opens with "a couple quick things", "a few quick fixes", "some small items", or otherwise hands over a numbered list of small changes. Sets the standing goal, the per-item ship boundary, and the build → verify → commit → deploy → confirm cadence.
---

# Quick things — batch quick-fix workflow

When work is framed as a list of small items, the **whole list is a standing
goal**. Work items one at a time, in the owner's order, and do not stop until the
list is done.

## Ship boundaries

- The owner's own numbering (`1.`, `2.`, `3.`) defines the boundaries.
- **Everything under one number ships as one unit** — one commit, one deploy.
- Never fold two numbered items into one commit; never reorder them.
- Do not ask "should I continue?" between items. The list is the plan. Ask only
  when an item genuinely needs a decision, then keep moving on the rest.

## What "shipped" means here

Compiling is not shipped. Committed is not shipped. Per item:

1. **Classify the item first** — it decides the whole path:
   - `src/**` → web, ships in-session via hosting deploy.
   - `functions/src/**` → ships in-session via functions deploy.
   - `firestore.rules` → ships in-session, and **ships first** (see ordering below).
   - `apps/mobile/**` → **cannot ship in-session.** EAS build + App Store review.
     Done means merged + `STATUS.md` updated to say it is merged and in no binary.
   - `packages/core/**` → touches both apps; the web half ships, the mobile half
     does not. Say so.
2. **Build + verify** — `verify-build` skill for the units the item touched, then
   `test-web-ui` for anything with a visible surface. Run the tests that cover the
   layer (`npm test`, `npm run test:rules`, `npm --prefix packages/core test`).
3. **Commit** — scoped to that item only, on a branch (`wt/<topic>`), since the
   default branch is `main`. If the owner says to commit straight to `main`, do
   that instead. Commit only within a batch the owner asked you to ship.
4. **Deploy, in the right order** — rules before clients, always:
   ```sh
   firebase deploy --only firestore:rules      # if rules changed — FIRST
   npm run build && firebase deploy --only hosting
   firebase deploy --only functions            # if functions changed
   ```
   `npm run build` must be the **prod** build; a dev build has no
   `build-info.json` and the deploy guard refuses it.
5. **Verify it deployed** — hit the real surface on `https://ignia.fit`, not
   localhost. A hard reload, in case a pre-ADR-0036 service worker is still
   holding the old bundle (the safety worker evicts it on first load).
6. **Then it is shipped.** Say in one line what shipped and where to look at it.

The owner may say "deploy once at the end" — then steps 1–3 run per item and 4–6
run once for the batch. Per-item commits still stand.

## After each ship

Play the confirmation sound so the owner knows to go look:

```powershell
(New-Object Media.SoundPlayer 'C:\Windows\Media\tada.wav').PlaySync()
```

## Batch bookkeeping (once, at the end — not per item)

- **`CHANGELOG.md`** — one entry for anything user-visible. Newest first.
- **`STATUS.md`** — only if the batch changed what is true right now: live
  version, what is merged but in no binary, what is unblocked.
- Nothing else. A batch of polish items does not earn an ADR or a plan document.

## Guardrails

- These are polish passes. If an item turns out to need a refactor, a schema
  change, or an ADR, stop that item, say so, and move to the next one — do not
  quietly turn a quick fix into a project.
- **Parity**: a web change with an obvious mobile counterpart gets the mobile port
  committed in the same batch (mobile is the long-term product), even though it
  ships later. A mobile-only change to shared behavior is a smell — check whether
  the logic belongs in `packages/core`.
- **i18n**: any new user-facing string lands in both `en` and `es-PR` for that
  platform, in that platform's key shape — web Transloco is nested with `{{var}}`,
  mobile is flat with `{var}`.
- Never `--force` push, never skip hooks, never deploy without a prod build.
