# ADR-0027: Where restaurant foods come from

- **Status:** **accepted** — all three measurements ran; option **A** stands, with three of its stated properties corrected below
- **Date:** 2026-08-24 (proposed) · 2026-08-24 (accepted, same day, after the measurements)
- **Measurements:** `docs/research/restaurant-foods-menustat.md` — counted from the files, not estimated
- **Implements:** issue #67

## Context

Restaurant items are the loudest gap in food logging. `docs/research/competitive-feature-scan.md`
listed "Restaurant data" as table-stakes and the roadmap sweep (#17) put it in
**BACKLOG** — not rejected, unslotted. The ask is to close it the way
MacroFactor does.

### What MacroFactor actually does — and the part worth copying is not the part it is famous for

MacroFactor's search runs against a **verified** database of ~1.15–1.36M items,
where "verified" is a process claim rather than a size claim: user submissions
are **checked by other humans** before entering the public database, which is
the specific thing that separates it from MyFitnessPal's crowdsourced corpus.
Results are bucketed into *From History · Custom · Common · Branded*.

The finding that matters most for this decision is in MacroFactor's own help
docs: **"coverage is not as strong for restaurant food items, as restaurants
are less likely to report their nutrition information."** The app being held up
as the target openly rates restaurant data as its weakest coverage area. So the
realistic goal is not "match MacroFactor's restaurant DB" — it is to beat an
empty search box for the chains a user actually eats at, and to be honest in
the UI about the ones we do not have.

That reframes the problem from *acquire a million items* to *acquire the right
few thousand, and label their provenance*.

### What this repo already has

- [ADR-0018](0018-bundled-usda-food-db.md) replaced the live USDA FDC API with
  a **bundled 13,272-food, 3.6 MB JSON** loaded once per Cloud Functions
  instance. It did so to escape an API key (a Secret Manager version against a
  free tier with no headroom), a shared 1,000/hr rate ceiling, missing CORS,
  and an upstream that can be down. Every one of those four costs applies again
  to any live restaurant API.
- FNDDS ("as eaten" survey foods) is already in that bundle and already carries
  a meaningful number of restaurant-style items.
- Open Food Facts stays live and owns packaged/branded items and the whole
  barcode path.
- [ADR-0013](0013-food-resolution-my-foods-library.md)'s **My Foods** already
  lets a user save "Chipotle chicken bowl, 3 eggs light" privately, with a
  serving size and a macro snapshot. The *personal* restaurant case is
  therefore already solved at zero cost and zero moderation; what is missing is
  the *first-time* case, where the user has never logged that item before.

## The options, priced

| | Source | Coverage | Cost to us | Blocking issues |
|---|---|---|---|---|
| **A** | **MenuStat** (NYC DOHMH; downloads free as Excel, CSVs on Harvard Dataverse) | Top US national chains, annual January snapshot, items linked over time by stable id; carries serving size, kcal, fat, sat fat, trans fat, cholesterol, sodium, potassium, carbs, fiber, sugar, **protein** | **$0.** No key, no secret, no rate limit, no upstream. Ingest script → JSON → sibling of `usda-db.ts`, exactly the ADR-0018 shape | US-only; annual snapshot goes stale between updates; **license terms not yet confirmed** |
| **B** | **FatSecret Platform API**, Basic edition | 1.9M items across 56 countries incl. restaurant meals; Basic is **US dataset only**, 5,000 calls/day, commercial use permitted | OAuth client key + secret → **+1–2 Secret Manager versions** past the audited floor of 7 (~$0.06/mo each); a **shared daily call ceiling** — the exact failure mode ADR-0018 escaped; attribution badge wherever content is displayed **and** "Powered by fatsecret nutrition API" in both app-store descriptions | Ceiling is per-app not per-user, so it degrades under growth; store-listing edits on iOS and Android |
| **C** | **Nutritionix** | The best in class — monitors **600+ chains** for menu changes, 800k+ items | Enterprise from **$1,850/month** | Fails the cost gate outright. Listed so it is not re-proposed |
| **D** | Crowdsourced user submissions | Unbounded | $0 in money, unbounded in moderation | MacroFactor's advantage *is* human verification of submissions. Without moderation capacity this reproduces MyFitnessPal's junk corpus, which is the thing users complain about. Not viable solo |

## Decision

**Take A — bundle a curated chain-restaurant dataset — and treat B as an
enrichment to be added only if a measurement says A is too thin.**

The argument is that A repeats a pattern this repo has already proven end to
end, at zero marginal cost, with no new secret, no rate ceiling and no upstream
dependency, and it ships inside a `functions`-only deploy with no client
release — the same property that made ADR-0018 cheap. A restaurant menu changes
a handful of times a year, so a dated snapshot is a far better fit for this data
than it would be for packaged goods.

Concretely:

1. `scripts/ingest-menustat.mjs` downloads the latest MenuStat release, keeps
   the four macros + serving size + a stable `(chain, itemId)` key, drops items
   missing calories *or* protein, and emits `functions/data/restaurant-foods.json`.
2. A `FoodDbSource` value of `'menu'` joins `'fdc' | 'off'`. Results carry the
   chain name and the **snapshot year**, and the UI shows both — a 2026 figure
   for a 2024 menu is not a bug if it says 2024 on it.
3. Search ranks an exact chain match above generic FDC results when the query
   contains a known chain name, and otherwise leaves ranking alone.
4. When a chain is absent, the empty state says which chains *are* covered and
   offers My Foods, rather than returning nothing.

## The measurements — run 2026-08-24

All three ran against the actual files. Full evidence, with per-chain tables, is
in `docs/research/restaurant-foods-menustat.md`; only the answers are here.

1. **License — qualified pass.** Three copies of MenuStat exist and they carry
   **three different license positions**. Harvard Dataverse
   ([doi:10.7910/DVN/K4NYTR](https://doi.org/10.7910/DVN/K4NYTR)) is **CC0 1.0**
   but stops at 2018 and was deposited by a Harvard researcher, not by NYC
   DOHMH. NYC Open Data's copy carries **no license field** and also stops at
   2018. menustat.org itself published through **2022** under
   *"© 2016 MenuStat. All rights reserved."* — no terms page, no grant.
   **Decision taken by the owner on 2026-08-24: ship the 2022 file** and pursue
   written permission by email in parallel, with the CC0 2018 file as the
   documented fallback if the answer comes back no. The counterweight is that
   the content is facts — calories, grams of protein — which are not
   copyrightable in the US, and the same dataset through 2018 is CC0 by a third
   party's hand.
2. **Completeness — pass.** **25,217 of 26,238 items (96.1%)** in the 2022
   snapshot carry calories AND protein, across 92 chains. Counted on distinct
   `menu_item_id`; the 2018 file repeats each item per customizable build, and a
   naive row count over-reports it by 2.4x. After deduplicating on
   `item_description` the shipped corpus is **25,126 items across 91 chains**.
3. **Relevance — pass.** The owner named 15 chains. **All 15 are present**;
   14 are in the licensed 2018 file (The Cheesecake Factory is 2022-only). On
   those 15 the bundled USDA corpus held **50** items; MenuStat adds **1,799**
   food items — a 36x increase on exactly the chains that matter here.

### What the measurements changed

**Three of this ADR's own claims were wrong, and are corrected rather than
quietly kept:**

- **The upstream is dead.** menustat.org stopped resolving between 2026-06-12
  (last Internet Archive 200) and 2026-08-24, and collection had already stopped
  after 2022 — its FAQ says data was gathered *"in January of each year through
  2020."* There is **no annual snapshot to inherit**; this is terminal data, and
  the snapshot year is stored per item and rendered for exactly that reason.
- **"Both clients unmodified / a `functions`-only deploy" was false, twice.**
  First, only 31% of the food items on the owner's chains carry a gram weight,
  and `ServingOption.grams` was consumed unguarded in one place — so those items
  ship with `grams: 0` and the web client's `food-search.component.ts` gained
  the guard mobile has had since 2026-07-01. Second, and larger: **mobile
  answers text search on-device** (Tier D) and never calls `searchFoods`, so a
  server-only change would have reached the frozen web app and nobody else.
- **Puerto Rico is not option A's problem, and option B does not fix it.**
  FatSecret was searched directly: it has no El Mesón Sándwiches either. What
  closes ground in PR is already shipped — 61 "Puerto Rican style" items in the
  bundled corpus, plus My Foods.

### How the corpus reaches mobile without bundling it

The corpus is 4.3 MB. The compacted on-device USDA index is already 1.4 MB
(+2.0 MB of Hermes bytecode, measured), so bundling MenuStat too would roughly
triple it and undo most of the −24.2% bundle cut shipped 2026-08-22.

So **only the 91 chain names ship to the phone** (~2 KB,
`packages/core/src/restaurant-chains.data.ts`, generated by the ingest) and act
as a router: a query that names a chain goes to `searchFoods`, which holds the
whole corpus; every other query stays local, instant and offline as before. The
two cases have genuinely different requirements — generic food search is the
common path and must work with the radio off, while naming a restaurant is
deliberate, rare, and already implies wanting something the device does not
have. If the call fails, the client falls back to the local index rather than
showing an error.

The cost of that split is that a query which does *not* name a chain sees no
restaurant items on mobile. That is accepted: it keeps the app's most-used path
unchanged.

## Consequences (as built)

- **No new AI, no new secret, no new scheduler job.** Confirmed — the ingest is
  a hand-run script and the data is committed. There is no refresh, because
  there is no upstream left to refresh from.
- **The delivery is a functions deploy + a hosting deploy + a mobile OTA.** Not
  the "no client release" this ADR originally claimed, but still **no binary on
  either platform**: the chain list is a JS module, so it rides an `eas update`.
  `FoodDbSource` widened additively to `'fdc' | 'off' | 'menu'` in both
  hand-mirrored copies.
- **`grams: 0` means "one serving, weight not published"** and is now part of
  the wire contract. 15,012 of 25,126 items are in that state. Every consumer
  already guarded it except the web picker, which was fixed; the failure it was
  producing was silent — `buildCustomFood` clamps an out-of-range 0 and would
  have saved the food as **"100 g"**, a weight nobody measured.
- **We inherit a staleness obligation, permanently.** A bundled menu that
  silently ages is the failure mode, and this one can never be updated. The
  snapshot year is stored per item and carried on the wire as
  `dataType: "restaurant_menu_2022"`, so the data cannot lie about its own age.
- **US-only, and the app says so.** Ignia ships en / es-PR / pt-BR; a US-only
  restaurant corpus is a real gap for two of those three locales, and the empty
  state must not pretend otherwise.
- **MenuStat reuses item names, so the ingest deduplicates on
  `item_description`.** 857 (chain, name) groups held more than one row with
  genuinely different macros — Applebee's "Fries Basket" is 640 kcal as a kids'
  side and 50 kcal under Sides & Extras. Keying on the description drops that to
  48 residual collisions, and a targeted pass folds the menu section into the
  visible name for those ("Fries Basket (Kids Sides)"). Picking one row silently
  would have meant choosing which published figure to hide.

## Follow-ups this decision creates

- **Send the permission email** (drafted; recipients `info@menustat.org` /
  `MenuStat@health.nyc.gov`). Nothing is blocked on the reply — it converts the
  weakest point in this ADR into a document. A bounce is itself an answer.
- **Pollo Tropical** is a major chain in Puerto Rico, publishes official
  nutrition, and is **not** in MenuStat's 91. One chain, one published source,
  hand-ingested — a better use of effort for this user than any API.
- **The provenance chip** ("Chili's · 2022 menu") is a mobile-only UI addition
  and is not built yet; the wire already carries what it needs. The web app is
  frozen ([ADR-0022](0022-web-pwa-frozen-not-retired.md)) and renders the item
  without a chip.
