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

## Route screens (13)

| Screen | Flow | Android | iOS |
|---|---|---|---|
| sign-in | `../android-signin.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| (app)/index — Today | `01-today.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| (app)/train | `03-tabs.yaml` (full-depth) | ✓ 2026-08-09 | ✓ 2026-08-09 |
| (app)/trends | `03-tabs.yaml` (full-depth) | ✓ 2026-08-09 | ✓ 2026-08-09 |
| (app)/body | `03-tabs.yaml` (full-depth) | ✓ 2026-08-09 | ✓ 2026-08-09 |
| (app)/settings | `04-settings.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| history/index | `05-history.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| history/[date] | `05-history.yaml` (deep link, `-e DATE`) | ✓ 2026-08-09 | ✓ 2026-08-09 |
| scan (intro only) | `06-scan-intro.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| coach (idle only) | `07-coach.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| refine-targets (render only) | `08-refine-targets.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| verify-email | `empty/01-verify-email.yaml` | ✗ authored, unrun | ✗ |
| onboarding | `empty/02-onboarding-empty.yaml` | ✗ authored, unrun | ✗ |

## Add-sheet modes (7)

| Mode | Flow | Android | iOS |
|---|---|---|---|
| Browse (recency list + Quick add strip) | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Manual (Write it in) | `02` render · `11` real write | ✓ 2026-08-09 (both) | ✓ 2026-08-09 (both) |
| Describe a meal | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Build a recipe | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Import from a link | `02-add-sheet.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Search → results → serving detail | `15-search.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Barcode | — camera; asserted present in `02`, never opened | ✗ camera | ✗ camera |

## Interactions

| Interaction | Flow | Android | iOS |
|---|---|---|---|
| Log → appears in Entries (Firestore-verified) | `11-e2e-log.yaml` + `qa-regression-verify.mjs snapshot` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Edit entry (Firestore-verified) | `12-e2e-edit.yaml` + snapshot | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Delete entry (Firestore-verified) | `13-e2e-delete.yaml` + snapshot | ✓ 2026-08-09 | ✗ **the one open iOS gap** — the row tap does not open the editor there, so `entry-delete` never renders; the capture shows Today with no sheet. Not an app defect on the evidence available (the same tap opens the editor in flow 12, which passes on iOS), but unexplained. Next session: dump `maestro hierarchy` with the row on screen |
| Row long-press → save preset | `12-e2e-edit.yaml` + snapshot | ✓ 2026-08-09 (preset doc read back) | ✓ 2026-08-09 (preset doc read back) |
| Water +8 / −8 | `14-metrics.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Sleep log 7.5 h | `14-metrics.yaml` + snapshot | ✓ 2026-08-09 (`sleepHours: 7.5`) | ✓ 2026-08-09 |
| Mic tap → listening state | `14-metrics.yaml` (conditional) | ✗ — button renders and the tap lands, but the emulator has no recognizer, so the state never appears. Closes on hardware only | ✗ same |
| Month prev/next in History | `05-history.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |

## State multipliers

| State | Flow | Android | iOS |
|---|---|---|---|
| es-PR locale (Today, tabs, sheet, Settings) | `09-locale-es.yaml` | ✓ 2026-08-09 — **caught the `lb/wk` bug** | ✓ 2026-08-09 |
| Dark theme (same surfaces) | `10-theme-dark.yaml` | ✓ 2026-08-09 | ✓ 2026-08-09 |
| Boot / loading (BrandLoader splash) | `01-today.yaml`'s launch capture | ✓ 2026-08-09 — **caught the "Igni" wordmark** | ✓ 2026-08-09 (renders correctly there — the clipping was Android-only) |
| Fresh account (onboarding funnel + every empty state) | `empty/02-onboarding-empty.yaml` | ✗ authored, unrun | ✗ |

## Known NOT covered — each with its reason, so nobody "discovers" these

| Surface | Why not |
|---|---|
| Barcode camera, scan photo flow past intro | Needs a camera/injected image; system UI is outside Maestro's reach |
| Coach ask→reply | Every ask is metered Gemini spend; a paying suite gets turned off |
| refine-targets save | Rewrites the QA account's targets; every later ring number moves |
| Workout logging (Train interactions) | Not yet authored — largest remaining interaction gap |
| Weight log (Body interactions) | Not yet authored |
| ShareCard / TipSheet / WeeklyReportCard / RecalibrationCard | Trigger conditions are data-dependent; not yet authored |
| Offline / error states | Emulator network shaping not wired into the suite yet |
| es-PR × dark combined | Multipliers run singly; the product of both is unwalked |
| Widget, QS tile, Siri, Live Activity | Not app-UI — `adb cmd statusbar` / hardware rows in `WIDGET.md` |
| Speech RESULTS (mic transcript → parse) | Simulators have no speech input; listening state only |

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
