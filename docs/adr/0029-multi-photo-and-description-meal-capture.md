# ADR-0029: Multi-photo and description meal capture

- **Status:** `proposed` — **all five items are BUILT and DELIVERED** to both platforms (Android OTA 62-63, iOS OTA 33-34, 2026-08-26). The delivery half of the Definition of Done is met; what keeps this `proposed` is the OTHER half, which asks for the description field's token cost to be **measured**. `estimateWithGemini` logs `usageMetadata` per call, so the data is sitting in Cloud Logging and nobody has read it. That is a log query, not a build. **Item 5's gate is gone** — `dailyQuota` counts IMAGES and `spendCeiling` follows; this line said it was still gated until 2026-08-26. See Amendment 1 for what building it changed.
- **Date:** 2026-08-24
- **Amends:** [ADR-0017](0017-photo-scan-free-for-all-v1.md) (photo-scan on and free), [ADR-0013](0013-food-resolution-my-foods-library.md) (the trust rule), [ADR-0015](0015-macronaut-photo-first-freemium-pivot.md) §1 (why the model is not asked for macros)

## Context

The owner described how he and the tester actually log a meal today — not in
Ignia, but in a chat with an assistant:

> Take 2 or 3 pictures of the same meal before inputting the data. Most of the
> time, add a description of the meal so it's easier for AI to pinpoint the
> macros. For example, a picture showing the food scale and the measurement,
> then in the chat box: *"1/2 cup of greek yogurt Kirkland, 1/2 cup of cottage
> cheese Daisy 2%, splash of cinnamon, vanilla extract and maple syrup pure
> Kirkland."* And the AI checks the picture or looks up the actual macros. Since
> the chat has context, a repeat meal resolves faster.

That is a description of a workflow that **works**, from the two people who use
this app most. The question this ADR answers is which parts of it Ignia should
absorb, and at what cost.

### What Ignia does today — both halves, and they never meet

**Photo (`functions/src/analyze-photo.ts`).** The callable takes
`{ photoBase64, locale }` — **exactly one image, and no text field at all.** The
model is asked for *recognition and portion size only*: a food name, grams, a
cooked/raw `state`, and a confidence. It is deliberately **not** asked for
calories or protein, because ADR-0015 §1 rejected that design on the finding that
general LLM vision shows **>60% error on protein** — this app's core metric.
`photo-resolve.ts` then looks the macros up in the bundled USDA database. Model
identifies; database counts.

**Text (`packages/core/src/meal-utterance.ts`).** A deterministic, on-device,
$0, private parser turns *"2 eggs and a cup of white rice"* into
`{ quantity, unit, food }` and **never emits a macro number**. Resolution is a
separate `searchFoods` lookup.

So Ignia already has both modalities the owner uses, built on the same rule — and
**they are two separate screens that cannot inform each other.** The photo path
cannot read a description; the text path cannot see a photo. That gap, not model
quality, is the subject of this ADR.

### The finding that reframes the whole request

**The owner's own example cannot be resolved by Ignia today, and no amount of
prompt or model work would fix it.** *"Greek yogurt Kirkland"* and *"cottage
cheese Daisy 2%"* are **branded packaged goods**, and branded **text** search was
removed on 2026-08-19 — Open Food Facts publishes a 10 req/min limit for search
against 100/min for barcode GETs, and debounced typeahead behind one Cloud
Functions egress IP could not live inside it. Two of three probes came back
throttled after paying full latency.

So a description naming a brand currently resolves to a generic USDA entry, or to
nothing. **Restoring branded resolution is a prerequisite for this feature, not a
nice-to-have**, and it is already scoped: `docs/research/off-branded-ingest.md`
says ingest a filtered OFF subset into the bundled format — the same move
ADR-0018 made for USDA, feasible, and not blocked on cost.

### What "the AI searches the web" must map to here — and must not

In a chat, "look up the macros" means a web search. **In Ignia it must not**, for
two independent reasons:

