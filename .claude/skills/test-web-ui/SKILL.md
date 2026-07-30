---
name: test-web-ui
description: Launch the Angular PWA and drive it in a real browser with Playwright to verify a change, reproduce a bug, or smoke-test a signed-in session. Use whenever a change has a visible surface, after any Firebase/ledger/adapter change, or when asked to "check it works", "see the app", or "reproduce this".
---

# Verify the web app in a real browser

The Angular PWA is where a change can actually be *seen*. Compiling proves
nothing about the ledger, the service worker, or a signed-in session.

## Pick the right server — this is the important decision

| Command | What it talks to | Use it for |
|---|---|---|
| `npm run dev` | **emulators** (auth 9099, firestore 8080, storage 9199) + `ng serve` | anything that **writes** — logging meals, onboarding, settings, repro attempts |
| `npm start` | plain `ng serve` → **PROD Firestore** | read-only visual checks only |

`npm start` uses `environment.development.ts`, which still points at **production
Firebase**. Signing in there is signing into the real project, and anything you
log lands in a real account. Default to `npm run dev`.

Emulator credentials, seeded by `scripts/seed-emulators.mjs`:
**`e2e@test.com` / `UserTest123`** — already onboarded, with sample logs, a
weight, and water. If the emulator data is empty, bootstrap once with `npm run seed`.

**Never sign in as `review@ignia.fit`** — that is Apple App Review's account, with
hand-made rows. `demo@ignia.fit` is for screenshot captures only; leave both alone.

## Drive it

The app serves on `http://localhost:4200`. Use the Playwright MCP tools
(`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill_form`,
`browser_console_messages`) headlessly. Use a visible browser only when the owner
asks to watch.

Navigation is signal-based but URL-backed, so deep links work — go straight to the
surface you changed instead of clicking through:

`/` (today) · `/history` · `/trends` · `/body` · `/train` · `/calculator` ·
`/macros` · `/faq` · `/vs` · `/status` · `/privacy` · `/terms` · `/changelog`

The admin panel is **desktop-only by design** — check it at a desktop viewport, and
do not file its phone layout as a bug.

## The standard pass

1. Navigate to the changed surface, signed in.
2. `browser_snapshot` — confirm the change is actually rendered, not just present
   in the DOM behind a flag.
3. **Read the console.** `browser_console_messages` on every run. Angular template
   errors and Firestore `permission-denied` both surface here and nowhere else.
4. **Exercise the write path** if the change touches data — log something, reload,
   confirm it persisted. A read-only glance misses the entire ledger seam.
5. **Check phone width.** Both apps are phone-first; 390×844 is the shape that
   matters. Resize before declaring a layout good.
6. Check dark and light if the change is visual — both are supported.

## Non-negotiable smoke tests

- **After any Firebase SDK, adapter, or `LEDGER_PORT` change: verify a signed-in
  session end to end.** A second copy of the Firebase SDK broke prod sign-in once
  and typechecks cleanly. Sign out, sign in, write, reload.
- **After a `firestore.rules` change:** rules must be deployed before clients write
  the new field, and the dev app talks to prod Firestore. A `permission-denied` in
  the console after a rules edit usually means "not deployed yet", not "bad code".
- **Before claiming an update-banner or offline fix works:** dev builds skip
  `ngsw.json`, so the service worker behaves differently locally than in prod. That
  class of fix is only truly verified after a prod build + hosting deploy.

## Out of scope

- **The Expo app.** Playwright cannot drive it. Use `cd apps/mobile && npx expo start`
  and a device or simulator; verification there is manual and belongs to the owner.
- **Automated regression suites.** This is an interactive verification recipe, not
  a test suite. Unit tests are `npm test` / `npm run test:ledger` / `npm run test:rules`.

## Cleanup

Stop the dev server when done. `npm run dev` exports emulator state to
`./.emulator-data` on exit — let it exit cleanly rather than killing it, so the
next session starts seeded.
