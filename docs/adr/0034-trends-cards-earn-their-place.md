# ADR-0034: Trends cards earn their place by evidence, not by a settings screen

- **Status:** **accepted** 2026-08-26 — implemented in full. #97 shipped the
  `fasts` collection it was blocked on (Android OTA 64 / iOS OTA 35) and #98
  shipped the fasting card built to the contract in decision 3.
- **Date:** 2026-08-26
- **Touches:** `apps/mobile/src/app/(app)/trends.tsx`, the shape of every future
  Trends card, and — as a *prerequisite, not a part* —
  [ADR-0032](0032-per-day-fasting-history.md)'s `users/{uid}/fasts` collection.
  It deliberately touches **no** `firestore.rules`, no `Profile` field and no new
  storage mechanism.

## Context

A user asked for **more fasting information on Trends**. The owner's instinct
was that Trends must not become a wall of data, and that a *configurable* view —
"I want to see this, this and this" — might be the better answer than adding a
fasting chart.

There are two questions tangled together and they have different answers, so
this ADR separates them before deciding either:

1. **Can Ignia show fasting on Trends at all today?** (No. §2.)
2. **Should Trends become user-configurable?** (No, and the reason is not
   "configuration is bad" — it is that the catalogue being configured is five
   items long and most of it already hides itself. §1, §5.)

Everything below is read out of the tree as of this commit or fetched from a
primary source, not remembered. The verification table at the end lists what was
re-read and where.

### 1. What Trends renders today, in order, and how much of it is already conditional

`apps/mobile/src/app/(app)/trends.tsx` is 582 lines and the render order is
numbered in its own comments:

| # | Element | Line | Rendered when |
|---|---|---|---|
| 1 | **Maintenance hero** (`testID="tdee-card"`) | 132 | **always** — "never a dash once onboarding is done" |
| 1b | **Activity correction** (`testID="activity-correction"`) | 163 | only when `useActivitySuggestion` returns a `suggestion` |
| 1c | **Accrual line** (`testID="activity-progress"`) | 221 | only when `guidance.kind === 'progress'` |
| 2 | **This week** (adherence) | 235 | **always** — "free, never blank" |
| 3 | **Weekly budget** | 251 | **always** — "free, never blank (bars are the illustration)" |
| 4 | **Sleep** ([ADR-0033](0033-sleep-analysis-on-trends.md)) | 257 | three states: nothing / one row / card |
| 5 | **Coach entry** | 265 | always (locked variant when `!isPro`) |
| 6 | **Weekly report** | 289 | `PRO_ENABLED` only — **never in v1** |

So the honest count for a free v1 user with no wearable and no activity
suggestion is **five elements, three of which are cards**: hero, This Week,
Budget, a one-line sleep stub, Coach. Element 6 never renders. Elements 1b, 1c
and 4 render only when they have something to say.

**Trends is not a wall of data. It is a five-item screen with four
self-suppressing slots.** That measurement is the single largest input to this
decision, and it is the thing most likely to be wrong later — see "What would
falsify this".

Two more facts about the order, because they matter to the reorder options:

- The activity correction sits under the hero **because it changes the number
  above it** (`trends.tsx:163-166`).
- Sleep sits under Budget and above Coach because the hero, This Week and Budget
  all set or spend a target and sleep sets nothing — and, explicitly, because it
  "must not push the budget below the fold on a 360×720 dp device"
  ([ADR-0033](0033-sleep-analysis-on-trends.md) §4).

**The order carries argument.** It is not an arbitrary stack.

### 2. The data prerequisite: fasting has no history, and no configuration option fixes that

[ADR-0032](0032-per-day-fasting-history.md) found this and it was re-verified
for this ADR rather than repeated:

- **`Profile.fastStartedAt` is still the only fasting field in the product.**
  `packages/core/src/types.ts:246`, allowed by `firestore.rules:472-473`
  (`is timestamp || == null`) and listed once in
  `packages/core/src/firestore-mappers.ts:113`.
- **`breakFast` still destroys the fast at the moment it completes.** Mobile:
  `apps/mobile/src/lib/ledger.ts:711-713` — `updateDoc(userDoc(uid), { fastStartedAt: null, … })`.
  Web: `src/app/services/firebase.service.ts:671-675`, identical.
