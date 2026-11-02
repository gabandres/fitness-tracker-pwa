# ADR-0048: Travel mode — trips hold maintenance, stay out of the fit, and end in re-entry sessions

- **Status:** accepted 2026-10-26 (owner request; first trip Bolivia
  2026-10-31 → 2026-11-18). Implemented on `feat/travel-mode`; JS + rules.
  **Deploy `firestore:rules` before any client — or the owner script — writes
  `travelPeriods`, `estimateQuality` / `proteinFirst`, a weigh-in `note`, or
  a session's `reentry` / `notComparable`.** The Settings editor is
  `FEATURES.travelMode: 'admin'`.
- **Date:** 2026-10-26
- **Relates to:** ADR-0047 (which days the fit reads — this removes travel
  days from it and adds a post-trip minimum), ADR-0024 (the multiplier seam
  is untouched), ADR-0016 (no new listener: Trends reads Train's cache, the
  ledger reads the trips the auth provider already holds), Program v2.1
  `deload.ts` (re-entry reuses "the engine never reads this session").
- **Touches:** `packages/core/src/travel.ts`, `reentry.ts`,
  `travel-volume.ts` (new); `tdee.ts` (`calculateTdee` wraps the live fit),
  `maintenance-view.ts`, `train-view.ts` (`engineSessions`,
  `exerciseHistory`, `bestE1RMByExercise`), `progression-engine.ts`
  (`ladderCall`, `harder-ladder`), `superset-context.ts`, `volume-credits.ts`,
  `csv-export.ts`, `types.ts`, `workout.ts`, serializers/mappers, the offline
  queue; `firestore.rules`; `apps/mobile` Today, Settings, Trends, Body, Train,
  reminders, ledger, three locales.

## Context

A trip breaks the two inputs the maintenance estimate trusts. There is no
scale, so weigh-ins stop (or come off a hotel or gym scale that is not the
user's), and food is eyeballed, so intake is a guess. Fed to the fit, three
weeks of that would move the number the user's targets lean on — and after
the trip the bad weeks would sit inside the 42–84-day window for months.
Training changes too: no gym, or a different one, and a layoff that makes
the last loads the wrong first ask.

## Decision

1. **A travel period is a dated range on the profile** (`travelPeriods`,
   `{start, end, label?, usualSteps?, altitude?}`, inclusive). Every trip is
   kept: a past trip's days must stay out of the fit while the window can
   reach them. Rules can only cap the list (≤ 24, the `dayBoundary`
   precedent); `travelPeriodsOf` drops a malformed entry on read rather than
   guessing. **Auto-exit is the dates** — nothing writes "travel ended".
2. **Maintenance** (`calculateTdee`, so Today, Trends, targets, the history
   replay and the coach agree):
   - travel days' intake, weigh-ins and "fully logged" answers never reach the
     fit — before, during or after the trip;
   - **inside a trip the estimate is FROZEN** at its value as of the trip's
     first day (so the last day home counts in full), computed over the trips
     before it; the result carries `travelHold: {state: 'frozen'}`;
   - **after a trip the frozen value holds** — `travelHold.state ===
     'rebuilding'`, "n of 14" — until 14 complete post-travel days are
     finished (the estimator's own minimum, ADR-0047's rule for "complete");
     then the live fit over non-travel days returns, unflagged;
   - only the latest started trip governs; an older trip only removes its
     days; a trip that has not started changes nothing.
3. **Weigh-ins on a travel day** are kept and shown, written with the note
   "travel scale — not comparable" (`setDailyWeight`, every writer), and
   excluded by DATE from the trend line, the 7-day average and the fit. No
   weigh-in reminder while a trip is on; it resumes by itself afterwards.
4. **Eyeballed meals** are ordinary log rows with `estimateQuality:
   'eyeballed'` (and `proteinFirst: true` when set) — a new axis, not a new
   `source`: provenance and trustworthiness are different questions. Kept
   across an edit like `source`; exported as columns.
5. **Re-entry sessions** (`reentry.ts`): a gym session during a trip after
   ≥ 7 days without one (`'travel'`), and each template's first session in the
   42 days after a trip (`'post-travel'`), seed loads −10 % on a load the
   equipment has, ask RIR 2, and are flagged on the session. **Like a deload
   the engine never reads one**, so the second session back reads the pre-trip
   history (normal targets return) and a lower day is never a regression,
   stall or deload trigger. The travel templates (`templateVersion`
   "travel…") are never re-entry and are not "the gym".
6. **"Different equipment — not comparable"** is a session switch, ON by
   default for a non-travel template during a trip. Such a session is out of
   the engine's reads AND out of e1RM charts and PRs (`exerciseHistory`,
   `bestE1RMByExercise`) — unlike a deload, whose numbers are still the
   lifter's on their own equipment.
