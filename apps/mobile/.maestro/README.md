# Device smoke tests (Maestro)

The only layer in this repo that tests **what a user can actually see**.

## Why this exists as a separate layer

The jest/RNTL suites in `src/**/*.test.tsx` cover wiring, state and copy. They
cannot cover layout: React Native Testing Library renders the element tree but
never runs a Yoga layout pass, so a view collapsed to zero height is still
"found" by `getByTestId` and every assertion against it passes.

That is not hypothetical here. On 2026-08-05 a tester reported that typed body
measurements never appeared. The value was in component state and written to
Firestore correctly; a stray `flex: 1` — written for a row layout, reused in a
column — resolved to `flexBasis: 0` and clipped the digits out of view. A
component test would have gone green through the entire incident.

So the rule for this directory: **assert on visibility, not existence.**
`assertVisible` fails when text is not rendered on screen, which is the only
assertion that can catch a layout regression.

## Running

Maestro is not an npm dependency — it is a standalone binary, installed once:

```sh
curl -Ls "https://get.maestro.mobile.dev" | bash        # macOS/Linux
# Windows: see https://docs.maestro.dev — or run these from WSL
```

Then, with an emulator or simulator booted and a **dev build** installed (not
Expo Go — the app uses native modules Expo Go does not carry):

```sh
cd apps/mobile
maestro test .maestro/measurements.yaml    # one flow
maestro test .maestro                      # all flows
```

## Deliberately not in CI

These need a booted emulator and a real build, which means either a macOS
runner or an Android emulator on a Linux runner with KVM — minutes and setup
cost that the current cadence does not justify. Run them locally before an EAS
build, which is the moment their answer actually matters.

Flows assume an already-signed-in session (`clearState: false`). Sign-in is its
own concern; re-authenticating inside a measurement flow would make an auth
failure look like a measurement regression.
