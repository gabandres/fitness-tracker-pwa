# ADR-0041: Train separates the logger from the coach — the home screen answers "what today", the set row answers "what last time"

- **Status:** accepted 2026-09-16 — implemented; merged, not yet on any OTA
  (`STATUS.md` §2 owns where that stands). Extends ADR-0007 and ADR-0040; the
  UI ordering in ADR-0040's implementation is **reversed** (decision 5 below).
- **Date:** 2026-09-16
- **Touches:** `packages/core/src/train-plan.ts` (new),
  `packages/core/src/workout-seed.ts` (`searchExerciseLibrary`,
  `findSeedExerciseByName`), `packages/core/src/workout.ts` (`MUSCLE_GROUPS`),
  `packages/core/src/workout-session.ts` (`addBlock`),
  `apps/mobile/src/lib/active-workout-signal.ts` (new),
  `apps/mobile/src/components/train/` (four new components),
  `apps/mobile/src/hooks/useTrain.ts`, `apps/mobile/src/app/(app)/train.tsx`,
  `apps/mobile/src/app/(app)/_layout.tsx`, three locale files. **No Firestore
  rules change** (`muscles` and `defaultCues` were already permitted by
  `isValidExercise`), no scheduled job, no AI call, no Cloud Function.
  **JS-only — OTA-shippable.**

## Context

The owner's report was "the Train module feels crowded and not as intuitive as
I imagined — not just editing or creating a template, but starting the workout
too." That is a symptom, and the reading that followed found a single cause.

**The engine and the logger are sharing one surface with no hierarchy between
them.** ADR-0038, ADR-0039 and ADR-0040 built something genuinely
differentiated: a progression engine that refuses to recommend a load off a
read it cannot trust. Nothing in the market does that honestly. But its
vocabulary became the *default* for the whole tab, for everyone:

- `+ Add cluster` sat beside `+ Add set` under every exercise, including the
  straight-set lifts it contradicts.
- A new template's first four fields were Name, Notes, **Rest (mini)** and
  **Rest (cluster)** — two of the four myo-reps vocabulary, asked before a
  single exercise existed.
- The structure picker was eight bare chips of gym jargon (`myo-reps`,
  `rest-pause`, `cluster sets`), two of them labelled "not read yet".
- The header carries a **glossary button**. That is the tell: the tab knows it
  has its own dialect. Active vocabulary across the tab ran to thirteen terms.

Three more findings, each measurable rather than aesthetic:

**The most prominent control was the least-used path.** The full-width primary
was `Start workout`, which starts an *empty* session. Starting "Push A" was a
small chip on a template row, three sections down, under a hero and a six-chip
audit. Template rows read `3 exercises · 12 sets` — no last-performed date, no
order, nothing that answers *what am I doing today*.

**Last session's numbers were one aggregate line.** `Last: 135 × 8` at the card
head. Hevy, Strong, Boostcamp and Fitbod all put PREVIOUS on *every set row*;
it is the affordance that turns logging from a decision into a comparison, and
it is the most-used cell in all four. An aggregate cannot answer "what do I put
in row 3."

**Two real defects, found while reading.** They are the reason this is an ADR
and not a polish pass:

1. **`EXERCISE_LIBRARY` was unreachable.** ~70 movements carrying muscle groups
   and coaching cues, localized to all three locales, and *no picker touched
   it* — both filtered `train.catalog` only. It entered a catalog solely as a
   side effect of cloning a starter template.
2. **Every hand-created exercise was permanently unattributed.**
   `addCatalogExercise` and `addExerciseToActive` hardcoded `muscles: []`, and
   no screen anywhere could set them afterwards. So `weeklyClusterAudit`'s
   `unattributed` line was reporting a gap the user had **no way to close** —
   the one thing this project is least willing to ship. The two compound: the
   library that would have fixed the attribution was sitting right there,
   unwired.

The competitive scan is in the session record; its conclusion is one line.
Every tracker that reads as intuitive makes the home screen make the decision,
makes the set row a comparison, keeps one always-visible action per exercise
and puts the rest behind an overflow, and puts destructive actions behind a
gesture — because the user has 60–90 seconds between sets, one hand, and wet
fingers.

## Decision

**The logger is boring and fast. The coach speaks once per lift, at the moment
the question arises.** Seven decisions follow from that.

**1. The home screen answers one question, and core decides the answer.**
`nextTemplateUp` (`train-plan.ts`) returns the template gone longest without
being performed, never-performed first. Least-recently-performed beats the two
alternatives: an explicit `order` field makes the user maintain a number they
never think about and cannot answer for someone who trains two of four
templates; "next after the last one performed" reads well until the list
reorders, and `subscribeTemplates` returns most-recently-updated first, so
*editing* a template would silently change what comes next. LRP needs no stored
order, is stable under any list ordering, and for a plain A/B/C rotation
produces exactly the rotation. Ties break on list order so a cold account is
deterministic. The card names the template *and when it was last done* — a card
that asserts "Push A" without showing its work is a decision the app made
silently, which this repo does not do with numbers and will not start doing
with recommendations.

The empty workout is **kept and demoted to a link**. The catalog, which
rendered as an unbounded list as the sixth stacked section of the home screen,
moves behind one row into a searchable sheet. The cluster audit collapses to
its one-line verdict with the chips one tap away.

**2. PREVIOUS is a column on every set row, and it is positional.** `previousSets`
takes the newest history entry that actually has logged numbers — an exercise
opened and abandoned is not a previous performance — and `previousCell`
formats one row's comparison. Row 3 compares against row 3. Comparing against
the *n*th **working** set instead drifts the moment a warm-up is added or
dropped, and a comparison that silently re-points is worse than no comparison.
The cell is read-only; making it a field would invite typing into last week.
The aggregate ghost line survives on the **collapsed** card, which is the one
place an aggregate is the right shape.

