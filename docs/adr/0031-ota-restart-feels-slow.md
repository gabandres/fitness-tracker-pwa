# ADR-0031: The OTA restart cannot be instant, so stop pretending and cover it

- **Status:** **accepted for A and B** (shipped 2026-08-24). **C remains held**, on the measurement below that does not exist yet.
- **Date:** 2026-08-24
- **Reported by:** the owner, on a real device: *"the Update and Restart link on the OTA doesn't feel instant… I feel that it can be improved substantially."*

## Context

Tapping **Restart** on the update banner runs `Updates.reloadAsync()`. The
complaint is that it does not feel immediate.

### What is already fast, and is not the problem

Read the code before blaming the network. `useOtaUpdate` in
`apps/mobile/src/lib/app-update.ts` only sets `pending` **after
`fetchUpdateAsync()` has resolved**:

```ts
const result = await Updates.checkForUpdateAsync();
if (!result.isAvailable || !alive) return;
await Updates.fetchUpdateAsync();
if (alive) setForegroundPending(true);
```

So by the time the banner is on screen the **bundle is already on disk**. The
tap does not download anything. Any theory that starts with "it has to
propagate" or "it's fetching the update" is wrong, and the code says so.

### What the tap actually costs

`reloadAsync()` is not a screen transition. Expo's own documentation is blunt
about it: it *"instructs the app to reload"*, the promise *"fulfills right
before the reload instruction is sent to the JS runtime"*, and it is
**"unsafe to execute logic after this call because the app may terminate
immediately."**

That is a **full JavaScript runtime restart**. Everything the app does at boot
runs again: React mounts from nothing, `AuthGate` resolves, every focus-gated
Firestore listener re-subscribes, Today re-hydrates its seven cached slices,
and the bundle is re-evaluated. On the LG G6 — a 2017 phone, and the slowest
device Ignia supports — that is seconds, not milliseconds.

**No configuration makes this instant, because it is a process restart.** This
ADR should not pretend otherwise, and a fix that claims to would be lying.

### So the real defect is feedback, not duration

Today the only acknowledgement is `ota.applying` disabling the button. Between
the tap and the app coming back, the user gets the OS's own blank/splash
handoff. A restart with no explanation reads as a hang — which is exactly the
report.

## What can actually change

**`Updates.reloadAsync()` takes an options object with `reloadScreenOptions`.**
That is the lever: it replaces the dead gap with a screen we control. Confirmed
present in the installed SDK's API surface; **the exact field set must be read
off the installed `expo-updates` types at implementation time and not guessed
from memory** — this repo has been burned before by writing a call signature
from recollection.

Three candidate changes, in order of honesty-per-effort:

| | Change | Effect |
|---|---|---|
| **A** | Pass `reloadScreenOptions` so the restart shows Ignia's own brand/loader instead of a blank handoff | Turns "did it hang?" into "it's restarting". Does not change duration by one millisecond, and is the only change that addresses the actual complaint |
| **B** | Reword the banner. *"Restart"* promises something a process restart cannot deliver; the body already says *"Restart Ignia to get the latest fixes"* | Sets the expectation the mechanism can meet |
| **C** | **Reduce how often anyone taps it at all.** `useAutoApplyOta` already reloads at cold start and on the next foreground — the banner is the *fallback* for whoever lands between those moments. If most taps happen where an auto-apply would have fired anyway, the best fix is fewer banners, not a faster one | Removes the interaction rather than decorating it |

## The measurement this needs first

**Nothing here should ship on a feeling, including the owner's.** The number
that decides between A/B/C does not exist yet:

1. Time from tap to first paint of Today, on the **LG G6** and on an iPhone.
   `adb shell am force-stop` + relaunch is not the same path; measure the real
   `reloadAsync` restart.
2. How much of that is bundle evaluation versus app boot (auth, listeners,
   cache hydration). If boot dominates, the win is in boot and the reload
   screen is cosmetic — worth knowing before choosing.
