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

- [ ] **CF: `scanMeal`** — accepts an image, calls Gemini Flash for
      **items + portions only**, returns `{items:[{name, grams, confidence}]}`.
      Key stays server-side. Model prompt forbids emitting macros.
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

- **Progress** = fold **Body** (weight/goal/progress-photos) + **Trends**
      (charts) into one tab.
- **History** = calendar + day detail (done; Tier-2 copy pass landed).
- **Home** = kcal+macro rings, streak, today's items, camera CTA (from Today).
- **Train** = keep as-is (the differentiator).

## 4. Surface area — 4 tabs + camera + settings

`Home | Train | 📷 Camera | Progress | History` · Settings on header avatar.
Archive **Coach** (retain code; disable route/tab) → return as **Pro**.

## 5. Retention — local-first smart nudges

- [ ] Extend `apps/mobile/src/lib/reminders.ts`: 1 daily → **3 meal-window
      nudges + evening streak-at-risk nudge** (opt-in, configurable).
- [ ] **Smart reschedule** on app-open / after each log: skip logged windows;
      cancel streak nudge once today's first log lands.
- [ ] **Streak milestones** (7/30/100) local congrats.
- [ ] **Streak-freeze** (`freezeMaxGap`) = Pro perk.
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
