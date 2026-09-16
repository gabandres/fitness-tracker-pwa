# ADR-0040: The set structure is declared on the prescription, and the engine dispatches on it

- **Status:** accepted 2026-09-16 — straight sets implemented; the remaining
  structures are declared-but-unread and refuse explicitly. Extends ADR-0038
  and ADR-0039, which stay in force for `myoreps` unchanged.
- **Date:** 2026-09-16
- **Touches:** `packages/core/src/workout.ts` (`SetStructure`,
  `TemplateExercise.setStructure`, `Exercise.setStructure`, `SetKind`
  gains `continuation`), `packages/core/src/set-structure.ts` (new —
  `structureOf`, `inferStructure`), `packages/core/src/progression-engine.ts`
  (dispatch, `recommendStraight`, `unsupported-structure`, `no-rule`,
  `nothing-to-read`, `straight-sets` carries a read),
  `firestore.rules` `isValidExercise`, `apps/mobile`
  (`TemplateEditorModal`, `train-shared.ts`, `recommendation-text.ts`,
  `train.tsx`, three locale files). No scheduled job, no AI call, no Cloud
  Function.

## Context

The app could express exactly one set structure: myo-reps — an activation
set followed by autoregulated mini-sets. That is programmed into the
template editor (an "add cluster" button that scaffolds
`activation, mini, mini`), the logging UI, and the progression engine.

Two things make that a real limit. Heavy compounds are normally programmed
as straight sets with full rest, progressing by load, with intensity
techniques reserved for accessories — the app could not express that
prescription at all. And myo-reps is one structure among several with
comparable evidence: rest-pause, cluster sets, drop sets, supersets, and
single-set-to-failure are all things a user may legitimately want to
program.

### What was already true, and what was not

The premise that "the engine applies myo-reps logic to everything" did not
survive reading the code, and the design is better for it.

`readExercise` filters for `kind === 'activation'` and, finding none,
returns early without judging anything. The first-mini rule has never run
on a straight-set log. The second progression path, `suggestProgression`,
calls `activationIssue()` without `expectsCluster`, which likewise returns
`null` when there is no activation set. **No structure was being
mis-evaluated.**

What was missing is the other half: the engine went *silent* rather than
*explicit*. `{ kind: 'straight-sets' }` already existed as a recommendation
reason, produced with `action: 'none'`, and its copy was the empty string
with the note suppressed entirely. A user programming straight sets saw
nothing and could not tell whether the app had judged the lift, declined
to, or crashed.

And straight-set double progression already existed — `suggestProgression`
implements exactly "bump when the key set hits `targetReps` for
`holdSessions` consecutive sessions", driven by `ProgressionRule`, and was
already called for every exercise on the Train tab. ADR-0039 left
`targetReps`/`holdSessions` dormant when it derived the myo-reps band.
**There were two progression systems running side by side with nothing
deciding which one owned a given exercise.**

### The blocker: structure was inferred, never declared

Nothing recorded what a lift was *programmed* as. Structure was recovered
by inspecting the logged sets:

```ts
expectsCluster: sessionEx?.sets.some((x) => x.kind === 'activation') ?? false
```

That does not generalise. Myo-reps, rest-pause and cluster sets are all
"an activation followed by continuations" in shape and are indistinguishable
by inspection — the thing that separates cluster sets from myo-reps is that
cluster sets are *not* autoregulated, which is a property of the
prescription and leaves no trace in the set list.

A first reading of this called it a live bug — `expectsCluster` is
documented as coming from the TEMPLATE, and this reads it off the SESSION,
which would make the `not-clustered` detection unfireable. **That was wrong,
and implementing the change disproved it.** The line runs only on the
`templateRow == null` branch. Every templated exercise goes through
`recommendOptionsFor`, which already derives `expectsCluster` from the
template's `plannedSets`; the remaining branch is an ad-hoc exercise with no
template at all, where the log genuinely is the only statement of intent
there is. `not-clustered` was never dead. The line is correct and stays.

The generalisation problem above is real regardless, and is the reason for
this ADR.

### What `SetKind` and `setGroup` could and could not carry

`SetKind` conflates two orthogonal axes: **accounting** (`warmup`,
`working`, `mobility` — does this count as volume?) and **structural role**
(`activation`, `mini`, `drop`). `activation` and `mini` are myo-reps
vocabulary, and `mini` specifically means *autoregulated to failure* to the
engine — so rest-pause and cluster sets cannot reuse it without importing
the semantics that distinguish them. Straight sets, however, need no new
kind: `working` was already the neutral default everywhere.