3. How often the banner is actually tapped versus how often `useAutoApplyOta`
   applies silently. If the banner is rare, C is the answer and A is polish on
   a path few people take.

## Proposed decision

**Ship B immediately** (copy, no risk, JS-only), **ship A once the field set is
read off the installed types**, and **hold C until (3) is measured** — it is a
behaviour change to the update path, which is the one path that, if broken,
cannot be fixed over the air.

Explicitly **do not** claim the restart became faster. It did not. It became
legible.

## What was actually read off the installed SDK, and what it changed

`expo-updates@57.0.15`, `build/ReloadScreen.types.d.ts` and
`build/Updates.d.ts`. The signature is:

```ts
reloadAsync(options?: { reloadScreenOptions?: ReloadScreenOptions }): Promise<void>
```

and `ReloadScreenOptions` is `backgroundColor`, `image`, `imageResizeMode`,
`imageFullScreen`, `fade`, and `spinner: { enabled, color, size }`. Two things
in that surface contradict what this ADR assumed, and both were found by
reading it rather than by writing the call from memory — which is the reason the
ADR insisted on reading it.

**1. The options are an ARGUMENT, so the live theme IS available.** The
Consequences section below says the reload screen "cannot read `useTheme()` and
must be configured statically". That is true of the `app.json` reload-screen
config and **false** of this path: `reloadAsync` is called from JS a moment
before the restart, so the active palette can be passed in. A dark-theme user
now gets a dark restart instead of a white flash. `reloadScreenOptions(colors)`
in `apps/mobile/src/lib/app-update.ts` is a pure function of the palette and is
unit-tested against both.

**2. The logo cannot be shown, and the obvious version renders it at 1024dp.**
`resolveImageSource` turns a `require()` id into `{ url, width, height, scale }`
via `Image.resolveAssetSource`, which reports the asset's **pixel** size — ours
is 1024x1024 — and both `ReloadScreenView`s then treat width/height as
**dp/points**. On the LG G6 (density 3.5) that lays the mark out at 3584px and
crops it. Passing an explicit `ReloadScreenImageSource` would fix the size, but
image and spinner are both centred by the native views, so the two stack; and
the mark alone is a still frame, which reproduces the launch splash and reads as
exactly the hang this change exists to remove. **Shipped: spinner only**, coral
on the app's own canvas. The familiar logo splash follows a beat later anyway
when the new bundle boots.

## Where the three measurements stand

- **(1) tap to first paint** and **(2) the bundle-eval / app-boot split** —
  still unmeasured. Neither could be taken before this shipped: producing a
  pending update on the device requires publishing one.
- **(3) banner taps vs silent auto-applies** — **not instrumented, and it is
  not free.** The obvious route (a `usage-events` counter) does not work as
  written: `track()` buffers in memory and flushes on backgrounding or every
  five minutes, and `reloadAsync` kills the process immediately — so a count
  incremented at the tap is lost by construction, and would under-report
  precisely the number being measured. A durable version has to write the path
  label to `AsyncStorage` before the reload and fold it in on the next boot,
  which is a change to the update path plus a new event in three places
  (`packages/core/src/usage-events.ts`, `firestore.rules`, and the rules test).
  **C stays held until someone decides that is worth doing.** It is not blocked
  on knowledge; it is blocked on a choice.

## Consequences

- **The banner keeps telling the truth.** Its current copy is accurate; the
  failure is the silence after the tap, not the sentence before it.
- **A reload screen is a new brand surface** and needs the dual-theme treatment
  (ADR-0014). ~~It appears while the app is not running, so it cannot read
  `useTheme()` and must be configured statically.~~ **Wrong — corrected above.**
  The options are an argument to `reloadAsync`, evaluated in JS before the
  restart, so the live palette is available and is what ships.
- **This is JS-only and rides an OTA.** No binary, either platform.

## What is out of scope

- Making `reloadAsync` faster. It is a process restart; that is the contract.
- Reducing app boot time generally. Real, separate, and measured elsewhere
  (the on-device food index is already lazy for exactly this reason).
