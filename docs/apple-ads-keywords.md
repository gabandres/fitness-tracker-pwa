# Apple Ads — campaign structure and keyword lists

**Status:** drafted 2026-07-28, nothing launched. Paste-ready.
**Owner action required:** everything here happens in the Apple Ads console; no
code ships for it.

---

## 0. Read this before spending anything

**Ignia earns approximately zero per install.** `PRO_ENABLED` is `false` on both
platforms and the tip jar is OFF entirely since 2026-08-19, so there is no LTV to recover a cost
per install against. Health & Fitness CPI benchmarks run **$2–7**. Every dollar
spent here is unrecoverable in revenue terms.

That does not make it worthless — it makes it a **purchase of ranking and
data**, not of users:

- Install velocity is an App Store ranking input, and paid installs count.
- Keyword-level tap and install data tells you which language actually converts,
  which is worth knowing before rewriting the listing copy again.

So: cap it hard, treat the number you set as the price of the experiment, and
judge it on what it teaches rather than on payback. **Do not scale a campaign
because it is "working" — there is nothing for it to pay back into yet.**

**Sequencing.** Do not launch any of this until the new screenshots are live.
Health & Fitness converts at roughly 48% on the App Store versus 61–63% for the
strongest categories; paying for traffic into an unconverted product page burns
the budget on the store's weakest step.

**Do not bid on what the build cannot back.** No photo-scan, no AI meal
scanning, no premium/Pro terms — the app has none of them, and the mismatch
between ad intent and first-run reality is exactly what produces one-star
reviews. This mirrors the not-claimable table in `go-to-market.md` §0.

---

## 1. Campaign structure

Five campaigns, each with one ad group unless noted. Separate campaigns rather
than one — Apple allocates budget per campaign, and mixing brand with discovery
lets the cheap, certain clicks eat the budget that was meant to buy learning.

| # | Campaign | Match | Why it exists | Suggested split |
|---|---|---|---|---|
| 1 | Brand defence | Exact | Stops competitors buying your name for pennies | 10% |
| 2 | Competitor | Exact | The "[X] alternative" intent the `/vs/*` pages already target | 30% |
| 3 | Category long-tail | Exact | Buyers who describe the exact thing Ignia is | 35% |
| 4 | Spanish | Exact | Thin competition, and the listing is fully localized | 15% |
| 5 | Discovery | Search Match ON, broad | Harvests terms you did not think of | 10% |

**Never enable the Today tab.** It is brand-awareness inventory with very low
conversion and no keyword signal — the opposite of what this exercise is for.

Discovery's only job is to feed campaigns 2–4: read its search-term report
weekly, promote anything that converts into an exact-match keyword in the right
campaign, and add the rest as negatives. It is a research budget, not a channel.

---

## 2. Keyword lists

Apple's keyword field takes one term per line. Lists below are paste-ready.

### Campaign 1 — Brand defence (Exact)

```
ignia
ignia app
ignia fit
ignia tracker
ignia calories
```

### Campaign 2 — Competitor (Exact)

Bidding on competitor names is permitted and is where the `/vs/*` landing pages
already point. Expect a lower conversion rate than brand and a higher CPT.

```
myfitnesspal alternative
macrofactor alternative
cronometer alternative
lose it alternative
cal ai alternative
free myfitnesspal alternative
macro tracker like macrofactor
calorie counter like myfitnesspal
myfitnesspal without subscription
macrofactor free alternative
```

### Campaign 3 — Category long-tail (Exact)

Long-tail only. Head terms ("fitness", "calorie counter", "diet") are dominated
by incumbents with real LTV; you cannot outbid them and should not try.

```
macro tracker with workout log
calorie counter and workout tracker
macro tracker no subscription
free macro tracker no ads
adaptive tdee tracker
tdee calculator app
macro tracker for lifters
calorie tracker for weightlifting
protein tracker app
protein and calorie tracker
macro counter with barcode scanner
free calorie counter no paywall
cutting macro tracker
bulking calorie tracker
weight trend tracker app
calorie tracker with lifting log
gym and diet tracker in one
macro tracker with strength training
```

### Campaign 4 — Spanish (Exact)

The listing is live as es-MX and the app is fully translated, so this is real
inventory against thin competition. `contador de calorías` is the head term for
the category in Spanish and will be the most expensive line here.

```
contador de calorias
contador de calorias gratis
calculadora de macros
contar macros
app de macros
registro de calorias y pesas
app para contar calorias gratis
calculadora de tdee
contador de proteina
app de dieta y gimnasio
```

### Campaign 5 — Discovery

No keyword list. Search Match **ON**, broad match, low bid. Apply the shared
negative list below.

---

## 3. Negative keywords (apply to every campaign)

Two groups. The first blocks intent the build genuinely cannot serve; the second
blocks traffic that will never convert regardless of how good the app is.

**Features Ignia does not have** — the important half, because these searchers
install, look for the feature, and leave a review saying it is missing:

```
photo calorie counter
ai food scanner
scan food photo
picture calorie counter
meal photo macros
food photo ai
apple watch calorie tracker
watch app calories
widget calorie tracker
```

*(Watch and widget come off this list the moment those ship — the widget is
built and waiting on the August build.)*

**Wrong audience or wrong product:**

```
meal delivery
meal kit
recipe app
weight watchers
ww points
points calculator
diabetes
blood sugar
medical
prescription
supplements
protein powder
steroid
workout only
running tracker
step counter
sleep tracker
water reminder
intermittent fasting only
pregnancy
kids
```

---

## 4. Bids and budgets

Benchmarks (SplitMetrics, Apr–Jun 2026): US median cost-per-tap **$1.79**,
median CPA **$2.76**; Health & Fitness runs CPT **$1.20–3.00** and CPI
**$2.00–7.00**.

Suggested opening position — deliberately small, because the goal is a readable
signal rather than volume:

| Campaign | Daily cap | Opening bid |
|---|---|---|
| Brand defence | $3 | $1.00 |
| Competitor | $8 | $2.00 |
| Category long-tail | $10 | $1.75 |
| Spanish | $5 | $1.25 |
| Discovery | $4 | $1.00 |

That is **$30/day maximum**. Run it for 14 days — roughly $420 — and stop. Two
weeks is enough to rank keywords by tap-through and install rate, which is the
entire deliverable.

Raise a bid only when a keyword shows a high tap-through and a high install
rate. If a keyword takes taps and produces no installs, the product page is
losing them, not the keyword — fix the page, do not raise the bid.

---

## 5. What you will and will not be able to measure

Apple Ads reports impressions, taps, installs and cost per keyword on its own,
with no SDK. That covers everything in §4.

**Attribution stops at the install.** There is no analytics SDK in the app
(no Firebase Analytics, no PostHog), so no ad-sourced user can be followed into
activation or retention. What you *can* do is watch the retention cohorts in
`config/retention` — the cohort weeks that overlap the campaign will include the
paid installs, and if activated-cohort D7 drops sharply during those weeks, the
traffic is worse than organic. That is a blunt instrument and it needs the
sample size to be meaningful; treat it as a smell test, not attribution.

Wiring real attribution means the Apple Ads Attribution API and a way to record
the token against the user. That is a build, and it is not worth doing before
there is a reason to scale spend — which, per §0, there currently is not.
