# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code (installed SDK is `expo@^54`; keep this URL in sync with `apps/mobile/package.json`).

# Entry point is NOT `expo-router/entry`

`package.json` `main` is a custom **`index.js`** at the app root. It imports
`expo-router/entry` for its side effect (routing behaves identically) and then
registers the Android home-screen widget's task handler — which must run at
module scope, before React mounts, because Android can wake the widget when the
UI was never started. Don't "fix" `main` back to `expo-router/entry`; it
silently kills the widget on Android. See `WIDGET.md`.

# `src/app/` holds ROUTES AND NOTHING ELSE — not even tests

Expo Router builds its route tree from a Metro `require.context` over
`src/app`, and [its regex excludes only `+api` and `+html`](https://docs.expo.dev/router/reference/testing/).
Every other file there is treated as a route **and bundled into the app**. A
colocated `*.test.tsx` therefore drags `@testing-library/react-native` into the
production bundle, which requires Node's `console`, which Metro cannot resolve:

```
Unable to resolve module console from @testing-library/react-native/dist/helpers/logger.js
```

Mobile tests live in **`src/__tests__/`** (or beside a non-route module, like
`src/components/SignInMethodsCard.test.tsx`) and import the screen through the
alias — `@/app/(app)/train`, never `./train`.

**`tsc --noEmit` and `jest` both pass while this is broken.** They do not run
Metro. On 2026-08-06 it took two EAS builds to the *Bundle JavaScript* phase
before anything noticed — a latent break from 2026-08-05, since no EAS build
had run in between. The cheap local gate is a real bundle, and it costs
nothing:

```sh
cd apps/mobile && npx expo export --platform android --output-dir <tmp>
```

**Run that before queueing any EAS build.** (Errored builds did not consume
plan quota in that incident — measured 7/15 before and after — but they cost
the queue wait, which on the Android free tier has run to two hours.)

# An OTA update that misses everyone looks EXACTLY like one that worked

This app uses **EAS Update**. A JS-only change ships with `eas update` and needs
no build — but delivery is gated on `runtimeVersion`, which is the
**`fingerprint` policy** (`app.json`), derived from the native dependency graph.

**If the fingerprint changed, `eas update` still succeeds.** It publishes under a
*new* runtime version that no installed binary matches, so every tester silently
stays on old code. Nothing errors. There is no warning. The only signal is that
the bug you "fixed" keeps getting reported.

So the gate before every publish is:

```sh
cd apps/mobile && npx expo-updates fingerprint:generate --platform android
```

Compare the `hash` against the fingerprint of the binary testers are running.
**Same → the update lands. Different → it reaches nobody and you need a build.**

Fingerprints of the binaries carrying `expo-updates` (update these when new ones
ship):

| Platform | Fingerprint |
|---|---|
| iOS | `781be0c885005e1d02bcf41408988c6622ff222e` |
| Android | `c0b85c15e6631d99e8ccef61867d937389094ae6` |

**Changes the fingerprint** (⇒ needs a build): any dependency carrying native
code, native config in `app.json` (permissions, icons, splash, plugins,
entitlements), an Expo SDK upgrade, the widget/watch Swift or Kotlin. A pure-JS
dependency usually does not — but "usually" is why you run the command instead of
reasoning about it.

**Does NOT change it** (⇒ ships over the air): `.ts`/`.tsx`/`.js` source, UI,
styles, business logic, i18n strings, Metro-bundled assets.

Two more things worth knowing: testers get an update on the **next** launch, not
the current one (it downloads in the background and applies on the following
start), and a bad update is undone with `eas update:roll-back-to-embedded`, which
returns everyone to the JS baked into their binary.

See the `build-android` skill for the full decision.

# This app is in production

Treat every change here as a production change: this app is on the iOS App Store.

**Do not read a version number out of `app.json` — it is not evidence of what
shipped.** Which version is live, which build backs it, and what is merged but
not yet in any binary all live in **`STATUS.md`**, which carries the command to
re-check each one. Nothing in this folder should restate them; a second copy is
how "planned" and "shipped" became indistinguishable here before.