1. **It reintroduces every cost ADR-0018 spent a release escaping** — an API key
   (a Secret Manager version against a free tier audited at a floor of 8), a
   shared rate ceiling, and an upstream that can be down.
2. **It breaks the trust rule.** A number scraped from a search result is
   unverifiable and unattributable. The whole architecture here is that the model
   never supplies a macro; a named database does.

Ignia already has **five** resolvers, and one of them shipped today: bundled USDA
(13,272 foods), **MenuStat restaurant items (25,126 across 91 chains, ADR-0027)**,
Open Food Facts by barcode, My Foods (ADR-0013), and the deterministic text
parser. The honest version of "search the web" is *use those five well and add
the branded corpus* — recorded here so a web search is not re-proposed.

## The options

| | Change | What it buys | Cost |
|---|---|---|---|
| **A** | **A description field on the scan screen**, passed to the same single-image call and used as a naming/quantity hint | The model stops guessing at a brand or a quantity the user already knows. Nearly free — it is a text field and a prompt section | **~+150 input tokens/scan** (~5% on a ~2.2k-token call). No new call, no new quota |
| **C** | **Read the scale.** When a photo shows a kitchen scale, take the displayed number as the item's weight instead of the model's visual estimate | **The highest accuracy per dollar available.** `grams` is the ONLY number the model contributes and every macro scales linearly off it, so replacing an estimate with a *measurement* removes the dominant error term outright | Prompt work + a scale-reading instruction. No extra image if the scale is in the same frame |
| **B** | **Multi-image**, 2–3 photos of one meal in one call | Better recognition of buried/ambiguous items and a second angle for portion size | **The real cost, see below** |
| **D** | **Repeat detection** — surface "you logged this before" from My Foods when a description matches a prior entry | The owner's "chat context makes a repeat faster" | **$0 and no model call at all.** My Foods already stores it; what is missing is surfacing it |
| **E** | **Live web lookup for brand macros** | — | **Rejected**, for the two reasons above |

### The cost finding that decides the ordering

> **CORRECTED 2026-08-26 — every number in the original version of this section
> was wrong, and the conclusion survives anyway.** The original text is preserved
> below the correction because *how* it went wrong is the reusable part.

**What the numbers actually are.** The active model is **`gemini-3.5-flash-lite`**,
not Gemini 2.5 Flash. A measured scan is **~1,840 input + ~443 output tokens** at
$0.30 / $2.50 per MTok = **~$0.0017**. The free tier's 3/day worst case is
**~$0.15 per user per month**, and the `photo` ceiling bounds the worst possible
day at 2,000 scans ≈ **$3.40**. (`spend-ceiling.ts` had already re-derived exactly
this on 2026-08-21; this ADR did not read it.)

**Three images does NOT triple the cost. It is roughly 1.4×.** The benchmark
figure of 1,009 input tokens is the **whole call** — prompt plus image — not the
image alone, and this ADR read it as per-image. The static prompt is ~700 tokens,
so the image's own share is roughly **1,100 tokens**, and only that part scales
with image count. Output tokens do not scale at all, and at $2.50/MTok they are
**two-thirds of a scan's cost**:

| | Input | Output | Cost |
|---|---|---|---|
| 1 image | ~1,840 | ~443 | **$0.0017** |
| 3 images | ~4,100 | ~443 | **$0.0023** |

So the free tier's worst case goes from ~$0.15 to **~$0.21** per user per month,
not to $0.40. **Multi-image is materially cheaper than this ADR concluded**, and
anyone re-reading the original ordering should know the cost argument against B
was roughly half as strong as it appeared.

**The structural argument is untouched, and it is the one that decides:**

> **`dailyQuota` counts SCANS, not IMAGES.** A 3-image scan costs ~1.4× the model
> spend against the *same* 3/day free allowance, and the `photo` `spendCeiling` —
> which bounds the worst possible day — is denominated in the same wrong unit.

