---
name: test-mobile-web
description: Render the Expo app in a browser (react-native-web) against production and drive it by testID, with a throwaway account that is deleted afterwards. Use to see a mobile change working before an OTA when no device, simulator or emulator is available, or when asked to "check it rendered", "look at the screen", "try it in the app".
---

# A rendered check of the mobile app, in a browser

The browser runs the same JavaScript against the same production backend. It is
NOT the native render: safe areas, the keyboard, native menus and both screen
readers stay unseen, and the report says so.

## Steps

1. **Start the server** (it restarts one that is already running):
   `pwsh -File scripts/web-check/server.ps1 start` → done when it prints
   `http://localhost:8097 answers`.
   Run it again after EVERY edit: under `CI=1` Metro never reloads.
2. **Open the page** with the preview tools (`preview_open
   http://localhost:8097`). `preview_open` often reports a 15 s timeout while
   the tab loads anyway: check with `preview_status`, do not open a second tab.
   Done when the splash has gone (first bundle: 1–2 minutes).
3. **Load the helpers**: paste `scripts/web-check/helpers.js` as one
   `preview_evaluate` call. Repeat after every navigation or reload.
4. **Sign up a throwaway account** in the app: `delivered+<label>@resend.dev`
   and a password you keep for step 7. That domain is the mail provider's test
   inbox; any other invented domain makes `sendVerificationEmail` log a
   production ERROR.
5. **Drive the change** by testID: `__click('…')`, `__text('…')`,
   `__until('…')`; type and upload with `preview_act` and the selector
   `[data-testid="…"]`. A file upload needs a real `preview_act` click on the
   picker first. Done when every state the change claims has been seen: read
   the text off the page, do not infer it from the code.
6. **State for the check account only** (a plan window, a profile field): write
   it to that account, never to a person's.
7. **Delete the account**: `node scripts/web-check/cleanup-account.mjs <email>
   <password>` → done when it prints `sign-in after delete → 400`.
8. **Stop the server**: `pwsh -File scripts/web-check/server.ps1 stop`, and
   close the tab you opened.

## Reference

- **A script over 15 s**: `preview_evaluate` times out at 15 s. Start the work
  without awaiting, push progress to `window.__log`, read it in a later call.
- **A phone-only call that crashes the web run** gets an optional call at the
  call site (`Keyboard.metrics?.()`), which is the same call on a phone.
- **Sentry**: the browser run reports nothing (`lib/sentry.ts` returns early on
  web), so a check cannot open an issue.
- **AI callables without the UI**: `analyzePhoto` with `{ data: { photoBase64:
  "…" } }` and an unverified token returns `failed-precondition` /
  `EMAIL_NOT_VERIFIED` before any quota is spent.
- **A real device instead**: the Android emulator needs the Windows Hypervisor
  Platform (`STATUS.md` §1), and a release binary loads only PUBLISHED updates,
  so it checks an OTA after it goes out.
