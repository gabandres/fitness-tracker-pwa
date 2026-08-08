# Photo-scan gets its macros from the bundled USDA database, not from the model

## Status

accepted (2026-08-07). Implements the split vision architecture
[ADR-0015](0015-macronaut-photo-first-freemium-pivot.md) §1 specified and never
built. Depends on [ADR-0018](0018-bundled-usda-food-db.md) (the bundled dataset)
and sits alongside [ADR-0017](0017-photo-scan-free-for-all-v1.md) (photo-scan is
on and free for everyone).

## Context

Photo-scan shipped live and free on both platforms, and it shipped as **the
design ADR-0015 §1 explicitly rejected**: the vision model was asked for the
meal's calories, protein, carbs and fat directly, and whatever it answered went
to the user.

ADR-0015 §1 rejected that on measured grounds. General LLM vision shows **>60%
error on protein** — the app's single most important number — while being
genuinely good at *identifying* food and *estimating portions*. Its conclusion
was to split those two jobs: the model names the food and sizes the portion, and
a nutrition database supplies the macros.

That split could not be built at the time because there was no local nutrition
database to resolve against; the live FoodData Central API meant a network call,
an API key and a rate limit per item. ADR-0018 removed that blocker by bundling
13,272 USDA foods into the functions deploy, and `searchFoods`/`getFoodDetail`
have been serving from it since. Nothing then connected it to photo-scan.

So the feature in front of users was the rejected one, and the only thing that
had ever blocked fixing it was gone.

## Decision

**The vision model does recognition, portion and cooked-state. The bundled USDA
database produces every macro it can. Items it cannot resolve keep the model's
numbers and are labelled as estimates.**

Concretely:

1. `analyze-photo.ts` asks for a **list** of `{ name, grams, state, confidence }`
   plus a portion-cue chain-of-thought. It no longer asks for the meal's macros.
   Per-item macros are still requested, last in the schema, as a **fallback only**.
2. `photo-resolve.ts` (new, pure, unit-tested) resolves each name against the
   bundled dataset and scales the matched food's per-100 g macros by the grams.
3. Unresolvable items fall back to the model's own numbers and are marked
   `source: "model"`. Both clients show that marking.
4. The response is **additive**: `items[]` is new; the flat
   `calories`/`protein`/`carbs`/`fat` fields remain and are now the sum of the
   resolved items.

### Why the response is additive, and not a clean new shape

Every binary in users' hands — iOS builds 24 and 25, Android vc 11 and 13, and
the deployed web app — reads only the flat fields. A clean break would have
broken photo-scan for every installed client the moment it deployed, and a mobile
client fix takes a store release.

Keeping the flat fields means the accuracy improvement reached **every existing
install the moment the function deployed**, with no app update, no OTA and no
review. The itemized review screen is the part that needs new clients; the
grounded numbers are not.

### Three findings that shaped the resolver

`searchUsda` could not be reused as-is, and the reasons are worth recording
because each was found by running against the real dataset, not by reasoning.

**Raw versus cooked is the largest error in the system, larger than picking the
wrong food.** USDA files staples raw. `searchUsda` deliberately *rewards* the
plain/raw row, because someone typing "rice" wants the canonical entry. But a
photo shows a plate, and the model measures the portion on that plate: raw rice
is 369 kcal/100 g against about 130 cooked, so resolving "white rice" to the
canonical row overstates the meal roughly **threefold** — silently, with USDA
provenance attached. Black beans (341 vs 132) and lentils (351 vs 116) are the
same story.

The fix is to ask the **model** whether the food was cooked, because that is a
fact about the photograph and the model can see the photograph. The alternative
— inferring it server-side from the food's name — was tried and abandoned: a
lexicon cannot separate a banana (raw is correct) from rice (raw is a 3× error)
without effectively encoding a food taxonomy. Getting this wrong in the other
direction is just as bad, and nearly happened: rewarding "dry" as a raw marker
promotes "Milk, dry, whole" (496 kcal/100 g) over "Milk, whole" (61). The penalty
for uncooked forms is therefore broad and the bonus narrow.

**A model phrase is not a typeahead query.** `searchUsda` requires *every* token
to appear in the description. Models emit "grilled chicken breast with skin" and
"two scrambled eggs", where "grilled", "with" and "two" appear in no USDA
description at all. Preparation words became optional-but-rewarded, filler is
dropped, and connectives split the phrase into clauses so a garnish cannot
outrank the dish.

**A wrong confident match is worse than an honest fallback.** Relaxation — trying
shorter token runs when the whole phrase fails — is where every embarrassing
result came from: "arroz con pollo" resolved to **"Fish, pollock"** because
"pollo" is a prefix of "pollock", and "salmon fillet" resolved to **"Vegetarian,
fillet"**. Relaxed matches must now clear a score floor, match on a whole word
rather than a prefix, never survive on a bare cut word ("fillet", "breast"), and
prefer the clause's head noun. All four dishes USDA does not carry — mofongo,
tostones, pernil, pan sobao — now correctly resolve to nothing and fall back.

Convenience products and branded rows also had to be demoted: "grilled chicken
breast" resolved to "Chicken breast, oven-roasted, fat-free, sliced" — deli meat
at 79 kcal and 16.8 g protein, against 165 and 31 for the actual cut. Protein
wrong by 45%, on the app's core metric, for its most-logged food.

## Consequences

- Macros for common foods are now database values scaled by a model-estimated
  portion. The model's numeric weakness is confined to foods the database does
  not carry, where it is labelled.
- **The grams are now load-bearing.** Every macro scales linearly off them, so
  the portion-cue reasoning in the prompt matters more than it did, and the
  review screen's per-item grams field is the primary correction.
- Both review screens are itemized. Mobile renders N rows with editable
  names/portions; web shows the same breakdown under the capture button and
  re-emits totals as the user edits. The handoff's claim that mobile needed no
  client change was wrong — `scan.tsx` rendered `items[0]` only.
- The whole plate is still logged as **one** `DailyLog`. Splitting it into N rows
  would change what streaks, counts and the Today list mean for a single meal;
  that is a separate product decision.
- **Cost is unchanged.** Same model, same image, one call per scan. The prompt is
  ~100 tokens longer and the output is per-item rather than per-meal, which at
  `gemini-2.5-flash` rates does not move ~$0.0015/scan meaningfully. Both spend
  guards are untouched and in the same order.
- Resolution is CPU-only against an in-memory array — no network, no new secret,
  no new scheduled function.

## Validation

`functions/test/photo-resolve.spec.ts` (43 tests) asserts the rules on fixtures
**and** resolves real phrases against the real committed dataset. The real-data
half is the half that matters: every ranking bug above involved a specific USDA
row ("Vegetarian, fillet", "Fish, pollock", "Milk, dry, whole") that no fixture
would have contained to be fooled by.

What is still owed, per ADR-0015 §2: judging the **item list and portions** on
30–50 real photos. `scripts/validate-photo-itemiser.mjs` is the harness and it
grades exactly that — never the macros, which is now correct by construction
rather than by discipline.
