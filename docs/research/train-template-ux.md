> **VERDICT** — Ignia's template editor is harder to use than Strong/Hevy/Boostcamp/Alpha Progression while prescribing *less*: every comparator's atomic unit is a **set row with its own target reps and load**, edited in a compact table, whereas our `PlannedSet` is `{ kind, group? }` — no reps, no weight — so a template physically cannot say "3 × 8 @ 135" and the session logger has nothing to prefill. The fix is not to simplify the editor's styling; it is to **put reps/load on the set row** and demote cues/progression/cluster behind a per-exercise menu, which makes the editor smaller and the workout run itself.
> **Status:** RESEARCHED, then BUILT (2026-08-18). Proposals 1, 2, 3 and 5 shipped, plus a vocabulary pass the owner asked for after seeing the mockups ("I don't want users to struggle and have a learning curve"). **Proposal 4 (drag-to-reorder) is the only one still open** — it needs a new dependency and on-device tuning, so the ▲▼ controls stay. Design canvas: the four artboards published 2026-08-18.
> **Researched:** 2026-08-18
> **Read this only if:** you are changing template creation/editing or the run-a-template session flow in `apps/mobile`.
> **Do not** re-derive the comparator behaviour below; cite it.

# How Other Training Apps Build Templates — and Why Ours Feels Complex

The owner's request, verbatim: *"creating a template and updating a template needs to be way more intuitive and less complex. Applies the same on the actual working out off a template. Take a step back to this and really do a web search on how they are working on other apps."*

Comparators surveyed: **Strong**, **Hevy**, **Boostcamp**, **Alpha Progression**. Hevy is quoted most because it is the only one that documents its builder mechanics field-by-field in public help pages; the others are cited for the specific things they do differently.

---

## 1. Bottom line

- **The industry's atomic unit is a set ROW in a TABLE**, columns `SET# | WEIGHT | REPS`, every cell editable in place. Ours is a full-width `TouchableOpacity` whose only content is the set *kind*, which expands an inline five-row picker underneath it.
- **Set type is a modifier on that row, not its identity.** In Hevy you tap the set *number* to mark it Warm Up / Normal / Failure / Drop Set. We make choosing a kind the primary — and only — action a set row affords.
- **Everything advanced is behind a menu.** Notes, rest timer, and warm-up sets are all one level down in Hevy; RPE is off by default and *not available during routine building at all*. We render cues (multiline), a progression checkbox, and three numeric progression fields inline on every exercise card, always.
- **We prescribe less while asking more.** `PlannedSet = { kind, group? }`. There is one `targetLoad` for the whole exercise and no per-set reps anywhere. So the editor's cost is real and its output is thin.
- **That thinness is what makes "working out off a template" feel manual.** Hevy prefills weight, reps and rest from the routine and you tap a checkmark per set. Our session set inputs are `placeholder="0"` — the user types both numbers on every set. We do show a `Last: 135 × 8` ghost (`lastHint`, `train.tsx:784`) and a progression suggestion, which is good, but a ghost is not a prefill.
- **Reordering is drag-and-drop everywhere else.** Alpha Progression even long-presses an exercise across days. We ship up/down chevrons (`template-up-*` / `template-down-*`) — two taps per position moved.

## 2. What each comparator actually does

### Strong
Routine-first by design: you build a template per workout and **every session starts from one**. Adding an exercise carries weight, warm-up sets, sets, rep goals and notes. Reviewers consistently frame the builder as "fast and intuitive" and the default fields — sets, reps, weight — as covering ~90% of strength training. Strong keeps *persistent per-exercise notes inside templates*, which is our `cues` field; the difference is that Strong does not put the notes box on screen for every exercise at once.

### Hevy (best-documented)
Create via **Workout tab → New Routine**, then add exercises and sets. Per set you program **load and reps (or a rep *range*, e.g. 6-8) or a duration**, under `KG/LBS`, `REPS`, `TIME` columns.

Shown inline by default:
- Sets, added with `+ Add Set`
- Set type — tap any set to mark **Warm Up / Normal / Failure / Drop Set**
- Weight, Reps (tap to switch to a rep range), Duration

Hidden behind a menu or toggle:
- **Exercise notes** — added after the exercise, persist each time the routine is reused
- **Rest timer** — below notes; can be toggled off
- **RPE** — requires Profile → Settings → Workouts → RPE Tracking, and is *not available during routine building*
- **Warm-up sets** — three-dot menu, "Add pre-designed warm-up sets"

Supersets are the three-dot menu → `+ Add To Superset`, and support more than two exercises. Routines live in **folders**, reorganised by drag and drop.

### Boostcamp
Positions its creator as *"an Excel spreadsheet, but designed for making workout programs"* — explicitly a grid, with keyboard and mouse shortcuts to add sets, edit sets, rearrange exercises and shift days. It is browser-first and syncs to the app. The lesson is the mental model, not the platform: **a program is a table you fill in**, and the fastest builder is the one that behaves most like a spreadsheet.

### Alpha Progression
Tells you the exact weight and rep target for **every set**, and adjusts as you log — i.e. per-set prescription is the product. Its editor imports workouts and days from other plans, and moves exercises between days by **long press and drop**.

