# Protocol Violations — spec (no implementation)

**Status:** proposal, nothing built. Approval gates in §G. A per-user *protocol document* the
user authors, plus pure functions in `packages/core` that compare current domain state against
it and return typed `Violation[]`. Deterministic — no LLM in evaluation, copy, or ranking.

**Read-only guarantee.** The engine is *observational*: it never writes, never mutates its
inputs, and never participates in producing a target, a TDEE, a protein number, or any
arithmetic. `calculateTdee`, `dailyTargets`, `MEASURED_MIN_DAYS`, `MEASURED_WINDOW_DAYS`,
`RELIABLE_MIN_PCT`, the Theil-Sen pass, `calendarSpanDays`, `mergeDailyWeights` and the
entry-count window semantics are **inputs, unchanged**; R6 *reads* `tdee.reliable` and has no
opinion on how it is computed. Deleting the engine must leave every number byte-identical.

**Motivating case.** The displayed target sat below the user's anchor and nothing surfaced it.
Every datum was in the app; no code made the comparison. Each rule below is that same shape.

## A. The protocol document — shape and location

### A.1 Decision: its own subcollection document, `users/{uid}/protocol/current`

**Argued against option A (fields on the user doc, next to `calorieFloor`):**

| For the user doc | Against |
|---|---|
| Already subscribed by every hook (`useToday`, `useTrends`, `useBody`) — zero new reads, zero new listeners. Owner is cost-averse. | `isValidProfileCompleted` (`firestore.rules:291-334`) is a `hasOnly` allowlist and the strictest validator in the file. Three of five protocol fields are **lists of maps**, and rules cannot iterate a list (`packages/core/src/workout.ts:46-48` — this is why `rir: 8` reached storage). Adding them makes the document that governs targets carry unvalidated free-form arrays. |
| `calorieFloor` lives there, so `calorieAnchor` beside it is coherent. One fewer document. | Every protocol edit becomes a write to the profile doc — the one read on every app open, whose corruption breaks onboarding and TDEE. List-size blowup lands on that hot read with no per-field cap possible. |

**Chosen: option B.** The unvalidatable part is quarantined in a document with its own
`hasOnly` (seven keys, §E), its own size caps, and no ability to weaken the profile validator.
Cost is exactly **one extra document read per client session** — a tiny, rarely-changing doc,
not a per-write or scheduled cost. `docId` is pinned to the literal `current` in rules, so the
subcollection cannot grow.

### A.2 The floors stay on the profile — they are not copied here

`calorieFloor` (`types.ts:181` → `tdee.ts:221`) and `proteinFloor` (`types.ts:187` →
`targets.ts:114`) already exist and already clamp real arithmetic (`targets.ts:165-171`).
Copying them here would create two sources of truth for numbers that change targets — the
exact bug class this engine exists to catch. The engine reads them from the profile; the
protocol doc carries only fields nothing else consumes.

### A.3 Shape

```ts
// packages/core/src/protocol.ts
export interface ProtocolDocument {
  schemaVersion: 1;
  updatedAt: Date;                 // required — also the R4 "never measured" anchor
  calorieAnchor?: number;          // intended daily target, kcal
  calorieCeiling?: number;         // kcal
  measurementCadence?: MeasurementCadence[];
  exerciseFlags?: ExerciseFlag[];
  progressionRule?: ProtocolProgressionRule;
}
export interface MeasurementCadence { field: MeasurementField; everyDays: number } // measurement-bounds.ts:20
export interface ExerciseFlag { exerciseId: string; reason: string; flaggedAt: Date; clearedAt?: Date }
export interface ProtocolProgressionRule {
  readSet: SetKind;                // owner's case: 'activation' (workout.ts:13)
  addLoadAtReps: number;
  holdBandLow: number; holdBandHigh: number;
  targetRirLow: number; targetRirHigh: number;
}
```

Every field optional and null-safe. **An unset field means its rule does not evaluate** — never
a default. `sanitizeProtocol(raw): ProtocolDocument | null` runs on read and discards malformed
elements individually (rules cannot check them, §E), so the engine never sees junk.

`flaggedAt` is **added** to the given `ExerciseFlag` shape: without it R5 fires on every
historical session forever, and R5 is non-dismissible — a permanently unclearable violation.

`ProtocolProgressionRule` is a **new, distinct type**. `ProgressionRule` (`workout.ts:36`) is
snapshotted into stored `SessionExercise`/`TemplateExercise` docs (`workout.ts:89,172`) and
drives `suggestProgression` (`workout-progression.ts:60`); widening it would change existing
behavior. R7 is a second, read-only opinion that does not feed `suggestProgression`.

