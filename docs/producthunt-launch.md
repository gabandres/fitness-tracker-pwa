# Ignia — launch kit (App Store era)

**Rewritten 2026-07-23**, after the iOS app went live. The previous version
was the PWA-era kit: it pitched "$3/mo Pro", a Stripe checkout, a 7-day trial
and "photo → macros via Gemini". None of that is in the shipped build. Posting
it would have been a straight-up false claim, and the audiences below punish
that harder than they punish a boring launch.

**The claim discipline from `docs/go-to-market.md` §0 applies to every word
here.** Free, adaptive TDEE, a real training log, barcode + USDA/OFF search,
AI coach, es-PR. Not: photo scan, Pro, trials, Health sync, widgets, Android.

---

## The one sentence

> A free calorie tracker that learns your real TDEE from your own weight
> trend — and logs your lifting in the same app.

Every post below is a variation on that sentence plus the audience's own
vocabulary. If a draft doesn't contain both halves (**adaptive** *and*
**training**), it's pitching a commodity calorie counter and will land flat.

---

## Sequencing

Do **not** fire these on the same day. Space them 3–7 days apart so each has a
clean attribution window and so a bad reception on one doesn't poison the
others. Order is deliberate: the lowest-stakes audiences go first, so the
pitch is already tuned by the time it reaches the ones that matter.

```
Week 1   r/SideProject + IndieHackers      ← rehearsal; friendly, forgiving
Week 2   Product Hunt                      ← the set-piece
Week 3   Show HN                           ← technical framing, different pitch
Week 4+  Fitness communities               ← highest value, slowest burn (see below)
```

---

## Product Hunt

**Tagline** (60 max)

```
Free calorie tracker that adapts — and logs your lifting
```
*(56 chars)*

**Description** (260 max)

```
Ignia learns your real maintenance calories from your own weight trend and
adjusts your targets as you go — instead of handing you one number forever.
It also has a full strength-training log. Free: no ads, no subscription, no
locked features.
```
*(243 chars)*

**Gallery** — first three show in the grid, so they carry the whole pitch.

1. Adaptive target next to the weight trend — *"your target moves because your body did"*
2. The training log mid-session — *"the only macro tracker with a real lifting log"*
3. Barcode / search logging — *"log a meal in about five seconds"*
4. Weekly insights — *"where the week actually went"*
5. AI coach reading real logs — *"advice from your data, not a template"*
6. Fasting + body metrics — *"the rest of the picture"*
7. Free / no-paywall screen — *"every feature. no subscription."*
8. es-PR screenshot — *"completamente en español"*

> Screenshots must come from the **iOS build**, not the PWA — the previous kit
> reused web captures and they read as a different product. Check every frame
> for PII, test-account emails and localhost URLs before upload.

**First comment** (post at 00:01 PT)

> Hey hunters 👋
>
> I'm Gabriel, solo dev. Ignia is the tracker I wanted and couldn't find.
>
> Two things make it different:
>
> **1. Your calorie target isn't a constant.** Most apps run a formula once at
> signup and never touch it again. Ignia fits your actual weight trend against
> your actual intake and recalibrates from there. When I did this by hand on
> my own data, the formula-estimated number was off by a few hundred calories
> a day — which is the entire difference between losing weight and wondering
> why you aren't.
>
> **2. It logs your lifting.** Templates, sets/reps/RIR, automatic progression
> suggestions, plate math, warm-up sets. If you count macros *because* you
> lift, you currently need two apps. I got tired of that.
>
> It's also free. Not freemium, not trial-then-paywall — free. No ads, no data
> selling. It's a solo project, not a funding round, so there's nobody to
> monetize you for. There's a tip jar that unlocks nothing.
>
> Also: fully translated to Spanish (Puerto Rico), because I live here and the
> localized options in this category are basically nonexistent.
>
> iPhone + any browser today; Android is in testing.
>
> The thing I actually want feedback on: **if you've bounced off a macro
> tracker, what made you quit?** Not what feature was missing — what made you
> stop opening it. That's the problem I care about.
>
> — G