- **The `users/{uid}/fasts` collection ADR-0032 proposes does not exist.** A
  tree-wide grep for `'fasts'`, `/fasts` and `fastEndedAt` across `src/`,
  `apps/mobile/src/`, `packages/core/src/`, `functions/src/` and
  `firestore.rules` returns **zero hits**.
- **`packages/core` contains no fasting math at all** — grepping `fast` in
  `packages/core/src` returns `fastStartedAt` in three places and otherwise only
  `breakfast` (the meal slot) and the word "fastidiousness" in a comment.
- **The CSV export has no fasting column.** `packages/core/src/csv-export.ts`
  does not mention fasting.
- **ADR-0032 is `proposed` and unscheduled.** `STATUS.md` does not mention it,
  fasting, or ADR-0033 anywhere.

**Consequence, stated plainly: a fasting card on Trends today could draw exactly
one thing — whether a fast is running right now, and for how long.** That is a
scalar with no series behind it, and it is already on Today
(`apps/mobile/src/components/DailyMetrics.tsx:83-96`). Every chart, average,
streak or weekly figure a user would recognise as "fasting information on
Trends" requires history that is not being written down.

**This is the most important finding in this ADR.** A configurable dashboard
would let the user switch on a fasting card that has nothing to draw. That is
strictly worse than not offering it — it converts an absent feature into a
broken one the user chose.

### 3. How per-user preferences are already persisted here — three tiers, and they are not interchangeable

There is no third mechanism to invent; there are three, and each already has a
job.

| Tier | Mechanism | Examples in tree | Follows the account? |
|---|---|---|---|
| **Profile field** | `users/{uid}` doc, validated in `firestore.rules` | `hiddenRecentLabels` (`rules:509-511`, cap 200), `dayBoundary` (`rules:518-520`, cap 24), `unitSystem`, `preferredLocale`, `weeklyDigestOptIn` | **Yes** |
| **Device-local** | `AsyncStorage` | theme mode (`theme-context.tsx:47,56`), activity-suggestion decline (`activity-suggestion.ts:37-49`), recalibration ack (`useRecalibration.ts:27`), what's-new dismiss, update dismiss | No |
| **Ephemeral** | component state | the web's insights ⇄ budget segmented toggle — `panelView`, a signal, `trends.component.ts:141-149`; never stored | No |

The pattern the tree already follows is sharp: **`AsyncStorage` holds dismissals
and device preferences; the profile holds anything the user would expect to
follow their account.** A dashboard layout is squarely in the second category —
device-local storage would make web and mobile disagree about the same account,
which is the exact failure ADR-0024's estimator work rejected a stored
carry-forward over.

