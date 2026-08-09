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

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$HOME/.maestro/bin:$PATH

cd ~/fitness-tracker-pwa/apps/mobile
maestro test .maestro/regression/           # Android emulator (auto-selected)
maestro --device <sim-udid> test .maestro/regression/   # iOS simulator
```

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

## Writing a flow that passes on BOTH platforms — the four rules

The suite ran green on Android and 6/15 on iOS the first time it met one, and
**not one of those failures was an app defect** — the Firestore snapshot showed
the e2e row landing at 123 kcal in the very run whose flow reported failure.
All four are Maestro/platform mechanics, all measured on 2026-08-09:

| Rule | Because |
|---|---|
| **Anchor on `testID`, never on an icon-button's label** | iOS merges the glyph into the label; a full-match text selector cannot match. See above. |
| **Never `hideKeyboard`** — tap a non-interactive element instead (a title, a section heading) | iOS has no native dismiss API, so Maestro fakes it by scrolling and then throws. [Its own known-issues page says so.](https://docs.maestro.dev/extra-materials/troubleshooting/known-issues) Numeric keypads have no return key to fall back on. On the sleep modal the same change fixes Android too, where the keyboard was swallowing the Save tap. |
| **`centerElement: true` on any `scrollUntilVisible` whose target you will then TAP** | The scroll stops the moment the element enters the viewport, which routinely parks it under the FAB or tab bar. Maestro taps layout bounds, so the touch goes to whatever is on top — this put one run on the Trends tab instead of toggling the theme, and made a diary row open the FAB's speed dial. |
| **`visibilityPercentage: 60` when scrolling to a diary row** | The default is 100, and the newest row is partly under the FAB on iOS, so a row that is plainly on screen is "not visible". |

The general shape: **Maestro reasons about layout bounds, the device draws
pixels, and the two disagree wherever something floats on top or a transform
has moved it.** When a flow fails on an element you can see in the capture,
suspect that gap before suspecting the app — then prove which it is with
`maestro hierarchy` and a Firestore read.
