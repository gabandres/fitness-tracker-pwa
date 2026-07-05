# Macronaut — build roadmap

Companion to [ADR-0015](adr/0015-macronaut-photo-first-freemium-pivot.md)
(the *why*). This is the *what/when*. Organized by the owner's product
framework: **core function → core loop → accessory → surface area →
retention**, then rebrand + clearance + discoverability.

Decisions locked (2026-07-04): brand **Macronaut**; **evolve** the Expo app;
**Firebase** source of truth; **photo-first, freemium** (5 lifetime free scans →
Pro unlimited + Coach); vision **split** (Gemini recognition+portion → USDA
macros), **default Gemini, validate, escalate only on failure**; retention
**local-first smart nudges**, streak-freeze = Pro; remote push deferred.

---

## 0. Name clearance (do BEFORE the code rename — gating)

- [ ] **USPTO** knockout search (uspto.gov TESS) — classes 9 (software) + 42
      (SaaS). Nothing surfaced in web checks; confirm formally.
- [ ] Reserve name in **App Store Connect** (surfaces any unpublished holder).
- [ ] Grab **macronaut.app** (check `.com`); reserve `@macronaut` /
      `@macronautapp` socials.
- If blocked: backups vetted — Tallio (two SaaS cos on the name) and Plently
      (live USPTO mark) both weaker; would re-hunt.

## 1. Core function — photo → macros

The split pipeline (ADR-0015 §1–2). Reuses USDA/`customFoods` (ADR-0013) and
the `consultationStream` CF-proxy pattern.

- [x] **CF already exists: `analyzePhoto`** (functions/src/analyze-photo.ts,
      live) — Gemini vision + chain-of-thought + PR-food priors + server photo
      quota. **Reused as-is for the mobile port.** TODO (ADR-0015 itemization):
      evolve its prompt/schema to return **items + portions** resolved via USDA
      instead of one whole-meal total. The mobile client already normalizes to
      an itemized `ScannedFoodItem[]`, so that CF change needs no client rework.
- [ ] **USDA resolution** — map each returned item → USDA/`customFoods` macros
      (reuse the ADR-0013 resolver). Portion × per-100g = the numbers.
- [ ] **Server quota** in the CF via `packages/core/tier-limits.ts`:
      5 lifetime free scans + hard daily ceiling; 402/paywall past that.
- [ ] **Validation gate** — run 30–50 real food photos; judge *item+portion*
      usability. Escalate to GPT-4o/Claude only if it fails (new secret + CF swap).

## 2. Core loop — snap → review → reward

- [ ] **Camera capture screen** (`expo-camera`) — clean full-screen, shutter +
      gallery-pick. Center tab-bar action (replaces "Log").
- [ ] **Review-estimate screen** — itemized, **editable portions/items**
      (start from `EntrySheet` edit form), running macro total, confidence hint,
      "Add all". This is the accuracy mitigation — never a black-box total.
- [ ] **Reward** — on Add: rings animate toward goal, haptic, streak check +
      celebration (reuse Today `HeroRings` + `usePulse` + `computeStreak`).

## 3. Accessory features (mostly built — reuse)

- **History** = calendar + day detail (done; Tier-2 copy pass landed).
- **Home** = kcal+macro rings, streak, today's items, camera CTA (from Today).
- **Train / Trends / Body** = keep as-is (see §4 — no fold).

## 4. Surface area — KEEP the 4 tabs (grilled 2026-07-04, reversed the fold)

`Today | Train | 📷 Camera | Trends | Body` · Settings/History via headers.

- **NO fold.** The current 4-tab bar is already the clean Cal-AI shape and was
  just Tier-2-polished; merging two polished screens into "Progress" is churn
  for a cosmetic tab-count win. Decided to keep them.
