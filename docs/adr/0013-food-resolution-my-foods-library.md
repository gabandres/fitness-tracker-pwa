# AI food-resolution pipeline + My Foods library (text/label/barcode → macros, on-device first)

## Status

accepted (2026-07-01)

## Context

Two things users already do by hand, outside Macro Log:

1. Ask a chat AI ("how many kcal/protein in grilled chicken breast ~200g +
   rice?") and copy the numbers into the app.
2. Photograph a packaged food's **Nutrition Facts** label into an AI's
   memory, then re-type it later.

Both are the same unmet need: *resolve a food to macros, then keep it so I
never re-enter it.* The obvious build — "snap a meal photo like Cal AI" —
is the wrong one. A [deep-research pass (2026-07-01)](../../CONTEXT.md)
established, with adversarial fact-checking:

- **Meal-photo estimation has a ~26–36% error floor** from a single RGB
  photo, with catastrophic mis-ID outliers (scrambled eggs read as pasta →
  1788% carb error) and **protein — our headline metric — the most volatile
  macro**. Depth-sensor accuracy (SnapCalorie ~15%) needs LiDAR a PWA can't
  reach.
- **Text description + food-DB grounding is more accurate, cheaper, and more
  private.** Best text→carbs config hits ~8.6g MAE (beats the photo floor).
  The reliable pattern is: LLM (or fuzzy/embedding match) only
  *decomposes* into `{food, quantity}` and **never emits macro numbers**; a
  deterministic DB lookup does the math.
- **Reading a printed Nutrition Facts panel is ~99% structured extraction**,
  not guessing — the opposite of meal photos.
- **USDA FoodData Central is CC0 public domain** — a ~1–2 MB whole-foods
  subset bundles freely in both apps. **Open Food Facts is ODbL** (share-
  alike attaches to any *cached copy*) → query it **live for barcodes, with
  attribution**, never bundle it.
- The whole thing runs **at ~$0 marginal cost**: on-device lexical/embedding
  match + on-device ML Kit label OCR + the existing barcode scanner. A paid
  vision-LLM is only a rare, opt-in fallback (Gemini 2.5 Flash-Lite via
  Vertex, ~$0.0003/call, ~12× cheaper than Claude Haiku; **never the free
  Gemini tier — it trains on user data**).

This deviates from the app's existing meal-photo path (`analyzePhoto` CF +
client-key Gemini, see [ADR-0002](0002-firestore-no-backend-architecture.md))
and from the AI-cost-aversion that killed weekly-report autogenerate — so the
"why we now add AI, and why *this* shape" is worth recording.

## Decision

Build **one shared food-resolution pipeline** in
[`packages/core`](../../CONTEXT.md), consumed by both frontends, that turns
any of three inputs into an **editable macro draft**, then persists confirmed
results to a per-user **My Foods** library:

```
INPUT ─┬─ barcode  → OFF / USDA-Branded live lookup (attribution)     [$0, existing scanner]
       ├─ label    → on-device ML Kit OCR → deterministic panel parse [$0, offline, private]
       └─ text     → parse {qty,unit,food} → USDA fuzzy/embed match   [$0, on-device]
                      ↓  editable draft, visible ± where uncertain
              confirm → users/{uid}/customFoods/{id}  (owner-only, offline-cached, macro SNAPSHOT)
                      ↓
              "My Foods / Recents"  → one-tap re-log forever   ← stickiness / data lock-in
                      ↓  (only when the above fail)
              opt-in: "read with cloud AI?" → Vertex Flash-Lite  [rare fallback]
```

Load-bearing choices:

- **`CustomFood` is a new collection**, not an extension of `MealPreset`. A
  preset is a deliberately minimal quick-add `{name, calories, protein?}`
  capped at 10 (`PRESET_LIMIT_FREE`); a `CustomFood` is a richer,
  barcode-keyed, *portionable* record and must not inherit preset semantics
  or the 10-cap.
