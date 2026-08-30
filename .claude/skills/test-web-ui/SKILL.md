---
name: test-web-ui
description: Serve the Angular web shell (marketing pages + /admin — the logging app is retired, ADR-0036) and drive it in a real browser with Playwright to verify a change or smoke-test the admin sign-in. Use whenever a web change has a visible surface, after any Firebase SDK change, or when asked to "check it works", "see the app", or "reproduce this".
---

# Verify the web shell in a real browser

Since ADR-0036 (2026-08-30) the Angular app is a **shell** — landing, calculators,
comparisons, FAQ, legal, `/status`, `/changelog`, public profiles — plus one
signed-in surface, **`/admin`**. There is no logging app, no ledger, no service
worker (a safety worker at `/ngsw-worker.js` only evicts old installs). What
can still only be seen in a browser: the prerendered pages hydrating, the
retired-routes page, the sign-in card on `/admin`, and the admin panel itself.

## Pick the right server

| Command | What it talks to | Use it for |
|---|---|---|
| `npm run build && npx firebase serve --only hosting --port 5055` | the built `dist` through the real `firebase.json` (rewrites, `cleanUrls`, headers) | **the default** — prerendered pages, `/app` → retired page, `/open`, `/u/**` rewrites |
| `npm start` | `ng serve` → **PROD Firebase** | `/admin` as the owner, read-only visual checks |
| `npm run dev` | emulators + `ng serve` | only if a change touches the emulator-seeded flows (`e2e@test.com` / `UserTest123`) |

`/admin` against emulators is empty and meaningless. **For layout work use the
preview seam: `npm start` then `http://localhost:4200/admin?preview=1`** — a
dev-build-only mode (`admin-preview.ts`) that renders the whole console on
fixture data with no sign-in and no Cloud Function calls; every section,
the drawer, the palette and both themes are drivable there. The Firestore
`ERR_CONNECTION_REFUSED` noise in the console is the dev environment pointing
at emulators that are not running — not a panel bug. Real data needs `npm
start` signed in as the owner. **Never sign in as `review@ignia.fit`** (Apple App
Review's account) or `demo@ignia.fit` (screenshot captures).

## Drive it

Use the Playwright MCP tools (`browser_navigate`, `browser_snapshot`,
`browser_console_messages`) headlessly. Routing is signal-based but URL-backed,
so deep links work:

`/` · `/calculator` · `/macros/lose/180-lb` · `/faq` · `/vs/myfitnesspal` ·
`/transformations` · `/u/<slug>` · `/status` · `/privacy` · `/terms` ·
`/changelog` · `/admin` · **`/app`, `/trends`, `/history/…` → the retired page**

The admin panel is **desktop-only by design** — at phone width it renders a
one-line "open this on a desktop-width window" notice, which is correct.

## The standard pass

1. Navigate to the changed surface.
2. `browser_snapshot` — confirm the change is rendered, not just in the DOM.
3. **Read the console.** `browser_console_messages` on every run. Angular
   template errors and Firestore `permission-denied` surface here and nowhere else.
4. **Check phone width** (390×844) for anything on the marketing pages; the
   shell is still phone-first for visitors.
5. Check dark and light if the change is visual.

## Non-negotiable smoke tests

- **After any Firebase SDK change: sign in on `/admin` end to end.** A second
  copy of the Firebase SDK broke prod sign-in once and typechecks cleanly.
- **After a `firestore.rules` change:** rules must be deployed before clients
  write the new field; the dev app talks to prod Firestore.
- **After touching `firebase.json`, `prerender-seo.mjs` or `sentry-release.mjs`:**
  serve the built dist (first row above) and check `/app` is the retired page,
  `/app-version.json` is 200, `/ngsw-worker.js` is the safety worker, and
  `/es/calculator` carries Spanish `<head>` meta.

## Out of scope

- **The Expo app.** Playwright cannot drive it. Use `cd apps/mobile && npx expo start`
  and a device; verification there belongs to the owner.
- **Automated regression suites.** Unit tests are `npm test` / `npm run test:rules`.

## Cleanup

Stop whichever server you started. `npm run dev` exports emulator state to
`./.emulator-data` on exit — let it exit cleanly rather than killing it.
