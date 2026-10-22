# ADR-0046: Weekly volume counts hard sets beside clusters, never mixed; a lift's muscle tags win over its name

- **Status:** accepted 2026-10-12 — implemented in the Train UX round 2
  pass (S23-12, S23-13, F5); JS-only, no rules change, no native change.
- **Date:** 2026-10-12
- **Relates to:** ADR-0040 (set structure is declared — the kinds this
  counts by), ADR-0041 (`muscles` became editable, which is what makes the
  tags trustworthy enough to win).
- **Touches:** `packages/core/src/volume-credits.ts` (`creditsFor`,
  `hardSetCount`, `hardSetsBetween`, `weeklyHardSets`, `plannedHardSets`,
  `defaultVolumeView`, report `total`), its new test file;
  `apps/mobile` `WeeklyVolumeSheet.tsx`, `StartView.tsx` (the entry link),
  `volume-muscle-name.ts` (new), three locale files.

## Context

The by-muscle sheet (Program v2, 2026-10-11) counted **myo-rep clusters
only**. For anyone lifting straight sets it was empty, and the home link was
hidden for them — the most common way to train had no weekly per-muscle
view at all (`UX_AUDIT.md` S23-13). Counting a cluster as N sets was ruled out
on the evidence in `weekly-cluster-audit.ts`: no validated conversion exists.

Separately, `creditsFor` matched the exercise **name** first and used the
user's muscle tags only when the name matched nothing. A "Landmine press"
tagged Shoulders credited chest 1.0 (it matches `press`); a Romanian deadlift
tagged Glutes credited hamstrings. The editor showed the user a "Primary"
chip that the count then ignored (S23-12). And the sheet named muscles
"Front delt" / "Abs" beside chips that say "Shoulders" / "Core" (F5).

## Decision

1. **Tags win (owner, 2026-10-12).** Untagged lifts keep the name table. A
   tagged lift is credited ONLY muscles its tags cover. A tag "covers":
   Shoulders → front/side/rear delt; Core → abs; Forearms → nothing (no
   forearm volume muscle); every other tag → the muscle of the same name. The
   table **agrees** with a tag when it names a muscle the tag covers, and then
   only *refines which one* (Shoulders + "lateral raise" → side delt; + "rear
   delt fly" → rear delt); otherwise the tag's own muscle (Shoulders → front
   delt, as before). **Weights follow the tag order**, because the chips label
   the first tag "Primary": the first covering tag's lead muscle is 1.0 — even
   against the table's own primary — and every later tag is 0.5 in total (its
   lead head only). The table's own ½ for a second head survives only inside
   the primary tag (shoulder press tagged Shoulders: front 1 · side ½). At most
   one 1.0 credit, always the user's primary.
2. **Hard sets are their own count.** A hard set is a `working` set that was
   performed (`isLoggedSet`: reps, or duration on a timed lift). Not counted:
   `warmup`, `mobility`, `drop` (a continuation of the set before it), and
   every set of an activation group — `activation`, `mini`, `continuation`.
   **A cluster contributes nothing to the set count, not even its activation**:
   counting the activation would put a fraction of the cluster into a number
   that then reads as its set-equivalent. L and R sets pair like L and R
   clusters (3 + 3 = 3 sets for the muscle).
3. **One tally, two units.** Hard sets and clusters run through the same
   private tally — same window (completed sessions in `[from, to]`), same
   `creditsFor` weights, same per-session plateau flag — so a muscle reads
   comparably on either face. The two numbers are never summed or shown in one
   figure; each face says the other's count exists ("Myo-rep clusters in the
   last 7 days: 3 — counted under Clusters. There's no validated way to turn a
   cluster into sets.").
4. **The sheet has a Sets | Clusters switch** (`SegmentedControl`, native where
   the binary has it). Until the user flips it: Clusters when the window has a
   performed cluster, else Sets; when nothing at all was logged, the plan
   decides (Clusters only if it plans clusters and no working sets). A flip is
   remembered **on the device** (`usePersistedTab`, key `train.volume.view`,
   ADR-0034 d4) — no profile field, no rules deploy.
5. **One muscle vocabulary.** Volume rows read the chip keys: "Shoulders
   (front|side|rear)" and "Core" (`volume-muscle-name.ts`); the
   `train.volume.muscle.*` keys are deleted.

## Consequences

- The owner's Program v2 data is unchanged where it matters: every primary is
  the same, so the straight-rest rule (`primaryMuscleOf`) and the "only side
  delt +1" plan diff still pass. Fractional numbers move where a tag was
  missing (DB Flat Press no longer credits front delt) or added (Rear delt
  flye tagged Back now credits back ½) — the tags were always the user's
  statement; now the count reads them.
- A lift tagged only Forearms is "not counted" even if its name matched. That
  is the rule, said on the sheet's unattributed line rather than guessed.
- `session-duration.ts` reads `creditsFor(...).length > 1` as "compound": a
  lift with two covering tags is compound now. Estimates only.
- The weekly cluster audit (`weekly-cluster-audit.ts`, `muscles[0]`) and its
  2–6 range are untouched; it already counted the user's primary.

## Amendment — 2026-10-22 (Program v2.2): a straight lift inside a cluster program

"The two views never mix" had a hole the owner's v2.2 found: a cluster
programme that carries ONE straight-set lift (the DB RDL, 2 × 8-12) showed that
lift on neither face it opens on — 0 clusters, and the Sets face holds only it.
The owner's rule is "1 set = 1 set".

`clusterViewUnits` (`volume-credits.ts`): a lift with NO activation sets, in a
session or template that DOES have clusters, counts its working sets one each
in the cluster view. Everywhere else the views stay apart exactly as decided
above — a straight-only session or programme still counts 0 clusters, so a
straight-set lifter's faces are unchanged. The Sets view is not touched.

`defaultVolumeView`'s empty-window rule moved with it, from "clusters and no
working sets" to "real clusters (`plannedClusters − plannedSets`, since the
straight sets now sit in both) at least the working sets" — otherwise that one
RDL flips the owner onto the Sets face. Pinned in `program-v2-2.test.ts` and
`volume-credits.test.ts`.
