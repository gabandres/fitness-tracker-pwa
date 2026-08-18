# Full UX/UI regression sweep

Walks **every screen and mode** of the app, asserting visibility of each
surface's anchor elements and capturing a screenshot per step into
`.maestro/regression/shots/`. The screenshots are the real audit — assertions
are the skeleton that stops the walk when a screen fails to render at all, but
only a human (or agent) LOOKING at the captures catches a collapsed field, an
off-screen button, or a mis-styled row.

**What is and is not covered lives in `coverage.md` — one row per
screen × state × platform, with the run date that earned each ✓.** Update it in
the same commit as any flow change; a surface with no row makes the suite's
coverage claim false. Flows 11–13 (log→edit→delete) and `empty/` (fresh
account) additionally verify against **Firestore itself** via
`scripts/qa-regression-verify.mjs` — the interleave is at the bottom of
coverage.md.

Suite-wide conventions the newer flows depend on:

- **Nonce suffixes.** Every flow that deep-links the add sheet appends its own
  flow number to the nonce (`${NONCE}-09`, `-10`, `-11`, `-14`, `-15`), so one
  directory run never repeats a value into the warm app. Flow 02 uses the bare
  `${NONCE}`. New sheet-opening flows take the next `-NN` suffix.
- **Multiplier flows restore their state in their own tail** — 09 flips the
  locale back to EN (a Firestore profile field: a midway death leaves the
  ACCOUNT Spanish — recover with `qa-regression-verify.mjs set-locale`), 10
  flips the theme back to System (device-local AsyncStorage: a midway death
  leaves the SANDBOX dark and every later shot dark with it — re-run 10 or fix
  by hand in Settings).
- **The suite never spends AI money and never mutates QA state it does not
  restore**: coach is walked idle, refine-targets is never saved, water is +8
  then −8, the e2e row is deleted by its own part 3 and its preset by the
  admin script's `cleanup`.

## Why this exists

On 2026-08-08 a Release 1 OTA shipped with the add sheet's search field
collapsed to a bare pill — its two new `flex: 1` neighbours squeezed it to
nothing. All 125 jest tests passed over it, because RNTL renders the element
tree and never runs a Yoga layout pass. The owner found it on a real phone
within minutes. This suite is the answer: after ANY UI change, run the sweep on
both platforms and look at the shots before publishing.

## Running

Signed-in session required (`android-signin.yaml`, works on both platforms).

**Hosts, re-measured 2026-08-18.** The 2026-08-17 Android-host move broke the
setup on BOTH platforms, silently and in two different ways, and this section
described a machine that could no longer run any of it. What follows is what
was actually executed.

### iOS — `ignia-mac`, the only working host today

Two breakages, neither of which announces itself until you try:

- **`openjdk@17` is gone**, removed with the Android toolchain. The Mac's
  default `java` is 11, on which Maestro 2.x refuses to start at all:
  `ERROR: Java 17 or higher is required.` Homebrew's keg-only `openjdk` is
  26.0.2 and Maestro 2.8.0 runs on it fine — it simply is not on `PATH`.
- **There are no simulator devices left.** `simctl delete all` was part of the
  disk reclaim (`DEV_ENVIRONMENT.md` §3.9), so `maestro test` has nothing to
  auto-select. Create one — and pass `--device` explicitly regardless, because
  this is a shared laptop and another simulator is routinely booted beside ours,
  which makes auto-selection a coin flip.

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk       # 26.0.2 — NOT openjdk@17, which no longer exists
export PATH=$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH

UDID=$(xcrun simctl create Ignia-QA \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17 \
  com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcrun simctl boot "$UDID"

cd ~/fitness-tracker-pwa/apps/mobile
npx expo run:ios --configuration Release --device "$UDID"   # Release: the suite needs a standalone bundle, not Metro
maestro --device "$UDID" test .maestro/regression/
```

Launch that build **detached** (`nohup caffeinate -dims …`) — an SSH-attached
build dies as `** BUILD INTERRUPTED **` with no `error:` line anywhere, a
signature that reads like a linker crash. `build-ios`'s `REFERENCE.md` carries
the measurement.

### Android has NO host — 2026-08-18

Android UI regression is **unhosted**. This is not a missing install:

| Machine | Why it cannot run the Android suite |
|---|---|
| `ignia-mac` | Android SDK, emulator and `openjdk@17` were all removed on 2026-08-17, when Android's build host moved to Windows (`DEV_ENVIRONMENT.md` §3.11) |
| Windows workstation | Snapdragon X Elite — **ARM64**. No Android emulator runs on it, by any route |

**Maestro itself is fine on Windows**: 2.8.0, installed natively, no WSL — the
docs discourage WSL explicitly ("advanced port configuration and can introduce
issues"). The emulator is the part that cannot run, measured 2026-08-18:

- an **arm64-v8a** AVD is refused by the SDK's `emulator.exe`, which is the
  x86_64 build running under Prism: `Avd's CPU Architecture 'arm64' is not
  supported by the QEMU2 emulator on x86_64 host`;
- an **x86_64** AVD is refused with `x86_64 emulation currently requires
  hardware acceleration!` — Snapdragon carries no Intel/AMD virtualization
  extension;
- Google ships **no Windows ARM64 emulator host build** (the emulator release
  notes offer arm64 hosts for Linux only), and WSL2 on ARM has no nested
  virtualization, so there is no `/dev/kvm` inside it either.

The one Android host this box could offer is a **physical device over adb**,
which Maestro drives natively — and which would also cover the single check no
emulator can reach: Google Sign-In on a **Play-signed** install, broken twice
historically and structurally invisible on a local build. Until that exists,
every Android row in `coverage.md` is frozen at its 2026-08-09 date and
describes an app no tester is running.

**Screenshots do NOT land beside the flows — collect them, or the audit has no
evidence.** Maestro 2.x ignores the path in `takeScreenshot:` as a repo
location and writes under
`~/.maestro/tests/<timestamp>/<flow>/takeScreenshot/<path>`, **a directory it
purges after 14 days**. Measured 2026-08-09: `shots/` had never been created by
any run, so every "review every screenshot" instruction pointed at nothing.
Run the collector after every suite run:

```sh
~/qa-collect-shots.sh     # copies the latest run's shots into shots/
```

The entry sheet is opened through the widget deep link (`ignia://?openAdd=1`)
rather than the FAB's mini-menu, whose chips do not expose accessible text and
would make the suite coordinate-dependent.

**A crashed multiplier flow silently re-themes every LATER flow's shots.**
Also measured 2026-08-09: flow 10 died mid-run, leaving the sandbox dark, and
the next run's flows 01–09 all captured in dark — including the es-PR pass, so
that run's "light" evidence was nothing of the kind. Before trusting a set of
captures, confirm 01's shot is in the theme you expect.


## Third run — 2026-08-18 · iOS on Expo SDK 57 · two shipped bugs, one red closed

**The first Maestro run against any SDK 57 binary**, nine days after the last
one and one SDK major later. Android could not take part — see "Android has
no host" above. iOS: **14/16 on the first pass**, both failures diagnosed, both
fixed, and the diagnosis turned up **two layout bugs that were shipping**.

The headline is that **SDK 57 broke nothing**. Fourteen flows walked Today,
the add sheet in all its modes, the three other tabs, history, search, the
metrics, both locales and both themes without a single new failure. Neither of
the two reds was a regression: one was a suite race that had been misdiagnosed
since 2026-08-09, the other a flow that had simply never run on iOS.

### The two bugs the captures caught

Neither is an assertion failure. Both were found by *looking*, which is the
entire argument for this directory.

- **The body-fat percentage rendered OUTSIDE its card**, clipped by the right
  screen edge — `15.1%` read as `15.1` in English and as `15.` in es-PR, whose
  copy is longer. `bfCard` is a `row` with `space-between`; the text column had
  no `flex`, so three lines of hint copy sized it wider than the card and
  pushed the value off the screen. Present in light, dark and both locales, on
  a screen whose row has been ✓ since 2026-08-09 — a reviewer looked at this
  capture and did not see it. Fixed with `flex: 1` on the text column.
- **Today's list had no bottom padding**, so the LAST diary row ended flush
  with the tab bar and was clipped by the screen edge. Measured from a
  hierarchy dump: bounds `[24,813][378,878]` against an 874pt screen, which put
  the row's centre *on the bar*. That is why the row was untappable by Maestro
  — and it is equally a user-facing bug, because the newest entry is the one
  people reach for. Every other tab already padded.

### `13-e2e-delete` on iOS is GREEN — and the old diagnosis was wrong

The row that "does not open the editor" was two separate faults stacked, and
the note that stood here for nine days described neither correctly.

1. **The "New version available" banner.** Every QA build is `CFBundleVersion`
   1, so it is permanently older than the shipped store version and Today
   renders the banner as soon as its async version check returns. That
   re-render lands mid-flow and returns the list to the top. `scrollUntilVisible`
   had already succeeded; `tapOn` then failed with *element not found*, because
   the row had left the tree. **The old note said the tap landed and no sheet
   opened. It never landed.** Flows 11, 12, 13 and 14 now dismiss the banner
   first — `optional: true` still WAITS ~17s for the element, which is exactly
   what makes it catch an asynchronous arrival.
2. **Then the padding bug above**, which is what made the tap miss once the
   banner was out of the way.

Verified the way this suite is supposed to verify: `entries: []` from
`qa-regression-verify.mjs snapshot`, not a green tick on screen.

### Three iOS mechanics, each of which cost a cycle

- **`back` does not dismiss a `Modal`-hosted BottomSheet on iOS.** There is no
  hardware back, so Maestro sends a left-edge swipe; the router honours that for
  a pushed SCREEN (`04-settings` and `05-history` still use `back` and still
  pass) and a modal never sees it. Nor does the backdrop's own `testID` help —
  it is an `absoluteFill` Pressable *behind* the sheet, so tapping the centre of
  its bounds lands on the sheet. A `swipe` from the component's own drag strip
  did not move it either. What works is a point tap on the backdrop, above the
  sheet's top edge, scoped with `runFlow: when: platform:`.
- **A value that is only a Text CHILD does not exist on iOS.** `containsChild`
  is Android-shaped: iOS merges the child into the touchable's single label. On
  the RIR cell the number was in **no** node at all — which was also a real
  VoiceOver defect, since the cell announced its question and never its answer.
  Fixed in the app by putting the value in the label, then asserted directly.
- **`assertVisible: 'Today'` passes while the splash is still up.** `Today` is
  also the tab bar's label and the bar is in the tree beneath the BrandLoader,
  so flow 01 captured the wordmark for two of its three shots and went green.
  Waiting on a Today element does not fix it either — the loader is an overlay,
  so `hero-rings` is already there underneath. Wait for `brand-loader` to become
  **notVisible**. Generalise the rule: when a capture must prove a screen
  rendered, wait on the disappearance of what covers it, not the presence of
  what it covers.


### One assert had been passing for the wrong reason

Fixing the RIR cell's accessibility label broke an assertion that had been
green since 2026-08-12 — and that is how the assertion was found to be
worthless on iOS.

`16-train-terms` tapped the RIR cell and then asserted the picker's prompt,
`How many more reps could you have done?`. The picker's own header renders
UPPERCASE. The **cell** carried that exact sentence, mixed-case, as its
accessibility label, because iOS merges a touchable's content into one label.
So the assert matched the closed cell. It would have passed if the picker had
never opened at all.

Nothing revealed this until the cell's label changed. The failing run's
hierarchy dump shows all seven picker chips present and correct — the picker
was working perfectly, and the assert that "proved" it was reading a different
element entirely.

**A text assert that names a string the app puts in two places proves
nothing.** Anchor state assertions on an element that exists in ONE of the two
states — here `set-rir-0-0-none`, which the picker renders and the cell never
does. This is the same lesson as *Anchor on IDs, not on icon-button labels*
below, arriving from the opposite direction: there a correct assert failed, here
a broken assert passed.

### A dead driver reads as two failed flows

The first full sweep after the fixes reported `15-search` and `16-train-terms`
as failures, at 12s and 510ms — both far too fast to be real. Neither was:

```
maestro.DeviceUnreachableException: Device became unreachable during deviceInfo
Caused by: java.net.ConnectException: Failed to connect to /127.0.0.1:<port>
... IOSCrashFileFinder.findCrashFile: crashFile=none, totalForBundle=0
```

`crashFile=none` is the tell — **the app did not crash, the XCUITest driver
died.** The cause was disk: three simulator builds had left 11 GB of
DerivedData and the Air was down to 5 GB free. `rm -rf
~/Library/Developer/Xcode/DerivedData/*` returned it to 16 GB and both flows
passed on the next run. The installed app lives in the simulator's own
container, so clearing DerivedData costs no rebuild.

**Check free disk before a sweep, not only before a build.** A flow that fails
in well under a second has not tested anything, and a suite that reports it
alongside real results invites you to debug a flow that is fine.

## Second run — 2026-08-09 · Android 15/15, iOS 14/15 · two real bugs

The suite grew from 4 flows to 15 plus a fresh-account arc, and its first pass
over the new states **found two shipped bugs on surfaces nothing had ever
looked at**:

- **The Android splash rendered the brand as "Igni".** `BrandLoader`'s
  wordmark was clipped of its trailing "a" on every cold start, on every build
  to date. The file already carried a comment describing this exact
  letterSpacing under-measurement and an iOS-era `paddingHorizontal` fix that
  did not cover Android. Now guarded by a `minWidth` wider than the word can
  be, plus `brand-loader-wordmark.test.ts` — **jest/RNTL cannot catch it**
  (no layout pass, no glyphs), which is why it survived every prior build.
- **`lb/wk` was hardcoded in Trends and Body**, so es-PR users read an English
  rate unit beside Spanish copy while Refine targets — and the whole web PWA —
  correctly said `lb/sem`. Both now use the translated key.

Both were verified fixed on the emulator by re-capture, not by reasoning.

Every other failure that run was the suite's own aim, each diagnosed from its
screenshot and confirmed against Firestore rather than assumed: the sleep
Save tap landing on the keyboard, a diary row's long-press hitting the FAB
that overlays it, a full-height sheet with no reachable backdrop, and an idle
assert on a chip that cannot exist before its first request. The fixes are in
the flows, with the measurement written into each comment.

**iOS then went 6/15 → 14/15** across the same kind of work — four platform
mechanics, none of them app defects, all four written up in the rules below.
The single remaining red is `13-e2e-delete`: the diary-row tap does not open
the editor on iOS, so `entry-delete` never renders and the capture shows Today
with no sheet at all. It is **not** explained by the preset chip sharing the
row's name (scoping the tap `below: Entries` did not fix it), and flow 12's
identical tap DOES open the editor on iOS. Left honestly red rather than
papered over — start the next session with `maestro hierarchy` while that row
is on screen.

## First full run — 2026-08-09, both platforms

**Android (emulator, R2 build): 15/15 screens clean.** One false alarm — a
mid-scroll capture made "Repeat yesterday" look FAB-occluded; at max scroll it
clears. The suite should scroll to the end before its final Today shot.

**iOS (simulator, Release build from main): flows 01/03/04 clean; flow 02
found a shipped bug.** `openLink ignia://` failed with
LSApplicationWorkspaceErrorDomain 115 — and that was not a suite problem: the
`ignia` URL scheme had been unregistered since build 29's CFBundleURLTypes
"de-duplication", so the iPhone widget's face tap opened nothing on builds
29–40. Confirmed against build 40's shipped Info.plist, fixed in build 41.
**This is the suite's first real catch, on its first iOS run.**

Platform quirks learned, so nobody re-pays them:

- **iOS cannot `stopApp` + `openLink` a custom scheme** (LS error 115). Keep
  the app warm and vary the `openAdd` nonce: `-e NONCE=$RANDOM`.
- **iOS shows "Open in Ignia?"** for a scheme fired from outside the app — the
  flow's optional `Open` tap handles it; a stale copy of that dialog also
  blocks later flows, so dismiss before starting.
- ~~**Maestro's iOS driver sometimes cannot see the EntrySheet's texts even
  while they are plainly rendered.** Restarting the run usually recovers.~~
  **SOLVED 2026-08-09 — it was never blindness, and never intermittent.**
  See "Anchor on IDs, not on icon-button labels" below: the match fails
  deterministically, and the answer to the VoiceOver question is **no, it does
  not share it** — the label is in the accessibility tree, so VoiceOver reads
  it fine. "Restarting recovers it" was superstition; a restart that appeared
  to help was a flow that had already been changed.
- **Never tap by coordinates on a signed-in account.** A missed percentage tap
  during this run hit a Quick-add chip and logged a spurious ~300 kcal entry to
  the QA account. Text/testID or nothing.

## Anchor on IDs, not on icon-button labels — 2026-08-09

**Any button that pairs an icon with a label must be addressed by `testID` on
both platforms.** iOS merges the Ionicons glyph INTO the button's single
accessibility label, so the node is:

```
{ text: "", accessibilityText: ", More ways", resource-id: "open-more" }
```

Maestro's text selector is a **full match**, so `More ways` cannot match that —
while Android, which exposes the icon and the label as separate nodes with
real `text`, matches it fine. One line, passing on one platform and failing
deterministically on the other, for a reason neither the assertion message nor
the screenshot reveals: the button is right there in the capture.

Read it yourself rather than guessing, whenever iOS "cannot see" something
that is plainly on screen:

```sh
maestro --device <sim-udid> hierarchy > /tmp/h.json     # then grep the label
```

That command is what closed this out, and it also settles the old VoiceOver
question: the label **is** in the tree, so this was never an accessibility
defect — only a selector mismatch.

`resource-id` is present on both platforms, so an ID anchor is simply
better everywhere. It is immune to this, and to locale — which is why the
es-PR flow now asserts IDs instead of Spanish strings.

## Writing a flow that passes on BOTH platforms — the six rules

The suite ran green on Android and 6/15 on iOS the first time it met one, and
**not one of those failures was an app defect** — the Firestore snapshot showed
the e2e row landing at 123 kcal in the very run whose flow reported failure.
The first four are Maestro/platform mechanics measured on 2026-08-09; the
last two were added on 2026-08-18, when 16-train-terms met iOS for the first
time:

| Rule | Because |
|---|---|
| **Anchor on `testID`, never on an icon-button's label** | iOS merges the glyph into the label; a full-match text selector cannot match. See above. |
| **Never `hideKeyboard`** — tap a non-interactive element instead (a title, a section heading) | iOS has no native dismiss API, so Maestro fakes it by scrolling and then throws. [Its own known-issues page says so.](https://docs.maestro.dev/extra-materials/troubleshooting/known-issues) Numeric keypads have no return key to fall back on. On the sleep modal the same change fixes Android too, where the keyboard was swallowing the Save tap. |
| **`centerElement: true` on a `scrollUntilVisible` whose MID-LIST target you will then TAP** — and never on an end-of-list row | The scroll stops the moment the element enters the viewport, which routinely parks it under the FAB or tab bar. Maestro taps layout bounds, so the touch goes to whatever is on top — this put one run on the Trends tab instead of toggling the theme, and made a diary row open the FAB's speed dial. **But the LAST row of a list cannot be centred** — there is nothing left to scroll — so Maestro swipes until it times out with the row plainly on screen. Mid-list: centre it. End-of-list: `visibilityPercentage` instead. |
| **`visibilityPercentage: 60` when scrolling to a diary row** | The default is 100, and the newest row is partly under the FAB on iOS, so a row that is plainly on screen is "not visible". |
| **`back` dismisses a SCREEN, never a `Modal`-hosted sheet** — scope the dismissal with `runFlow: when: platform:` | iOS has no hardware back, so Maestro sends a left-edge swipe. A pushed route honours it (`04-settings`, `05-history`); a modal does not. The backdrop's `testID` is not the answer either — it is an `absoluteFill` behind the sheet, so a bounds-centre tap lands on the sheet. A point tap above the sheet's top edge is. |
| **Never assert a value that lives only in a Text CHILD** — `containsChild` is Android-shaped | iOS merges the child into the touchable's own accessibility label. On the RIR cell the number appeared in **no node at all**, which was also a VoiceOver defect: the cell announced its question and never its answer. If the value is not in the tree, that is an app bug to fix, not a selector to work around. |

The general shape: **Maestro reasons about layout bounds, the device draws
pixels, and the two disagree wherever something floats on top or a transform
has moved it.** When a flow fails on an element you can see in the capture,
suspect that gap before suspecting the app — then prove which it is with
`maestro hierarchy` and a Firestore read.