### A.4 The Violation type

```ts
export type Severity = 'critical' | 'warn' | 'info';
export interface Violation {
  id: ViolationId;              // 'R1-target-below-anchor' | ...
  severity: Severity;
  title: string;                // i18n KEY, not prose
  detail: string;               // i18n KEY
  params?: Record<string, string | number>;   // interpolation values
  suggestedAction?: string;     // i18n KEY
  dismissible: boolean;
  dedupeKey: string;            // stable per-occurrence key, §D
  subjectId?: string;           // exerciseId / measurement field — R4/R5/R7 emit many
}
```

**Core emits keys, never English.** `packages/core` is framework-free and the clients' i18n
shapes are incompatible (web: Transloco, nested, `{{var}}`; mobile: flat, `{var}`). Prose in
core would force one client to reimplement it — the parity smell CLAUDE.md forbids.

## B. The rules — exact predicates

Entry point, pure, deterministic, `now` injected (no `Date.now()` inside):

```ts
export interface ProtocolInputs {
  now: Date;
  protocol: ProtocolDocument | null;
  profile: Profile | null;
  targets: DailyTargets;                          // the OUTPUT of dailyTargets() — never recomputed
  todaySummary: DaySummary;                       // day-summary.ts:15
  measurements: Measurement[];                    // types.ts:51
  sessions: WorkoutSession[];                     // active + recent completed
  exerciseHistory?: Record<string, SessionExercise[]>;  // per exerciseId, most-recent-first
}
export function evaluateProtocol(i: ProtocolInputs): Violation[];  // sorted severity desc, then id
```

Shared clock gate, defined once and used by R2 and R3 — one concept, one magic number:

```ts
const isDayNearlyClosed = (now, profile) => now.getHours() >= (profile?.reminderHour ?? 20); // types.ts:191
```
`reminderHour` is reused rather than adding a config field: it is already the user's declared,
stored, per-user end-of-day and already the hour the app treats the day as over. Caveat §G-8.

### R1 — effective target below anchor  · `critical` · **not dismissible**

```
anchor = protocol?.calorieAnchor
if (anchor == null) return null
if (targets.calorieTarget >= anchor) return null
emit { shortfall: anchor - targets.calorieTarget, anchor, actual: targets.calorieTarget,
       tdeeSource: targets.tdee.source, branch: deriveBranch(profile, targets.tdee) }
```

**Why this covers all four branches without per-branch instrumentation.** `dailyTargets`
(`targets.ts:119`) already funnels measured, formula, manual and seed through one return
expression, and the floor clamp was deliberately consolidated there for exactly this reason
(`targets.ts:150-171`). R1 reads `DailyTargets.calorieTarget`. Every branch, including manual
(`targets.ts:133-134`) and seed (`tdee.ts:254`), passes through it. There is no path around it.

`deriveBranch` re-reads the same conditionals — read-only, no change to `targets.ts`. It
duplicates a conditional and can drift; the non-duplicating fix is an additive `branch`
discriminator on `DailyTargets`, out of scope here (§G-2).

### R2 — projected day close below the calorie floor  · `warn` · dismissible

**"Projected" ≡ what the day closes at if nothing further is logged.** No extrapolation, no
scaling by fraction-of-day, no historical average. The only estimate in the rule is *when* to
look, and that is the user's own `reminderHour`.

```
floor = calorieFloor(profile)                 // tdee.ts:221 — defaults 1500
if (!isDayNearlyClosed(now, profile)) return null
if (todaySummary.mealCount === 0) return null
if (todaySummary.totalCalories >= floor) return null
emit { deficit: floor - totalCalories, floor, logged: totalCalories }
```

**Why these two gates.** Before the user's own declared end-of-day, a low total is simply an
unfinished day — firing is a false positive by construction. `mealCount === 0` is excluded
because a zero-entry day is a *logging* gap: the engine cannot tell "ate nothing" from "logged
nothing", and "you ate 0 kcal" is the false claim. Remaining-budget was rejected as a trigger
because it is a function of the target, and R1 already covers a wrong target — chaining them
would make R2 fire *because* R1 fired.

### R3 — day nearly closed, protein below floor  · `warn` · dismissible

