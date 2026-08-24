# ADR-0027: Where restaurant foods come from

- **Status:** proposed — blocked on one measurement, named below
- **Date:** 2026-08-24

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

## Proposed decision

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

## The measurement that unblocks this

This ADR stays `proposed` until an ingest dry-run answers three questions,
because two of them can kill option A outright:

1. **License.** Are MenuStat's terms compatible with redistributing the data
   inside a commercial app? The dataset is public and free to download, but
   "free to download" is not a redistribution grant, and this is a public repo.
   *If the answer is no, A dies and B becomes the recommendation.*
2. **Completeness.** How many items survive "has calories AND protein"?
   ADR-0018's own scoping was blocked for a session on a number that turned out
   to be wrong by three orders of magnitude, so this gets counted, not
   estimated.
3. **Relevance.** How many of the ~25 chains a user here would actually eat at
   are present? A dataset of 60,000 items that omits the local chains is worse
   than useless — it looks like coverage and behaves like a gap.

## Consequences (if adopted as proposed)

- **No new AI, no new secret, no new scheduler job.** A refresh is a rerun of
  the ingest script and a functions deploy, done by hand once a year — which is
  how this repo already ships everything.
- **Both clients are unmodified for search itself**, as in ADR-0018, provided
  `FoodDbSource` widening is additive. The provenance chip ("Chipotle · 2026
  menu") is a mobile-only UI addition; the web app is frozen
  ([ADR-0022](0022-web-pwa-frozen-not-retired.md)) and simply renders the item
  without the chip.
- **We inherit a staleness obligation.** A bundled menu that silently ages is
  the failure mode. The snapshot year is stored per item and rendered, so the
  data cannot lie about its own age.
- **US-only, and the app says so.** Ignia ships en / es-PR / pt-BR; a US-only
  restaurant corpus is a real gap for two of those three locales, and the empty
  state must not pretend otherwise.
