# The USDA food DB ships bundled, replacing the live FDC API

## Status

accepted (2026-08-07)

Delivers **N2** from `UX_AUDIT.md` §S15, and closes the half of
[ADR-0015](0015-macronaut-photo-first-freemium-pivot.md) that photo-scan shipped
without. Supersedes `docs/usda-food-db-scoping.md`, which is deleted with this
change per the housekeeping rule in `CLAUDE.md`.

## Context

Text food search was backed by the **live USDA FoodData Central API**, proxied
through `searchFoods` / `getFoodDetail` and cached in Firestore. That worked,
and it carried four costs that had nothing to do with the data:

1. **An API key** — `USDA_FDC_API_KEY`, one of 8 active Secret Manager versions
   against a 6-version free tier the account is already over (`CLAUDE.md`).
2. **A rate ceiling** — 1,000 requests/hour/key, shared by every user, which is
   why the Firestore search cache and a per-uid throttle exist at all.
3. **No CORS headers**, which is why the call must be proxied rather than made
   from the client.
4. **An upstream that can be down**, degrading search to Open Food Facts alone.

The data itself is CC0 and small enough to ship. Nothing about the dependency
was buying us anything.

There was a second, larger reason to act. ADR-0015 specifies a **split vision
architecture**: the model does *recognition and portion estimation only*, and a
USDA database produces the macros — precisely because LLMs show >60% error when
asked to emit protein numbers directly. Photo-scan shipped live on 2026-08-07
(ADR-0017) **without** that second half, so today the model emits macros
directly. A bundled USDA DB is the prerequisite for closing that gap on a
feature already in front of users.

### The scoping doc was blocked on a number that was wrong

`docs/usda-food-db-scoping.md` recorded this work as "gated on one owner-run
ingest (multi-GB download can't run from the agent env)", and it sat there for a
session. The real archives are **6.1 MB, 3.4 MB and 3.3 MB compressed**. The
multi-GB figure belongs to the Branded and full FoodData Central downloads,
which we deliberately do not use. Nothing was ever blocked.

## Decision

**Ship the dataset inside the `functions/` deploy and search it in memory.**

`scripts/ingest-usda.mjs` downloads three CC0 USDA datasets, filters them to the
four macros plus household portions, and emits
`functions/data/usda-foods.json` — **13,272 foods, 3.6 MB, committed**.
`functions/src/usda-db.ts` loads it once per instance (~45 ms) and serves both
callables with no network call.

| Dataset | Foods | Why |
|---|---|---|
| SR Legacy | 7,671 | broad generic coverage, with household portions |
| FNDDS (survey) | 5,298 | "as eaten" foods, and by far the most natural names |
| Foundation | 303 | lab-analyzed; overrides SR's macros on a name clash |
| ~~Branded~~ (2M) | — | out: label-quality and huge. Open Food Facts already covers packaged goods, and still does |

**Open Food Facts is untouched.** It remains live, merged into the same result
list, and still owns branded/international items and the whole barcode path. The
swap is FDC-the-API → FDC-the-bundle, not a retreat from branded search.

**The wire contract does not change.** `FoodDbSource` stays `'fdc' | 'off'`, ids
stay FDC ids, and `ServingOption`/`FoodDetail` are byte-identical. Both
frontends and `packages/core/src/food-search.ts` are **unmodified**, so this
ships as a functions-only deploy with no client release on either platform.

### Server-side, not on-device

The obvious alternative — bundle the JSON into each app for true offline search
— was rejected for v1. It forks the search path (an `expo-sqlite` bundle works
for the Expo app but not the web PWA), and the web app has a 1.6 MB budget that
3.6 MB of JSON does not fit without a lazy-fetch-and-precache path. One shared
backend keeps the parity rule in `CLAUDE.md` cheap. Revisit if offline search
becomes a requirement; the ingest output is already the right shape for it.

## Consequences

**`USDA_FDC_API_KEY` is dead code but could not actually be retired**, so the
account stays at 8 active secret versions rather than dropping to 7. The
expected win did not materialise, and the reason is worth recording because it
will recur for any future secret removal here: **`firebase deploy` does not
prune secret bindings.** The source stopped declaring the secret, a full
`--only functions` deploy ran clean, and the revision still carries the binding.
`gcloud run services update --remove-secrets` is not a workaround either — it
crashes parsing the annotation firebase-tools writes. Since gen2 resolves
bindings at instance start, deleting the secret while it is still bound would
stop the function booting, so it stays. `STATUS.md` records the remaining
route (a Cloud Run Admin REST patch removing env var and annotation together).

**Search got faster and free.** A query is an in-memory scan over 13k records
instead of an HTTPS round trip. The Firestore search cache and per-uid throttle
are **kept** — they now defend the OFF call, which is still a network dependency.

**The search cache key moved to `v3`.** A cached `v2` page can name a Branded
`fdcId` that only the old API could resolve; serving one would hand a client an
id whose detail lookup is now guaranteed to 404. Bumping the prefix retires
every stale page atomically.

**No stored data references an `fdcId`.** `CustomFood` copies macros per serving
and records only a capture-axis `source` ('barcode' | 'label' | 'text' |
'manual'), so no historical log re-resolves through the food API and none can
break. This was verified before choosing to drop the live fallback entirely.

**Relevance ranking is now ours to own, and it is the hard part.** The API ranked
results; a bundle does not. `usda-db.ts` scores matches, and the tuning is
load-bearing — every rule in it was added in response to a specific wrong answer,
and `functions/test/usda-db.spec.ts` locks each one:

- Data *quality* must not drive *relevance*. Giving Foundation a large bonus made
  "egg" return **"Egg, yolk, dried"** (654 kcal) over "Egg, whole, raw". Quality
  picks the macros, at ingest time; relevance picks the order.
- USDA inverts English compounds — "cheddar cheese" is filed **"Cheese,
  cheddar"** — so the head noun is usually the query's *last* token.
- It spells one food two ways, as a compound head ("Chicken breast, …, sliced")
  or spread across leading segments ("Chicken, breast, …"). Scoring the compound
  higher put **deli slices above actual chicken breast**.
- It files some foods under a genus, so "tuna" must reach **"Fish, tuna, raw"**
  and not "Tuna salad sandwich wrap".
- Users type the singular and USDA stores the plural, so queries are
  singular-folded; without it "onion" returned **"Bread, onion"**.

**The ingest is reproducible by anyone, offline after first run.** It downloads
and unzips its own inputs (a minimal ZIP reader is inlined; no new dependency)
and caches them under a gitignored `.cache/`. Re-running on unchanged inputs is
byte-identical, so a regenerated dataset diffs cleanly.

**The data will age.** SR Legacy is frozen at 2018 by USDA and is fine for
generic foods; FNDDS and Foundation are refreshed roughly yearly. Nothing
auto-updates — regeneration is a deliberate act, which is the correct trade for
a dataset that must stay diffable and reviewable.

**N6 and N7 are now cheap.** Restaurant/chain data (N6) was deferred explicitly
until this bundling mechanism existed, and the micronutrient panel (N7) is a
change to the nutrient list in the ingest plus UI — the pipeline already carries
whatever nutrients it is told to keep.
