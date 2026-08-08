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

## The Android emulator lives on `ignia-mac` — 2026-08-08

**The owner has no Android device.** Every Android box in `WIDGET.md` was
unticked from the day the feature shipped, and vc 18 and vc 21 both reached
testers with nothing anywhere having launched them. The emulator is what closes
that, and it is already installed:

| Piece | Where |
|---|---|
| AVD `ignia-a35` | API 35, `google_apis`, `arm64-v8a`, Pixel 6 profile |
| Emulator + system image | `~/Library/Android/sdk` |
| Maestro | `~/.maestro/bin/maestro` |
| bundletool | `/opt/homebrew/bin/bundletool` |

**Every one of these needs `JAVA_HOME` and `ANDROID_HOME` exported explicitly** —
neither is in the Mac's shell config, and Maestro 2.x fails with a bare
*"Java 17 or higher is required"* against the Mac's default Microsoft JDK 11.

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.maestro/bin:$PATH

emulator -avd ignia-a35 -no-window -no-audio -no-snapshot -gpu swiftshader_indirect &
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 10; done
```

Headless (`-no-window`) is deliberate: this is driven over SSH, and it boots in
about two minutes.

### Install the REAL artifact, not a preview build

`eas build --local` produces an `.aab`, which cannot be installed directly.
Extract the universal APK from **the same file Play ships** rather than cutting a
separate `preview` build — a preview APK is a different binary on a different
channel, and would prove nothing about what testers run.

```sh
bundletool build-apks --bundle=build-<ts>.aab --output=/tmp/ignia.apks --mode=universal --overwrite
unzip -o -q /tmp/ignia.apks -d /tmp/apkx
# bundletool's output is UNSIGNED and will not install. Sign with the real
# upload key so the emulator runs the same cert a tester does.
APKSIGNER=$(ls $ANDROID_HOME/build-tools/*/apksigner | tail -1)
"$APKSIGNER" sign --ks credentials/dev.keystore --ks-key-alias macrolog-dev \
  --ks-pass "pass:$(node -p 'require("./credentials.json").android.keystore.keystorePassword')" \
  --key-pass "pass:$(node -p 'require("./credentials.json").android.keystore.keyPassword')" \
  --out /tmp/ignia-signed.apk /tmp/apkx/universal.apk
adb install -r -d /tmp/ignia-signed.apk
```

**Google Sign-In will fail on the emulator** and that is expected, not a
regression: authorization is by package name + signing certificate, and the
emulator's build is signed by the upload key rather than by a Play app signing
key. Do not chase it here (`CLAUDE.local.md` has the four-key story).

### What Maestro can and cannot reach

Maestro drives the **app's** UI. It cannot place a home-screen widget, and it
cannot open the Quick Settings shade reliably. `adb` can do what Maestro cannot:

```sh
TILE=fit.ignia.app/expo.modules.quickaddtile.QuickAddTileService
adb shell cmd statusbar add-tile   $TILE     # as if the user added it in the QS editor
adb shell cmd statusbar click-tile $TILE     # as if the user tapped it
adb shell cmd statusbar remove-tile $TILE
```

That drives `QuickAddTileService` directly, with no UI in the loop at all, and it
is how the tile's rows in `WIDGET.md` get answered without a phone. Verify the
result out of `adb logcat` and `dumpsys activity activities`, never by eye.

**Verified 2026-08-08 on this setup**: signed out, `click-tile` started
`fit.ignia.app/.MainActivity` through an `ignia:///` deep link and wrote nothing
— which is exactly the documented signed-out behaviour, and the first Android QA
row in this repo to be confirmed by anything.

**Still out of reach**: placing the 2×2 widget on the launcher. There is no `adb`
command for it, and the AOSP launcher's widget picker is a long-press flow that
Maestro can only drive by coordinates. The widget's own quick-add button
therefore stays unverified on Android.

**Signed-in flows need a credential nobody automated has.** The demo account's
password lives only in the owner's password manager, so `android-smoke.yaml`
asserts the signed-OUT entry point. Anything past sign-in needs the owner to
either type it once on the emulator or hand over the password.

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