`setGroup` carries no myo-reps semantics. It is a grouping index, already
documented as "clusters sets (C1/C2); omit it for plain straight sets". The
ENGINE interprets a group as "one activation plus its minis", but the field
generalises unchanged to rest-pause blocks, cluster blocks and superset
pairing. The interpretation is structure-specific; the field is not.

## Decision

1. **The structure is declared on the prescription.** `SetStructure` is
   `straight | myoreps | rest-pause | cluster | drop | superset | hit`. It
   lives on the template exercise (what this lift is programmed as) and
   optionally on the catalog exercise (the default for that lift). It
   mirrors how `logStyle` already works, deliberately: a small closed union
   on the prescription, defaulted, never inferred from what got logged.

2. **Absence means "infer with the pre-0040 rule", and that is the whole
   migration.** `structureOf` returns the declared value when there is one
   and otherwise reproduces exactly what the app did before: an `activation`
   set present means `myoreps`, anything else means `straight`. It is a pure
   function over data already on disk. **No document is rewritten and no
   backfill runs**, which is what makes it impossible for this change to
   retroactively reinterpret a logged session. Every existing template keeps
   behaving as it did, because the resolver *is* the old behaviour.

3. **The engine dispatches on the resolved structure, and refuses what it
   cannot read.** `myoreps` routes to the ADR-0038/0039 path unchanged —
   the validity gate, the first-mini test and the derived band are
   untouched, and that is a hard constraint, not an aspiration. `straight`
   routes to a double-progression read built in the engine — it does NOT
   reuse `suggestProgression`, whose `keySet` reads only the FIRST working
   set, the same "recommended off half the evidence" defect `keySets` was
   written to close for multi-cluster lifts. The straight reader is bound by
   the LOWEST rep count across the session's working sets, and its run counts
   sessions AT THE CURRENT LOAD, matching ADR-0039's calibration rule. Every
   other structure returns
   `{ kind: 'unsupported-structure', structure }` with `action: 'none'` and
   renders as visible copy naming the structure.

   This is the point of the ADR. An engine that silently declines is
   indistinguishable from an engine that is broken, and one that guesses is
   worse than either. A structure with no reader gets an explicit refusal by
   construction: the dispatcher has no default branch that falls through to
   myo-reps.

4. **`straight-sets` stops being silent — in BOTH places it was silenced.**
   The empty-string copy was only half of it. `recommendationText` also
   returned `null` for every `action: 'none'`, so the note never mounted at
   all; the reason string was unreachable even once written. Found while
   implementing this ADR, by a test that asserted non-empty copy and got a
   null object instead. Both layers are fixed: the reason carries the read
   (`reps`, `targetReps`, `sessionsAtTarget`, `holdSessions`), and a `none`
   whose reason is one of the ADR-0040 set renders under a "No load call"
   headline rather than vanishing.

5. **`SetKind` gains `continuation`.** Prescribed reps, not autoregulated:
   the role rest-pause and cluster sets need. It is added now, with the
   type, so those structures have somewhere to land; nothing reads it yet,
   because nothing may read it until its structure has a reader.

6. **Structure resolution has exactly one seam.** `recommendOptionsFor`
   resolves template → catalog → inference, and both call sites already
   funnel through it — which is what its own doc promises: "both apps build
   options through this so they cannot disagree about which field means
   what." The ad-hoc branch passes its logged sets as the inference fallback;
   nothing else changes.

## Consequences

- Straight sets are programmable and get a real recommendation. Main
  compounds can be programmed as the literature actually describes them.
- The five unimplemented structures are declarable and say so honestly. A
  user can pick `rest-pause` today and will be told the engine does not read
  it yet, rather than being handed a myo-reps number computed from the wrong
  rule.
- `setStructure` on the CATALOG exercise passes through `isValidExercise`,
  whose `hasOnly` allowlist rejects unknown keys — so **the rules deploy
  strictly precedes any client that writes it**. On the TEMPLATE it needs no
  rules change, because rules cannot iterate `exercises` and never validated
  its members.
- `WorkoutSet` is not validated by rules at all, so `continuation` is free
  server-side and equally unguarded — the client is the only check.
- `action: 'none'` no longer means "render nothing". Four reasons now speak
  through it. Any future `none` must decide explicitly whether it belongs in
  `NON_MYOREPS_REASONS`, or it will be silent in exactly the way this ADR
  exists to stop.
- Two progression systems still exist. This ADR gives them a dispatcher
  rather than merging them; `suggestProgression` keeps its own callers on
  the history screens. Merging them is a later decision, and this ADR
  deliberately does not take it.
- The myo-reps path is byte-for-byte unchanged. Any behaviour difference on
  a `myoreps` lift is a bug in this change, not a consequence of it.
