# ADR-0029: Multi-photo and description meal capture

- **Status:** proposed — the owner's own worked example does not resolve today, and the reason is not the model
- **Date:** 2026-08-24
- **Amends:** [ADR-0017](0017-photo-scan-free-in-v1.md) (photo-scan on and free), [ADR-0013](0013-food-resolution-my-foods-library.md) (the trust rule), [ADR-0015](0015-ignia-pivot.md) §1 (why the model is not asked for macros)

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

Gemini 2.5 Flash bills **~1,009 input tokens per image** (`analyze-photo.ts`
records the measurement). Today a scan is ~2.2k input tokens ≈ **$0.0015**.

**Three images roughly triples the image half of that** — call it $0.003–0.004 a
scan. That is still small in absolute terms. The problem is structural:

> **`dailyQuota` counts SCANS, not IMAGES.** So a 3-image scan costs 3× the model
> spend against the *same* 3/day free allowance. The free tier's worst case goes
> from ~$0.14 per user per month to ~$0.40, and the `photo` `spendCeiling` — which
> bounds the worst possible day — is denominated in the same wrong unit.

**Multi-image must not ship until the quota counts images.** That is a one-line
semantic change in `functions/src/daily-quota.ts` plus a re-priced ceiling, and it
is the difference between a bounded feature and an unbounded one. Both guards stay
mandatory (`check()` before the per-user reserve, `record()` after).

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
4. **Multi-image, deferred**, and explicitly gated on `dailyQuota` counting images.
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