```
floorG = proteinFloor(profile)                // targets.ts:114 — returns 0 when unset
if (floorG <= 0) return null                  // opt-in only; preserves existing semantics
if (!isDayNearlyClosed(now, profile)) return null
if (todaySummary.mealCount === 0) return null
if (todaySummary.totalProtein >= floorG) return null
emit { deficit: floorG - totalProtein, floor: floorG, logged: totalProtein }
```
Compares against the **floor**, not `targets.proteinTarget` — the target routinely sits above
the floor and comparing to it would fire on ordinary days.

### R4 — measurement overdue  · `info` · dismissible · one violation per cadence entry

```
for (c of protocol.measurementCadence ?? []) {
  last = max-by-date of measurements where m[c.field] != null
  since = last ? localDateKey(last.date) : localDateKey(protocol.updatedAt)
  days  = daysBetween(since, localDateKey(now))
  if (days > c.everyDays) emit { field: c.field, days, everyDays: c.everyDays, subjectId: c.field }
}
```
Strict `>`: a 7-day cadence fires on day 8, not day 7. Never-measured anchors to
`protocol.updatedAt` — a cadence only means something from when it was declared, and that
needs no per-entry `since` field.

### R5 — set logged against an uncleared flag  · `critical` · **not dismissible**

```
flagged = Map(protocol.exerciseFlags.filter(f => f.clearedAt == null), by exerciseId)
scope   = the ACTIVE session, plus completed sessions with date within the last 7 days
for (s of scope) for (ex of s.exercises) {
  f = flagged.get(ex.exerciseId); if (!f) continue
  if (s.date < f.flaggedAt) continue                       // no retro-fire
  style = ex.logStyle ?? DEFAULT_LOG_STYLE
  if (ex.sets.some(set => isLoggedSet(set, style)))        // workout.ts:194
    emit { exerciseId, name: ex.name, reason: f.reason, sessionId: s.id, subjectId: ex.exerciseId }
}
```
`isLoggedSet`, not `isWorkingSet` — a flag means "do not load this"; a warmup on a flagged
exercise is still the thing the flag exists to prevent.

### R6 — TDEE not trustworthy  · `warn` · dismissible

```
if (targets.tdee.source === 'measured' && targets.tdee.reliable === false)
  emit 'R6-measured-unreliable' { loggingCompletenessPct, outliersDropped }
if (targets.tdee.source === 'seed' && toProfileFields(profile) != null)
  emit 'R6-seed-despite-profile' {}
```
`=== false`, never `!reliable`: the field is optional and **undefined on formula and seed**
(`tdee.ts:21-31`), so a falsy check would fire on every formula user. Second clause:
`toProfileFields` (`targets.ts:85`) returns null exactly when onboarding is incomplete, so a
non-null result plus `source: 'seed'` is an observable inconsistency (thin log set, or the
trend fit returned null at `tdee.ts:254`). Read-only — R6 does not touch how any of this is
computed.

### R7 — progression call  · `info` · dismissible · one per exercise

```
for ([exerciseId, history] of exerciseHistory) {
  rule = protocol.progressionRule; if (!rule) return
  ex  = history[0]; style = ex.logStyle ?? DEFAULT_LOG_STYLE
  if (style !== 'weight-reps') continue                    // load calls apply to load only
  set = first set of ex where set.kind === rule.readSet && weight != null && reps != null
  if (!set) continue                                       // rule does not evaluate
  call =
      (set.rir != null && set.rir < rule.targetRirLow)     ? 'hold'      // too near failure to add load
    : (set.reps >= rule.addLoadAtReps)                     ? 'add-load'
    : (set.reps >= rule.holdBandLow && set.reps <= rule.holdBandHigh) ? 'hold'
    : (set.reps < rule.holdBandLow)                        ? 'build'
    :                                                        'hold'     // holdBandHigh < reps < addLoadAtReps
  emit { call, exerciseId, weight: set.weight, reps: set.reps, rir: set.rir, subjectId: exerciseId }
}
```
Mirrors the *selection* shape of `keySet` (`workout-progression.ts:24`) but keys on
`set.kind`, not `isWorkingSet`. Does not call, feed, or alter `suggestProgression`.
Two shape gaps in the owner's rule are flagged in §G.

## C. Input provenance

