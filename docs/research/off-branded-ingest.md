# Branded food search without calling Open Food Facts live

## VERDICT

**Text search stopped calling OFF on 2026-08-19 (barcode still does), and
restoring branded text search means ingesting a filtered OFF subset into the
bundled format — the same move ADR-0018 made for USDA. It is feasible. It is not
free, and it is not blocked on cost.**

- **Ingest from the CSV export, not the JSONL one.** Measured 2026-08-19:
  `en.openfoodfacts.org.products.csv.gz` is **1.19 GB**;
  `openfoodfacts-products.jsonl.gz` is **11.83 GB**. Both had been refreshed
  within the previous 12 hours, so the nightly cadence is real. A 10× smaller
  download for the same fields is the whole decision.
- **Target ≤ ~50k products.** At the bundle's measured 271 bytes/record that is
  ~16 MB raw / ~1.8 MB gzipped — still the same performance class as today's
  USDA bundle. ~100k lands at ~32 MB, where per-instance parse and memory start
  to argue for a different storage strategy rather than a bigger JSON.
- **The one number nobody has is how many products survive a real filter**
  (complete kcal+protein+carb+fat, a usable name, non-trivial `unique_scans_n`,
  target markets). It is answerable only by running the ingest once. The API
  route to estimate it cheaply is throttled — see below — which is itself part
  of the finding.
- **Cost is not the obstacle.** This is a bigger JSON in a deploy that already
  exists. The obstacles are ingest engineering, a refresh cadence, and the
  memory tier if the filter is too generous.

**Do not re-derive the rate limits or the export sizes; they are measured here.**

---

## Why text search stopped calling OFF

[OFF's API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/)
publishes **100 requests/minute for product GETs by barcode** and **10
requests/minute for search**, and says exceeding the limits can lead to IP bans.
For bulk needs it directs consumers to the static exports, or to hosting a local
Product Opener instance fed by the daily exports.

Ignia was calling the *search* endpoint from debounced typeahead (350 ms), and
every user's query left through **one shared Cloud Functions egress IP**. So the
10/min budget was global to the whole app and spent a few keystrokes at a time.

Measured 2026-08-19, three probes of the exact query the function issued:

| Query | Time | Result |
|---|---|---|
| `chicken breast` | 1308 ms | HTTP 200, 20 products |
| `banana` | 1837 ms | HTML error page |
| `greek yogurt` | 273 ms | HTML error page |

Two of three paid full latency and returned nothing. `searchFoods` **awaited**
that before returning the USDA hits, which are an in-memory scan over the
bundled dataset and were already finished — so the generic-food half was held up
by a branded lookup that was usually failing.

A second, later attempt to measure product *counts* through the same endpoint
was itself throttled: the first call returned HTML in 1723 ms and the second
took **30,483 ms**. That is the limit behaving exactly as documented, and it is
why the count below is an open number rather than a measured one.

Barcode is a different story and is unchanged: one user-initiated GET against a
100/min ceiling fits comfortably.

## What a bundled subset would cost

The USDA bundle gives a measured baseline for the same record shape
(`{ id, desc, dataType, per100, portions }`):

| | Value |
|---|---|
| Records | 13,272 |
| Raw | 3,599,034 bytes (3.43 MB) |
| Gzipped | 0.39 MB |
| **Bytes per record** | **271 raw, ~31 gzipped** |
| Parse + index, per instance | ~45 ms |

An OFF record in that shape carries a brand and a longer product name, so budget
~300–350 bytes. Projected:

| Products kept | Raw | Gzipped | Verdict |
|---|---|---|---|
| 25k | ~8 MB | ~0.9 MB | comfortable |
| 50k | ~16 MB | ~1.8 MB | **the ceiling worth targeting** |
| 100k | ~32 MB | ~3.6 MB | parse ~10× today's; revisit storage |
| everything | multi-GB | — | not a bundle |

Note the deploy artefact is not the binding constraint — **per-instance memory
and cold-start parse are**. `loadFoods()` reads and indexes the whole file once
per instance, and `indexFoods` builds five derived arrays per record. That cost
scales linearly and lands on every cold start of `searchFoods`, `getFoodDetail`
and `analyzePhoto` (which ranks against the same index via `photo-resolve.ts`).

## The filter is the project

Everything above is arithmetic. The actual work is deciding what to keep, and
the ingest is the only way to learn how many survive:

- complete macros — kcal, protein, carbs, fat all present and plausible
  (`isLoggableFood` already exists and should be the gate, so the bundled subset
  inherits the same plausibility rules the live path used);
- a real `product_name` — OFF has many rows with none;
- non-trivial `unique_scans_n`, which is the closest thing to a popularity prior
  and is what keeps the subset to foods people actually eat;
- target markets — `countries_tags` for US/PR at minimum.

`scripts/ingest-usda.mjs` is the template: it downloads, caches under `.cache/`,
filters, normalizes to the record shape and writes a committed JSON. An OFF
ingest is that script pointed at a different source with a harder filter.

## Refresh

Unlike USDA — where SR Legacy is frozen forever and 98% of the bundle moves at
most every two years — branded data genuinely churns: new SKUs, reformulations,
corrections. OFF publishes nightly full exports plus **delta files for the
previous 14 days** (`https://static.openfoodfacts.org/data/delta/index.txt`).

So this needs a refresh cadence in a way the USDA bundle does not, and a
forgotten cadence is the failure mode. A quarterly re-ingest is probably the
right trade; the deltas exist if something finer is ever wanted.

## What users lose meanwhile

Branded and packaged products do not appear in **text** results. They remain
reachable by barcode, by photo scan, and as custom foods or presets. Given two
of three probes were being throttled, the honest framing is that branded text
search was already failing often — the cut made a degraded path explicit rather
than removing a working one.