**Maker bio**

> Solo dev in Puerto Rico. Building quiet software: no ads, no dark patterns,
> no data selling.

---

## Show HN (week 3 — rewrite, don't cross-post)

HN wants the engineering, and reacts badly to marketing copy. Lead technical:

**Title:** `Show HN: Ignia – free macro tracker that fits your TDEE from your own weight trend`

**Body outline:**
- The math: least-squares fit over weight trend + intake to derive maintenance
  calories, and why a static Mifflin-St Jeor number drifts away from reality.
- The architecture: Angular PWA + Expo React Native sharing a framework-free
  `packages/core` for all domain math, so both frontends compute identical
  numbers. Firebase with no app server — Firestore rules *are* the
  authorization layer.
- The cost story: what it actually costs to run a free app on Firebase, and
  the constraints that follow (≤3 scheduled functions to stay in Cloud
  Scheduler's free tier, no `minInstances`, coarse schedules).
- What's deliberately absent: AI photo calorie estimation. Say plainly that
  the published error rates didn't justify it and it was cut rather than
  shipped as a demo. HN respects a "we didn't ship it" story.

Expect scrutiny on the TDEE math. Have the actual method ready to defend.

---

## r/SideProject + IndieHackers (week 1)

Build-log framing, not launch framing. "Solo dev, shipped a free macro tracker
to the App Store after N months — here's the stack and what it costs to run."
Share real numbers; both audiences reward specifics and ignore polish.

## Fitness communities (week 4+, the slow burn)

**These are the highest-value and the easiest to burn permanently.** r/loseit,
r/fitness, r/gainit, r/intermittentfasting, r/xxfitness and the training
Discords ban promo on sight, and a burned subreddit does not come back.

Rules:
- **Do not post a launch.** Not once, not as "I built this for myself".
- Participate genuinely for weeks first. Answer TDEE and macro questions with
  actual answers, no link.
- Mention the app only when someone asks for a recommendation that matches it
  precisely — free, adaptive, has a training log — and disclose that you built
  it, in the same sentence.
- Read each sub's self-promo rule before the first comment.

The `/vs/*` comparison pages exist for exactly these threads: when someone
asks "MacroFactor alternative that's free?", the honest comparison page is a
better answer than a store link.

---

## Channels that don't need permission

Worth more than one launch-day spike, and none of them can be revoked:

- **The website funnel.** `/calculator` (plus 8 keyword variants),
  `/macros/<goal>/<weight>-lb`, `/vs/<competitor>`, `/faq` are already
  indexed and now carry App Store badges, an iOS smart banner and a
  `/download` page. This is the compounding channel — every improvement to
  those pages pays out indefinitely, unlike a launch post.
- **The es-PR listing** (`docs/go-to-market.md` §4). Localized listings are
  the cheapest untapped reach available.
- **Ratings.** The in-app prompt and the Settings → *Rate Ignia* row feed the
  single biggest store-ranking input we're weakest on.
- **App Store promotional text.** 170 chars, editable without a build —
  a free announcement slot for every release.

---

## Launch-day checklist

- [ ] Screenshots are from the **iOS build**, no PII, no test emails
- [ ] Tagline ≤60, description ≤260 (measured, not eyeballed)
- [ ] First comment drafted and pasted, not typed live
- [ ] Sign-in tested cold in a fresh install: Apple, Google, email+password
- [ ] Email verification tested end-to-end
- [ ] Account deletion tested (it's the thing reviewers check)
- [ ] `/status` healthy; `/support` resolves and the mailto works
- [ ] `CHANGELOG.md` entry written
- [ ] Sentry open — watch for auth errors and Firestore rule denials as
      signups spike
- [ ] Rollback commit identified, Firebase CLI already authenticated

## First 24 hours

- Reply to every comment within ~2h while awake.
- Don't argue with critics. Thank them, ask a follow-up question.
- Watch Firestore rule denials specifically — a new-user path nobody has
  exercised is the most likely thing to break under a signup spike.
- Day 2: write up what happened, numbers included. That post is often worth
  more traffic than the launch itself.
