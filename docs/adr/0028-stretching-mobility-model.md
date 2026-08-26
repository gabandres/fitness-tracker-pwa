# ADR-0028: Stretching is mobility, and mobility is a timed exercise — not a new feature

- **Status:** **accepted** (2026-08-26). Every claim this ADR makes about the existing code was re-read against the source before acceptance; the verification is recorded at the end.
- **Date:** 2026-08-24, accepted 2026-08-26
- **Decides:** issue [#71](https://github.com/gabandres/fitness-tracker-pwa/issues/71) (`wayfinder:research`) — "decide the model before building". Implementation is a separate ticket and does not start before this is accepted.

## Context

The ask was "add stretching before and after in the Train tab." Three things
turned that from an implementation ticket into a decision:

1. **The evidence contradicts the version of the feature everyone ships.** The
   headline claim of a stretching feature — that it reduces soreness — is the
   one claim the best available evidence tests and rejects.
2. **The word is already taken.** `packages/core/src/warmup.ts` means *the load
   ramp for one lift*. [`CONTEXT.md`](../../CONTEXT.md) opens with "one concept,
   one term," and shipping stretching as "warm-up" would break that rule in the
   file that states it.
3. **Reading the existing types properly changed the answer.** `LogStyle`
   already has `'time'`, `PlannedSet` already has `durationSec`, `WorkoutSet`
   already has `durationSec` + `targetDurationSec`, and the seed library is
   already localized through `SEED_L10N`. A timed hold, prescribed by a
   template and logged in a session, is **already a first-class thing this app
   models**. The four candidate shapes in #71 were all priced as if it were not.

[ADR-0025](0025-cardio-is-a-block-on-the-workout-session.md) settled the
analogous question for cardio, and its reasoning is the live precedent. But
cardio genuinely had no home — `exercises[]` is a double-progression engine over
load, and a 5k inside it is a defect waiting for a plausible refactor to expose
it. Stretching is different: a 45-second couch stretch is a `time` exercise,
structurally indistinguishable from a plank, and planks already work.

## The evidence, and what it rules out

The research is done. It is summarised in #71 and in `STATUS.md` §3, with the
sources listed there. Do not re-derive it; cite it.

**Static stretching before lifting costs measurable performance.** Simic et
al.'s meta-analytical review of 104 studies found pre-exercise static stretching
reduced maximal strength by about **5.4%** and power by about **1.9%**,
irrespective of age, sex or training status. The effect is **dose-dependent**:
smallest at **≤45 s** per muscle group, with range of motion still improving and
strength maintained at **≤60 s**, and the deficit climbing past roughly 60 s.

→ **Rules out an unbounded pre-lift stretch timer.** A five-minute static
routine offered before the session makes the user measurably worse at the thing
they opened the app to do. If a *pre*-position hold is prescribed at all, the
prescription has a ceiling and the app says why.

**Stretching does not meaningfully reduce soreness — before, after, or both.**
The Cochrane review (Herbert & de Noronha) pooled 12 studies including one field
trial with **2,377 participants** and found no clinically important reduction in
delayed-onset muscle soreness in healthy adults; the large trial's effect was
about **four points on a 100-point scale**.

→ **Rules out the copy.** This is a copy decision before it is a product one.
"Stretch to prevent soreness" is the single most common sentence a fitness app
says about stretching, and it is not defensible. Ignia's positioning is measured
honesty, and this repo has already spent real design effort keeping numbers
honest when the dishonest version would have been easier —
[ADR-0024](0024-continuous-activity-multiplier-floored-at-fao-minimum.md)
decision 4 and [ADR-0025](0025-cardio-is-a-block-on-the-workout-session.md)
decision 5 both refuse to spend an imported calorie the app is already holding
in its hand. Shipping a soreness claim here would undo that on the cheapest
possible surface.

**What *is* supported pre-training is a structured dynamic warm-up.** The RAMP
protocol (Jeffreys, 2006) — Raise, Activate, Mobilise, Potentiate — is the
standard framework: raise temperature and heart rate, activate the relevant
musculature, mobilise the joints the session needs, then potentiate with
progressively heavier or faster efforts.

→ **Ignia already implements P.** `generateWarmup()` produces empty bar →
~50/70/90% of the working weight, each step rounded down to a loadable weight,
and the Train tab renders it. That is potentiation, and it has been shipping for
months. So the honest description of this feature is **"add M"** — optionally R
and A — not "add stretching." Whatever gets built is an addition to a warm-up
this app already performs, and calling it "the warm-up feature" would
misdescribe both halves.

## The vocabulary problem

Three collisions, not one. All three have to be settled before any identifier is
typed, because two of them are already stored in Firestore documents.

| Word | What it already means here | Collision |
|---|---|---|
| **warm-up** | `packages/core/src/warmup.ts` — the load ramp leading to a working weight; and the `SetKind` value `'warmup'`, which `isWorkingSet` excludes from PR and progression math | Direct. Stretching under this word puts two concepts on one term |
| **activation** | The `SetKind` value `'activation'` — the set that *opens a cluster*, with the `mini` sets after it inheriting its group number (`cluster-groups.ts`) | Silent. This is cluster-training vocabulary and has nothing to do with RAMP's "Activate". A future reader mapping RAMP onto `SetKind` would be wrong in a way the type system cannot catch |
| **potentiate** | Not in the codebase, but it is what `warmup.ts` does | None yet — and it should stay that way |

**Decided vocabulary:**

- **Mobility** is the canonical term for the new concept. It matches RAMP's M,
  covers both dynamic movement and static holds without asserting which, and —
  unlike "prep" or "cooldown" — describes the *physiology* rather than the
  position in the session. Position is a separate question and is answered
  separately below.
- **Warm-up** is re-scoped in `CONTEXT.md` to mean **only** the load ramp for
  one lift. The `SetKind` value `'warmup'` keeps its stored string (renaming it
  is a Firestore data migration for a cosmetic gain), but its glossary entry now
  says what it is *not*.
- **"Stretch"** stays available as user-facing English for a specific movement
  ("Couch stretch"), never as the name of the feature or of a type. A stretch is
  one kind of mobility work; the feature is not only stretching.
- **RAMP's letters are never identifiers.** The framework is a citation in this
  ADR, not a taxonomy in the code. `activation` already means something else,
  and a second meaning would be invisible.

`CONTEXT.md` gains **Mobility set** under the Train section, cross-referencing
`warmup` and `activation` so neither is revived into the wrong meaning — the
same treatment `cardioCompleted` got in
[ADR-0025](0025-cardio-is-a-block-on-the-workout-session.md).

## The options, priced

#71 listed four shapes. A fifth is added here, because reading `workout.ts`
properly showed the machinery already exists. Doing nothing is priced as a real
option, because it very nearly wins.

| | Shape | Cost | Verdict |
|---|---|---|---|
| **A** | `mobility?: MobilityBlock[]` on `WorkoutSession`, each with `phase: 'pre' \| 'post'` | A third array on the session doc; a `firestore.rules` change deployed **before** any client writes it (`isValidWorkoutSession` is `hasOnly()`, so an un-deployed rule rejects the *whole* session write, strength half included); a new `phase` concept with no precedent in the codebase; a parallel template prescription type; a parallel logger UI; a parallel history renderer | **Rejected.** It is ADR-0025's shape applied to a problem that, unlike cardio, is not shaped like a new kind of work. Nearly everything it builds already exists one type over |
| **B** | Reuse `CardioBlock` with `modality: 'other'` | Zero schema change | **Rejected, and it corrupts data.** Stretching is not cardio; it would enter `cardioWeekStats` minutes and the modality chart, inflating weekly cardio volume with holds. ADR-0025 rejected exactly this class of shortcut for exactly this reason |
| **C** | Session-level phase fields (`warmupNotes` / `cooldownNotes`) or an ordered `phases[]` | One or two string fields, plus a rules deploy | **Rejected.** Loses which movement and for how long, so there is nothing to prescribe, nothing to prefill, nothing to look back at — and it spends the word "warmup" on the collision above. Cheap, but it buys a text box |
| **D** | Template-level prescription only; the session records nothing | Near zero | **Rejected on a detail, not on principle.** A prescription that is never recorded cannot be ticked off, and the session is live-written — so "did I already do the hip flow?" survives neither a backgrounded app nor a resumed session |
| **E** | **Mobility is a timed exercise in the existing `exercises[]` array**, prescribed by the template, positioned before or after the working exercises | One `SetKind` value; one line in `isWorkingSet`; a seeded catalog list; one pure guardrail function. **No new session field. No `firestore.rules` change. No new collection. No new template concept. No new history surface** | **Accepted** |
| **∅** | Do nothing | Zero | **Genuinely close, and it is the baseline E is measured against.** A user can already add a catalog exercise named "Couch stretch" with `logStyle: 'time'` and log 45-second holds today, with no code at all. The evidence also says the benefit comes from *doing* the work consistently, not from logging it — so the logging burden may buy very little. This repo has killed features for less (weekly-report autogenerate, on cost) |

The reason **E** beats **∅** is narrow, and worth stating precisely because it is
the whole justification: the capability exists but is **wrong in a few specific
ways**, and E fixes exactly those and adds nothing else.

## Decision

**Take E. Mobility is not a new feature; it is a small set of corrections to a
capability that already ships.**

**1. `SetKind` gains `'mobility'`, and `isWorkingSet` excludes it.** Without
this, a 60-second hold sets `maxDurationSec` in `computeExercisePRs` and the app
celebrates a "longest hold" PR on a pre-lift static stretch — a congratulation
for doing the one thing the evidence says costs strength. Widening the union is
additive in `packages/core` plus the two hand-mirrored client copies;
`firestore.rules` cannot iterate sets and has never validated `kind`, so **no
rules deploy is required** ([ADR-0007](0007-workout-train-tab.md)'s
nested-array trust model, unchanged).

**2. Mobility movements are catalog `Exercise` rows with `logStyle: 'time'` and
no `ProgressionRule`.** `suggestProgression` already refuses to auto-bump
anything that is not `weight-reps` — it "just surface[s] the last result" — so
the deterministic load engine was never a risk here. Omitting the rule keeps
even the *suggestion* off, which matters because "you held it 45 s last time"
next to an empty field is a nudge toward a longer hold.

**3. Position in the ordered `exercises[]` array is the pre/post distinction.
There is no `phase` field.** The array is already ordered and already renders in
order. "Before the first working exercise" and "after the last one" are
derivable, cost nothing to store, and cannot drift out of sync with the order
the user actually sees. This is the one place this ADR diverges from #71's
option A on purpose: `phase` would be a stored assertion about a position the
document already encodes.

**4. Templates prescribe mobility through `PlannedSet.durationSec`, which
already exists.** It already snapshots into `targetDurationSec` and renders as a
placeholder rather than a logged value, so a prescribed stretch is not recorded
as performed until it is ticked — the footgun ADR-0007 paid for once and
ADR-0025 restated. Nothing new is needed for the prescription half.

**5. The dose guardrail is a pure function, and it is the only place the
research has a direct implementable consequence.** A new `packages/core`
predicate flags a **static** mobility set prescribed at more than **60 s** in a
**pre** position, and the template editor shows a one-line note citing the
dose-response finding (smallest deficit at ≤45 s; strength maintained and range
of motion still improving at ≤60 s; deficit climbing beyond). It **warns, it
does not cap** — the user may have a reason, and this app does not silently
overrule a person who typed a number. Post-position holds are unguarded; the
deficit finding is about what happens *before* you lift.

**6. The UI records; it does not claim.** No copy anywhere says or implies that
stretching reduces soreness, aids recovery, or prevents injury. The two claims
that are defensible from the sources above, and the only two that may appear:
range of motion improves with bounded-dose stretching (Simic et al.), and a
structured dynamic warm-up is the supported pre-training practice (Jeffreys,
2006). Everything else is a label and a duration. If a surface cannot be built
without a benefit claim, that surface does not ship.

**7. A short seeded mobility list ships, translated.** #71 asked whether a
content library reopens the i18n problem
[ADR-0007](0007-workout-train-tab.md) deferred. **It does not, and that deferral
is stale**: `packages/core/src/workout-seed.ts` now carries `EXERCISE_ES`,
`EXERCISE_PT`, `TEMPLATE_ES`, `TEMPLATE_PT` and `SEED_L10N`, so shipped library
content *is* localized today. A seeded mobility list is a per-locale cost on an
existing mechanism, not a new problem. Keep it short — enough that the feature is
not a blank text box — and keep user-entered names as data, never translated
([ADR-0013](0013-food-resolution-my-foods-library.md)'s rule, unchanged).

**8. Streak credit follows the session, per existing precedent.** A session
containing only mobility sets marks the day trained, exactly as a session
containing only a cardio block does
([ADR-0025](0025-cardio-is-a-block-on-the-workout-session.md) decision 1). The
objection — that a six-minute stretch is not a training day and cheapens the
streak — is real, and is noted rather than dismissed. It loses to consistency:
there is already no floor on what counts (a walk logged as cardio qualifies
today), the streak means "you showed up," and the evidence says consistency is
precisely where mobility work's benefit comes from. A minimum-effort rule
invented for mobility alone would be a new concept serving one case.

## Consequences

- **No `firestore.rules` change, and therefore none of #61's trap.**
  `isValidWorkoutSession`'s `hasOnly()` allow-list already contains `exercises`,
  and rules never validated set-level fields. This is the single biggest cost
  difference between E and A, and it is why the delivery is an **OTA** — pure
  JS, no manifest change, no fingerprint move, which is the constraint currently
  governing everything shipped here.
- **The frozen web app must not choke on an unknown `SetKind`.** Mobile is the
  source of truth and this is mobile-first
  ([ADR-0022](0022-web-pwa-frozen-not-retired.md)), but the Angular Train tab
  reads the same session documents and maps `kind` to a label. It needs a
  fallback for an unrecognised value — the "one-line check, not a port"
  precedent ADR-0025 set for `cardio[]`.
- **Mobility sets are invisible to every strength derivation, by the same
  mechanism warmups already are.** `sessionVolume` is Σ weight×reps and a hold
  carries neither; `computeExercisePRs`, `metricForSet` and
  `trainHeroStats.topSet` gate on `isWorkingSet`. A test pins the property —
  adding mobility sets to a session leaves every strength number byte-identical
  — in the family of `cardio-strength-independence.test.ts`.
- **`durationSec` now means three things in this domain, and only two of them
  are seconds.** `WorkoutSet.durationSec` is a hold; `CardioBlock.durationSec`
  is how long one run was; `WorkoutSession.durationMin` is how long the whole
  session took, in minutes. ADR-0025 already flagged the last pair as "one
  careless autocomplete apart." This adds a third member to the same
  neighbourhood, and the doc comments have to say so.
- **The feature is deliberately unimpressive on the surface.** There is no
  mobility tab, no dedicated screen, no streak of its own, no chart. A user who
  expected "Stretching" as a headline feature will find a seeded set of timed
  movements they can put at either end of a template. That is the honest size of
  what the evidence supports, and the gap between that and what competitors
  advertise is the finding, not a shortfall.
- **A trainer-authored routine library stays a content problem, not a schema
  problem.** If mobility routines are ever worth shipping as prescribed
  sequences, they are `STARTER_TEMPLATES` entries under the existing seed
  mechanism, and this decision does not need revisiting to allow that.
- **The strongest argument against this ADR survives it.** If, months from now,
  nobody has logged a mobility set, the correct read is that ∅ was right and E
  was a small, cheap mistake — one `SetKind` value and a seed list, all of which
  delete cleanly. That is the price of finding out, and it was chosen knowing
  the null option was live.

## What is explicitly out of scope

- **Any soreness, recovery or injury-prevention claim.** Not in copy, not in a
  tooltip, not in a store description, not in an empty state. This is the point
  of the ADR and it is not a matter of tone.
- **A guided or animated stretch player.** Illustrations or video for a seeded
  library is a content and licensing project with a per-movement cost, and it is
  not what the evidence says produces the benefit.
- **Timed audio cueing or a mobility-specific rest timer.** `RestTimer` exists
  and the set already carries a duration; a second timer concept needs a reason
  this decision does not supply.
- **Flexibility progression or range-of-motion tracking.** Progression on hold
  duration is deliberately off (decision 2), and there is no measured ROM input.
  Charting a number the app cannot measure is the failure mode
  [ADR-0024](0024-continuous-activity-multiplier-floored-at-fao-minimum.md)
  exists to prevent.
- **Any change to how imported workout energy is treated.** Mobility carries no
  `kcal`, and if a health-store record ever arrives labelled as flexibility work
  it maps to a mobility item with no energy at all —
  [ADR-0026](0026-oura-through-the-os-health-store.md) decision 5 is untouched
  and unweakened.
- **A web port.** [ADR-0022](0022-web-pwa-frozen-not-retired.md): the web Train
  tab stays correct, not current. Rendering an unknown `SetKind` without
  breaking is the entire web obligation here.
- **Implementation.** This ADR decides the model. The build is a separate
  ticket, and its first task is the `CONTEXT.md` vocabulary entry, not code.

## Amendment 1 — accepted 2026-08-26, with two clarifications decision 5 needed

Accepting this ADR meant reading every claim it makes about the existing code
back against the source. All of them hold (the record is below), but two of the
decisions were **under-specified in a way implementation would have had to guess
at**, and a guess is how a decision doc quietly becomes an opinion doc. Both are
settled here rather than deferred.

### Clarification A — "static" is not a property this model can read, so the guardrail does not use it

Decision 5 said the predicate flags a **static** mobility set prescribed at more
than 60 s in a **pre** position. **There is no static-vs-dynamic distinction
anywhere in the model, and adding one is not free**: it is either a new field on
`Exercise` (which every user-created mobility movement would leave blank and
unclassifiable) or a hardcoded list keyed on seed identity (which classifies
nothing a user writes). Either way the guardrail would be silent on exactly the
movements the app knows least about.

**Decided: the predicate keys on position and duration only.** It flags **any**
mobility set prescribed at more than 60 s before the first working exercise.
Three reasons this is the right trade even though it will sometimes warn on a
dynamic flow:

1. **The note is a citation, not a verdict.** It says what the dose-response
   evidence found and leaves the number alone — decision 5 already ruled it
   warns rather than caps. A warning that occasionally applies to a movement it
   need not is a much smaller cost than a guardrail that stays quiet on a
   five-minute pre-lift hamstring hold because nobody tagged it.
2. **Simic et al.'s dose figures are about static stretching**, so the note must
   name what it is citing rather than assert something about the user's specific
   movement. Wording follows from that: *"Held stretches longer than about 60 s
   before lifting measurably reduce strength (−5.4%) and power (−1.9%). Under
   45 s the effect is smallest, and range of motion still improves at 60 s."*
   That is true as written whether or not this particular set is a static hold.
3. **It is a pure function of data the session already has** — the array
   position and `PlannedSet.durationSec` — so it needs no new field, no new
   catalog metadata and no rules change, which is the entire reason E beat A.

If a static/dynamic distinction ever earns its place for another reason, this
predicate can narrow onto it without a schema change. It must not be added *for*
this predicate.

### Clarification B — a session with no working exercise has no "pre" position

Decision 3 makes position in the ordered `exercises[]` array the pre/post
distinction, and "pre" is derived as *before the first working exercise*. **A
mobility-only session has no working exercise**, and decision 8 explicitly
allows one (it marks the day trained). So the derivation has an undefined case
on a session shape this ADR deliberately permits.

**Decided: with no working exercise in the session, no mobility set is `pre`,
and the guardrail does not fire.** The strength-deficit finding is entirely
about what a stretch does to the lifting that follows it. When there is no
lifting that follows it, there is nothing to protect, and a warning would be
telling the user that a mobility session is bad for a workout they are not
doing. The predicate returns "not applicable", not "safe" — the distinction
matters for the test, which pins that a mobility-only session produces **zero**
warnings at any duration.

## Verification record — the claims this ADR rests on, re-read 2026-08-26

Accepting a decision that turns on "the machinery already exists" requires
checking that it does. Each claim below was read from the named source, not
recalled.

| Claim in this ADR | Verified at | Result |
|---|---|---|
| `SetKind` is a five-value union, hand-mirrored in two client copies | `packages/core/src/workout.ts:15`, `src/app/models/workout.ts:39`, `apps/mobile/src/lib/workout.ts:38` | **Holds.** All three read `'warmup' \| 'activation' \| 'working' \| 'mini' \| 'drop'`. `src/app/components/train/template-editor.component.ts:27` is a **fourth** place the values are enumerated (`SET_KINDS`), which the ADR did not mention — widening the union means four edits, not three |
| `LogStyle` already has `'time'` | `packages/core/src/workout.ts:51` | **Holds** |
| `PlannedSet` already has `durationSec`, and `WorkoutSet` has `durationSec` + `targetDurationSec` | `packages/core/src/workout.ts:46`, `:99`, `:112` | **Holds.** `targetDurationSec`'s doc comment already states the "prescription is not a performance" rule decision 4 relies on |
| `isWorkingSet` is the single gate, so excluding mobility is one line | `packages/core/src/workout-progression.ts:10` | **Holds.** `return set.kind !== 'warmup' && set.kind !== 'drop'` — one clause |
| Without that exclusion a hold would set a `maxDurationSec` PR | `packages/core/src/workout-progression.ts:106–123` | **Holds.** `computeExercisePRs` gates on `isWorkingSet` and then takes `s.durationSec` unconditionally |
| `suggestProgression` already refuses to auto-bump anything but `weight-reps` | `packages/core/src/workout-progression.ts:73` | **Holds.** `if (style !== 'weight-reps' \|\| !rule \|\| ...)` returns early |
| `firestore.rules` never validates set-level fields, so no rules deploy | `firestore.rules:297–322` | **Holds.** `isValidWorkoutSession`'s `hasOnly()` already lists `exercises`, and the only assertion on it is `is list && size() <= 40`. Nothing reaches `kind` |
| Seed library content is already localized, so a seeded list is not a new i18n problem | `packages/core/src/workout-seed.ts:278, 353, 371, 474` | **Holds.** `EXERCISE_ES`, `TEMPLATE_ES`, `EXERCISE_PT` and the `SEED_L10N` registry all exist; adding a language is one row |
| The frozen web app maps `kind` to a label and needs a fallback | `src/app/components/train/session-sheet.component.ts:433` | **Holds, and it is smaller than feared.** The call is `t('train.kind.' + set.kind)` — a dynamic Transloco key, so an unknown value renders the key text rather than throwing. The cheaper fix is to add `train.kind.mobility` to **both** web locales, which `npm run doctor`'s i18n parity check enforces anyway. The web's own working-set predicate (`:396`) is an explicit three-value allow-list, so mobility is already excluded there |

**One thing the ADR got slightly wrong and it is worth carrying:** it says
widening the union costs "`packages/core` plus the two hand-mirrored client
copies." There is a fourth site — the web template editor's `SET_KINDS` array,
which populates the kind `<select>`. Missing it would compile cleanly and simply
never offer the new kind on the web, which is the failure mode that is invisible
until someone looks.
