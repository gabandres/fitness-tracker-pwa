# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code (installed SDK is `expo@^54`; keep this URL in sync with `apps/mobile/package.json`).

# Entry point is NOT `expo-router/entry`

`package.json` `main` is a custom **`index.js`** at the app root. It imports
`expo-router/entry` for its side effect (routing behaves identically) and then
registers the Android home-screen widget's task handler — which must run at
module scope, before React mounts, because Android can wake the widget when the
UI was never started. Don't "fix" `main` back to `expo-router/entry`; it
silently kills the widget on Android. See `WIDGET_PLAN.md`.

# This app is LIVE

Shipped on the iOS App Store (v1.1.0). Treat changes here as production
changes. Android is not launched. Several planning docs in this folder describe
work that has since shipped — check the code before scoping anything as new.
