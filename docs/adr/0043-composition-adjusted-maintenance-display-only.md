# ADR-0043: Composition-adjusted maintenance is shown beside the measured number, never in its place

- **Status:** accepted 2026-10-03 — flag-gated to the owner's account; shipped by OTA
  the same day (iOS `1ff4aa65`, Android `631f3110`, at `a9f57976`). §Open settled the
  same day (§Resolved): DXA-anchored mode added, the 84-day cap kept.
- **Date:** 2026-10-03
- **Touches:** `packages/core/src/{body-composition,composition-maintenance,recomp-signal}.ts`
  (new), `reminder-plan.ts` (weekly tape plan), `types.ts` / `firestore-writers.ts` /
  `firestore-mappers.ts` / `measurement-bounds.ts` / `csv-export.ts` (`bodyFatPct` +
  `bodyFatMethod`),
  `tdee.ts` (two helpers exported, no logic change), `firestore.rules`
  (`isValidMeasurement`); mobile `lib/features.ts` (`compositionMaintenance: 'admin'`,
  `forbesPrior: false`), `lib/auth.tsx` (`isAdmin`), `lib/reminders.ts`,
  `hooks/useCompositionTrends.ts`, `components/CompositionCards.tsx`, Trends and Body.
  Amends nothing in ADR-0024: the measured estimate is untouched.

## Context

Measured maintenance (ADR-0024) is intake minus scale-weight change priced at one
constant, `KCAL_PER_POUND = 3500` (`tdee.ts:181`, ≈ 7,716 kcal/kg). During
recomposition the scale can sit flat while fat is lost and lean mass/water rises, so
the scale sees ~no deficit and maintenance reads low. The owner tapes waist + neck
(`type=measurement`) and wanted that evidence used.

### Evidence

1. **Energy densities** — Hall 2008, *The dynamics of human body weight change*
   (PLoS Comput Biol): fat mass ρF = 39.5 MJ/kg = **9,440 kcal/kg**; lean mass
   ρL = 7.6 MJ/kg = **1,816 kcal/kg** (protein 19.7 MJ/kg at hydration 1.6). Water and
   glycogen swings make short windows meaningless.
2. Hall 2008, *What is the required energy deficit per unit weight loss?* (IJO): a
   fixed 3,500 kcal/lb misstates energy per unit weight for lean people; it depends on
   composition.
3. **Forbes** (revisited by Hall 2007, Br J Nutr): dFFM/dBW = 10.4 / (10.4 + FM_kg) — a
   population prior for how weight change splits when composition is NOT measured.
   From non-training cohorts; resistance training + high protein shifts loss toward
   fat, so it is a prior only.
4. **US Navy circumference method** (inches) — men: %BF = 86.010·log10(waist − neck) −
   70.041·log10(height) + 36.76; women: %BF = 163.205·log10(waist + hip − neck) −
   97.684·log10(height) − 78.387. Men's waist at the navel.
5. **Its accuracy for CHANGE is poor per individual** — Frontiers in Physiology 2023
   (n = 926 men, 8 weeks of basic training): DXA −3.3 ± 2.8 %BF points vs circumference
   −2.2 ± 3.3; ~83% classified correctly for changes ≥ 1 point; absolute bias ≈ −6
   points. Hence: changes, not levels; many tapes and a regression, not two endpoints;
   always show uncertainty; prefer DXA when entered.

## Decision

**Display only.** `maintenance_comp` is shown UNDER the existing maintenance on Trends
and feeds nothing — not the calorie target, not the pace offset, not the progression
engine. `targets.ts`, `tdee.ts` and `tdee-recalibration.ts` import none of the new
modules (`composition-maintenance.test.ts` pins it), and `dailyTargets` /
`calculateTdee` output was verified **byte-identical** to the pre-change code on a
fixture and on the owner's account (§Verification).

**Flags.** `FEATURES.compositionMaintenance = 'admin'`: on for the `admin` custom claim
(the owner, sole entry of `SEED_ADMINS`), off for everyone else — no uid or email in the
client. `FEATURES.forbesPrior = false`.