- **Coach → Pro-only.** Entry point stays where it is (the "Ask the Coach"
  button on Trends); gate the screen/CTA behind `isPro`. Bounds free-tier AI
  spend to just the 5 lifetime photo scans; Pro = unlimited scans + Coach.
  (Coach's server `consultation` quota stays as defense-in-depth.)

## 5. Retention — local-first smart nudges (fully grilled 2026-07-04)

- [ ] **Opt-in via a primed prompt after the first logged meal** → then the OS
      permission ask (never burn iOS's one-shot prompt on a cold launch). Keep
      the Settings toggle too.
- [ ] **3 configurable meal-window nudges.** Defaults: **breakfast OFF, lunch
      ON (~1:00 PM), dinner ON (~7:30 PM)**; all editable. Generalize
      `reminders.ts` from one hour/flag to per-window settings.
- [ ] **The split mechanic** (expo-notifications can't make a repeating
      notification conditional):
      - Meal-window nudges → **daily-repeating, timed at the window's tail**
        (lunch ~1:30, dinner ~8:00) so "did you log?" rarely fires after you
        already did. Reliable; reaches lapsed users.
      - **Streak-at-risk → smart:** re-armed each evening, **canceled the
        instant today's first log lands**. Fires ~8:30 PM only when the streak
        is **≥ 3** and today is unlogged. Copy: "🔥 Your N-day streak ends
        tonight — log anything to keep it."
- [ ] **Streak milestones** (7/30/100) local congrats. **Streak-freeze**
      (`freezeMaxGap`) = Pro perk.
- [ ] **QA (device-only feature):** extract a pure
      `planReminders({ now, mealSettings, loggedWindowsToday, streak })
      → { schedule, cancel }` into `packages/core`, **fully unit-tested**; the
      expo-notifications layer is a dumb adapter. Verify the Settings UI on
      8081; add a dev-only "fire a test nudge in 5s" button for on-device
      delivery smoke.
- Remote/server push (lapsed re-engage) — **post-launch** (needs dev build + FCM).

## 6. Rebrand mechanics (465 refs / 141 files — but scoped)

**Split the change — don't sed-replace blindly:**

- **A. Display name → "Macronaut"** (safe, mechanical): i18n `en`/`es-PR`,
      `apps/mobile/app.json` name/slug, `manifest.webmanifest`, notification
      title in `reminders.ts`, `ShareCard`, email templates, OG image, SEO
      prerender, README/docs, CHANGELOG going forward.
- **B. Infra identifiers — leave for now:** `macrolog.web.app`, Firebase
      **project** `fitness-tracker-gb-1775407101`, hosting site `macrolog`.
      The project id does **not** need to change. Domain is a *separate*
      migration: register **macronaut.app** as a custom domain, keep
      `macrolog.web.app` as a 301 redirect. No rush; gate on launch.
- Do A as one focused commit per surface (mobile app, web app, functions,
      docs) so review is legible. Keep i18n `en`/`es-PR` in parity.

## 6b. Donations (cost-offset — external-link, US-first)

Optional support path for free-tier users who won't subscribe but want the AI
scans to keep running. **Reality:** marginal offset only — the subscription is
the real funder; donations are goodwill + community signal. Cheap to add.

**Apple rule (current, matters — gets apps rejected):**
- **US App Store (post-May 2025 Epic ruling):** external donation **links are
  allowed, no entitlement, Apple takes no cut**. ✅ ship it.
- **Outside US:** developer donations still generally **IAP-only** (the 3.2.1
  "tips" clause is for tipping *other people*, not the dev). Geo-gate the link
  to the US storefront, or add consumable "tip" IAPs later for other regions.
- **Google Play + web PWA:** external links fine.

**Build (cheap):**
- [ ] **Rail:** reuse **Stripe** via a pay-what-you-want **Payment Link** (no
      new vendor/backend). Alt: Buy Me a Coffee / Ko-fi.
- [ ] **Settings row** "Support Macronaut — keep the AI scans running" →
      `Linking.openURL(donationUrl)` (external), **US storefront only**.
- [ ] **Web landing footer** button (no restrictions there).
- [ ] Copy stays purely altruistic — **unlocks nothing** (a donation that grants
      features would be an IAP-circumvention rejection).

## 6c. Trends redesign (grilled 2026-07-05)

Purpose: **"your targets + how you're tracking to them."** Removes the weight
trend (Body owns weight — was duplicated). Order + gating + never-blank states:

- **Order:** Maintenance hero → This week (adherence) → Weekly budget →
  Coach (Pro) → Weekly report (Pro). Rationale: anchor → status → runway →
  AI layers. AI CTAs go last (above-the-numbers AI reads as an ad).
- **Free vs Pro:** free = maintenance + this-week adherence + budget (all $0
  client math); Pro = Coach + weekly report + the *deeper* insight rows
  (best/off day, weight-slope). "AI costs money, math on your own data doesn't."
- **Never-blank / progressive accuracy** (empty-state research: Inform +
  Inspire + Activate, positive copy, preload estimates):
  - Hero always shows ≥ the **formula estimate** ("Estimate" badge → "Adaptive"
    + completeness% as it sharpens). Never a dash.
  - This week: 0 days → faded skeleton of the stats + "Log a meal to start your
    week"; partial → "2 of 7 days logged" + averages so far; full → full stats.
  - Budget: the 7 day-columns are the illustration — faded when empty +
    "your budget fills as you log".
- **Protein too:** "this week" reports **calories AND protein** adherence (avg
  protein vs target + protein-goal days hit) — needs a small weekly-insights
  core addition. Trends must serve the kcal+protein identity, not calories only.

## 7. Discoverability / ASO (the "I hope people find it" problem)

Your Train differentiator **is** the wedge — nobody pairs AI-photo macros with
a real lifting log (Cal AI has none; MacroFactor only added workouts Jan 2026).

- **App Store title/subtitle** lead with the combo: e.g. *"Macronaut — AI
      Calorie Photos + Workout Log."* Keywords: `ai calorie tracker, macro
      tracker, food photo, workout log, lifting, protein`.
- **SEO landing** (reuse the web app's `/calculator` `/vs-page` machinery):
      "Macronaut vs Cal AI" and "calorie + strength tracker in one app" — the
      exact query the two-app Reddit crowd searches.
- **The homepage** ("sexy feature page" you asked for) foregrounds the camera
      demo + the lifting log as co-equal heroes.

## Suggested sequence

1. **Name clearance** (§0) — unblocks everything brand.
2. **Vision validation spike** (§1 last bullet) — proves/kills the Gemini split
   cheaply *before* building UI on top of it.
3. **Core loop** (§1 CF + §2 camera/review) behind a feature flag.
4. **Surface refactor** (§4) — fold Progress, archive Coach, camera center.
5. **Freemium wiring** (§1 quota + paywall + Pro = scans + Coach).
6. **Retention** (§5).
7. **Rebrand display pass** (§6A) + **ASO/landing** (§7).
8. Domain migration (§6B) + remote push — post-launch.