**RESOLVED 2026-08-26.** The quote above is the argument as it stood, kept
because it is what decided the ordering. It is no longer the state of the code:
`dailyQuota` counts IMAGES and `spendCeiling` follows, which is what unblocked
item 5.

**Multi-image must not ship until the quota counts images.** That is a one-line
semantic change in `functions/src/daily-quota.ts` plus a re-priced ceiling, and it
is the difference between a bounded feature and an unbounded one. Both guards stay
mandatory (`check()` before the per-user reserve, `record()` after). Note the
gate is now about **boundedness, not magnitude** — an unbounded multiplier of 1.4
is still unbounded.

**How this went wrong, because it will recur.** Neither error was invented here.
`analyze-photo.ts` itself said `gemini` — `gemini-2.5-flash` in its provider
table until 2026-08-26, eight weeks after `GEMINI_MODEL` moved to
`gemini-3.5-flash-lite` twenty lines below, and it repeated the $0.0015 / $0.14
figures in a third place. This ADR read the file that owns the fact and the file
was stale. **Both are fixed at source**, and `estimateWithGemini` now logs
`usageMetadata` on every call, so the next person to price this reads real
traffic instead of a benchmark someone ran once.

*Original text, superseded:* "Gemini 2.5 Flash bills ~1,009 input tokens per
image. Today a scan is ~2.2k input tokens ≈ $0.0015. Three images roughly triples
the image half of that — call it $0.003–0.004 a scan… the free tier's worst case
goes from ~$0.14 per user per month to ~$0.40."

### The resolution claim was not a contradiction — it is two clients

This ADR reported `analyze-photo.ts` as self-contradictory, stating 768px in one
comment and 1920px in another. **Both were correct and both were about a
different client**, which neither comment said:

| Client | Resize | Where |
|---|---|---|
| **Mobile** | **768px WIDE** (`.resize({ width })` — width only, so a tall photo stays tall) | `apps/mobile/src/lib/mealScan.ts`, `UPLOAD_MAX_EDGE` |
| **Web** | **1920px on the long edge** | `src/app/components/photo-capture/photo-capture.component.ts`, `resizeAndEncode(file, 1920)` |

Both comments now name their client. Web's extra pixels are wasted upload bytes
on the Anthropic path (the API downscales to 1568px anyway); on the Gemini path
they are worth measuring before assuming, now that usage is logged. **Quote a
resize number only with the client attached.**

## Proposed decision

**Ship A + C + D first. Hold B until the quota counts images. Reject E.**

The argument is that A, C and D deliver most of what the owner described at
almost none of the cost, and that C in particular attacks the single largest
source of error in the current pipeline rather than adding a second one.

1. **A description field** on the scan screen, optional, placed before capture so
   it frames the photo rather than correcting it afterwards. Passed to
   `analyze-photo` as a new `note` field and appended to `ESTIMATION_PROMPT` as
   *user-supplied context that overrides visual inference for naming and
   quantity*. The deterministic parser already understands *"1/2 cup"*, so the
   same string should also run through `meal-utterance.ts` to seed quantities —
   which costs nothing and is more reliable than the model for that specific job.
2. **Scale reading.** Add a prompt clause: if a kitchen scale with a legible
   readout appears, report that number as the item's grams and mark the item
   `measured` rather than `estimated`. Surface that distinction in the review UI —
   a measured weight should look different from a guessed one, because it is.
3. **Repeat detection** from My Foods on the description text, before any model
   call. A matched repeat should be offerable **without scanning at all**, which
   makes the common case both instant and free.
4. ~~**Multi-image, deferred**, and explicitly gated on `dailyQuota` counting images.~~ **SHIPPED 2026-08-26** — the gate was moved first, then the feature.
5. **Branded resolution is the real unlock** and is a separate piece of work:
   the OFF branded ingest. Without it, a description naming a brand resolves to a
   generic. This ADR does not pretend otherwise.

