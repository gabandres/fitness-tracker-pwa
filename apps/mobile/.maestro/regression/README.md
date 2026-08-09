# Full UX/UI regression sweep

Walks **every screen and mode** of the app, asserting visibility of each
surface's anchor elements and capturing a screenshot per step into
`.maestro/regression/shots/`. The screenshots are the real audit — assertions
are the skeleton that stops the walk when a screen fails to render at all, but
only a human (or agent) LOOKING at the captures catches a collapsed field, an
off-screen button, or a mis-styled row.

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

Screenshots land beside the flows; review every one. The entry sheet is opened
through the widget deep link (`ignia://?openAdd=1`) rather than the FAB's
mini-menu, whose chips do not expose accessible text and would make the suite
coordinate-dependent.


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
- **Maestro's iOS driver sometimes cannot see the EntrySheet's texts even
  while they are plainly rendered** (Android sees them fine). Open question
  whether VoiceOver shares the blindness — worth a manual check someday.
  Restarting the run usually recovers the driver.
- **Never tap by coordinates on a signed-in account.** A missed percentage tap
  during this run hit a Quick-add chip and logged a spurious ~300 kcal entry to
  the QA account. Text/testID or nothing.
