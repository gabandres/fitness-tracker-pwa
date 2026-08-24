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

| Piece | Where | State |
|---|---|---|
| Emulator + API 35 `google_apis` `arm64-v8a` image | `~/Library/Android/sdk` | installed |
| Maestro | `~/.maestro/bin/maestro` | installed |
| bundletool | `/opt/homebrew/bin/bundletool` | installed |
| AVD `ignia-a35` | `~/.android/avd` | **deleted to reclaim 2 GB — recreate it below** |

The AVD is the only disposable piece; the 2 GB it costs is not worth leaving
parked on someone else's laptop between sessions. Recreating it takes about a
minute and needs no download, because the system image stays:

```sh
echo no | $ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd   -n ignia-a35 -k 'system-images;android-35;google_apis;arm64-v8a' -d pixel_6 --force
```

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

### When no `.aab` survives on disk — the QA-only build

Artifacts get deleted for disk, and the two obvious re-supply routes are traps:
**`eas build --local` burns a real versionCode per attempt** (remote counter —
a QA install would mint vc N+1), and **Play's `generatedApks` download API
404s** on every URL variant tried 2026-08-09 (list works, media download does
not — don't re-spend that hour). For *suite* runs — where the question is
"does current main's UI regress", not "what exact bytes do testers run" — a
prebuild + `assembleRelease` of the same commit is the honest sandbox:

```sh
export SENTRY_DISABLE_AUTO_UPLOAD=true   # or the Sentry Gradle task 401s the build
cd ~/fitness-tracker-pwa/apps/mobile
rm -rf android && npx expo prebuild -p android --no-install
cd android && ./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

Debug-keystore signing is fine here (email sign-in only). Two obligations
travel with this: it is NOT evidence about a shipped binary — artifact-level
verification stays with `verify-mobile-artifact.mjs` on real `.aab`s — and
**the `android/` prebuild dir must be deleted before any fingerprint work on
the Mac** (`rm -rf apps/mobile/android`): a resident prebuild dir is hashed
into the fingerprint and would strand every future OTA published from here
(`AGENTS.md`, the machine-dependence section).

### The Settings sheet is 31 seconds tall on the LG G6 — budget for it

Measured 2026-08-23, and it broke three flows in one run before it was
understood. A `scrollUntilVisible` from the TOP of Settings to a row near the
bottom ("Quick add") takes **~31 s** on this device: the sheet has 17 sections
and Maestro dumps the hierarchy after every swipe. Flows written with a 20 s
budget therefore report a **missing element** for a row that is present,
correct, and a few swipes away.

**It is not flake, and the reason it looked like flake is the interesting
part.** The settings ScrollView **retains its scroll position between opens**.
So whenever an earlier flow happened to leave the sheet part-way down, the next
flow's scroll had less distance to cover and finished inside 20 s. The budget
only ever held because a previous flow had paid part of the cost — which is why
these flows passed for months and then failed together the day the suite ran in
a different order.

Consequences, all of them measured on the 2026-08-23 run:

- `04-settings` failed on "Quick add"; `09-locale-es` failed on
  `settings-lang-en`, and because that is its **flip back to English**, it left
  the account in Spanish and cascaded a "Today is not visible" failure into
  every later EN flow; `10-theme-dark` failed on `settings-theme-dark`.
- All settings scrolls now budget **60 s**. `20-units-metric` was raised at the
  same time without having failed — its row is just as deep, and its mid-run
  death is the one that leaves the account in kilograms.
- Spanish is worse than English: the same sheet is taller when the copy is
  longer, so `09` has the longest scroll in the suite.

**When a settings row reports missing, check the budget before the selector.**
A useful discriminator: reopen Settings and run the same scroll again — if it
passes the second time, the sheet was already part-way down and you are looking
at a timeout, not a missing element.

**A different failure with the same symptom**, for the row nearest the bottom:
`settings-signout` cannot be reached by `scrollUntilVisible` DOWN at all,
because it sits clipped against the nav bar and `visibilityPercentage: 100` is
unreachable there. Drive to the END with explicit swipes and search **UP**, the
same technique `18-train-template` uses for the cues box:

```yaml
- repeat:
    times: 10
    commands:
      - swipe: { start: 10%, 85%, end: 10%, 25% }
- scrollUntilVisible:
    element: { id: 'settings-signout' }
    direction: UP
    visibilityPercentage: 30
```

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

### The emulator found a real bug on its first day (2026-08-08)

The tile is in the Quick Settings panel, **is labelled with the preset's name**
(`Log Chicken + rice (meal prep)`), and tapping it wrote nothing. Chasing that
to the bottom is what this harness is for, and it took five wrong suspects
before the right one — each ruled out from an artifact, not from reasoning:

| Suspect | Ruled out by |
|---|---|
| The task-name mismatch `index.js` warns about | `TASK_NAME` and `registerHeadlessTask` both read `IgniaQuickAddTile` |
| The tile never being ready (`openApp()` fallback) | `adb root` + `shared_prefs/ignia.quickAddTile.xml`: `enabled=true`, label set |
| No quick-add target in the snapshot (`no-target`) | AsyncStorage `ignia.widget.snapshot.v1` carried the target |
| Auth not rehydrated in a headless context | `currentUid` already waits 4s for `onAuthStateChanged` |
| The emulator simply being slow | A `Write` RPC was logged — the write was *attempted* |

The actual cause: **Firestore's `setDoc` does not reject when it cannot reach
the backend — it waits.** So `logQuickAdd`'s `catch`, which is the entire
offline story, was unreachable. No throw, no `park()`, no optimistic snapshot
bump, and `ActivityManager` killing the headless service at its 15s ceiling
with the un-parked row inside it. The clinching evidence was a **negative**: no
pending-logs key had ever been created, which proves the write neither landed
nor threw.

Fixed in `logQuickAdd` with a 6s write deadline that converts the hang into the
throw the design already handles. Safe to double-write because the id is minted
before the attempt (ADR-0020).

**Read this as the argument for the harness.** The bug is in the *shared* JS
path, so it applied to the Android widget button too, and `WIDGET.md` had
promised the opposite behaviour — "airplane mode → tap → re-enable, open the
app, the row lands" — since the feature shipped. No unit test caught it because
every test mocks the ledger, and mocks reject on demand where Firestore does
not.

**Still unresolved**: whether a tile tap logs on a *healthy* connection — and
2026-08-23 established that **the adb route cannot answer it on the LG G6**,
which is worth knowing before anyone spends another evening on it.

The network condition was finally right: Wi-Fi up, Firestore reachable at
**39 ms**, signed in, and slot 1 bound to a real preset (*Chicken + rice (meal
prep)*, 610 kcal — confirmed by the ① badge in Settings). The tile is genuinely
registered: `settings get secure sysui_qs_tiles` lists
`custom(fit.ignia.app/expo.modules.quickaddtile.QuickAddTileService)`, and
`dumpsys package` shows the service with `BIND_QUICK_SETTINGS_TILE` and the
`QS_TILE` action.

What happened, in order:

1. **With NO slot bound**, `cmd statusbar click-tile` worked and took the
   documented fallback — `START u0 … ignia://?quickAddSlot=0 … from uid 10222`,
   app opened, nothing written. So `onClick` really does fire, and the
   signed-in/no-slot behaviour is confirmed.
2. **After binding slot 1, every subsequent `click-tile` was inert.** No
   activity start, no line from the app's pid in `logcat`, zero occurrences of
   `quickadd` in the whole buffer, no Firestore row, and no parked row flushed
   when the app was next opened. Tried with the app force-stopped, backgrounded,
   and in the foreground.

So the tile stopped responding to `click-tile` after the first invocation,
independently of what the app would have done with the tap. That is an
LG/SystemUI behaviour, not evidence about `logQuickAdd`: the emulator (AOSP
SystemUI) drove this fine on 2026-08-08.

**Closing this row therefore needs one of two things, and neither is adb on this
phone:** a human tapping the tile from the real Quick Settings panel on the G6,
or the AOSP emulator on a network where Firestore's WebChannel works. Do not
re-attempt it with `cmd statusbar click-tile` here.

**Still out of reach**: placing the 2×2 widget on the launcher. There is no `adb`
command for it, and the AOSP launcher's widget picker is a long-press flow that
Maestro can only drive by coordinates. The widget's own quick-add button
therefore stays unverified on Android.

**Signed-in flows use a throwaway QA account**, not `review@` (Apple App
Review's login — ASC carries it forward on every version, so changing that
password is a review rejection waiting to happen) and not `demo@` (the store
screenshots). Create one in a single command and sign in with it:

```sh
node scripts/seed-demo-account.mjs --email qa-test@ignia.fit --password '<generated>'
maestro test .maestro/android-signin.yaml -e EMAIL=qa-test@ignia.fit -e PASSWORD='<generated>'
```

The address must contain `demo`/`test`/`review`/`appstore` or the seed script
refuses it. 

**When a flow dies mid-run it leaves state behind, and one command clears all of
it.** 11–13 leave a `QA E2E Sandwich` diary row or preset; 16 leaves a
`QA Term Check` catalog exercise; 18 leaves a `QA Tpl Check` template. A
stranded template is the nastiest of the three — it makes the NEXT run open
*Edit template* instead of *New template*, a different layout that fails
somewhere else and reads as a new bug.

```sh
node scripts/qa-regression-verify.mjs cleanup --email qa-test@ignia.fit
```

It deletes today's labelled entries and presets **and** any `QA `-prefixed
exercise or template. The Train half was added 2026-08-23, the day flow 16's
teardown failed and the documented recovery turned out not to cover the
documented failure; it found six leftovers on its first run. Locale and theme
are restored separately — `set-locale`, and the theme by re-running 10's tail. The session persists to AsyncStorage, so it is a once-per-emulator
step and every other flow keeps `clearState: false`.

## The iOS Simulator runs Live Activities — and proved N3 (2026-08-08)

Live Activities render in the Simulator from iOS 16.2, and the Dynamic Island
appears on any iPhone 14 Pro or newer. That makes ActivityKit the **one** native
surface in this repo verifiable without hardware.

A device `.ipa` will not install on a Simulator, and adding a `simulator` profile
to `eas.json` would move the fingerprint and strand the published OTA. Build
through Xcode instead:

```sh
cd ~/fitness-tracker-pwa/apps/mobile
npx expo prebuild -p ios --clean --no-install     # REQUIRED: generates targets/*/Info.plist
npx expo run:ios --configuration Release --device <sim-udid> --no-bundler
```

Three traps, all paid for:

- **Skipping the explicit prebuild fails** with `Build input file cannot be
  found: targets/widget/Info.plist` — `expo run:ios` will not regenerate it when
  `ios/` already exists.
- **`expo run:ios` ends by opening Simulator.app via AppleScript**, which cannot
  work over SSH: `osascript ... exited with non-zero code: 1`. The build has
  already succeeded at that point — install it yourself:
  `xcrun simctl install <udid> <DerivedData>/Build/Products/Release-iphonesimulator/Ignia.app`.
- **Xcode needs a lot of disk.** A build died mid-flight with
  `The file "swbuild.tmp..." couldn't be saved` at **236 MB free** — an
  out-of-space error that names no space. **A single iOS build grows
  DerivedData to ~9 GB**, so clear it before starting, not after:

  ```sh
  rm -rf ~/Library/Developer/Xcode/DerivedData ~/.gradle
  rm -rf ~/fitness-tracker-pwa/apps/mobile/ios      # prebuild output, regenerated
  ```

  `~/.gradle` (~6 GB) and `apps/mobile/ios` (~0.5 GB) are the other two worth
  knowing. All three regenerate; the only cost is a slower next build. Nothing
  else on that machine is ours — the remaining bulk is the owner's personal
  data and Xcode itself.

**Maestro auto-selects a device and will pick (and even boot) an Android AVD**
even when the Android emulator process is dead, because a stale `adb` entry
lingers. Pass `maestro --device <sim-udid> test …` explicitly.

The evidence to look for is in the system log, not on screen:

```sh
xcrun simctl spawn <udid> log stream --predicate 'subsystem CONTAINS[c] "activitykit"' --style compact
```

A working start prints `attributesType: FastActivityAttributes, requester:
fit.ignia.app, state: active, sceneTargets: [lockscreen: widget(containingProcess:
fit.ignia.app)]`. Then background the app (`xcrun simctl launch <udid>
com.apple.springboard`) and screenshot: the Dynamic Island carries the compact
faces.

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
