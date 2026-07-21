# Competitive Feature Scan

Primary-source survey of leading nutrition apps vs. **Ignia** (free, private kcal + protein tracker; web PWA + soon-to-ship Expo iOS/Android). Purpose: surface feature **gaps** and characterize each as **table-stakes**, **acquisition-hook**, or **retention-loop** — plus a rough runtime-cost note and a native-only flag. **No prioritization decisions here** — candidates only.

Surveyed: Cal AI, MacroFactor, MyFitnessPal, Lose It!, Cronometer. All facts cite the source that owns the claim; "unverified" = not confirmable from a primary page (some store/help pages 403 or render via JS).

_Last updated: 2026-07-11._

---

## 1. Per-app summaries

### Cal AI (Viral Development LLC) — photo-first AI calorie tracker
- **Hook:** "Track your calories with just a picture" — AI photo scan is the entire pitch; claims the phone depth sensor estimates food volume, then AI returns kcal + macros ([calai.app](https://www.calai.app/)).
- **Logging:** Photo/AI scan (primary), **barcode**, **"describe your meal"** (text/voice NL), manual foods/recipes, DB search with editable macros ([App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616)). Database size (often cited "2M+") **unverified** on any primary page.
- **Adaptive-TDEE/coaching:** Onboarding lifestyle questionnaire → fixed kcal + macro targets. No adaptive-TDEE recalibration claim found (**unverified**).
- **Integrations:** **No Apple Health / Health Connect mention on the App Store listing** — a review even notes other apps "aren't integrated" ([App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616)). Site vaguely says "integrates with your favorite fitness products" ([calai.app](https://www.calai.app/)). Treat health sync as **absent/unverified**.
- **Widgets/Watch:** **Apple Watch app** confirmed (watchOS 10+); home-screen widgets **unverified** ([App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616)).
- **Social/streaks:** **Public Groups** (community), **streaks** with a **$0.99 "Streak Restore" IAP** ([App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616)).
- **Free vs paid:** **3-day free trial; price hidden until after onboarding.** IAP tiers $0.99–$29.99; widely reported ≈$29.99/yr but exact mapping **unverified** ([calai.app](https://www.calai.app/), [App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616)).
- **Sentiment:** 4.8★ / ~339K ratings. Praise: point-and-log speed, results. Complaints: **inaccurate macros / absurd counts** ("8000 cal for popcorn"), slow load, no manual step/water logging ([App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616)).

### MacroFactor (Stronger By Science) — adaptive-TDEE tracker
- **Hook:** Adaptive **expenditure algorithm** — back-calculates real metabolism from logged intake + trend weight and updates weekly, vs. apps that fix TDEE at signup ([macrofactor.com](https://macrofactor.com/macrofactor/), [help](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)).
- **Logging:** Barcode/label scan; **AI photo + text-description** logging; **voice/speech-to-text**; **recipe import via URL or cookbook photo**; quick-add; **verified ~1.36M-food database** ([App Store](https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471), [macrofactor.com](https://macrofactor.com/macrofactor/)).
- **Coaching:** Three program styles — **Coached / Collaborative / Manual**; weekly check-in reviews trend weight + intake and adjusts targets conservatively ([Program Styles](https://help.macrofactorapp.com/en/articles/91-program-styles), [help](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)).
- **Integrations:** Apple Health + Google Fit (30-day historical import), spreadsheet export; **deliberately ignores wearable activity data** as less reliable than its own calc ([macrofactor.com](https://macrofactor.com/macrofactor/)).
- **Widgets/Watch:** Home + lock-screen **widgets**; **Apple Watch app** (Sept 2025) ([App Store](https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471), [macrofactor.com](https://macrofactor.com/macrofactor/)).
- **Social:** None in-app (external FB/subreddit/IG only).
- **Free vs paid:** **No free tier by design.** $11.99/mo, $47.99/6-mo, $71.99/yr; 7-day trial requires payment info ([App Store](https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471), [macrofactor.com](https://macrofactor.com/macrofactor/)).
- **Sentiment:** 4.8★ / ~19K. Praise: "fastest macro tracker," accurate adaptive targets, **non-judgmental** (no red/shaming numbers) ([App Store](https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471)).

### MyFitnessPal — incumbent database king
- **Hook + DB:** "#1 nutrition tracking app," **20.5M+ foods** incl. restaurant dishes ([Google Play](https://play.google.com/store/apps/details?id=com.myfitnesspal.android), [blog](https://blog.myfitnesspal.com/how-food-database-works/)).
- **Logging:** Search (free); **Barcode scan — Premium-only since Oct 2022** ([support](https://support.myfitnesspal.com/hc/en-us/articles/360032624771-How-do-I-use-the-barcode-scanner-to-log-foods)); **Meal Scan** (photo/AI) — Premium; **Voice Log** (NL) — Premium ([blog](https://blog.myfitnesspal.com/voice-logging-myfitnesspal/)).
- **Restaurant/chain menus:** Yes — Restaurant Logging; major chains (McDonald's, Dunkin, Chipotle) searchable in DB ([blog](https://blog.myfitnesspal.com/myfitnesspal-introduces-restaurant-logging/)).
- **Integrations:** "35+/40+" devices & apps — Apple Health, Google Fit, **Health Connect**, Fitbit, Garmin, Strava, Samsung Health, smart scales ([myfitnesspal.com](https://www.myfitnesspal.com/), [Google Play](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Widgets/Watch:** Home-screen widgets; **Apple Watch + Wear OS** with complications/tiles ([App Store](https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718)).
- **Recipe URL import:** **Recipe Importer (paste URL), free**, web + iOS/Android ([support](https://support.myfitnesspal.com/hc/en-us/articles/360032271592-How-does-the-Recipe-Importer-on-the-website-work)).
- **Social:** Community feed/forum, friends, success stories; 200M+ users ([myfitnesspal.com](https://www.myfitnesspal.com/)).
- **Free vs paid:** Free (ads). **Premium $19.99/mo or $79.99/yr; Premium+ $24.99/mo or $99.99/yr** (Meal Planner + grocery delivery). 7-day trial ([blog pricing](https://blog.myfitnesspal.com/myfitnesspal-membership-pricing-tiers/), [premium](https://www.myfitnesspal.com/premium)).
- **Sentiment:** Praise: DB size, planner. Complaint: **barcode scanner behind paywall** is the dominant backlash ([App Store](https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718)).

### Lose It! (FitNow) — gamified mass-market
- **Hook/DB:** Freemium weight-loss tracker; **56M+ item** database, 57M+ users ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)).
- **Logging:** **"Snap It" AI photo**, voice/NL, and barcode ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)). Snap It is Premium per secondary sources (primary **unverified** — loseit.com blocked fetch).
- **Coaching:** Personalized budget; macro goals + BP/glucose tracking ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)).
- **Integrations:** Apple Health, Fitbit, Garmin, Withings, Google Fit ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)).
- **Watch:** Apple Watch + iPad/Mac/Vision Pro ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)).
- **Social:** Friends + support/community groups + **challenges** ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)).
- **Free vs paid:** Premium tiers $9.99–$79.99 + lifetime $49.99–$59.99 ([App Store](https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629)).
- **Sentiment:** 4.8★ / 765K+, praised intuitive/effective.

### Cronometer — accuracy / micronutrient authority
- **Hook/DB:** "Most accurate"; 1M+ **verified/lab-analyzed** foods (USDA/NCCDB/CRDB), not crowdsourced ([home](https://cronometer.com/index.html), [free-features](https://cronometer.com/blog/free-features/)).
- **Micronutrients (differentiator):** Tracks **84 nutrients incl. 82 micros** ([free-features](https://cronometer.com/blog/free-features/), [gold](https://cronometer.com/gold/index.html)).
- **Logging:** Barcode + search **free**; **photo & voice logging is Gold-only** (Siri) ([free-features](https://cronometer.com/blog/free-features/), [gold](https://cronometer.com/gold/index.html)).
- **Coaching:** "Crono Coach" AI, Macro Scheduler, Oracle, Nutrition Scores, Fasting Timer — all Gold ([gold](https://cronometer.com/gold/index.html)).
- **Integrations (broadest):** Apple Health, **Health Connect**, Fitbit, Garmin, Suunto, **Oura, WHOOP**, Withings, Polar, **Dexcom CGM**, Keto-Mojo ([free-features](https://cronometer.com/blog/free-features/)).
- **Watch/widgets:** Apple Watch + dashboard widgets ([home](https://cronometer.com/index.html)).
- **Free vs paid:** Generous free tier (all 84 nutrients, barcode, device sync). Gold **$10.99/mo or $59.99/yr** (recipe importer, photo/voice, unlimited history) ([gold](https://cronometer.com/gold/index.html)).

---

## 2. Gap matrix — what competitors ship that Ignia lacks

Ignia already has: barcode (OpenFoodFacts), NL + voice logging, AI coach (Gemini), fasting timer, full Train tab, body-fat (Navy) + measurements + progress photos, weight + projection, water + sleep, weekly reports + insights, streak + streak-freeze, CSV import/export, recipe builder, presets/slots, share cards.

| Gap (who has it) | Category | Runtime $cost | Native-only? |
|---|---|---|---|
| **Apple Health / Google Health Connect sync** (MFP, MacroFactor, Lose It!, Cronometer) | **table-stakes** | **$0** (on-device OS API) | **Yes** (PWA cannot) |
| **Home-screen widgets** (MFP, MacroFactor, Cronometer) | retention-loop | $0 | **Yes** |
| **Apple Watch app** (all four majors + Cal AI) | table-stakes (mid-tier) | $0 | **Yes** |
| **Restaurant / chain-menu data** (MFP, incl. free search) | table-stakes | $0 if bundled dataset; $ if live API | No |
| **Meal photo-scan / AI calorie-from-photo** (Cal AI *hook*, MFP, Lose It!, MacroFactor) | **acquisition-hook** | **$$ (paid vision API)** — conflicts w/ cost-aversion | No |
| **Recipe-URL import** (MFP *free*, MacroFactor, Cronometer Gold) | table-stakes | $0 (client-side JSON-LD parse) | No |
| **Adaptive-TDEE recalibration** (MacroFactor *hook*, informal in Lose It!) | retention-loop | $0 (pure math in `packages/core`) | No |
| **Fasting Live Activity / Dynamic Island** (extends Ignia's existing fasting timer) | retention-loop | $0 | **Yes** |
| **Wearable / CGM / Oura / WHOOP ingest** (Cronometer, MFP) | nice-to-have | $0–$ (via Health Connect it's free) | **Yes** (via OS health) |
| **Full micronutrient panel (80+)** (Cronometer *hook*) | acquisition-hook (niche) | $0 (needs richer food DB) | No |
| **Verified/curated food DB** (MacroFactor, Cronometer) | quality differentiator | $0 (bundle USDA CC0) | No |
| **Social challenges / community groups** (Lose It!, Cal AI, MFP) | retention-loop | $–$$ (server/moderation) | No |
| **Grocery-delivery / meal-planner** (MFP Premium+) | acquisition-hook (commercial) | $$ | No |
| **Timeline (non-slot) logging + food memory** (MacroFactor, Cal AI) | nice-to-have | $0 | No |

Notes: "table-stakes" items are ones whose **absence draws bad reviews or blocks adoption** (Health sync and a good barcode/restaurant DB are expected in 2026). Meal photo-scan is the loudest **acquisition hook** in the category right now (Cal AI's entire growth engine) but also the most **cost-exposed** — and its own reviews show accuracy backlash.

---

## 3. Validated candidate list (characterize only — no go/no-go)

Each candidate + one-line "why it matters." `[tag]`, cost, native-only noted.

1. **Apple Health / Google Health Connect sync** `[table-stakes]` · $0 · native-only — Every serious competitor has it; its absence is a visible review complaint and blocks the "one source of truth" expectation. Highest-leverage native-only win.
2. **Home-screen widget (today's kcal/protein rings + quick-add)** `[retention-loop]` · $0 · native-only — Puts the number on the lock/home screen daily; MacroFactor/MFP/Cronometer all ship it. Pure retention, no runtime cost.
3. **Apple Watch app (glance + quick log)** `[table-stakes-ish]` · $0 · native-only — Now baseline; even photo-first Cal AI has one. Reinforces "mobile is the endgame."
4. **Fasting Live Activity / Dynamic Island** `[retention-loop]` · $0 · native-only — Extends Ignia's *existing* fasting timer onto the lock screen; differentiator vs. trackers without a fasting timer, zero new backend.
5. **Recipe-URL import (JSON-LD parse)** `[table-stakes]` · $0 · cross-platform — MFP gives it away free; done client-side from schema.org recipe metadata, so $0 runtime. Complements Ignia's existing recipe builder.
6. **Adaptive-TDEE recalibration (trend-weight + intake)** `[retention-loop]` · $0 · cross-platform — MacroFactor's whole hook, and it's **pure math** that belongs in `packages/core`. Turns Ignia's existing weight + logging data into a weekly re-engagement loop at no cost. Owner already ran a manual TDEE audit — same algorithm, automated.
7. **Restaurant / chain-menu data** `[table-stakes]` · $0 if bundled / $ if live · cross-platform — Users expect to log a Chipotle bowl; a bundled static chain dataset keeps it $0. Common gap-filler.
8. **Smart on-device nudges (already partly present)** `[retention-loop]` · $0 · native stronger — Local notifications from existing data (streak-at-risk, protein-behind, log-reminder); no server, no AI cost. Native push is stronger than PWA push.
9. **Meal photo-scan (AI calorie-from-photo)** `[acquisition-hook]` · **$$ paid vision API** · cross-platform — The category's #1 install driver (Cal AI), **but** cost-exposed and accuracy-criticized in Cal AI's own reviews. Already planned for v1.1 (ADR-0015). Characterize as high-hook / high-cost / high-risk.
10. **Verified/curated food DB (bundle USDA CC0)** `[quality differentiator]` · $0 · cross-platform — MacroFactor & Cronometer market "verified" data as trust. Ignia can bundle USDA CC0 to reduce OpenFoodFacts junk-entry complaints at $0.
11. **Full micronutrient panel** `[acquisition-hook, niche]` · $0 (needs richer DB) · cross-platform — Cronometer's differentiator; appeals to a serious sub-segment. Low cost if the curated DB (candidate 10) lands, but off Ignia's kcal+protein focus.
12. **Social challenges / community** `[retention-loop]` · $–$$ · cross-platform — Lose It!/Cal AI/MFP use it for stickiness, but it needs a server + moderation — conflicts with cloud-cost-aversion. Flag as high-cost.

### "We give away what they paywall" angle (Ignia's existing free features vs. competitor paywalls)
- **Barcode scanning** — free in Ignia; **Premium-only in MyFitnessPal** (their biggest review backlash). Strong marketing wedge.
- **Voice / natural-language logging** — free in Ignia; **Premium in MyFitnessPal, Gold-only in Cronometer.**
- **AI coach** — free (Gemini) in Ignia; Cronometer's "Crono Coach" is **Gold-only**; MacroFactor has **no free tier at all.**
- **Fasting timer** — free in Ignia; **Gold-only in Cronometer.**
- **Full workout/Train tab, body-fat, measurements, progress photos, weekly reports, streak-freeze** — free in Ignia; comparable analytics are paid in MacroFactor/MFP.
- Positioning line: *Ignia ships free the exact features (barcode, voice logging, coach, fasting, adaptive insights) that MyFitnessPal, MacroFactor, and Cronometer put behind $60–100/yr paywalls.*

### Caveats / unverified
- Cal AI food-DB size, pricing tiers, and any health integration are **unverified** on primary pages (integration appears **absent** from its App Store listing).
- Lose It! "Snap It = Premium" is secondary-sourced (loseit.com/Play blocked fetch).
- MFP streak/reminder mechanics and exact Voice-Log-vs-Meal-Scan free/paid split not fully confirmable on non-403 support pages.