- **Portion model: per-serving, grams-first.** A `CustomFood` stores a
  serving definition (`servingSize` + `servingUnit`) and the macros for
  **one serving**; logging is `quantity × serving`. USDA whole foods
  normalize as `servingSize:100, unit:'g'`. Quantity ambiguity ("a handful")
  — not matching — is the dominant error source, so UX is grams-first.
- **Logging copies a macro snapshot** into the `DailyLog` (does *not*
  reference-link), mirroring the `WorkoutSession`-snapshots-template pattern
  ([ADR-0007](0007-workout-train-tab.md)) so editing a saved food never
  rewrites history.
- **Free wedge, not Pro.** Barcode + label-OCR + My Foods are **free** — they
  are the "one app does what I did across three" pitch. Only the optional
  cloud vision-LLM fallback is Pro/opt-in.
- **The math lives in core, the skin per-frontend.** Pure, unit-tested:
  quantity/unit parser, panel parser (`labelText → CustomFood` draft), USDA
  matcher, `resolveFood`. Native bits (ML Kit OCR, on-device embeddings) are
  per-frontend adapters behind a port.

## Considered options

- **Meal-photo estimation (Cal AI shape)** — the intuitive build. Rejected as
  the primary path: ~26–36% error, worst on protein, needs a photo to leave
  the device, costs per call. Kept only as the pre-existing `analyzePhoto`
  path, de-emphasized.
- **Extend `MealPreset`** — reuse the presets collection. Rejected: presets
  are minimal and free-capped; overloading them with barcode/serving/source
  fields muddies two distinct concepts and drags the 10-cap onto a library.
- **Pure-LLM macros on every log** — let the model emit the numbers.
  Rejected: unreliable vs grounding, and recurring cost against the
  cost-aversion constraint. LLM is decompose-only and off the hot path.
- **Bundle Open Food Facts** — best barcode coverage. Rejected for bundling:
  ODbL share-alike attaches to any cached derivative DB, and the dump is
  ~9 GB. Live API (a "Produced Work", attribution-only) sidesteps both.
- **Free Gemini tier for the LLM fallback** — cheapest. Rejected: the free
  tier trains on / human-reviews inputs, which breaks the privacy brand. Paid
  Vertex (in our GCP project, no training on data) only.

## Consequences

- **New collection `users/{uid}/customFoods`.** Owner-only rules with a
  `isValidCustomFood` schema validator must ship **before** any client
  writes it (dev talks to PROD Firestore — same discipline as every prior
  collection). `deleteAccount` (gdpr.ts) gains a
  `deleteSubcollection('customFoods')` step; `exportUserData` includes it.
- **New bundled asset:** a curated USDA Foundation+SR-Legacy macros subset
  (~1–2 MB) precached in the PWA (ngsw) and shipped/first-launch-downloaded
  in Expo. Curation (which foods, es-PR/PR staples for i18n parity) is manual
  work and the main effort sink. Add a "Data from USDA FoodData Central"
  credit in Settings (courtesy, not legally required).
- **On-device embeddings are dev-build-gated on mobile** (native module,
  won't load in stock Expo Go) — same threshold already crossed for Google
  Sign-In. The PWA has no such limit (transformers.js WASM). Lexical FTS5
  works on both today with zero native additions, so ship that first;
  embeddings are a later recall booster.
- **ML Kit OCR is native-only** — the Angular PWA can't use it and falls back
  to barcode + manual entry (or the opt-in cloud path).
- **Attribution obligations:** show "Product data © Open Food Facts
  contributors, ODbL" on barcode-result screens.
- **Cost:** on-device default = $0; even a 20%-fallback worst case at 10k
  users lands ~$60/mo before caching. Cost-aversion satisfied.
- **Accuracy honesty is the differentiator:** always land on an *editable*
  draft with a visible range where uncertain — never a fake-precise single
  number. This is the trust wedge against Cal AI's overconfident outputs, and
  it lets us use the cheapest model.

## Resolved (owner, 2026-07-01)

1. New `customFoods` collection (not extend `presets`).
2. Portion model: **per-serving, grams-first**.
3. Barcode / label-OCR / My Foods are **free**; only the cloud-LLM fallback
   is Pro.