## 3. Our current flow, counted

Creating a template today (`TemplateEditorModal.tsx`):

1. Name, notes, two rest fields (`restMini`, `restCluster`).
2. Type into the adder → a three-chip `Weight × reps / Bodyweight / Time` row appears → pick a catalog match, or tap "Add <name>".
3. The exercise lands as a card that is **always fully expanded**, carrying: reorder chevrons, remove ✕, target load + `lb`, a **multiline cues box**, a **progression checkbox**, and when checked **three numeric fields** (`targetReps`, `holdSessions`, `incrementLb`) plus a generated rule sentence.
4. Sets: each `Add set` appends a row whose only control is the **kind** button; tapping it expands a five-row picker *inline, pushing the rest of the card down*. `Add cluster` appends activation + two minis.
5. Repeat per exercise. Save.

A six-exercise template is therefore six always-expanded cards, roughly eight controls each, in one `ScrollView` — with no per-set reps or weight to show for it.

**This is the complexity the owner is describing, and it is structural, not cosmetic.**

## 4. The structural gap, stated plainly

```ts
// packages/core/src/workout.ts
export interface PlannedSet { kind: SetKind; group?: number }

export interface TemplateExercise {
  targetLoad?: number;      // ONE number for the whole exercise
  progression?: ProgressionRule;
  plannedSets: PlannedSet[]; // no reps, no load, per set
}
```

Every comparator's set carries its own targets. Ours carries a category. Consequences:

- A template cannot express `3 × 5 @ 225` then `1 × 8 @ 185`, the ordinary shape of a top-set/back-off day.
- The session logger has no per-set target to prefill, so it renders empty `0` placeholders and the lifter retypes everything — the exact "working out off a template" friction the owner named.
- `targetReps` inside `ProgressionRule` is the *only* rep number in a template, and it is a progression trigger, not a prescription. Users will read it as the prescription; it is not.

## 5. What the spacing bug was

Fixed in this session and separate from all of the above: `styles.styleRow` carried no top margin, so the three log-style chips sat flush against the exercise text input in the template adder. The same row was used in two other sheets, one of which patched it inline with `space.sm` (8px) and one of which did not patch it at all. Spacing now lives once on the base style at `space.md`, so all three sites agree. `apps/mobile/src/components/train/train-styles.ts`.

## 6. Proposal — for approval, not yet built

Ordered by payoff per unit of risk. **1 and 2 are the ones that answer the owner's ask**; 3–5 are follow-ons.

**1. Put reps and load on the set row.** — **BUILT 2026-08-18.** Extend `PlannedSet` to `{ kind, group?, reps?, weight?, durationSec?, repRangeMax? }`, all optional so every stored template stays valid, and render sets as a compact table: `SET | LB | REPS` with the kind demoted to a tap on the set number, as Hevy does. This shrinks the card *and* makes it say more. Additive and backwards-compatible — a `core` change plus both frontends' readers, though only mobile's editor needs the new UI under ADR-0022.

**2. Prefill the session from those targets.** — **BUILT 2026-08-18**, with one correction found during implementation and recorded in §8. Once sets carry targets, `startFromTemplate` seeds each set's weight/reps, the lifter confirms with one tap per set, and `lastHint` stays as the reality check beside the plan. This is the single biggest win for "working out off a template" and is nearly free once 1 lands.

**3. Collapse the exercise card.** — **BUILT 2026-08-18.** Default to a one-line summary — `Bench Press · 3 × 8 · 135 lb` — expanding on tap. Cues and progression move behind a per-exercise ⋯ menu, matching Hevy's notes/rest-timer placement. The card stops being eight controls and becomes one row.

**4. Drag to reorder**, replacing the chevrons. — **NOT built.** It needs a gesture library (`react-native-draggable-flatlist` or a Reanimated implementation) and on-device tuning, and no SDK 57 binary has had device QA yet. The ▲▼ controls stay until then. Standard everywhere; the chevrons are the tell that this editor was built quickly.

**5. Reconsider clusters' prominence.** — **BUILT 2026-08-18**, differently and better: see §9. Activation/mini clustering is genuinely ours and worth keeping — but `Add cluster` currently sits at the same visual weight as `Add set`, and the vocabulary is unexplained at the point of use. Behind the ⋯ menu with a one-line description, it costs nothing and stops confusing the common case.

**Explicitly NOT proposed:** community/shared routine libraries (Hevy's), multi-week periodization (Boostcamp's), or algorithmic program generation (Hevy Trainer, Alpha Progression). All are out of scope for a free single-developer app, and the last two are AI-cost surfaces the owner has ruled out.

## 8. What implementation changed about proposal 2

The naive reading of "prefill the session" is to write the template's reps into
the session set's `reps`. **That is a data-fabrication bug**, and it was caught
only by reading `isLoggedSet`:

```ts
export function isLoggedSet(s: WorkoutSet, logStyle = DEFAULT_LOG_STYLE): boolean {
  return logStyle === 'time' ? s.durationSec != null : s.reps != null;
}
```