**And the profile field has a rules consequence that is not optional.**
`isValidProfileCompleted` is a `hasOnly()` list (`firestore.rules:347-348`), and
rules evaluate `request.resource.data` as the **merged** document. So an
undeclared new field does not fail *that* field — it **rejects the entire
profile write**, from either frontend, including the frozen web's. `firestore
deploy --only firestore:rules` would have to land before a single client wrote
the key. That is a real, cross-frontend, ordering-sensitive cost, and it is the
same trap [ADR-0028](0028-stretching-mobility-model.md) priced against its option
A.

`hiddenRecentLabels` is the closest existing precedent and it is worth reading
for its *shape*: it stores what is **hidden**, not what is shown
(`apps/mobile/src/lib/ledger.ts:922-927`,
`in-memory-ledger.adapter.ts:232-244`). That is not a style choice. A
visible-list would mean every new card is invisible to every existing user until
they go and switch it on. Any configuration decided here inherits that
constraint.

### 4. What other apps ship, surveyed 2026-08-26

Fetched from primary product/support pages where the host allowed it; rows
marked ⚠ were title-verified from the search index only because the host
rejects non-browser fetches.

| App | Configurable? | Shape | Source |
|---|---|---|---|
| **MacroFactor** | **Yes, prominently** | More → Feature Settings → Dashboard. Toggle any tile on/off, **reorder with up/down arrows** (not drag), swipe-to-remove, the "Dashboard Hat" can be swapped or disabled. Shipped as a **v4.0 headline feature** | [help](https://help.macrofactorapp.com/en/articles/254-how-to-customize-your-dashboard) · [announcement](https://macrofactor.com/dashboard-customization/) |
| **Cronometer** | Show/hide only | More → Display Settings (web) / More → Display → Dashboard Settings (mobile). **Per-widget booleans**; reorder not documented anywhere ⚠ | [Display Settings](https://support.cronometer.com/hc/en-us/articles/360060181932-Display-Settings) · [Mobile Dashboard](https://support.cronometer.com/hc/en-us/articles/10684426724116-Mobile-Dashboard) |
| **Apple Health** | Yes, bounded | **Pinned** (renamed from Favorites in iOS 16): Edit → pin/unpin from a **fixed catalogue**, drag to reorder. Below it, **Highlights** is system-chosen and not orderable | [support 104997](https://support.apple.com/en-us/104997) |
| **Oura** | **Deliberately partial** | Only the **Shortcuts** strip is user-controlled, with a **minimum of three**. The Today feed itself cannot be reordered or hidden. Vitals has its own pencil-icon reorder | [How to Use the Oura App](https://support.ouraring.com/hc/en-us/articles/42987005571859-How-to-Use-the-Oura-App) |
| **Zero** (fasting) | Yes — and **paywalled** | Trends customizer icon toggles and rearranges graphs; rearranging/hiding is a **Zero Plus** benefit | [correlation graphs](https://zerofasting.zendesk.com/hc/en-us/articles/360048177093-Zero-Plus-Correlation-graphs-and-advanced-statistics) · [Plus benefits](https://zerofasting.zendesk.com/hc/en-us/articles/4402552785691-What-are-the-Benefits-of-Zero-Plus) |
| **Whoop** | Yes | The redesigned **Overview** is marketed as letting you "reorder and prioritize the features that matter most"; also collapsed multi-tab swiping into one long home ⚠ | [The Locker](https://www.whoop.com/us/en/thelocker/your-key-whoop-metrics-all-in-one-place/) |
| **Garmin Connect** | Yes, most thorough | "Editing the Home View" — add, remove, reorder cards ⚠ | [FAQ d7p0eCpRPJ4Q](https://support.garmin.com/en-US/?faq=d7p0eCpRPJ4Q6bntYkdIb6) |
| **Fitbit / Google Health** | Yes | Today tab → Edit → Add/Remove metrics. Drag-reorder appears in legacy Fitbit help but **not** in the current Google Health article | [support 14237011](https://support.google.com/fitbit/answer/14237011) |
| **Monarch Money** (finance) | Full drag-and-drop | Customize button; hide and reorder widgets — and **web and mobile customize independently** | [help](https://help.monarch.com/hc/en-us/articles/360058127551-Customizing-Your-Dashboard) |

**Two rows carry the decision, and neither is the obvious one.**

**MacroFactor ships it, and that is a genuine argument against this ADR — but
look at what it configures.** MacroFactor's dashboard is macros, every vitamin,
every mineral, expenditure, weight trend, scale weight, the Dashboard Hat, and
more; the Nutrition section alone orders arbitrary nutrient lists. That is a
catalogue in the dozens. Configuration cost is roughly fixed while benefit
scales with catalogue size, so a screen with 30 tiles and a screen with five are
not the same problem. Worth noting alongside: MacroFactor's own most-upvoted
roadmap item was **steps import at 5,720 upvotes**, not customization —
customization arrived attached to a redesign, not because users demanded it.

**Oura is the most transferable row, and it is the one that says "not
everything".** A short pinned strip the user controls, sitting above a
system-ordered feed the user does not, with a **floor of three** so the surface
can never be emptied. Apple splits the same way — Pinned above Highlights. The
field has converged on *bounded* customization over a fixed catalogue, not on
"arrange the screen however you like".

**Zero paywalls it.** In a product where `PRO_ENABLED` is false and no
purchasable product ships, a feature the category treats as a paid perk is a
strange thing to build first for free.

### 5. What the UX evidence says, including the part that is folklore

- **NN/g, [Customization of UIs and Products](https://www.nngroup.com/articles/customization-of-uis-and-products/):**
  "there are countless tales of companies investing heavily in customization only
  to find that users **rarely — if ever — customize**", and users "exhibit a
  strong bias toward simply getting things done… rather than spending time
  fiddling with preference settings". Its recommendation is to reserve
  customization for features with substantial benefit and to **keep strong
  defaults, because some users will not customize no matter how easy you make
  it**. Measured in the same article: interface-customization sites hit **83%
  task completion vs 66%** for product-customization sites.
- **NN/g, [Customization vs. Personalization](https://www.nngroup.com/articles/customization-personalization/):**
  customization is user-driven, personalization is system-driven; "many users
  don't know what they actually need and most users are not interested in doing
  the work required to tweak the user interface". Explicit guidance: fix the base
  design first, and do not use customization as a fix for a broken layout.
- **Progressive disclosure** ([Nielsen, 2006](https://www.nngroup.com/articles/progressive-disclosure/))
  is the sanctioned middle ground — defer rarely-used features to a secondary
  screen — **but its binding constraint is that everything users frequently need
  must be disclosed up front.** A settings panel that hides a commonly wanted
  card fails that test rather than passing it.
- **The famous "under 5% of users change any setting" figure is real but thin,
  and this ADR does not lean on it.** Jared Spool,
  ["Do users change their settings?"](https://archive.uie.com/brainsparks/2011/09/14/do-users-change-their-settings/),
  2011: users mailed in their Word config files and "less than 5% … had changed
  any settings at all". Sample is "several hundred folks" with **no stated n, no
  timeframe and self-selected mail-in recruitment**, about a 1990s desktop app.
  Spool's own caveat is the interesting half: programmers and designers changed
  40–80% of their settings — the rate is population-dependent, and a person who
  fasts, lifts and logs every meal is closer to that tail than to the Word
  median. **Cite it as an anecdote or not at all.**
- **The commonly repeated Mozilla/Firefox "% who never change defaults" figure
  could not be verified.** Mozilla documents that it *collects* preference-change
  telemetry; no published percentage was found. Treat any such number as
  unsourced.

The honest reading is **not** "customization is always wrong". It is: the field's
evidence says the editor will be opened by a minority, so the value has to come
from the *default* state — which means the work is in choosing the default, not
in offering an escape from it.

## The questions this ADR has to answer

1. Can fasting be shown on Trends at all right now? (§2)
2. Is Trends actually too long, measured rather than felt? (§1)
3. If a preference is stored, where — and what does the frozen web do with a key
   it has never heard of?
4. How many empty states does a configurable dashboard create?
5. What is the cheapest thing that answers the user who asked?

## The options, priced

| | Option | Cost | Verdict |
|---|---|---|---|
| **∅** | **Do nothing.** No fasting card, no configuration | Zero | **Rejected, but it is the baseline.** It leaves a real user request unanswered *and* leaves fasting data being destroyed on every `breakFast`. The second half is a bug the request happened to expose, and doing nothing keeps paying for it |
| **A** | **Just add a fasting card, no configurability** | **Blocked.** It needs [ADR-0032](0032-per-day-fasting-history.md) first: a `users/{uid}/fasts` collection, a `firestore.rules` change, a batched `breakFast` on **both** frontends, a pure `fasting-history.ts` in `packages/core`. Then the card itself: one component, ~4 strings × 3 locales | **Accepted, and sequenced.** This is the direct answer to what was asked. It is not cheap and it is not fast, but every part of the cost is data the product should be keeping anyway |
| **B** | **A fixed order everyone gets, where each card self-gates on evidence** | **Zero new cost — it is what ships today** (§1). The cost is a *rule* on future work: every new card must define its absent / stub / card states | **Accepted as the rule.** It is already how the sleep card, the activity correction and the accrual line behave; it has simply never been written down as a contract |
| **C** | **Show/hide toggles over a fixed catalogue** (Cronometer's model; `hiddenTrendsCards: string[]` on the profile) | One profile field + a `firestore.rules` change **deployed before any client writes it**, or the whole profile write is rejected from both frontends (§3). An editor screen inside a `settings.tsx` that is already 1,103 lines. ~2 strings per card (name + "what this needs") × 6 × 3 locales ≈ **36 new keys against 53 existing `trends.*` keys in `en.ts`**. Plus a permanent migration rule: the list must store *hidden* ids, never visible ones | **Rejected now, deferred with a trigger.** It buys the ability to hide two or three cards on a five-item screen. NN/g's own guidance is that this is customization used as a fix for a layout problem — and §1 says there is not yet a layout problem |
| **D** | **Apple/Oura "Favorites" pin model** — a user-controlled pinned strip above a system-ordered feed | Everything in C, **plus** a default pin set (or every existing user's Trends is empty on first launch), **plus** a floor like Oura's minimum-of-three, **plus** a second rendering path for pinned-vs-feed | **Rejected.** It is the best-designed option in the survey and the wrong size for this screen. With five elements, "pinned" and "the feed" would contain the same items |
| **E** | **Full drag-to-reorder** (Garmin/Monarch) | Everything in C, plus a reorderable list on RN, plus an array-order field, plus an insert-position rule for every card added after a user has stored an order | **Rejected, and it breaks meaning.** The order is argumentative (§1): the activity correction is under the hero *because it changes that number*, and sleep is above Coach *so it cannot push Budget below the fold at 360×720 dp*. Reordering hands the user a way to break a layout that is carrying information. Note even MacroFactor chose arrows over drag |

## Decision

### 1. No "My View", no "My Dashboard", and no configuration screen on Trends

Not now, and not as a smaller version of itself. The name **"My View"** is
recorded here specifically so it is recognisable if it comes back: it is
rejected, it introduces no term to `CONTEXT.md`, and reviving it needs the
trigger in decision 5, not a fresh instinct.

The reason is the measurement in §1, not a principle. **Five elements, four of
which already self-suppress, is not the problem configuration solves.**

### 2. Fasting on Trends is accepted, and it is blocked on ADR-0032

The user asked for something real and the answer is yes. **The order of work is
forced and this ADR's main job is to state it:**

1. **[ADR-0032](0032-per-day-fasting-history.md) ships first** — `users/{uid}/fasts`,
   the `firestore.rules` deploy *before* any client writes it, the batched
   `breakFast` on both frontends (a fast ended on the frozen web must still be
   recorded, or history has holes), `fasting-history.ts` in `packages/core`, and
   the CSV row.
2. **Then** a fasting card on Trends, built to the contract in decision 3.

Anything that reverses this order ships a card that draws nothing. **The
prerequisite is not negotiable and it is not a nice-to-have: today, ending a
fast deletes it.**

### 3. The Trends card contract — every card carries its own evidence gate and three states

This is what replaces configuration, and it is the actual decision.

A Trends card is **absent, a stub row, or a card**, and *it* decides which —
never the user, and never a designer's guess at a per-person layout:

| State | When | What renders |
|---|---|---|
| **absent** | the data source has not answered yet, or the feature cannot apply to this account at all | nothing — not a header, not a skeleton |
| **stub row** | the feature applies but has too little data to say anything | one hairline-bounded row, one sentence, and **it must act** — see below |
| **card** | the evidence gate passes | the full card |

Three constraints on it, each taken from something that has already gone wrong
here:

- **The gate lives in `packages/core` as a pure function that returns `null`**,
  the way `sleepIntakeContrast` does
  ([ADR-0033](0033-sleep-analysis-on-trends.md) §7). The component holds no
  thresholds, so the gate is testable without a renderer and both frontends could
  call it.
- **A stub row must have a destination.** ADR-0033's Amendment 2 shipped a row
  with a chevron and no action, found on a device screenshot rather than by any
  of 427 green specs; "an affordance that does not act reads as a broken row,
  which is worse than not drawing it".
- **A stub row must not lie about why it is empty.** "Connected to Oura — no
  nights yet" and "no sleep data" are different facts
  ([ADR-0026](0026-oura-through-the-os-health-store.md)'s empty-state rule). The
  fasting stub inherits this: *"start a fast on Today"* and *"no completed fasts
  yet"* are not the same sentence.

**This is personalization, in NN/g's sense, rather than customization** — the
screen already differs per user, with no editor, no stored preference, no rules
change and no migration. It is also why the empty-state multiplication in
question 4 does not happen: states are bounded at three per card *and* the user
cannot switch on a card that has nothing to draw, because there is no switch.

### 4. If Trends does get long, the lever is consolidation, not configuration — and this project has pulled it before

The web Trends went from **six stacked cards to three surfaces** by merging
averages + insights + budget into one **Weekly panel** with an ephemeral
insights ⇄ budget toggle, and the two AI cards into one **Coach panel**
(`CONTEXT.md:599-601`, `trends.component.ts:141-149`). The toggle is a signal —
it stores nothing, syncs nothing, and needs no rules change.

That is the precedent, it is already vocabulary in `CONTEXT.md`, and it costs a
fraction of option C. **Reach for it before reaching for a settings screen.**

### 5. The trigger that would reopen this, stated so it cannot be reopened on instinct

Following [ADR-0022](0022-web-pwa-frozen-not-retired.md)'s pattern of deferring
to a measurement rather than to a feeling, option **C** (show/hide over a fixed
catalogue, storing *hidden* ids in a profile field) is revisited when **either**:

- **Trends renders more than eight elements for a median account** — counted the
  way §1 counts them, on a real account, not on the maximum a code-read implies;
  **or**
- **three or more distinct users ask to remove or reorder something on Trends.**
  One user asking to *add* fasting is not this, and was not this.

If it reopens, it reopens as **C**, not D or E: show/hide over a fixed order,
storing hidden ids, on the `hiddenRecentLabels` shape. Reordering stays rejected
for the reason in the options table regardless of how long the screen gets.

### 6. Mobile only, and the web is left alone entirely

The web logging app is frozen for features
([ADR-0022](0022-web-pwa-frozen-not-retired.md)), so the fasting card is
mobile-only and the card contract is a mobile rule.

**There is no "what does web do with an unknown config" problem, because this
ADR stores no config.** That is worth saying out loud as a benefit: option C
*would* have had one, and it is not the one it looks like. The web would simply
never read the key, which is fine — the trap is on the write side. `hasOnly` is
evaluated against the merged document, so the rules deploy that admits a new
profile field is a **cross-frontend** deploy even under the freeze, and getting
it wrong rejects the frozen web's profile writes too. Choosing not to add a
field avoids that entirely.

The one thing the web *must* do is in decision 2: its `breakFast` has to write
the `fasts` document when ADR-0032 lands. That is a correctness fix under a
freeze, which ADR-0022 explicitly still allows.

### 7. i18n

The fasting card ships in **en, es-PR and pt-BR**, flat keys, `{n}`-style
interpolation (`apps/mobile/src/i18n/{en,es-PR,pt-BR}.ts`), per the mobile
convention. Budget roughly **four strings × three locales** for the card, its
stub row and its coverage footer.

For contrast, and as part of why option C is rejected: a configuration screen
needs a name *and* a "what this needs" line for **every** card in three locales —
about 36 new keys against the 53 `trends.*` keys `en.ts` holds today. A ~70%
increase in that namespace that adds no information to the product.

### 8. No AI, no scheduled function, no new listener

Nothing here calls a model, so the standing no-new-AI-features rule is not
engaged. Nothing here needs a schedule — Cloud Scheduler's three-job free tier is
fully spent. The fasting card reads the `fasts` collection ADR-0032 creates, and
per [ADR-0016](0016-mobile-per-hook-subscriptions-intentional.md) it does so
through its **own** focus-gated, **range-bounded** listener, not by widening
`useCoreSnapshot` — three screens would otherwise pay for a listener one screen
reads, and an unbounded second listener is how a read bill starts
([ADR-0033](0033-sleep-analysis-on-trends.md) §9).

## Consequences

- **The strongest argument against this decision.** Self-gating is a designer's
  judgement about relevance, applied to a stranger, and it can be wrong for a
  specific person in a way they have no recourse against. A user who fasts daily
  and owns no wearable now has a Trends screen with a **permanently unhideable
  sleep stub row** on it, and this ADR makes that permanent by refusing the one
  mechanism that would remove it. The person who asked the original question is
  plausibly exactly that user. And the direct competitor, MacroFactor, shipped
  dashboard customization as a **4.0 headline feature** — so "nobody does this"
  is false and was never the argument. The counter is only that MacroFactor
  configures dozens of tiles and Ignia has five; if that stops being true, the
  argument stops working, which is what decision 5 exists for.
- **Every future Trends card is now more expensive.** It must arrive with a pure
  gate, three states, a stub row that acts, and a stub sentence that does not lie
  about *why* it is empty. That is a deliberate tax and it is the thing standing
  between this screen and the wall of data the owner was worried about.
- **The user's request is answered late.** The honest reply was "yes, and it
  needs the thing underneath it built first". That reply is now complete rather
  than pending: ADR-0032 was `proposed`, unscheduled and absent from `STATUS.md`
  when this was written; it shipped as #97 the same day this ADR was accepted,
  and the card followed it.
- ~~**Fasting data is still being destroyed every day this sits unbuilt.**~~
  **CLOSED 2026-08-26.** It was written down twice and the second writing was
  the last: #97 shipped the `fasts` collection and the batched `breakFast` on
  both frontends, and it reached users the same day. Ending a fast records it.
- **Nothing is reversible-proofed by storage here, because nothing is stored.**
  If option C is ever built, it starts from zero — no migration, no orphaned
  field, no half-configured accounts. That is the upside of the refusal.
- **`CONTEXT.md` gains one term when this is accepted, not before:** *Trends card
  contract* — the absent / stub row / card triple in decision 3. It does **not**
  collide with the existing **Weekly panel** or **Coach panel** entries, which
  name *surfaces*; the contract names the *states a surface may be in*. It is
  also **not** the Today tab's **Nudge vs utility** rule, which is about priority
  among promotional prompts, not about evidence.

## What is explicitly out of scope

- **Any settings screen, toggle, pin list or reorder affordance on Trends.**
  Decision 1.
- **Configurability anywhere else** — Today, Body, Train and History are not in
  question and nothing here should be read as a precedent for them.
- **Building ADR-0032.** This ADR *orders* it and does not re-decide it; the
  interval shape, the end-day attribution rule and the stale-fast guard are all
  its business.
- **The design of the fasting card itself** — which number leads, what window,
  what the strip looks like. That is a second ticket once the data exists, and it
  should follow ADR-0033's discipline of refusing to claim more than the data
  supports.
- **Anything on the web** beyond the `breakFast` correctness fix in decision 6.
- **Fasting on the widget, the watch, or any glanceable surface.**
- **Any correlation between fasting and intake, weight or sleep.** Tempting, and
  it needs a lot more than one collection and an ADR.

## What would falsify this

- **The element count in §1 being wrong on a real account.** It was read off the
  source, not off a device. If a median account actually renders eight or nine
  elements — because activity suggestions fire more often than assumed, or
  because a populated sleep card is taller than a stub — then decision 5's
  trigger is already met and option C should be reconsidered immediately.
- **Users asking to *remove* things rather than add them.** One request to add
  fasting is evidence for decision 2 and evidence *against* configuration. Three
  requests to remove something would invert that.
- **A fasting card that, once ADR-0032 lands, has a gate almost nobody clears** —
  which would mean the honest answer to the original request was a better Today
  timer, not a Trends card at all.

## Verification record — the claims this ADR rests on, re-read 2026-08-26

| Claim | Where it was checked | Result |
|---|---|---|
| Trends' card order and conditionality | `apps/mobile/src/app/(app)/trends.tsx:132,163,221,235,251,257,265,289` | Confirmed; 582 lines total |
| Weekly report never renders in v1 | `trends.tsx:289` — `{PRO_ENABLED ? … : null}` | Confirmed |
| Sleep has three states | `apps/mobile/src/hooks/useSleepTrends.ts` — `SleepTrends` union: `pending` / `empty` / `card` | Confirmed |
| Fasting is one profile field | `packages/core/src/types.ts:246`; `firestore.rules:472-473` | Confirmed |
| `breakFast` destroys the fast, both frontends | `apps/mobile/src/lib/ledger.ts:711-713`; `src/app/services/firebase.service.ts:671-675` | Confirmed |
| No `fasts` collection exists | tree-wide grep for `'fasts'` / `/fasts` / `fastEndedAt` | **Zero hits** |
| No fasting math in `packages/core` | grep `fast` in `packages/core/src` | Only `fastStartedAt` ×3, otherwise `breakfast` the meal slot |
| No fasting column in the export | `packages/core/src/csv-export.ts` | Confirmed absent |
| ADR-0032 unscheduled | `STATUS.md` grep for `0032` / `fasting` / `Trends` | **No hits at all** |
| Profile is `hasOnly`-validated | `firestore.rules:347-348`, `525-526` | Confirmed |
| `hiddenRecentLabels` stores hidden, capped at 200 | `firestore.rules:509-511`; `apps/mobile/src/lib/ledger.ts:922-927` | Confirmed |
| `AsyncStorage` is used for dismissals/device prefs only | `theme-context.tsx:47,56`; `activity-suggestion.ts:37-49`; `useRecalibration.ts:27` | Confirmed |
| The web's panel toggle stores nothing | `src/app/components/trends/trends.component.ts:141-149` — a signal | Confirmed |
| Web Trends already consolidated 6 → 3 | `CONTEXT.md:599-601` | Confirmed |
| Three mobile locales exist | `apps/mobile/src/i18n/{en,es-PR,pt-BR}.ts` | Confirmed |
| 53 `trends.*` keys today | grep count in `apps/mobile/src/i18n/en.ts` | Confirmed |
| `settings.tsx` is already 1,103 lines | `wc -l` | Confirmed |
| No existing dashboard-config code anywhere | grep `hiddenTrends` / `cardOrder` / `dashboardConfig` / `myView` / `favorites` | **Zero hits** |