| Input | Core source | Web | Mobile |
|---|---|---|---|
| `targets: DailyTargets` | `targets.ts:119` | `fitness-store.service.ts:282-284` (`_targets`) | `useToday.ts:145`, `useTrends.ts:88` |
| `targets.tdee` | `tdee.ts:247` via `DailyTargets.tdee` | `fitness-store.service.ts:286` | same `dailyTargets` result |
| `todaySummary` | `day-summary.ts:58` | `FitnessStore.summaryFor` | `useToday.ts:144` |
| `profile` (floors, `reminderHour`) | `types.ts:169-191` | `FirebaseService.profile()` | `useToday`/`useBody` profile |
| `measurements` | `types.ts:51` | body store facet | `useBody.ts:76,200` |
| `sessions`, `exerciseHistory` | `types` in `workout.ts:83,101` | `train.component.ts` | `useTrain.ts:129` |
| `protocol` | new `protocol.ts` | new `LEDGER_PORT` method | new `subscribeProtocol` in `ledger.ts` |

Every input is already loaded on every client. The engine adds one subscription (the protocol
doc) and no recomputation — it consumes `dailyTargets`' existing result, it never calls it.

## D. Rendering, and why R2/R3 do not nag

**The engine emits no push, no toast, no sound, no haptic.** It returns a list; clients render
it in place as a persistent banner — which removes the repeat problem at its root, since a
banner already on screen cannot fire again.

| Rule | Web | Mobile |
|---|---|---|
| R1, R2, R3 | `components/today/today.component.ts` | `src/app/(app)/index.tsx` |
| R6 | `components/trends/trends.component.ts` | `src/app/(app)/trends.tsx` |
| R5, R7 | `components/train/session-sheet.component.ts` | `src/app/(app)/train.tsx` |
| R4 | `components/body/` | `src/app/(app)/body.tsx` |

Dismissal is client-local — `localStorage` on web (precedent: `fitness-store.service.ts:299`),
`AsyncStorage` on mobile (precedent: `components/WhatsNewBanner.tsx`) — keyed by `dedupeKey`:

| Rule | `dedupeKey` | Re-arms |
|---|---|---|
| R2 / R3 | `pv1:R2:<todayKey>` | at local midnight, automatically — a dismissal can never silence tomorrow |
| R4 | `pv1:R4:<field>:<dueDateKey>` | at the next due window, not the next day |
| R7 | `pv1:R7:<exerciseId>:<sessionId>` | next session |
| R1 / R5 | — | not dismissible |

Not synced across devices: syncing costs a Firestore write per dismissal on a free product, and
a `warn`/`info` banner reappearing on a second device is cheap. R1 and R5 are non-dismissible,
so the critical path is unaffected.

## E. `firestore.rules` additions

No change to `isValidProfileCompleted` (`firestore.rules:291-334`) — that is the point of §A.1.

```
match /users/{userId}/protocol/{docId} {
  allow read:   if isOwner(userId);
  allow create, update:
        if isOwner(userId) && docId == 'current' && isValidProtocol(request.resource.data);
  allow delete: if isOwner(userId);
}

function isValidProtocol(d) {
  return d.keys().hasOnly(['schemaVersion','updatedAt','calorieAnchor','calorieCeiling',
                           'measurementCadence','exerciseFlags','progressionRule'])
      && d.schemaVersion == 1
      && d.updatedAt is timestamp
      && (!('calorieAnchor' in d.keys()) ||
          (d.calorieAnchor is number && d.calorieAnchor >= 1000 && d.calorieAnchor <= 10000))
      && (!('calorieCeiling' in d.keys()) ||
          (d.calorieCeiling is number && d.calorieCeiling >= 1000 && d.calorieCeiling <= 20000))
      && (!('measurementCadence' in d.keys()) ||
          (d.measurementCadence is list && d.measurementCadence.size() <= 5))
      && (!('exerciseFlags' in d.keys()) ||
          (d.exerciseFlags is list && d.exerciseFlags.size() <= 50))
      && (!('progressionRule' in d.keys()) ||
          (d.progressionRule is map && d.progressionRule.keys().hasOnly(
             ['readSet','addLoadAtReps','holdBandLow','holdBandHigh','targetRirLow','targetRirHigh'])));
}
```

Follows the `calorieFloor` pattern exactly: `hasOnly` allowlist plus per-field
`!('x' in keys()) || (type && range)` (`firestore.rules:371-372`). The `calorieAnchor` band
mirrors `calorieFloor`'s 1000–10000 deliberately.

**Honest limits.** Rules cannot iterate lists (`workout.ts:46-48`), so element shape inside
`measurementCadence` and `exerciseFlags` is **unvalidated**; mitigation is the size caps above,
`sanitizeProtocol()` on read, and per-element null-safety in every rule. No cross-document rule
asserts `calorieAnchor >= calorieFloor` — the floor is on another document; see §G-6.

Deploy rules **before** any client writes (the dev app talks to prod Firestore). Cover with
`npm run test:rules`.

