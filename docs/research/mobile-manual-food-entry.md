> **VERDICT** — On mobile, writing a food yourself is a text link at the **bottom** of the Add-food sheet's browse list, and it is reachable **only while the search box is empty**. Three compounding defects, not one: it sinks further with every custom food the user saves; typing a query — the single strongest signal that someone wants to write their own food — *removes* the affordance entirely; and the "No matches" dead end discards the name they already typed. The web PWA does not have this problem: it opens on a **Manual** segment by default. **Recommended fix, in order: (1) turn "No matches" into a create action that carries the query into the name field; (2) add a manual affordance to the header icon row so the entry point is fixed, not scroll-dependent.** (1) is a few lines and removes the dead end; (2) restores web parity.
> **Status:** SETTLED (diagnosis + recommendation; not implemented) · **Researched:** 2026-08-06
> **Read this only if:** you are changing the mobile Add-food sheet, or deciding where manual entry belongs in it.
> **Do not** re-derive the measurements below; cite them.

# Manual food entry on mobile — why it is hard to find

Scope: `apps/mobile/src/components/EntrySheet.tsx` (840 lines) and
`apps/mobile/src/components/FoodSearch.tsx`. The complaint that prompted this:
*users who want to just write a food themselves have to scroll down to catch it.*
That is true, and it is the least of it.

## 1. What the sheet does today — measured

The sheet opens in `mode: 'browse'` (`EntrySheet.tsx:142`, `:247`). Browse renders
`<FoodSearch>` with `browseEmpty` passed as `emptyContent`. `FoodSearch` shows
`emptyContent` **only in the idle phase** — as soon as the query reaches 2
characters it switches to results, an error, or "No matches"
(`FoodSearch.tsx:207-225`).

`browseEmpty` renders in this fixed order (`EntrySheet.tsx:396-517`):

| # | Section | Rows | Capped? |
|---|---|---|---|
| 1 | **Recent** | ≤ 5 | yes — `useToday.ts:158-171`, "cap at 5" |
| 2 | **My Foods** | every custom food | **no** — `customFoods.map(...)`, and `subscribeCustomFoods` sets no `limit` (`ledger.ts:558-568`) |
| 3 | **Quick add** (presets) | every preset | **no** — `presets.map(...)` |
| 4 | Suggested (starter chips) | only when 1–3 are all empty | — |
| 5 | **"Create custom food"** | 1 link | last element in the container |

So the create affordance is the **last** thing in a list whose length the user
controls, and which grows as they use the app.

## 2. Three distinct defects

**(a) The button is buried by its own output.** Every food saved via "Create
custom food" adds a row to My Foods, which sits *above* the link. The feature
pushes its own entry point down each time it succeeds. A new user with nothing
saved sees the link near the top; a committed user with 20 saved foods scrolls
past all 20 to reach it. That is backwards — the committed user is the one who
reaches for manual entry most.

**(b) Searching destroys the affordance.** `browseEmpty` — and therefore the
link — only renders in `FoodSearch`'s idle phase. Type two characters and it is
gone. But typing is the natural first move, and someone typing *"abuela's
arroz con gandules"* is precisely someone who will not find a database match
and does want to write it themselves. The interface removes the escape hatch at
the exact moment the user needs it.

**(c) "No matches" is a dead end that throws away work.** When a search returns
nothing the user gets a centred grey line — `'food.noMatches': 'No matches. Try
a simpler term.'` (`FoodSearch.tsx:209`) — and nothing else. No create action.
The recovery path is: clear the query → scroll to the bottom of the browse list
→ tap "Create custom food" → **retype the name they already typed.** The copy
also blames the user's search term for what is usually just an absent food.

## 3. The web PWA already solved this — this is a parity break

`src/app/components/entry-sheet/entry-sheet.component.ts` puts a **segmented
control at the top** of the sheet (`:70-91`) with four visible segments —
Search, Meal, Barcode, Manual (Photo is filtered out behind `FEATURES.photoScan`,
`:395-403`). The default is `manual` (`:385`), and the sheet resets to it on
every close (`:405-407`, *"every open starts on the Manual entry surface"*).

On web, writing your own food is the **default surface**. On mobile it is a link
below an unbounded list. CLAUDE.md states parity is bidirectional and maintained
page-by-page, so this is a gap to close, not a platform difference to preserve.

Mobile already has the right container for it: a header icon row with four
actions — meal text, barcode, recipe calculator, recipe URL import
(`EntrySheet.tsx:520-540`). **There is no manual/write icon in it.** The one
logging method that needs no network, no camera and no parsing is the only one
without a fixed, always-visible entry point.

## 4. Options

| Option | Cost | Effect |
|---|---|---|
| **A. "No matches" → create, prefilled** with the typed query as the food name | very low — one branch in `FoodSearch.tsx:209` + a callback | Removes defect (c) entirely and most of (b). The user's intent and their typed text are both already in hand at that moment. |
| **B. Add a manual icon to the header icon row** (`pencil`/`create-outline`) | low | Fixes (a) and (b): a fixed entry point that never moves and survives typing. Mirrors the web's Manual segment without restructuring the sheet. |
| **C. Move the link above the lists** | trivial | Fixes (a) only. Still vanishes on typing. A stopgap, not a fix. |
| **D. Full segmented control matching web** | medium — restructures the sheet header | True parity, but it replaces an icon row that already works and costs the most for the increment over A+B. |
| **E. Cap My Foods / presets with a "see all"** | low–medium | Bounds the scroll, but treats the symptom; the link is still last and still vanishes on typing. Worth doing on its own merits — the lists are genuinely uncapped. |

## 5. Recommendation

**Do A and B.** Together they cost less than D and address all three defects: a
fixed entry point that survives typing (B), and a create path at the moment of
failure that preserves the user's typed name (A). Then reconsider D only if the
icon row starts feeling crowded — it would hold five.

Consider **E** separately: `subscribeCustomFoods` is genuinely unbounded and
will render every custom food a user ever saves into a sheet, which is a
performance and scroll problem independent of where the create link sits.

Two copy notes for whoever implements A:
- `'food.noMatches'` currently reads *"No matches. Try a simpler term."* — it
  should offer the action instead, e.g. *"No matches. Add «{query}» yourself"*.
- Both locales need the new key, flat with `{query}` interpolation on mobile
  (`{{query}}` if the web ever mirrors it) — see CLAUDE.md's i18n convention.