## Consequences

- **This is a new AI-cost surface and it is priced, not waved through.** A is ~5%
  on an existing call; C is prompt-only; D removes calls. Only B raises spend
  materially, and it is held behind the quota fix for exactly that reason.
- **No new secret, no new scheduler job, no new callable.** A and C extend
  `analyze-photo`'s existing payload and prompt; D is a local lookup.
- **The trust rule is unchanged and is what makes this safe.** The model still
  never supplies a macro. A description makes it *name* better; a scale makes it
  *weigh* better; the database still counts.
- **`measured` vs `estimated` becomes a thing the UI owes the user.** Once a scale
  reading can enter the pipeline, showing both the same way would be the same
  class of dishonesty as rendering a 2022 menu figure as today's (ADR-0027).
- **Both platforms**: the description field is a mobile-first change; the web
  logging app is frozen (ADR-0022) and keeps the single-photo path unchanged.

## What still needs deciding

- Whether the description field is **pre-capture** (frames the shot) or
  **post-capture** (corrects the result). This ADR proposes pre-capture; the
  owner's workflow is actually post-capture, and that disagreement should be
  settled by trying it rather than by argument.
- Whether a matched repeat (D) should log **silently** or land on the same
  editable draft every other path lands on. The trust rule says editable draft.


## Amendment 1 — what building items 1-4 changed (2026-08-26)

Three things this ADR asserted did not survive contact, and one number in it was
wrong by half. Recorded here rather than silently fixed, because each was a
reasoned position and the reasoning is what a future reader needs.

**1. The description field is POST-capture, not pre-capture.** The ADR proposed
collecting it before the shot, on the reasoning that it frames the photo. The
owner's actual workflow is photo-first, and this ADR's own instruction was to
settle it by trying rather than arguing. Built post-capture, and the argument
that decided it is one the pre-capture version cannot make: **the describe step
is where repeat detection runs**, so a note that matches My Foods can end the
flow with zero tokens and zero quota spent. That turns the extra tap from a tax
into a shortcut. Pre-capture, the user has not yet decided what they are
photographing, so there is nothing to match against.

**2. The cost section was wrong in three places and is corrected above.** The
active model is `gemini-3.5-flash-lite`, not Gemini 2.5 Flash; the benchmark's
1,009 tokens is the whole call and not the image; and three images is therefore
**~1.4x, not 3x**, because output tokens are two-thirds of a scan's cost and do
not scale with image count. **The gate on item 5 survives, on a different
argument**: it is now about boundedness rather than magnitude. An unbounded 1.4x
is still unbounded, and `dailyQuota` still counts the wrong unit.

**3. `measured` needed a guard this ADR did not anticipate.** Item 2 says to mark
a scale-read item `measured`. What it did not say is what happens when the
pipeline then changes the number: `clampGrams` caps at 5,000 g, so a model
claiming it read "6,200 g" would ship 5,000 g **labelled a measurement**. The
flag is the one thing in this pipeline that claims something about the physical
world, so `resolveItem` drops it whenever the displayed value is not the value
the scale showed. Rounding 180.4 to 180 keeps it — same quantity at display
precision; clamping does not. Both directions are pinned by tests.

**4. Repeat detection needed an abstain path, and that is the finding this ADR
should have started from.** Measured the same day: `resolvePhrase` resolves
**100%** of phrases, because its relaxed pass drops tokens until something
scores and in a 13,272-row index something always scores. A repeat suggestion is
a *stronger* claim than a search result — it says "you ate this exact thing" —
and it is offered when the user is least likely to check it. So
`packages/core/src/meal-repeat.ts` is built to return `[]` readily, behind three
gates. The one that did the real work was not in any plan: **containment**, added
after a symmetric score offered `Chicken thigh` for a note reading `chicken
breast`. Being brief and adding detail are things a person does about a food they
mean; naming a different cut is not.