**3. The tick accepts last session, not just the prescription.** The one-tap
path existed but only for a set a template had prescribed — so an ad-hoc or
unprescribed row, which is most rows for most users, had to be typed. It now
falls back to what was actually done, reps **and load**: a repeated set at no
weight is not a record of the set that was performed. Nothing is pre-filled as
a *value*, so abandoning a session mid-way still records only what was done,
and typed input always wins.

**4. One always-visible action per exercise; the rest behind `⋯`.** The card
keeps `+ Add set` — burying the most frequent action to tidy the rarest ones is
the same mistake in the other direction. Add cluster / add block / plates &
warm-up / lift settings / remove move into an overflow sheet, and **which of
them exist is structure-dependent** (`addActionsFor`). The set row drops from
six hit targets to five: the permanent `✕` was the smallest, the most
destructive, and directly beside the control tapped after every single set. It
becomes swipe-left, and **the swipe reveals while the tap deletes** — deleting
on the swipe itself would let an over-enthusiastic scroll on a wet screen
destroy a logged set with no undo, which is a looser bar than the `✕` it
replaces, not a tighter one. The set sheet carries the same action as a
labelled row, so it stays reachable by VoiceOver and by anyone who does not
know the gesture.
The set-kind and RIR pickers, which expanded *inside the set list* and pushed
every row below them down, become that one sheet — a layout jump mid-logging is
worst under exactly the conditions this screen is used in.

**5. The template editor asks for the structure FIRST, and the structure
scaffolds the rows.** This reverses the ordering ADR-0040 shipped. The
declaration is the decision and the rows are its consequence; asking for it
*underneath* the sets table, after three buttons have made the user hand-build
a list that implies a structure, is those two in the wrong order — and it is
why every card carried the union of every structure's needs. `scaffoldKindsFor`
names the mapping. **ADR-0040's model is untouched**: the structure is still
declared and never inferred, `undefined` still means "infer with the pre-0040
rule", and an undeclared legacy template still gets all three add-buttons.

The scaffold is gated on `isPristineScaffold`. Rows the user has typed numbers
into are **kept**, only the declaration changes, and the card says so. This
repo does not silently overrule a person who typed a number, and a template's
numbers are the ones that cost real effort.

Notes, rest defaults and prescribed cardio move behind one **Template options**
row, open by default for any template that already uses them. Name and
exercises is the whole form.

**6. Creation routes through the shipped library, and attribution is
editable.** `searchExerciseLibrary` and `findSeedExerciseByName` make
`EXERCISE_LIBRARY` reachable; one `ExerciseSearchList` serves all three pickers
(three copies of the filter-and-map had already drifted on how a seeded
mobility movement is classified). A typed name that **exactly** matches a
library movement inherits its muscles, cues and `seedKey` — exact only, because
a fuzzy match would attach the wrong muscle group to a movement the user named
deliberately, and do it silently. `MUSCLE_GROUPS` and a chip picker in the
exercise sheet fix the movements created before this.

**7. A live session is visible from every tab.** `active-workout-signal.ts` is
one boolean and a name, written by `useTrain`'s single `setActive`, read by the
tab bar as a dot. **It is not a shared subscription cache and must not become
one** — it opens no listener and holds no documents, so ADR-0016 is untouched.
It is persisted (uid-scoped, best-effort) purely so quitting mid-workout and
reopening on Today still shows the dot; the cached value is a hint that
`useTrain` overwrites with the truth on load.

## Consequences

- **The engine is unchanged.** `progression-engine.ts`,
  `activation-validity.ts` and `set-structure.ts` are not touched. ADRs 0038,
  0039 and 0040 stay in force; this is entirely the surface above them.
- **One new session action**, `addBlock`, closes a real ADR-0040 gap: a
  template could prescribe rest-pause but the live session had no way to add a
  block, so the user had to pick `continuation` out of the set-kind list by
  hand and know it was the right one.
- **The bundle grew 1.47%** (13,343,009 → 13,538,783 bytes raw; +82 KB
  gzipped), almost all of it `ReanimatedSwipeable`. Within budget, accepted on
  the record here rather than absorbed silently.
- **Three `Date.now()` calls in one render** on the idle screen now, where
  there were two. `react-hooks` flags each as an impure render call; the two
  that existed set the precedent and the value genuinely has to be the render
  time, since core takes `now` as a parameter so its windows stay testable.
  Noted rather than fixed — if it is worth fixing it is worth fixing all three.
- **The glossary button stays**, but it is no longer the only place the tab
  explains itself: the structure picker gained a description per option (the
  pattern the set-kind picker has always had and the best-explained control in
  the tab) and RIR is expanded in words where it is answered.
- **Nothing is migrated and no document is rewritten.** Existing templates keep
  their sets, their undeclared structure and all three add-buttons; existing
  exercises keep their (possibly empty) muscles until someone edits them.

## Alternatives considered

- **Continuous scroll in place of the accordion**, as Strong and Hevy use.
  Rejected for now: the accordion is load-bearing for a nine-exercise session
  on a 360dp screen, and the PREVIOUS column plus the `⋯` menu address most of
  what the accordion was hiding. Revisit if the complaint survives.
- **An explicit program with ordered days.** The right long-term shape and a
  much larger change — it needs a new entity, a new editor and a migration.
  `nextTemplateUp` delivers the behaviour users actually want from a rotation
  with no stored state at all; if a real program is built later, it replaces
  this function and nothing else.
- **Leaving the two defects as bugs rather than folding them into this ADR.**
  Rejected: the unreachable library and the unfixable attribution are the same
  problem as the crowding — a surface built for one user's protocol, where the
  general path was never walked.