7. **No-equipment progression is a ladder on the row** (`ladder: {capReps,
   harder}`), not a load step: once any working set reaches the cap (20, or 15
   per leg), the call is "make it harder" — 3 s lowering + 1 s pause, then
   backpack load, then the named variation — and the load is held, never
   stepped (a backpack is estimated). Only the load is observable, so an
   unloaded lift is told the first rung and the second; a loaded one the
   second and the third.

## Consequences

- During a trip the maintenance number does not move, by design; Today says
  why ("Held for travel"), and Trends says it under the number.
- A trip's eyeballed intake has no effect on the estimate at any time — the
  eyeball flag is for the export and the user, not for the fit.
- A re-entry or not-comparable session leaves no trace in progression. If the
  user trains hard at a strange gym and wants it to count, they switch "not
  comparable" off.
- "Missed" sessions do not exist in this app (the streak counts logged days,
  food or training, and eyeballed meals are logged days); Zone 2 has no
  frequency expectation — so "travel does not break streaks or count as missed"
  needed no change. Planned sessions arrived with the amendment below and read
  "skipped" at worst.

## Amendment 2026-11-02: a gym on the trip, and a plan

The owner's trip gained a gym (Haven Gym, Cochabamba: kg rack, different
machines) and a week-by-week plan. All JS plus data; no rules change.

- **An away gym's lifts are their own evidence.** Lifts with no home link get
  their own catalog entries (`haven-*`). A lift the owner linked keeps its home
  `exerciseId`, and its row carries `awayGym` + `linkedHome`, snapshotted onto
  the session row. `exerciseHistory` / `engineHistory` then split the record: an
  away row reads only that gym's rows, a home row, the e1RM chart and PRs never
  read them. This is per ROW, not the session-wide `notComparable` of decision 6,
  because the away rows must still progress on their own reads, and it is why
  `travel-gym-*` templates stay `isTravelTemplate` (never −10 %, not "the gym").
- **A row can be in kg** (`loadUnit`): the card shows and takes kg, the lb
  equivalent beside it. Stored loads remain pounds, so the engine and volume read
  one unit; the export adds `loadUnit` / `loadInUnit`. A kg row steps 2.5 kg and
  ignores the catalog's lb `availableLoads`.
- **The first session of a lift at the gym is calibration**
  (`SessionExercise.calibration`, set at start): activation RIR 2, the long first
  mini is not "too easy", and "raise load now" runs on clusters too (home
  clusters still never prompt). Its read counts: at `progression.targetReps` (12
  / 15, `EngineConfig.repFlagAt`) the next load is called, with no baseline hold.
- **The plan is data on the trip** (`TravelPeriod.plan`, `travel-plan.ts`): Today
  shows "This week", Train's Next up follows it, and travel templates stop being
  Next up once home. Nothing penalises a skipped session.

Limits: `MAX_SUPERSET_SIZE` stays 3, so Travel C's D4 and Travel D's E5 are the
next row at the same 30 s, in the performed order the owner asked for. "Raise
load now" skips L/R lifts (two tracks), as it does for straight L/R rows.

## Alternatives rejected

- **A stored frozen number** (write the estimate at trip start). The estimate
  is computed live everywhere (`tdee.ts` says why there is no stored "last
  good value"); a stored copy needs a writer at the right moment on a phone
  that may be offline, and drifts from the replay. Recomputing "as of the
  trip's start" is deterministic.
- **Imputing travel intake** from the eyeballed rows. ADR-0047 rejected
  imputation for incomplete days for the same reason: a guess fed to a fit
  reads as data.
- **Re-entry as a deload variant.** A deload halves volume at the template's
  loads; re-entry keeps the volume and lowers the load. Different sessions,
  one shared property (unread), which is what `engineSessions` keys on.
