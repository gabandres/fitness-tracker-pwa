> **VERDICT** — MenuStat's data is obtainable and large enough (**25,217 items with calories AND protein across 92 chains**, counted from the 2022 snapshot), but **option A as ADR-0027 wrote it does not exist any more**: menustat.org is offline, collection stopped after 2022, and the only copy carrying an explicit licence (Harvard Dataverse, **CC0 1.0**) stops at **2018** and was deposited by a third party, not by the NYC rights holder whose own site said *"All rights reserved."* The licence answer is therefore **a qualified yes on 2018 and an unlicensed copy for 2019–2022**, and the "annual January snapshot" the ADR priced is a dead upstream.
> **Status:** SETTLED — all three measurements ran, ADR-0027 is `accepted`, and the ingest is built. The owner's call on 2026-08-24 was to **ship the 2022 file and pursue written permission in parallel**, with the CC0 2018 file as the documented fallback · **Researched:** 2026-08-24
> **Read this only if:** you are deciding where restaurant foods come from (ADR-0027 / issue #67), or you are about to write the MenuStat ingest.
> **Do not** re-derive the counts below. They were counted from the actual files, not estimated.

# Where restaurant foods come from — the MenuStat measurements

Primary-source research for issue **#67**, which gates **ADR-0027**. The ADR
prices four options and recommends **A (bundle MenuStat)**, blocked on three
measurements, two of which can kill the recommendation. This note answers
measurements **1** and **2** and states exactly what is still missing from **3**.

Everything below was measured against files downloaded on 2026-08-24. The
scratch copies and the counting script live outside the repo; the counts are
reproducible from the sources cited at the end.

---

## 0. The finding that reframes the ADR: the upstream is gone

ADR-0027 priced option A on the premise of *"annual January snapshot"* and
*"a refresh is a rerun of the ingest script … done by hand once a year."*
That premise is **false as of today**.

| Fact | Evidence |
|---|---|
| **menustat.org does not resolve.** SERVFAIL from the local resolver, from `1.1.1.1` and from `8.8.8.8` | `nslookup menustat.org 1.1.1.1` → *"Server failed"* (2026-08-24) |
| It was alive recently — the Internet Archive holds HTTP 200 captures through **2026-06-12** | Wayback CDX for `menustat.org` |
| **Collection stopped.** The site's own FAQ: *"Nutrition information was manually collected from restaurant websites in January of each year **through 2020**."* | archived `faq.html` |
| The newest annual file that ever existed is **`ms_annual_data_2022.xlsx`** | Wayback CDX for `menustat.org/uploads*` — the complete file list ends at 2022 |
| The site's own footers read **"Copyright 2022"** and **"© 2016 MenuStat. All rights reserved."** | archived `data.html`, `about.html` |

So there is no annual refresh to inherit. Whatever ships is a **terminal
snapshot**, and it is already 4 years old. That does not by itself kill option
A — a bundled snapshot with its year rendered is still honest — but it changes
the consequence the ADR must record from *"we inherit a staleness obligation"*
to *"this data will never be newer than 2022, and the app must say so."*

---

## 1. Licence — the measurement that could kill A

**Answer: a qualified yes for the 2018 snapshot, and no licence at all for 2019–2022.**

Three copies of this dataset exist and **they carry three different licence
positions**. This is the whole of the finding.

| Copy | Years | Licence as published | Who asserted it |
|---|---|---|---|
| **Harvard Dataverse** — [`doi:10.7910/DVN/K4NYTR`](https://doi.org/10.7910/DVN/K4NYTR), *"MenuStat Annual Data"* | 2008, 2010, 2012–2015, 2017, 2018 (**2009, 2011, 2016 absent**) | **CC0 1.0** (`rightsIdentifier: CC0-1.0`, SPDX) — public-domain dedication; commercial use and redistribution permitted, no attribution required | **Lauren Cleveland, Harvard Pilgrim Health Care Institute** — the depositor, published 2022-06-02. **Not** NYC DOHMH |
| **NYC Open Data** — [`qgc5-ecnb`](https://data.cityofnewyork.us/Health/DOHMH-MenuStat-Historical-/qgc5-ecnb), *"DOHMH MenuStat (Historical)"* | through 2018 | **No licence field at all** (`license: undefined`, `licenseId: undefined`). Update frequency *"Historical data"*; rows last updated **2019-02-04**. NYC Open Data's site terms say only that data is *"provided for informational purposes"* and disclaim warranty — they grant nothing explicitly | NYC DOHMH |
| **menustat.org** (offline; Internet Archive only) | 2008–**2022** | **"© 2016 MenuStat. All rights reserved."** No terms-of-use page, no licence, no redistribution grant. Its own words for the data are only *"All are free to download as excel files here."* | NYC DOHMH |

### What that means

- **Free to download is not a redistribution grant** — the exact distinction
  ADR-0027 flagged — and MenuStat's own site is the copy that says
  *All rights reserved*.
- The **only** affirmative grant is Dataverse's CC0, and it is asserted by a
  Harvard researcher who deposited someone else's dataset. A depositor cannot
  licence rights they do not hold. Dataverse's CC0 is strong evidence of intent
  to make the data freely reusable; it is **not** a warranty from the rights
  holder.
- The counterweight, and it is a real one: the *content* is **facts**
  (calories, grams of protein) transcribed from public restaurant websites, and
  in US law facts are not copyrightable — only a database's original selection
  and arrangement can be. A per-item macro table extracted from the file and
  re-keyed into a different schema is a weak target for a copyright claim.
  **This note is not legal advice and does not pretend the question is closed.**
- **Trademark is a separate axis the ADR never raised.** Shipping "Big Mac ·
  McDonald's" inside a commercial app is nominative use to identify the item,
  which is ordinarily permissible, but it is a different body of law from the
  dataset licence and it applies to every chain name in the corpus.

### The practical consequence

The **2018 file from Dataverse is the only one that can be shipped on a written
licence.** The 2019–2022 files exist solely as Internet Archive captures of a
site that said *All rights reserved*. Shipping those is a materially weaker
position than shipping the CC0 one, and the ADR must not blur them together.

If the owner wants the 2022 data on a clean footing, there is exactly one cheap
move: **email `info@menustat.org` / `MenuStat@health.nyc.gov` and ask for
written permission.** That mailbox may be dead along with the site. It costs one
email to find out, and it converts the strongest objection in this ADR into a
document.

---

## 2. Completeness — counted, not estimated

Both snapshots were downloaded and parsed in full. **Counts are of distinct
`menu_item_id`, not of rows** — the 2018 file repeats each item once per
customizable-build row, which inflates a naive row count by **2.4x**
(71,172 rows → 30,120 items). That is the same class of error ADR-0018's
scoping made, so it is called out here.

| | **2018** (Dataverse, CC0) | **2022** (Wayback only, unlicensed) |
|---|---|---|
| Distinct items | 30,120 | 26,238 |
| **Has calories AND protein** | **26,162** (86.9%) | **25,217** (96.1%) |
| Distinct chains with usable items | 96 | 92 |
| …of which carry a numeric g/ml/oz serving size | 11,366 | 10,143 |
| …household serving text only ("1 Bowl", "Full") | — | 3,232 |
| …**no serving size of any kind** | — | **11,842** |
| Usable items **excluding** Beverages + Toppings | ~13,800 | **11,392** |

**Verdict on measurement 2: it passes, comfortably.** ~25k items with both
macros is roughly **2x** the entire bundled USDA corpus (13,272 foods, 3.6 MB),
and the file is the same order of magnitude on disk — the ADR-0018 shape holds.

**But three qualifiers belong in the ADR, and none of them were in it:**

1. **More than half the corpus is drinks and condiments.** Beverages (8,878) and
   Toppings & Ingredients (4,947) are 55% of the 2022 usable items. The count
   that matters for "I ate at Chili's" is the **11,392** entrees, sandwiches,
   burgers, pizza, sides, salads and soups.
2. **Serving size is the real completeness problem, not macros.** `ServingOption`
   in `packages/core/src/food-search.ts` requires `grams: number`.
   **11,842 usable 2022 items carry no serving size at all** — 47%. Those
   cannot produce a valid `ServingOption` without either synthesizing a gram
   weight (a fabrication), emitting `grams: 0` (a lie the client will divide
   by), or widening the wire type so `grams` is optional — **which contradicts
   ADR-0027's "both clients are unmodified" consequence** and makes this a
   client release, not a `functions`-only deploy. This is the single largest
   correction this research makes to the ADR.
3. **The two snapshots are not schema-compatible.** 2022 dropped the `year` and
   all `*_100g` columns, and renamed chains inconsistently
   (`Dominos`→`Domino's`, `Chick-Fil-A`→`Chick Fil A`, `In-N-Out Burger`→
   `In-N-Out`). Any ingest that merges years needs a hand-maintained chain-name
   normalization table, which the ADR did not price.

---

## 3. Relevance — answered, and it is the measurement that changes the design

The owner's list, given 2026-08-24, is **15 chains**. **All 15 are in MenuStat's
2022 snapshot; 14 of 15 are in the licensed 2018 one.** Counts are usable items
(calories AND protein), with "food" excluding Beverages and Toppings &
Ingredients.

| Chain | 2018 usable | 2022 usable | 2022 **food** | food **with gram weight** | in bundle today |
|---|---:|---:|---:|---:|---:|
| Panda Express | 129 | 183 | 70 | **70** | 0 |
| Wendy's | 138 | 110 | 66 | **0** | 14 |
| Church's Chicken | 138 | 128 | 51 | **51** | 0 |
| Denny's | 261 | 252 | 139 | **95** | 12 |
| IHOP | 394 | 362 | 224 | **0** | 0 |
| The Cheesecake Factory | **0** | 552 | 399 | **0** | 0 |
| Wingstop | 57 | 68 | 64 | **64** | 0 |
| Chipotle | 63 | 125 | 7 | **4** | 3 |
| Qdoba | 74 | 144 | 28 | **28** | 0 |
| Taco Bell | 292 | 376 | 85 | **0** | 11 |
| Starbucks | 566 | 791 | 89 | **89** | 0 |
| Panera Bread | 294 | 459 | 187 | **10** (+177 household) | 0 |
| Olive Garden | 224 | 166 | 81 | **2** | 5 |
| Chili's | 343 | 364 | 157 | **1** (+4 household) | 2 |
| Chick Fil A | 102 | 209 | 152 | **152** | 3 |
| **TOTAL** | **3,075** | **4,289** | **1,799** | **566** (+193 household) | **50** |

### What this says

- **Relevance passes on coverage.** Every named chain is present. The bundled
  corpus holds **50** items across these 15 today; MenuStat 2022 holds **1,799**
  food items — a **36x** increase on the chains that actually matter to this
  user. Measurement 3 is a clear pass.
- **The Cheesecake Factory exists only in the unlicensed 2022 file** (399 food
  items — the largest single contributor on the list). Shipping 2018-only drops
  it entirely. This is the concrete cost of the licence split in §1.
- **And the serving-size problem from §2 lands almost exactly on this list.**
  Only **566 of 1,799** (31%) carry a gram weight. Dropping gram-less items
  would delete **IHOP (0 of 224), The Cheesecake Factory (0 of 399), Wendy's
  (0 of 66), Taco Bell (0 of 85), Chili's (1 of 157) and Olive Garden (2 of 81)**
  — six of the fifteen, and 1,011 of the 1,799 food items. **The cheap path is
  therefore not available.** This is the finding that decides the ADR.

### The Puerto Rico gap — and what already fills it

- **MenuStat is US-mainland chains only** (its FAQ: *"MenuStat captures national
  data."*). No El Mesón Sándwiches, no panadería, no fonda, no cafetería.
- **Option B does not fix this either.** FatSecret was searched directly for
  *"El Meson Sandwiches"* on 2026-08-24: it is **not a recognized brand** there;
  the search returns unrelated generic foods. So the PR-local-chain gap is not
  a reason to prefer B over A — **neither source has it**, which removes B's
  only PR-specific argument.
- **The bundled corpus already covers PR *food*, just not PR *brands*.**
  `functions/data/usda-foods.json` holds **61 items named "Puerto Rican style"**
  — *Green plantain with cracklings* (mofongo), *Fried stuffed potatoes*
  (alcapurrias), *Hayacas* (pasteles), *Codfish salad, Serenata*, chicken
  fricassee, meat loaf, octopus salad — plus plantain (18), flan (25), guava
  (12), tamal (12), empanada (8), arroz con… (5), cassava (5), pigeon pea (3),
  sofrito, habichuela, yautía. **The local-cuisine case is in far better shape
  than "no PR data" suggests**; what is missing is brand-level items, and
  **My Foods (ADR-0013) already solves that for a returning user.**
- **One concrete, cheap PR follow-up exists: Pollo Tropical.** It is a major
  chain in PR, it **publishes official nutrition** (`pollotropicalpr.com/nutricion`,
  updated 2026-02-01), and it is **not** in MenuStat's 92. One chain, one
  published source, hand-ingested — a far better use of effort than any API.

### The 92 chains in the 2022 snapshot (for reference)

Applebee's · Arby's · Auntie Anne's · Baskin Robbins · Big Boy/Frisch's ·
BJ's Restaurant & Brewhouse · Bob Evans · Bojangles · Bonefish Grill ·
Buffalo Wild Wings · California Pizza Kitchen · Captain D's · Carl's Jr ·
Carrabba's Italian Grill · Casey's General Store · Checker's/Rally's ·
Cheddar's Scratch Kitchen · Chick Fil A · Chili's · Chipotle · Chuck E. Cheese ·
Church's Chicken · Ci Ci's · Cracker Barrel · Culver's · Dairy Queen ·
Del Taco · Denny's · Dickey's Barbeque · Domino's · Dunkin' Donuts ·
Einstein Bros · El Pollo Loco · Famous Dave's · Firehouse Subs · Five Guys ·
Golden Corral · Hardee's · Hooter's · IHOP · In-N-Out · Jack in the Box ·
Jamba Juice · Jimmy John's · KFC · Krispy Kreme · Krystal · Little Caesar's ·
Long John Silver's · Longhorn Steakhouse · McDonald's · Moe's Southwest Grill ·
O'Charley's · Olive Garden · On The Border · Outback Steakhouse ·
Panda Express · Panera Bread · Papa John's · Papa Murphy's · Perkins ·
PF Chang's · Pizza Hut · Popeyes · Portillo's · Qdoba · Quiznos ·
Raising Cane's · Red Lobster · Red Robin · Romano's Macaroni & Grill ·
Round Table Pizza · Sbarro · Shake Shack · Sonic · Starbucks ·
Steak 'N Shake · Subway · Taco Bell · TGI Friday's · The Capital Grille ·
The Cheesecake Factory · Tropical Smoothie Café · Waffle House · Wendy's ·
Whataburger · White Castle · Wingstop · Yard House · Zaxby's

---

## 3b. How much does the gram-less half actually cost? Less than it looks

§2 called the required `ServingOption.grams` "the single largest correction."
Reading the consumers rather than the type narrows that materially:

| Consumer | Handles a gram-less serving? |
|---|---|
| `packages/core/src/custom-food.ts:98` | **Yes, already** — `s.grams != null ? … : 1` with `servingUnit: 'serving'`. The domain model has always supported "1 serving" |
| `apps/mobile/src/components/FoodSearch.tsx:186` | **Yes, already** — `s.grams > 0 ? … : undefined` |
| `src/app/services/entry-form-manager.service.ts:338` | **Yes** — guards on `ctx?.grams != null` |
| `packages/core/src/meal-utterance.ts:372,388` | **Yes** — guards on `base.grams` being falsy |
| `packages/core/src/usda-search.ts:307` | Skips `!(p.grams > 0)` — correct for USDA, would need a sibling path for MenuStat |
| **`src/app/components/food-search/food-search.component.ts:445`** | **No** — `grams: Math.round(s.grams * m)` is unguarded and yields `NaN`. **This is the one place that breaks** |

So the real cost of admitting gram-less items is: **widen `ServingOption.grams`
to optional in both mirrored copies of the wire type, and fix one unguarded line
in the frozen web client** (a correctness fix, which ADR-0022 explicitly still
permits). Mobile needs a release only because the type is compile-time required,
not because its runtime would break. That is a much smaller bill than "both
clients ship a feature," and it is what makes keeping all 1,799 items viable.

---

## 4. What this means for ADR-0027

**All three measurements pass. Option A survives — but three of the ADR's own
stated properties are wrong and must be rewritten, not quietly kept.**

1. **Licence: take the CC0 2018 file as the baseline, and pursue 2022 by email.**
   2018 is the only copy with a written grant. It covers 14 of the owner's 15
   chains and 3,075 usable items on that list. 2022 adds The Cheesecake Factory
   and ~1,200 more usable items on the same list, but only as an
   Internet-Archive capture of a site that said *All rights reserved* — so it
   ships **only** if `info@menustat.org` / `MenuStat@health.nyc.gov` answers.
   One email decides it.
2. **"Both clients unmodified / functions-only deploy" is false and must go.**
   Only 31% of the food items on the owner's list carry a gram weight, and
   dropping the rest would delete IHOP, The Cheesecake Factory, Wendy's, Taco
   Bell, Chili's and Olive Garden outright. The corpus is only worth shipping if
   gram-less servings are admitted, which costs an optional `grams` in both
   mirrored copies of `ServingOption` plus **one unguarded line** in the frozen
   web client (§3b). Small — but not zero, and not what the ADR claims.
3. **The upstream is dead; there is no annual refresh to inherit.** The snapshot
   year must be stored per item and rendered, and the empty state must name what
   is not covered.

**And one thing the ADR should stop treating as a MenuStat problem.** The Puerto
Rico gap is real but it is not option A's fault and option B does not fix it —
FatSecret has no El Mesón either. What actually closes ground in PR is already
in the repo (61 "Puerto Rican style" items in the bundle, plus My Foods), and
the one cheap addition is **Pollo Tropical**, hand-ingested from its own
published nutrition page. That belongs in the follow-up ingest ticket as a named
second source, not as an argument against A.

---

## Sources

- Harvard Dataverse, *MenuStat Annual Data*, [doi:10.7910/DVN/K4NYTR](https://doi.org/10.7910/DVN/K4NYTR) — licence, file list and the 2018 file itself (Dataverse API, 2026-08-24).
- NYC Open Data, [*DOHMH MenuStat (Historical)*](https://data.cityofnewyork.us/Health/DOHMH-MenuStat-Historical-/qgc5-ecnb) — Socrata metadata API `views/qgc5-ecnb.json`: no licence field, `rowsUpdatedAt` 2019-02-04, update frequency *"Historical data"*.
- [NYC Open Data terms](https://opendata.cityofnewyork.us/overview/) — *"provided for informational purposes"*, warranty disclaimer, no grant.
- menustat.org `about.html`, `data.html`, `faq.html`, and the `uploads/` file list — Internet Archive captures (latest 200 for the site: 2026-06-12; `about.html` 2026-02-06; `data.html` / `faq.html` 2022-07-01).
- `ms_annual_data_2022.xlsx`, Internet Archive capture — parsed in full.
- `functions/data/usda-foods.json` (ADR-0018 bundle) and `packages/core/src/food-search.ts` — this repo.
