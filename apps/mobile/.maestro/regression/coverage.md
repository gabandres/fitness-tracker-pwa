# Coverage ledger — screen × state × platform

**"Covered" means: a flow asserted the surface's anchors AND a human or agent
reviewed that run's screenshots.** Authored-but-never-run is ✗. A row flips to
✓ only with the date and platform of the reviewed run — that discipline is the
difference between this table and a wish list, which this project has been
burned by three times.

Update this file in the same commit as any flow change. If a surface ships
that has no row here, the suite's "100%" claim is false until the row exists —
add it as ✗ first, cover it second.

**A green run is not automatically evidence.** Two ways a pass can lie, both
measured on 2026-08-09: a flow that dies before its restore tail leaves the
account in es-PR or the device in dark, so every LATER flow is asserting
against a state you did not intend (that is what turned one iOS run into
9 "failures", only two of which were real); and screenshots do not reach
`shots/` at all unless the collector ran. Before ticking rows: confirm the
locale/theme are back to baseline, and look at the captures.

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