## F. Build order (TDD)

1. `packages/core/src/protocol.ts` — types + `sanitizeProtocol`. **Red first:** sanitize drops
   a junk cadence element, a flag missing `flaggedAt`, a string `calorieAnchor`; returns null
   on a null doc.
2. `packages/core/src/protocol-rules.ts` — one exported predicate per rule, then
   `evaluateProtocol`. One spec file per rule.
3. **R1 first, and its test is the motivating bug**: fixture anchor `A`, target `A - 90` →
   fires; `A` → silent. Then the same assertion driven through all four `dailyTargets` branches
   by feeding real `DailyLog[]` (measured/reliable, measured/unreliable, manual, seed) — that
   is what proves the choke point holds. Fixture values only; no user's numbers in `src`.
4. R2/R3 clock gate at `reminderHour - 1` (silent), `reminderHour` (fires), `mealCount === 0`
   (silent). R6 `reliable === undefined` on formula → silent.
5. `evaluateProtocol` ordering + `dedupeKey` stability tests. Export from `src/index.ts`.
   Gate: `npm --prefix packages/core test` and `run typecheck` green.
6. `firestore.rules` + `npm run test:rules`: accept well-formed; reject unknown key,
   out-of-band anchor, `docId != 'current'`, other user's uid, oversized lists.
7. **Owner action:** `firebase deploy --only firestore:rules`.
8. Ledger read/write — web `LEDGER_PORT` interface + `FirebaseService` + `FirestoreLedgerCore`
   + `in-memory-ledger.adapter` (all adapters, per CLAUDE.md); mobile `subscribeProtocol` /
   `saveProtocol` in `lib/ledger.ts`, doc shape byte-identical.
9. Settings editors: `settings-preferences-section.component.ts` and
   `src/app/(app)/settings.tsx`; i18n keys added to all four locale files in the right shape.
10. Banners per §D, with dismissal keys. Mobile port committed alongside web. Steps 8–10 touch
    files outside the permitted set — see §G-1.

## G. Open questions I could not resolve from the repo

1. **Scope approval.** §D and steps 8–10 edit files outside
   `packages/core`/`docs`/`firestore.rules`/the two settings surfaces — the ledger port and its
   three adapters, `lib/ledger.ts`, and four render surfaces per client. Approve, or split into
   a core-only phase 1 with no UI.
2. **R1 branch attribution.** Re-derive in the engine (duplicated conditional, can drift) vs.
   an additive `branch: 'measured'|'formula'|'manual'|'seed'` on `DailyTargets` (no
   duplication, but touches `targets.ts` — currently forbidden). Which?
3. **`calorieCeiling` has no rule.** Nothing in R1–R7 reads it. Add R2b — *day close above
   ceiling*, needing no clock gate because exceeding is factual rather than projected — or drop
   the field. I lean R2b.
4. **R7 shape gaps.** (a) The band between `holdBandHigh` and `addLoadAtReps` is undefined by
   the given shape; I defaulted it to `hold`. (b) `targetRirHigh` has no consumer in my
   predicate — should RIR above it force `add-load` regardless of reps, or should the field go?
5. **`flaggedAt`** added to `ExerciseFlag` (§A.3). Confirm — without it R5 fires
   unclearably on all history.
6. **Anchor/floor inconsistency.** If `calorieAnchor < calorieFloor` the protocol contradicts
   itself and R1 can never fire meaningfully. Emit an R0 config violation, or block it in the
   settings UI only?
7. **Anchor has no default, by design** — so R1 is silent for any user who never sets one, and
   the motivating bug would still have been invisible. Is a first-run prompt to set the anchor
   in scope, or is silence-until-authored correct?
8. **`reminderHour` doing double duty** (§B). It is also the push-notification hour. A user who
   moves it for notification reasons silently moves the R2/R3 gate. Acceptable, or add a
   dedicated `dayCloseHour` to the protocol doc?
9. **Cross-device dismissal** is local-only (§D). Confirm that is acceptable for `warn`/`info`.
10. **Widget.** `useDailyTargets` / `widget-snapshot.ts` feed the home-screen widget. I assume
    the engine does **not** run there (no dismissal surface, no room). Confirm.
11. **Gating.** I assume the protocol doc is free and ungated — no `PRO_ENABLED`, no `FEATURES`
    flag, not counted by `tier-limits.ts`. Confirm.

**Parity: no exception.** All seven rules evaluate entirely in `packages/core` from inputs both
clients already hold. Nothing here needs a per-frontend reimplementation.