**Composition points** (`body-composition.ts`). One per day, priority **DXA %BF >
another measured %BF > Navy (from that day's tapes) > none**; several rows of a source
on one day combine by median. `navyBodyFatPct` is the unrounded, guarded estimate
(height 48–90 in, waist 20–70, neck 10–25, hip 20–80, waist > neck, result 2–60%; cm
accepted); the Body tab's rounded/clamped `navyBodyFat` is left as it was.
**Trend weight on a date** is a local least-squares line through weigh-ins within ±14
days (one-sided at the data's edge), never a single weigh-in — the measured fit returns
a slope only, never a level. FM = trend weight × BF; FFM = the rest; kg internally.

**Measured body fat** is two new optional measurement fields, written as a pair:
`bodyFatPct` (2–60) and `bodyFatMethod` (`dxa` | `other`), enforced by
`isValidMeasurement`. An edit that does not name the pair leaves it alone (a tapes-only
form cannot erase a DXA value). The Body-tab field ships behind the same flag.

**The estimate** (`composition-maintenance.ts`).
- Points from the last **84** calendar days; the window runs **first point → last
  point** (interpolated, never extrapolated). Gate: **≥ 3 points AND ≥ 28 days** between
  first and last, else `insufficient_tapes`. This is the `mixed` mode; the
  **DXA-anchored** mode (§Resolved 1) is tried first.
- Intake follows the measured-mode logged-day rules: `aggregateByDay` under the user's
  boundary, unlogged days excluded (never imputed), the day in progress contributes no
  intake (`withoutInProgressIntake`, cf0953d4), the same `trimmedMean`; days
  [first, last); ≥ 14 logged days or `insufficient_logging`.
- BF slope by least squares over ALL points; BF at the two ends × trend weight there →
  ΔFM, ΔFFM. **ΔE = 9,440·ΔFM + 1,816·ΔFFM; maintenance_comp = mean intake − ΔE / days.**
- **Monte Carlo**, N = 2,000, seeded (mulberry32, seed 20261003): tape σ waist 0.25 in,
  neck 0.125 in, hip 0.25 in per reading; DXA / other %BF σ 1.0; plus the method's error
  on a change, **σ 3.0 %BF per 8 weeks × √(days/56)** (`NAVY_CHANGE_SD_PER_56_DAYS`,
  Frontiers 2023), omitted only when every point is DXA. Report the median and the 80%
  interval. **Confidence from the 80% half-width: High ≤ 150, Medium ≤ 300, Low > 300.**

**Copy.** "lean mass (includes water)", never "muscle"; the FM/FFM split is shown only
above Low confidence (no direction claims inside Low). Insufficient: "Log a waist + neck
tape weekly to estimate recomposition (needs 3 tapes over 4+ weeks)."

**Recomp signal card** (`recomp-signal.ts`). Weight slope = OLS over the RAW weigh-ins of
the last 28 days (`weightSlopeLbPerWeek` — the brief's "OLS on the 7-day average" does
not exist in this app; OLS on raw points has the same expected slope without the moving
average's end-effects). Waist slope = OLS over the tapes of the last 42 days (median per
day), in/4 weeks, ≥ 3 tapes. Classification exactly as briefed (±0.25 lb/wk,
±0.125 in/4wk, first row wins). The card also shows the waist slope's 1σ from reading
error and, when |slope| < 1σ, says the change is within tape noise — the class is not
suppressed, it is qualified.

**Weekly tape reminder** — opt-in on the card: same weekday as the last tape, 07:00,
copy "before breakfast: waist at the navel and neck, 3 readings each — log the median".
A separate `TapeReminderPlan`, scheduled under a fixed identifier and re-armed on every
reminder sync (which cancels everything) BEFORE the meal-reminder master switch, and
isolated so its failure never costs the meal plan.

**Forbes prior** (`forbesMaintenance`, flag OFF). ρ_eff = p·1,816 + (1 − p)·9,440 with
p = 10.4/(10.4 + FM_kg) from the latest composition point. Computed, surfaced nowhere.

## Consequences

**Measured on the owner's account, 2026-10-03** (read-only replay, the app's own inputs):

| | |
|---|---|
| Scale-based (unchanged) | **2,004** kcal — measured, 42 logged days, 100% complete, slope −0.228 lb/wk, ±70 (95%), `measuring`; target 1,850 |
| Composition points | 06-17 16.38 (outside 84 d) · 08-05 16.38 · 08-17 16.38 · 08-30 15.85 · 09-14 15.85 · 09-28 15.32 (Navy, 68 in) |
| Composition-adjusted | **median 2,149, 80% 1,773–2,530, ±379 → Low**; 5 tapes over 54 days (08-05 → 09-28); intake 1,919; trend 160.6 → 155.8 lb; BF 16.46 → 15.42; ΔFM −1.10 kg, ΔFFM −1.08 kg |
| Recomp card | "Recomposition signal: waist down, weight stable" — weight −0.13 lb/wk, waist −0.24 ± 0.34 in/4 wk, 3 tapes, **within tape noise** |
| Forbes (OFF) | FM 10.9 kg → p 0.49 → ρ 5,716 kcal/kg vs 7,716 → **1,974** (−30 vs 2,004) |

Note what the composition window actually says: over 08-05 → 09-28 the scale fell 4.8 lb
and the split is roughly half fat, half lean-incl.-water. That is not the
"flat scale, fat down" case the feature was built for; the card's "recomposition"
reading over the last 6 weeks rests on one quarter-inch step, which the card says.

**Medium is NOT reachable from tapes under this error model.** The method term falls
only as 1/√days and is independent of tape count, and the 84-day lookback caps the span.
Synthetic sweep (155 lb, weekly tapes): ±536 at 28 d, ±435 at 42 d, ±369 at 56 d, ±333 at
70 d, **±308 at 84 d (floor)**. On the account, adding weekly tapes from 10-05 holds the
half-width at ±310–340 for 12 weeks — **no number of additional tapes reaches Medium**.
Phase 0's estimate ("84 days makes Medium reachable from tapes") was wrong; it ignored
the reading-error term and the sliding window.

**Byte-identity.** `dailyTargets` + `calculateTdee` on a fixture with tapes, and
`dailyTargets` on the owner's live data, produce the same JSON at git HEAD `6b850326`
and with this change (worktree comparison, 896 and 493 bytes). Pinned as an inline
snapshot in `composition-maintenance.test.ts`.

**Rules first.** `bodyFatPct` / `bodyFatMethod` are new measurement keys: deploy
`firestore:rules` before any OTA carrying the Body-tab field reaches the flagged account.

## Resolved (owner, 2026-10-03)

These were open questions until the owner settled them later on 2026-10-03.

1. **DXA-anchored mode: added.** In a mixed window any Navy point kept the full method
   error, so a DXA at each end of a tape series barely helped (±303 at 84 d vs ±308), and
   two DXA scans alone failed the ≥ 3-point gate. Now: **≥ 2 DXA points (`dxa` only,
   not `other`) ≥ 28 days apart within the last 182 days** (`COMP_DXA_WINDOW_MAX_DAYS`)
   → the change comes from those scans alone (σ 1.0 each, no method term), and tapes are
   left to the recomp card. The lookback is longer than the tapes' because scans are
   months apart. If that estimate fails a later gate (no weigh-ins around an old scan,
   < 14 logged days), the mixed estimate runs instead. Result field `mode`:
   `dxa_anchored` | `mixed`; the Trends line says "DXA scans". Measured (155 lb, a
   1-point drop, 2 scans): **±346 Low at 28 d · ±236 Medium at 41 d · ±176 Medium at
   55 d · ±117 High at 83 d · ±87 at 111 d · ±54 at 181 d.**
2. **The 84-day cap: kept.** Tape-only estimates stay Low. Stretching the window to
   ~105 days would clear 300 by about 2 kcal, which would be false precision, and the
   estimate would react more slowly.

**Found while building 1: the log cache is rows, not days.** Trends passes the
400-row cache (`LOG_WINDOW_ROWS`, ADR-0004), so a 182-day span can start before it,
and the cap can also cut the oldest cached day off partway. The estimator therefore
takes `logsCompleteFromKey` (`logsCompleteFrom`: the day after the oldest row, once
the cache is full). Days before it are unknown, not unlogged, and intake is averaged
from there (`intakeFromKey`). That is the measured estimate's own assumption about
unlogged days: the logged days stand for the rest. Trends' measurements listener is
bounded by TIME (`subscribeMeasurementsSince`, the last 183 days) rather than by rows.
It shipped first at 80 rows, which could have pushed the older scan out for a heavy
measurer and quietly dropped the estimate back to `mixed`. Replaced 2026-10-04. A
range plus order on `timestamp` alone needs no composite index (checked on prod).

**Fixed in the pre-ship review (2026-10-03):**
- Switching meal reminders OFF in Settings ran `cancelAll`, which took `tape-weekly`
  with it. Now it cancels every identifier except that one.
- The master switch, the sync and the tape toggle now share one queue (`enqueue`), so a
  sync in flight cannot re-arm a reminder that was just turned off.
- The tape reminder is stored on the device but belongs to the account, so sign-out
  clears it (`clearTapeReminder`).
- `trendWeightAt` returns null when every weigh-in sits on one side of the date and the
  nearest is more than 3 days away (`TREND_MAX_EDGE_DAYS`). Weigh-ins at +11…+14 days,
  read at 0, multiplied their noise about 5×, and a DXA-anchored estimate can report
  High.
- If a DXA pair misses on logging or weight and there are no tapes to fall back on,
  the result names that gap instead of saying "log a tape".
- The CSV export carries `bodyFatPct` and `bodyFatMethod`, appended as the last columns.
  Before this, a DXA-only row exported blank.

**Women's tapes (2026-10-04).** `compositionPoints` combines tape fields PER FIELD
across a day's rows (median of the rows that carry each field), so a hip saved on its
own row completes a woman's set; before this, all three had to be on one row. For a
female profile the Trends copy asks for waist + neck + hip (`comp.needTapesHip`), and
the how-to measures the waist at its narrowest and the hips at their widest
(`recomp.howHip`). The weekly reminder carries `hip: true` in its stored setting when it
is turned on from a female profile, and its text then names the hip
(`reminder.tapeBodyHip`). A setting stored before that keeps the original text.

**Before widening the flag (done 2026-10-04):**
- **The Body tab's body-fat card shows a measured value.** It uses the measured
  %BF when that is at least as recent, by day, as the newest Navy-capable tape
  (`bodyFatToShow`; the measured value wins on the same day and needs no
  sex/height), labelled "Measured · DXA · Oct 4" with the tape estimate kept
  beside it. Before this, a DXA entered today sat under a "U.S. Navy estimate"
  from the same week. `bodyFat` itself is still the Navy number, and only that
  is mirrored to Health.
- **Glossary:** Trends' "?" sheet lists *Composition-adjusted* and *Recomp
  signal*, only for users with the flag.
- **Usage signal:** `composition_view`, one per Trends focus while the line is
  shown. Like every event it is in the catalogue, the rules' closed field list
  and the rules spec, and the rules deploy before the OTA; otherwise the whole
  day's flush is rejected.
- Still the owner's to do: a native-speaker read of the es-PR / pt-BR copy, and
  watching the weekly reminder fire on a real phone.

**Not modelled, by decision (2026-10-04): trend-weight error.** Rough estimate, assuming
~1 lb daily noise and near-daily weigh-ins: about ±0.5 lb at each end → ±12 kcal/day at
84 d against ±91 from DXA alone, so it would not move a confidence label. The
extrapolation case it would have mattered for is blocked by `TREND_MAX_EDGE_DAYS`. Add
it to the Monte Carlo if a High DXA reading ever has to be defended.