`reps != null` IS the definition of "this set was performed" — it is what
`dropEmptySets` prunes on at finish. Pre-filling it means starting a template
and walking out of the gym records every prescribed set as completed, writing
training history the lifter never did, silently.

So the prescription rides on **`targetReps` / `targetDurationSec`**, new
optional fields on `WorkoutSet`, and:

- the logger renders the target as the input's **placeholder**, not its value;
- ticking a set `done` with nothing typed **commits** the target to `reps` —
  the one-tap confirm Strong and Hevy use, and the reason nothing is logged
  until the lifter actually taps;
- typed input always wins, and unticking never erases what was typed.

**Weight is the exception and IS pre-filled as a real value** — a load with no
reps has never counted as a logged set, which is exactly why the pre-existing
code could already seed `targetLoad` that way.

`firestore.rules` needed **no change**: `isValidWorkoutTemplate` and
`isValidWorkoutSession` both validate only top-level keys and treat
`exercises` as an opaque `is list` (rules cannot iterate a list, which is the
same gap that once let `rir: 8` be stored). Covered by
`apps/mobile/src/__tests__/train.template-targets.test.ts` — 8 cases, the
load-bearing one being "start a template, log nothing, finish → zero sets
saved".

## 9. The vocabulary pass — the half the research nearly missed

The competitive review found the structural gap and would have stopped there.
Seeing the mockups next to the real screenshots made the other half obvious,
and the owner named it: *"I don't want users to struggle and have a learning
curve understanding how this works."*

Density was never the whole problem. **The first thing a new user met was
jargon**: `Activation`, `Mini`, `C1`, `Cues`, `Auto-progression`, `RIR` — all
cluster-training vocabulary, all on screen at once, all before anything they
came to do. The app already had a `TrainGlossary` explaining these terms, which
is the tell: a glossary is a workaround for names that do not explain
themselves.

What shipped:

- **`C1` → `1a / 1b / 1c`.** The old notation was worse than jargon, it was
  *two numbering schemes interleaved*: a session's rows read `1, C1, C1, C1, 2`,
  where `C1` is the cluster's index and `1`/`2` are row positions, so neither
  number told you where you were. A cluster now takes one set number and letters
  its parts. `setRowLabels` in `packages/core` owns this; it is presentation
  only and `group` remains the stored truth.
- **The `RIR` column header → `LEFT`** (`FALTAN` in es-PR). The acronym is the
  single hardest word in the tab. The glossary still teaches "RIR", now under a
  heading that leads with what the column actually says.
- **The set number IS the type control.** Tapping it opens the kind picker, as
  in Hevy — which deleted a full-width button from every row without hiding
  anything, because a non-`working` kind still prints its name under the number.
- **Cues, auto-progression and the exercise-level default load moved behind
  "More options"**, one disclosure inside the open card. Nothing was removed.

Deliberate deviation from the mockup: the advanced panel is an inline
disclosure, not a nested sheet. Nested `Modal`s inside the editor's own `Modal`
are a known-flaky combination in React Native, and nothing here has had device
QA — the disclosure delivers the same "one level down, collapsed by default"
without that risk.

## 7. Open question for the owner

The handoff notes four unresolved "try again" messages whose referent was never established. If they meant *this* work, item 1 + 2 above is the smallest change that makes both halves of the complaint go away; if they meant something else, it is still unidentified.

---

## Sources

- [Strong App vs Hevy: The Best Strength Training Logger in 2026 — RepReturn](https://repreturn.com/strong-app-vs-hevy/)
- [Strong App Review (2026) — RepReturn](https://repreturn.com/strong-app-review/)
- [Strong App Review 2026: Think Less, Lift More — HotelGyms](https://www.hotelgyms.com/blog/the-strong-app-review-think-less-lift-more)
- [Explore the Exercise Programming Options — Hevy](https://www.hevyapp.com/features/exercise-programming-options/) — the per-field inline-vs-hidden breakdown in §2
- [How to Log & Track Workouts Easier and Faster — Hevy](https://www.hevyapp.com/features/track-workouts/) — the run-a-routine flow in §1
- [Build a Workout Program: Create & Organize Routines — Hevy Help Centre](https://help.hevyapp.com/hc/en-us/articles/34953606698903-Build-a-Workout-Program-Create-Organize-Routines)
- [The Complete Guide to Supersets — Hevy Help Centre](https://help.hevyapp.com/hc/en-us/articles/35650286563095-The-Complete-Guide-to-Supersets-and-Smart-Superset-Scrolling)
- [Previous Workout Values to Monitor Your Training — Hevy](https://www.hevyapp.com/features/track-exercises/)
- [Workout Program Creator — Boostcamp](https://www.boostcamp.app/custom-program)
- [Boostcamp Launches Web Program Creator — Fitt Insider](https://insider.fitt.co/press-release/boostcamp-launches-web-program-creator-the-easiest-way-to-make-free-workout-plans/)
- [Alpha Progression · Gym Tracker & Workout Planner](https://alphaprogression.com/en)
- [Alpha Progression Gym Tracker — Google Play](https://play.google.com/store/apps/details?id=com.alphaprogression.alphaprogression)
