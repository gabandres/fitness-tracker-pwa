# Coverage ledger — screen × state × platform

**"Covered" means: a flow asserted the surface's anchors AND a human or agent
reviewed that run's screenshots.** Authored-but-never-run is ✗. A row flips to
✓ only with the date and platform of the reviewed run — that discipline is the
difference between this table and a wish list, which this project has been
burned by three times.

Update this file in the same commit as any flow change. If a surface ships
that has no row here, the suite's "100%" claim is false until the row exists —
add it as ✗ first, cover it second.

## Run log — 2026-08-24 — iOS 19 of 21, Android partial

**The "21 of 21" this section originally claimed was never measured, and is
retracted.** The runner piped each flow through `tail -3`, which truncates
Maestro's output ABOVE the `FAILED` lines — so "no failures" meant "no failure
string in the last three lines". Both the Android and the iOS summaries were
produced that way; neither was evidence. Re-run with full output, this is the
real picture.

## iOS run 2026-08-26 — 18 of 20, and THREE of the five failures were harness state

Run against a **fresh Release simulator build from `295d9435`** (the commit
carrying #83, #85 and #77 Q5), on `QA-iPhone` / iOS 26.5. The raw first pass
read **15/20**, and reporting that number would have been wrong three times
over. Every correction below is the same lesson this file already states — *count
a mass failure as one fault until proven otherwise* — so here is what each
actually was:

| Flow | Raw | Real | Cause |
|---|---|---|---|
| all 20 | FAIL ×19 | — | **The guided tour was covering Today.** The sign-in flow's `tour-skip` guard reported the id NOT visible and skipped, yet the tour was plainly on screen. **And `assertVisible: 'Today'` PASSED anyway** — because the tour card itself lists the words *Today · Train · Trends · Body*, so the assert matched the tour's own copy. That is a false pass sitting directly on top of the thing it is meant to detect. Dismissed with `tapOn: text: "Skip"`; all 19 then ran. |
| `21-train-cardio` | FAIL | **PASS** | Asserted `distance (mi)`; the account was in **metric**. |
| `20-units-metric` | FAIL | **PASS** | Asserted `lb`; same cause. The first, tour-broken pass had died *inside* this flow after it flipped units and before its restore tail — exactly the documented 09/10/20 state-leak cascade, reproduced. |
| `13-e2e-delete` | FAIL | **PASS** | **The suite ran past midnight.** Flow 11 logged the sandwich on Aug 25; by flow 13 it was Aug 26 and Today was a fresh empty day (`No entries yet.` in the failure capture). Passes when 11→12→13 run inside one calendar day. |
| `15-search` | FAIL | FAIL | Pre-existing: `Tap on "^Banana, raw$"`. |
| `18-train-template` | FAIL | FAIL | Pre-existing. Re-run with units restored it fails EARLIER, at `scrollUntilVisible id: template-set-reps-0-0` — same family as `15-search`, iOS list rows absent from the accessibility hierarchy. |

**So: 18 of 20, and the two failures are the documented platform-gated
selectors, not regressions.** The auth-gate rewiring in #83 — `sessionUid` now
drives routing on every screen's entry — is clean on iOS: sign-in lands on
Today and all four tabs, both locales, both themes, and the full log/edit/delete
arc pass.

**Two harness defects this run exposed, both worth fixing before the next one:**

1. `assertVisible: 'Today'` is not a valid post-sign-in gate while the tour can
   be up, because the tour contains that word. Gate on a Today-only id.
2. `tour-skip` was not matchable by id on iOS even with the tour on screen;
   `text: "Skip"` was. Until that is understood, the sign-in flow's tour guard
   is not load-bearing.

**Three build traps hit getting here**, all new to this file: the RN codegen
artifacts under `ios/build/generated` were partial and `pod install` is what
regenerates them; `-arch arm64` cannot be combined with `-destination`
(`ONLY_ACTIVE_ARCH=YES` alone is the way, and matters — the first build compiled
**x86_64** on an Apple Silicon Mac); and the build fails at the **Sentry
source-map upload** because `xcodebuild` does not read `.env.local`
— `SENTRY_DISABLE_AUTO_UPLOAD=true` is correct for a simulator QA build and is
the iOS twin of the documented Android 401.

**iOS: 19 of 21.** `15-search` fails at `Tap on "^Banana, raw$"` and
`18-train-template` at `.*3 × 8 · 20 lb.*` — the SAME two documented
platform-gated selectors as the 17/19 baseline, not regressions.

**The three flows exposed to that day's Settings refactor (17 sections → 13) —
`04-settings`, `20-units-metric`, `10-theme-dark` — pass with ZERO failures on
iOS.** That is the claim the run existed to make, and it stands.

**Android: `04-settings`, `15-search` and `18-train-template` pass clean;
`20-units-metric` and `10-theme-dark` failed.** Those two are **DIAGNOSED AND
FIXED** as of 2026-08-25 (`fc3a071e`) — and the cause was neither the Settings
refactor nor the Body tab. `_layout.tsx` renders `<Splash/>` (absoluteFill,
zIndex/elevation 100) while `initializing || profileLoading || waitingOnProfile
|| !fontsReady`, and on a cold start those do not clear together: measured on
the LG G6, the loader is gone at ~1.9 s, **BACK at ~3.4 s**, and gone for good
at ~5.3 s. A tap landing in that second window is swallowed by the overlay.
`assertVisible: 'Today'` passes straight THROUGH it, because the tab bar is in
the hierarchy underneath — so it is not a readiness gate. Maestro then burns its
whole `retryIfNoChange` budget (24–27 s measured), reports COMPLETED, and the
app has not navigated; the next `scrollUntilVisible` spends 60 s hunting a
testID on the wrong screen and fails THERE. That is why the failure pointed at
Body and at a Settings testID rather than at the overlay. Both flows now retry
until the DESTINATION is on screen, which is the only condition that cannot
race the splash. **Not yet re-run on the device** — the Android driver was
failing to start that day (`did not start up in time`), which is harness, not
these flows.

The device screenshot taken during that triage also showed the **"What's new"
banner open on Today**, shifting layout — and this file already records three
prior occasions where a batch of failures here was harness state.

**Never summarise a Maestro run through `tail`.** Grep for
`COMPLETED|FAILED|Assertion`, or read the whole output. A truncated pass is
worse than a failure, because it gets written down.

### Verified on device — 2026-08-25, LG VS988, vc 37 + OTA 52

**Both flows PASS, back to back, exit 0 with zero failures**, run from a clean
baseline in the documented suite order with no force-stop between them. The
swallowed-tap fix is confirmed: `Tap on "Body"` and `Tap on settings-open` now
land, where on 08-24 they burned 24–27 s and never navigated.

Three things that run taught, each of which cost a re-run:

- **The loader wait was the actual fix, not the retry.** `20-units-metric`
  already had `extendedWaitUntil notVisible: brand-loader`; `10-theme-dark` had
  only `assertVisible: 'Today'`, which is not a readiness gate — the tab bar
  sits UNDER the splash, so it passes while the overlay is still up. Adding the
  loader wait to both launch points is what made `10-theme-dark` pass. The
  retry loop alone did not.
- **`repeat` is a bounded retry, NOT an assertion.** It reports COMPLETED once
  it exhausts its iterations whether or not the condition ever held — so a gate
  that never lands passes silently and the flow dies 60 s later on the wrong
  screen, which is the exact misdirection the gate was added to remove. Both
  flows now `assertVisible` the destination immediately after the loop. That
  assert has already earned itself: it caught a warm-start failure that the bare
  loop reported as COMPLETED.
- **The retry budget is 8, not 4, and that is measured.** A COLD start lands on
  the first tap; a warm launch straight after another flow exhausted all four.

**What was covering the button, when 8 taps in a row were eaten:** the captured
hierarchy showed `brand-loader` visible AND the **What's new banner open** AND a
stale **offline banner** — on a device whose network pinged fine. The What's new
banner was self-inflicted: `WHATS_NEW_VERSION` was bumped that morning for the
day-boundary setting, and this file already records the banner shifting layout
as a prior cause. **Dismiss What's new on the QA device after any OTA that bumps
it, before running the suite.**

**A failed `20-units-metric` is self-perpetuating.** It flips the account to
metric early and restores at the tail, so a run that dies in between leaves
metric on file and the NEXT run fails at its opening `"lb"` assertion — which
reads like a units regression and is not. Check the profile before blaming the
flow.

**UNRESOLVED, and it is not the splash:** `20-units-metric`'s restore tail taps
`settings-unit-us` and reports COMPLETED, but the write **does not reliably
reach Firestore** — verified against the server after passing runs, twice
`metric`, once `us`. Theme's tail (`settings-theme-system`) restores reliably in
the same runs, so this is specific to the units tail. Suspects not yet
separated: `pickUnit`'s `savingUnit` guard, `settings-back` tapped before the
await settles, or the new **Day starts at** card (added 2026-08-25) sitting
directly below Units and shifting what `centerElement` centres. **Until this is
understood, reset `unitSystem` to `us` on `qa-test@ignia.fit` before running the
suite** rather than trusting the tail.

### The Android run itself

Full suite on the LG VS988 (Android 9 / API 28) over adb, against the SHIPPED
bundle — OTA `4a76f432…` on vc 37, device confirmed on it by
`CheckCompleteUnavailable` before the run.

One near-miss worth recording, because it is the kind of thing that usually
breaks a suite silently: `20-units-metric` asserts `'Units'`, and the Settings
section header of that name was renamed to *Preferences*. It passes because the
string it actually targets is the ROW label (`settings.portionDisplay`, also
"Units"), not the header — which the flow's own comment says. Before the
refactor there were two "Units" on that screen and now there is one;
`assertVisible` is satisfied either way. **If that row is ever renamed, this
flow fails and the section header is not the reason.**

### Why iOS could not be run that day — resolved 2026-08-25

The Release simulator build failed with `Internal Error:
DecodingError.dataCorrupted … unexpected end of file` while compiling
`ExpoCrypto`. That is a truncated write, not a Swift error: `ignia-mac` was at
**354 MiB free, 100% full**, because the build's own 7 GB DerivedData filled it.

**That blocker is now cleared.** The Air was cleaned on 2026-08-25 and sits at
**19.18 GiB free** — above a build's ~17 GB floor, though only by ~2 GB, and a
build consumes space as it runs. `STATUS.md` §1 carries the current number and
the one remaining lever (an 8.1 GB watchOS simulator runtime, an owner call).
Re-check the number before starting an iOS suite run rather than trusting this
paragraph.

**A green run is not automatically evidence.** Two ways a pass can lie, both
measured on 2026-08-09: a flow that dies before its restore tail leaves the
account in es-PR or the device in dark, so every LATER flow is asserting
against a state you did not intend (that is what turned one iOS run into
9 "failures", only two of which were real); and screenshots do not reach
`shots/` at all unless the collector ran. Before ticking rows: confirm the
locale/theme are back to baseline, and look at the captures.

**Full Android sweep, 2026-08-23, on the LG G6 against vc 37 + OTA 28 — 12 of
19, and the 7 failures are the HARNESS, not the app.** First sweep since vc
34/35, and the first ever run from the Windows workstation, which carries
**Maestro 2.8.0**. Driven by the explicit `flowsOrder` loop keyed on exit code
(§3.12 of `docs/DEV_ENVIRONMENT.md`); `17-coach-ask` excluded, it spends real
AI money.

Failures: `04-settings`, `09-locale-es`, `10-theme-dark`, `14-metrics`,
`16-train-terms`, `18-train-template`, `19-glossary`.

**Five of the seven die on `scrollUntilVisible`, and the app is provably fine.**
04/09/10/14/16 all fail the same way, and the captured hierarchy at the moment
of failure shows the target **present, on-screen, enabled, clickable and
correctly bounded** — `settings-theme-dark` at `[927,698][1276,878]` on a
1440×2880 screen, `settings-lang-es-PR` at `[736,1234][1276,1414]`. Maestro
reported "No visible element found" for both.

Three things were measured rather than assumed, in this order:

1. **Manual swipes scroll everything the flows could not.** Today reaches Water
   and Entries in three swipes; Settings reaches *Quick add* and continues to
   *Sign-in methods* and *Delete account* in eight. Nothing is unreachable and
   nothing is clipped.
2. **`visibilityPercentage: 60` does not fix it.** A probe copy of `04-settings`
   with the threshold lowered — the first remedy Maestro's own error tip
   suggests — fails identically. So this is not a visibility-threshold problem.
3. **The gesture origin is not the problem either.** Maestro's docs say
   `scrollUntilVisible` swipes *from the centre of the screen*; five manual
   swipes from exactly `(720,1440)` reach *Quick add* in about five seconds,
   which Maestro failed to do in twenty.

So the command is not making progress on these screens while an identical
gesture, sent by hand, does. Maestro's own documentation warns that
`scrollUntilVisible` "may repeatedly interact with static elements instead of
triggering the desired scroll action" on complex layouts and recommends a
**custom scroll loop** — which is what (1) and (3) show would work here. It
fails on **Today** and **Settings** and succeeds on **Refine targets** (08) and
the **Train workout** (16's `discard-workout`), so it is screen-specific, not
global.

**This exact message was written off once before.** The 2026-08-21 sweep logged
`No visible element found: id: settings-theme-dark` and recorded it as a device
flake because a re-run passed. On 2026-08-23 it took five flows in one run.
A one-off that recurs is a defect; do not close it as a flake a third time.

**The remaining two are NOT the same thing and are not attributed here.**
`18-train-template` fails at `tapOn: template-match-0` — a *tap*, not a scroll,
and a **different step** from the iOS failure below (`template-set-kind-0-0`),
so the two platforms are not showing the same defect. It is the same *shape* as
the documented iOS `15-search` finding — list rows absent from the
accessibility tree at tap time — and that is where an investigation should
start. `19-glossary` fails at `tapOn: "Today"`, which is always present, so it
most likely inherited a bad screen state from 18; it has not been re-run alone.
**Note `15-search` PASSED on Android** in this run, while it fails on iOS.

**Not caused by that day's OTA**, and the mechanism rules it out rather than the
timing: OTA 28 changed only which icon font and which Manrope weights are
bundled. Neither can affect a scroll gesture, and every screen was screenshotted
rendering correctly — icons on all four tabs plus Settings, no tofu.

**State left clean.** 09 and 10 both died BEFORE their locale/theme flips, so no
later flow inherited es-PR or dark — which is why 11–13 and 20 passed. 16 died
on its own teardown scroll, leaving its `QA Term Check` catalog entry behind;
it was removed by hand (Train → exercise → REMOVE → confirm) and the catalog now
reads Plank → Rear delt DB flye. No workout was left in progress.

**FOLLOW-UP, later the same day (2026-08-23) — the scroll failures were a
BUDGET, and the earlier entry above stops one measurement short of that.**

Everything above is accurate about what was ruled out. What was not tried is the
timeout, and it is the dominant cause: a `scrollUntilVisible` from the TOP of
Settings to *Quick add* takes **~31 s** on this device, timed end-to-end (a
launch-plus-open-Settings baseline of 31 s against 62 s for the same flow with
the scroll appended). Every settings flow budgeted **20 s**. Point 3 above
compares five *manual* swipes against Maestro's twenty seconds, but a manual
swipe costs no hierarchy dump and Maestro takes one after every swipe — so the
comparison does not show Maestro failing to progress, only that it is slower per
swipe. It was progressing, and running out of time roughly two-thirds of the way
down.

**Why it looked intermittent, and why it broke in a batch.** The settings
ScrollView **retains its scroll position between opens**. Whenever an earlier
flow left the sheet part-way down, the next flow's scroll had less distance to
cover and finished inside 20 s. So the budget only ever held because some
previous flow had paid part of the cost — which is exactly why these flows
passed for months and then failed together in a run whose order differed, and
why re-running one alone could pass or fail depending on what preceded it. That
is the mechanism behind "a one-off that recurs"; the entry above was right to
refuse to call it flake.

Raised to **60 s** on 04/09/10 and, pre-emptively, on 20 — whose row is just as
deep and whose mid-run death is the one that leaves the account in kilograms.
Result on the re-sweep: **04 passes consistently (57 s, 59 s), 10 passes
(2m 27s)**.

**Residual: 09 still failed once at 60 s**, on its FIRST scroll, so the budget is
necessary but not sufficient and some genuine stalling remains. The deterministic
remedy is the **custom scroll loop the entry above already recommends**, and it
is verified working on this screen: swipe to the END down the left gutter, then
search **UP**.

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

That shape reached `settings-signout` first try after two DOWN-scroll attempts
had failed on it — and `settings-signout` is the hardest target on the sheet,
being clipped against the nav bar where `visibilityPercentage: 100` is
unreachable.

**The other four failures were four different things, none of them the app:**

- **`14-metrics`** — the FIRST tap after the IME closes is swallowed. Ruled out
  the two obvious causes on the device rather than reasoning about them:
  `maestro hierarchy` puts `sleep-save` at `[96,2309][1344,2544]`, exactly where
  it is painted, and a real `adb shell input tap 720 2426` at that centre writes
  `sleepHours` on the first try. Maestro's own log says the tap COMPLETED and
  nothing is written; a second, optional tap lands. Fixed with a platform-gated
  `hideKeyboard` plus a repeated tap.
- **`16-train-terms`** — failed ONLY in its teardown, with the row it wanted
  plainly on screen in the capture. Another budget (15 s → 45 s). It leaked
  `QA Term Check`; `qa-regression-verify.mjs cleanup` now also deletes
  `QA `-prefixed exercises and templates, and found **six** on its first run.
- **`19-glossary`** — two separate defects, and the entry above guessed wrong in
  good faith: it did **not** inherit a bad state from 18. First, its own boot
  wait was 15 s and the capture at failure shows the app still on the brand
  loader. Then, once past that, it asserted the SECOND-TO-LAST glossary term
  after scrolling to it, which only fits on a taller viewport; and it dismissed
  the sheet at `50%,8%`, which on 360×720dp lands ON the Train glossary — the
  longest of the three — so the sheet stayed open over the tab bar and the run
  died at `tapOn: "Today"`. That is the "always present" element the entry above
  puzzled over: it was present and covered. All three fixed, and the question
  the flow exists to ask is now answered — **the last term IS reachable, so
  `Glossary`'s 460 cap is fine on this viewport.**
- **`18-train-template`** — passed on the re-sweep (2m 50s) with no change to it
  at all, which fits the retained-scroll-position mechanism above.

`Glossary` also gained the `backdropTestID` that `EntrySheet` has always had —
and it **does not work for this dismissal**, which is the more useful finding.
It shipped to both platforms (iOS OTA 19, Android update
`01a0318b-3cab-7ab4-8abd-0072d3f7aa21`) and the LG G6 was confirmed running the
Android one; `tapOn: id: 'glossary-backdrop'` then reported COMPLETED while
dismissing nothing. The backdrop is `<Pressable style={StyleSheet.absoluteFill}>`,
so its bounds are the WHOLE screen and Maestro taps an element's **centre** —
which on a content-height sheet is behind the panel. The tap lands on the panel.

So: a full-screen backdrop is not addressable by id for a dismissal, on any
viewport. `19-glossary` stays on `50%,5%` and carries the disproof inline. The
prop is inert and harmless; leave it.

**iOS re-swept 2026-08-23/24 on a Release simulator build from current `main`:
17 of 19**, and the two that fail are the same two as the 2026-08-22 baseline.
So that day's Android work neither fixed nor broke iOS — with one exception,
below, which was mine and is repaired.

**First attempt: 0 of 19, all with the identical line** `Assertion is false:
"Today" is visible`. That is one fault, not nineteen — a freshly installed
simulator build is **signed out**, confirmed by screenshot. `android-signin.yaml`
is misnamed and works on iOS; running it first turned 0/19 into 17/19. Recorded
in `docs/DEV_ENVIRONMENT.md` §3.12 as step 0.

**`19-glossary` failed on iOS because of a fix made for Android that day, and it
is now platform-gated.** The dismissal is a backdrop tap above the panel, and
the safe Y is not the same fraction of the screen on both: on the LG G6
(360x720dp) the Train glossary reaches ~8%, so `50%,8%` lands ON the sheet and
5% clears it; on the iPhone simulator (1179x2556) 8% is correct and 5% is up in
the Dynamic Island where the tap never reaches the backdrop. Both failures
present identically — the sheet stays open over the tab bar and the run dies two
steps later on `tapOn: "Trends"`. Gated with `runFlow: when: platform:` using
both measured values, and **verified green on both platforms**.

The two genuine iOS failures, with more precision than the previous entry had:

- **`15-search`** — the search itself is FINE on iOS. `.*[Bb]anana.*raw.*` is
  visible, so the callable answers and the USDA rows render. What fails is the
  anchored tap `^Banana, raw$`, which cannot match because iOS merges a list
  row's label with its macros into one accessibility element. The anchor exists
  for a real Android reason (four rows match the loose regex, and "Pepper,
  banana, raw" sits clipped at the bottom edge on 360x720dp), so the fix is a
  platform-gated selector, not a looser one.
- **`18-train-template`** — it now gets MUCH further than the 2026-08-22 note
  says. That entry has it dying at `template-set-kind-0-0`; it now walks the
  whole editor, saves, re-opens the template, and fails only on the collapsed
  summary `.*3 × 8 · 20 lb.*`. So the Android scroll/budget fixes did carry to
  iOS for every earlier step. What remains is the summary string on iOS —
  either the same label merge or a spacing difference.

Neither is a product defect and neither blocks a release. Both are one
platform-gated selector each, and both should be fixed with a verify pass on
BOTH platforms — the `19-glossary` regression above is what happens otherwise.

**Rows are NOT flipped for this run** — `collect-shots.sh` did not run, so there
are no captures to review, and this file's own rule stands.

**Where this stands, 2026-08-18.** iOS is **31 of 33 rows**, earned by a single clean sweep — `16/16 Flows Passed in 9m 42s`, 64 captures collected and reviewed — plus the fresh-account arc run separately, as it must be. The two that are
left cannot be closed on a simulator by anyone: the barcode camera needs a
camera, and the mic's listening state needs a speech recognizer.

**iOS re-swept 2026-08-22 on a Release simulator build from current `main`:
17 of 19 flows pass**, including both new ones (`19-glossary`, `20-units-metric`).
Two fail — `15-search` and `18-train-template` — and **both fail on the
pre-change baseline too**, so neither is caused by that day's F3–F7 work. That
was established rather than assumed: `27828e5c` was checked out on the Mac,
rebuilt, installed and run against the same two flows, and both failed there
as well. Do not re-attribute them to the units or glossary work.

What each one actually shows, from the run's own artifacts:

- **`15-search`** — the results render correctly (the capture shows *Banana,
  raw* as the third row), and by the time `tapOn: '^Banana, raw$'` executes the
  **result rows are not in the accessibility tree at all**: the captured
  hierarchy at that step contains exactly two banana strings, both the search
  input's own `banana`. So this is not a ranking change and not an anchoring
  problem — the list is gone from the tree at tap time, which is where an
  investigation should start.
- **`18-train-template`** — the editor renders all three set rows (capture
  `18-set-table`), the flow types 20/8 into each, and the SAVED document shows
  row 0 as a bare `{kind:'working'}` while rows 1 and 2 carry `reps: 8,
  weight: 20`. Read out of Firestore, not inferred. The summary then correctly
  degrades to `3 sets` — which is the flow's own stated intent — so the
  assertion is right and the lost first row is the defect.

Both predate 2026-08-22 and are unclaimed. The suite's last clean iOS sweep was
2026-08-18, and the on-device food search (2026-08-21) and the bottom-sheet
sweep (2026-08-22) both landed in between.

**Android has a host again, 2026-08-19.** An **LG VS988 (LG G6, Android 9 /
API 28)** runs the suite over adb from the Windows workstation, so "Android has
no host" is retired. First run against Play-signed **vc 34** (SDK 57):
**14 of 17 passed**. Failing: `06-scan-intro` ("Scan meal" not found),
`15-search` ("banana raw" not found), `18-train-template`
(`template-set-kind-0-0` missing).

**The Android dates below are deliberately NOT updated to 2026-08-19.** This
file's own rule is that a row flips only when a run's captures were collected
AND reviewed, and `collect-shots.sh` did not run — `shots/` is empty on the
Windows side, so there is nothing to review. A green Maestro line alone is
exactly the evidence this file refuses to accept. Re-run with the collector and
review the images before flipping anything.

**Full Android sweep, 2026-08-21, against vc 37 + OTA #4 — 16 of 17, and the
captures were collected this time.** The one failure was `10-theme-dark`
("No visible element found: id: settings-theme-dark"), and it is a **device
flake, not a regression**: it died on `scrollUntilVisible` while still on
*Today*, because the preceding `settings-open` tap never navigated — Maestro
retried it for 26 s first. `04-settings` and `09-locale-es` drive the same
`settings-open` chain and both passed in that same run. Re-run alone
immediately after, the flow passed end to end **including its tail**, so the
device is back on the System theme baseline. Because it failed *before* the
theme was flipped, no later flow's captures were contaminated.

`15-search` and `18-train-template` — the two historically flaky flows, and two
of the three that failed on 2026-08-19 — both **passed**. `17-coach-ask` did not
run and should not: it is tagged `manual` because it spends real AI money.

73 captures collected (64 from the sweep, 9 dark from the `10` re-run).
**Rows below are still NOT flipped, deliberately.** Only a sample was reviewed —
`06-scan-intro`, `06-fab-dial`, and the `10-dark-*` set — not all 73, and this
file's rule is that a row flips on a *reviewed* capture. Flipping 30 rows off a
sample would be exactly the "green line as evidence" substitution the paragraph
above refuses. The sample did earn two real findings: the What's New banner
renders correctly on Today with the OTA #4 copy, in both light and dark, and
`06-scan-intro`'s capture was being taken under the FAB dial's dismiss scrim
(fixed in that flow the same day — see its header).

Two cautions the first run produced. A whole-suite cascade is easy to
misread: an earlier run showed 15 failures, all of them `"Today" is visible`
after the session was lost, and re-running the sign-in flow turned it into
14/17 — count a mass failure as one fault until proven otherwise. And cold
start on this device is **6.6s** to first frame with the brand loader clearing
near `01-today`'s 15s budget, so that flow flakes on timing rather than on
behaviour.

Note the device is API 28 while `minSdkVersion` is 26, so this host does **not**
prove the floor.

## Route screens (14)

| Screen | Flow | Android | iOS |
|---|---|---|---|
| sign-in | `../android-signin.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| (app)/index — Today | `01-today.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| (app)/train | `03-tabs.yaml` (full-depth) | ✓ 2026-08-09 | ✓ 2026-08-18 |
| (app)/train — logging interactions | `16-train-terms.yaml` (glossary, RIR scale, set-type rows; starts + discards a workout) | ✓ 2026-08-12 | ✓ 2026-08-18 — first iOS run; took five platform fixes and exposed a false-positive assert |
| (app)/train — template editor | `18-train-template.yaml` (build a template from a seeded exercise, set table + headers, collapsed card summary, More options, save → re-open → per-set targets still there) | — no Android host | ✓ 2026-08-18 — first run; the only flow that exercises the editor at all |
| (app)/train — cardio blocks | `21-train-cardio.yaml` (add a block, pick a modality, type a duration, see the summary recompute, and prove it round-trips through Firestore by leaving Train and coming back; discards in its own tail) | ✓ 2026-08-24 — **first run, and it found a real data loss**: `useTrain.persist` wrote `{ exercises }` only, so a cardio block rendered, updated the summary and never reached Firestore — an omitted field, not a rejected write, so nothing errored. Confirmed by reading the doc back (`cardio: null` against a block on screen), fixed, re-published, re-run green end to end | ✓ 2026-08-24 — green end to end on a Release simulator build from `main`. **No platform-gated selector was needed**: the first iOS run died at `tapOn: id: tab-train` and looked like an iOS id problem, but the accessibility tree showed the **guided tour** covering the app (`tour-skip`, `STEP 1 OF 6`) — §3.12's documented trap. Dismiss the tour and the identical flow passes. One real harness fix came out of it: `hideKeyboard` is unsupported on the iOS simulator AND does not blur on Android, so the flow taps out instead |
| (app)/trends | `03-tabs.yaml` (full-depth) | ✓ 2026-08-09 | ✓ 2026-08-18 |
| (app)/body | `03-tabs.yaml` (full-depth) | ✓ 2026-08-09 | ✓ 2026-08-18 — **caught the body-fat overflow** |
| Today / Trends / Train — the "?" glossaries | `19-glossary.yaml` (all three headers carry it, the sheet opens, and it scrolls to its last term rather than clipping at the panel ceiling) | ✗ authored 2026-08-22 | ✓ 2026-08-22 — first run, on a Release sim build from `9475676` |
| Body weight in kilograms | `20-units-metric.yaml` (Body hero + weigh-in sheet follow the Units setting; restores pounds in its own tail) | ✗ authored 2026-08-22 | ✓ 2026-08-22 — first run, same build |
| (app)/settings | `04-settings.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| history/index | `05-history.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| history/[date] | `05-history.yaml` (deep link, `-e DATE`) | ✓ 2026-08-09 | ✓ 2026-08-18 |
| scan (intro only) | `06-scan-intro.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| coach (idle only) | `07-coach.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| refine-targets (render only) | `08-refine-targets.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| verify-email | `empty/01-verify-email.yaml` | ✗ authored, unrun | ✓ 2026-08-18 — **first run ever, either platform** |
| onboarding | `empty/02-onboarding-empty.yaml` | ✗ authored, unrun | ✓ 2026-08-18 — **first run ever, either platform** |

## Add-sheet modes (7)

| Mode | Flow | Android | iOS |
|---|---|---|---|
| Browse (recency list + Quick add strip) | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Manual (Write it in) | `02` render · `11` real write | ✓ 2026-08-09 (both) | ✓ 2026-08-18 (both) |
| Describe a meal | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Build a recipe | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Import from a link | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Search → results → serving detail | `15-search.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Barcode | — camera; asserted present in `02`, never opened | ✗ camera | ✗ camera |

## Interactions

| Interaction | Flow | Android | iOS |
|---|---|---|---|
| Log → appears in Entries (Firestore-verified) | `11-e2e-log.yaml` + `qa-regression-verify.mjs snapshot` | ✓ 2026-08-09 | ✓ 2026-08-18 (123 kcal read back) |
| Edit entry (Firestore-verified) | `12-e2e-edit.yaml` + snapshot | ✓ 2026-08-09 | ✓ 2026-08-18 (321 kcal / P 9g read back) |
| Delete entry (Firestore-verified) | `13-e2e-delete.yaml` + snapshot | ✓ 2026-08-09 | ✓ 2026-08-18 (`entries: []` read back) — **closed after nine days red, and the old diagnosis was wrong twice over.** The tap never landed: the update Nudge re-rendered Today and returned the list to the top, so `tapOn` searched a tree the row had left. Under that sat a real app bug — Today's list had no bottom padding, so the row's centre fell on the tab bar. Both fixed |
| Row long-press → save preset | `12-e2e-edit.yaml` + snapshot | ✓ 2026-08-09 (preset doc read back) | ✓ 2026-08-18 (preset doc read back) |
| Water +8 / −8 | `14-metrics.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Sleep log 7.5 h | `14-metrics.yaml` + snapshot | ✓ 2026-08-09 (`sleepHours: 7.5`) | ✓ 2026-08-18 (`sleepHours: 7.5`) |
| Mic tap → listening state | `14-metrics.yaml` (conditional) | ✗ — button renders and the tap lands, but the emulator has no recognizer, so the state never appears. Closes on hardware only | ✗ same |
| Month prev/next in History | `05-history.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |

## State multipliers

| State | Flow | Android | iOS |
|---|---|---|---|
| es-PR locale (Today, tabs, sheet, Settings) | `09-locale-es.yaml` | ✓ 2026-08-09 — **caught the `lb/wk` bug** | ✓ 2026-08-18 — **caught the body-fat overflow first, its copy being longer** |
| Dark theme (same surfaces) | `10-theme-dark.yaml` | ✓ 2026-08-09 | ✓ 2026-08-18 |
| Boot / loading (BrandLoader splash) | `01-today.yaml`'s launch capture | ✓ 2026-08-09 — **caught the "Igni" wordmark** | ✓ 2026-08-18 (renders correctly there — the clipping was Android-only) |
| Fresh account (onboarding funnel + every empty state) | `empty/02-onboarding-empty.yaml` | ✗ authored, unrun | ✓ 2026-08-18 — **first run ever**; the funnel saves and every empty state renders |

## Known NOT covered — each with its reason, so nobody "discovers" these

| Surface | Why not |
|---|---|
| Barcode camera, scan photo flow past intro | Needs a camera/injected image; system UI is outside Maestro's reach |
| Coach ask→reply | Still out of the SUITE for the same reason (metered Gemini spend). Now covered by `17-coach-ask.yaml`, tagged `manual` so `excludeTags` keeps it out of directory runs — run it by hand with `--include-tags manual` |
| refine-targets save | Rewrites the QA account's targets; every later ring number moves |
| Template editor — the progression rule sentence | Partly closed 2026-08-18 by `18-train-template.yaml`, which covers the set table, the collapsed summary and the save→re-open round-trip. The progression fields are still unasserted on device: `template-cues-*` is a MULTILINE TextInput, i.e. a UITextView, so a swipe over it scrolls the field instead of the sheet and `scrollUntilVisible` never reaches what sits below. Unit-covered instead |
| Weight log (Body interactions) | Not yet authored |
| ShareCard / TipSheet / WeeklyReportCard / RecalibrationCard | Trigger conditions are data-dependent; not yet authored |
| Offline / error states | Emulator network shaping not wired into the suite yet |
| es-PR × dark combined | Multipliers run singly; the product of both is unwalked |
| Widget, QS tile, Siri, Live Activity | Not app-UI — `adb cmd statusbar` / hardware rows in `WIDGET.md` |
| Speech RESULTS (mic transcript → parse) | Simulators have no speech input; listening state only |

## The fresh-account arc, as actually run — 2026-08-18

Six steps, and every one of them matters. The arc had never run on either
platform, and its first iOS pass needed four fixes before it went green:

```sh
node scripts/qa-regression-verify.mjs create-empty --email qa-test-empty@ignia.fit --unverified   # prints the password
maestro --device <udid> test .maestro/regression/empty/01-verify-email.yaml -e EMAIL=… -e PASSWORD=…
node scripts/qa-regression-verify.mjs set-verified --email qa-test-empty@ignia.fit
maestro --device <udid> test .maestro/regression/empty/02-onboarding-empty.yaml -e EMAIL=… -e PASSWORD=…
node scripts/qa-regression-verify.mjs reset-empty  --email qa-test-empty@ignia.fit
maestro --device <udid> test .maestro/android-signin.yaml -e EMAIL=qa-test@ignia.fit -e PASSWORD=…
```

- **Let `create-empty` generate the password. Do not supply one.** It prints
  the value, and generating it there is the only way to be sure of three
  things that each cost a cycle on 2026-08-18 — and each surfaced as the same
  symptom, the app's own `signin-error`, *"Wrong email or password"*, minutes
  later inside Maestro. Firebase rejects a lowercase-only string server-side;
  a password generated on Windows keeps a carriage return and is one invisible
  byte longer than what Maestro types; and the command USED to leave an
  existing account's password alone while accepting a new one on the command
  line. The script handles all three now: it validates a supplied password up
  front, generates a clean compliant one when none is given, and RESETS an
  existing account rather than silently keeping the old secret.
- **`02` signs in fresh rather than relaunching warm.** After `set-verified`
  the app routes straight into onboarding, so the wall's refresh button never
  fires and the client keeps its pre-verification token: the entire funnel
  completes and the save fails with "Please verify your email first".
- **The last step is not optional.** The arc ends signed out, so the sandbox
  needs `android-signin.yaml` before any other flow runs.

## `hideKeyboard` is the wrong tool on BOTH platforms

Measured 2026-08-24 while bringing flow 21 up on iOS and Android:

- **iOS simulator:** `hideKeyboard` is not supported and fails the step outright.
- **Android:** it SUCCEEDS and does not fire the input's `onBlur`. That is worse,
  because `onBlur` is what commits a deferred edit — a run using it stored
  `durationSec: 0` while the screen showed `32:00`, confirmed by reading the
  session doc back out of Firestore.

Tap a neutral element instead. The session ScrollView sets
`keyboardShouldPersistTaps="handled"`, so a tap on the card's own title
dismisses the keyboard *and* blurs the field, on both platforms.

## Why flow 21's round trip really is Firestore-verified

Worth writing down, because it looks like it only checks local state. Leaving
Train and returning does **not** just re-render from memory: `useTrain`'s
`useFocusEffect` calls `getActiveSession(uid)` on every focus and `setActive`s
the result, so the screen is repainted from the server's copy. An uncommitted
value cannot survive that step.

The commit itself rides on **blur**, exactly as set inputs do — the numeric
fields dispatch with `{ defer: true }` and `onBlur` flushes. In the flow, the
tab tap is what blurs them. That matters for authoring: **`hideKeyboard` alone
does not fire `onBlur` on Android.** A flow that types a value, hides the
keyboard and then reads Firestore will find the field unwritten and blame the
app — measured on 2026-08-24 while proving out the fix above.

## Cardio import is NOT covered on Android, and cannot be

`21-train-cardio.yaml` walks the MANUAL cardio path only. The import half —
a run recorded by an Oura ring arriving through the OS health store — needs
`android.permission.health.READ_EXERCISE`, which is a manifest entry and
therefore a new binary (ADR-0026 amendment, decision 7). Until vc 38 ships,
`readWorkouts` returns an empty list on Android **by design**, so there is
nothing on screen for a flow to assert and a green run would prove nothing.

The asymmetry is worth stating plainly, because it is the opposite of this
project's usual one: iOS needs no binary here at all. HealthKit read types are
requested at RUNTIME and `NSHealthShareUsageDescription` is already declared, so
the iOS fingerprint does not move and cardio import ships over the air. For once
Android is the platform waiting on a build.

**There is exactly one Oura ring available to this project** (the account is in
`CLAUDE.local.md`), so the import path's real verification is a hand run against
that device, not a Maestro flow. What a flow can check — that an imported block
renders its "via Oura" chip and its reported-kcal caveat — is worth authoring
once a build exists to run it on.

## The e2e + empty interleave (admin script on the ADC machine, Maestro on the Mac)

Flows 11–13 and `empty/` need `scripts/qa-regression-verify.mjs` between runs
— it is the ground truth their on-screen asserts cannot provide, and the
janitor that keeps runs idempotent:

```sh
# e2e trilogy (part of a normal directory run; verify between flows):
node scripts/qa-regression-verify.mjs snapshot --email <qa>   # after 11: 123 kcal; after 12: 321 + preset; after 13: gone
node scripts/qa-regression-verify.mjs cleanup  --email <qa>   # always, after: removes the preset (and any orphaned row)

# fresh-account arc (NOT in the directory run — it ends signed out):
# see empty/01-verify-email.yaml header for the full six-step sequence.
```

A run that skips the snapshots still passes on screen. It has simply not
verified what it claims — do not tick the Firestore-verified rows from such a
run.
