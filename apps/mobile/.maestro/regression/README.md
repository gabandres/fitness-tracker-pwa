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
