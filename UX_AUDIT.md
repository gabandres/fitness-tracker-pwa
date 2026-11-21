# Ignia — UX Audit

> Updated: 2026-11-19 — cut from 1,075 lines to the open backlog on this date. Shipped items, score narratives and correction stacks were deleted; outcomes are in `CHANGELOG.md`, reasoning in `docs/adr/`, the full text in `git log -- UX_AUDIT.md`.

The **open UX backlog** for Ignia, and nothing else. §S13 is the launch-readiness checklist. Past audit sections survive as two-line stubs so references elsewhere in the repo (`§S16`…`§S23`, `F0`–`F7`, `N5`) still resolve. **Status legend:** `[ ]` open · `[~]` in progress · `[-]` decided against. When an item ships, delete it here and record the outcome in `CHANGELOG.md`.

---

## 2. Strengths to preserve

- Log-first layout — capture before analytics.
- Many paths to the same form (preset, barcode, photo, webhook).
- Adherence-neutral colors (no red/green shaming).
- Signals everywhere; views never stale after mutations.
- SwUpdate banner + 5-min poll keeps users on latest.

Don't regress these while fixing below.

---

## 🎯 S12 — Market-informed strategic direction (2026-04-17)

Positioning: **"The calm, private macro log with an AI coach that actually reads your data."** — calm (vs shame-based MFP), private (trust moat), log (editorial, not gamified), coach that reads your data (photo-AI *and* adaptive TDEE; no competitor does both). Weeks 1–3 of the backlog shipped.

#### Week 4 — market signals
- [ ] Play Store TWA wrap for discovery. *(Likely moot: it wraps the PWA, which ADR-0036 retired, and the native Android app is on Play. Owner to confirm and delete.)*
- [ ] One creator collab for "calm macro log" TikTok angle.

Market research sources:
- [Best Macro Tracking Apps Compared 2026](https://www.macronutrientcalculator.org/blog/macro-tracking-apps/)
- [MyFitnessPal Premium Cost 2026](https://healthfitpublishing.com/myfitnesspal-premium-cost-is-macro-tracking-worth-it-in-2026/)
- [MacroFactor Review 2026 — Outlift](https://outlift.com/macrofactor-review/)
- [How top subscription apps approach paywalls — RevenueCat](https://www.revenuecat.com/blog/growth/how-top-apps-approach-paywalls/)
- [Paywall tactics for health apps — Adapty](https://adapty.io/blog/paywall-newsletter-22/)
- [App Retention Benchmarks 2026](https://enable3.io/blog/app-retention-benchmarks-2025)
- [Two Teens Built Cal AI — Slashdot](https://slashdot.org/story/25/04/04/2338220/two-teenagers-built-cal-ai-a-photo-calorie-app-with-over-a-million-users)

---

## 🚀 S13 — Public-launch readiness (2026-04-18)

The launch-readiness checklist: what stands between "deployed" and "safe to share with strangers". Every hard blocker and all but one soft/advised item shipped (Stripe items are history: the extension was removed 2026-08-31). The app is live on both stores; what gates wider promotion now lives in `STATUS.md`. Since ADR-0036 the launch surface is the two store apps plus the `ignia.fit` shell and `/admin`.

### 💪 Strongly advised
- [ ] **Support inbox + SLA.** Provision a real support address and state a 30-day response SLA in the privacy policy. Not `support@macrolog.app` (pre-pivot domain, does not exist); the org address is `gabriel@bermudezsystems.com` (Microsoft 365).

### 🔧 Engineering cleanup
- [ ] **Staging environment on a separate Firebase project.** Deploys go straight to prod; the dev app also talks to prod Firestore.
- [ ] **Function-handler unit tests** for `sendDayThreeCoachPush`, `publishUserCount`, `generateWeeklyReport`, `analyzePhoto`, `exportUserData`, `deleteAccount` (needs `firebase-functions-test` + admin-SDK mocking).

### Decided against (deliberately not shipping)
- [-] **Shame-based gamification** (streak-break punishment, red/green progress). Narrowed 2026-08-29: a *retrospective record* is allowed (**Milestones**, never "achievements"/*Logros*/*Conquistas*; earned only, never the locked remainder, no countdown, cannot be revoked); *forward pressure* is rejected. Enforced by `packages/core/src/milestones.test.ts` and `apps/mobile/src/__tests__/milestones-copy.test.ts` — those tests are the decision.
- [-] **Third pricing tier** ($7.99/mo "Pro+") — revisit at 1,000+ active users.
- [-] **Forced account creation before first log** — Guest Mode (N5) is the fix if Day-1 retention data warrants it.
- [-] **ToS legal review** — closed 2026-09-17: its trigger was auto-renewal language, and no subscription exists (any paid tier goes through Apple/Google IAP). Re-open with a paid tier.

---

## 🧭 S15 — Competitive roadmap backlog (2026-08-07)

From `docs/research/competitive-feature-scan.md`. Shipped and not to be re-scoped: Health sync, widgets (N4, N4b), Watch, Siri/Quick Settings tile (N1), bundled USDA DB (N2), photo-scan grounding (N2b), fasting Live Activity (N3), recipe import, adaptive TDEE, nudges, streak + freeze, barcode, voice, AI coach, chain-restaurant data (N6).

- [ ] **N5 · Guest mode / log-before-signup.** Forced signup before the first log is the standard freemium leak; "no account needed" carries the privacy pitch. Revisit against real D1 retention data (`STATUS.md` lever 6).
- [-] **N6 remainder · Starbucks/Chipotle-style build-your-own drinks** need a licensed menu source; never invent macros (fabricated health data is worse than no result). *(The 2026-08-12 entry said Starbucks had 0 rows and Chipotle 3; `CHANGELOG.md` 2026-08-24 later added 25k items from 91 chains incl. Chipotle.)*
- [-] **N7 · Full micronutrient panel (80+).** Deferred: off the kcal+protein focus; Cronometer owns the niche.
- [-] **N8 · Social challenges / community.** Not planned: needs a server + moderation (cost discipline) and gamified competition contradicts "calm".

### From a real user — Abdiel Medina, 2026-08-21

Reported in Spanish over chat against the live Android build: the speed dial stayed open over the scan result; *"no se le puede añadir un custom mode que la persona misma pueda poner la cantidad que quiere?"* (custom calorie goal); and *"una parte de feedback in-app para que por shy te escriban sugerencias"* (the social barrier, not the channel). All three resolved — `CHANGELOG.md` 2026-08-22. Nothing open.
- [-] Custom-target input floor of 1,200 — decided against: `dailyTargets` clamps at `calorieFloor` (1,500 default), so a lower input would be stored and silently overridden.

### From a real user — "not intuitive for women", relayed 2026-08-22

She said she needs **a tutorial or walkthrough** of the app; the owner's framing: men tend to start tapping and figure it out. GenderMag (Burnett et al.) finds learning style — **tinkering vs. process-oriented** — clusters by gender statistically, not individually, so the fix is an orientation path anyone can take, **never a gender-branched UI**. Durable rules: a guided path with an order and an end; show the whole map first; say what is reversible; replayable and skippable.

Findings **F0–F7** (F0 tutorial/tour, F1 sex-blind calorie seed, F2 Mifflin inputs at onboarding, F3 kilograms, F4 "Search foods" naming, F5 + button over the empty-state CTA, F6 glossaries on Today/Trends, F7 signed pace for "gain") all shipped 2026-08-22 — `CHANGELOG.md` 2026-08-22. Still open: whether *she* finds it intuitive now — no follow-up from her is recorded.

---

## 🎨 S16 — Full-app design audit (2026-08-31)
96 device screenshots + code audits; verdict "foundation strong, drift". 3 fixes + all twelve S16-1…S16-12 judgment calls shipped 2026-08-31 (`fcdcea07`, `534b55c2`; Android OTA 96 / iOS OTA 60) — not in `CHANGELOG.md`, see the list at the bottom.

## 🏋️ S17 — Train module UX overhaul (2026-09-16)
S17-1…S17-7 shipped, OTA'd 2026-09-17 — see ADR-0041 and `CHANGELOG.md` 2026-09-16.
- [-] **S17-8 · Continuous scroll instead of the accordion** — owner 2026-10-07: keep the accordion (load-bearing for nine exercises at 360dp). Revisit only if the complaint survives.
- [ ] **S17-9 · A real program entity with ordered days.** Needs a new entity, editor and migration; `nextTemplateUp` covers rotation statelessly, and a program would replace that one function. Not urgent.

## 📏 S18 — Scored UX audit against 2026 standards (2026-09-28)
Rubric: Usability 25 · A11y 20 · Platform 15 · Visual 15 · Perf 10 · Copy 10 · Delight 5 (reused by S19–S23). Scored **69/100**; all eighteen S18 items shipped — `CHANGELOG.md` 2026-09-28. Preserve: `lib/motion.tsx` accessible motion, offline-first adds with honest dedupe, self-explaining validation, teaching empty states, PREVIOUS column.

## 📏 S19 — Today + add-meal re-scored to 9+ (2026-10-04)
Baseline 74.5 / 68.6 → shipped **91.1 / 90.3** (`4773b4b1`) — `CHANGELOG.md` 2026-10-04.
- [ ] **Device QA never run:** in-app camera (`onCameraReady` + 2 s fallback), per-field iOS KeyboardBar, a confirm presented from inside an open sheet, `sendAccessibilityEvent` focus moves, in-panel toast elevation on Android.

## 📏 S20 — all five tabs re-scored for 1.2.5 (2026-10-05)
Round 3: Today 89.8 · Add-meal 90.4 · Train 85.3 · Trends 83.8 · Body 82.8 (round-3 fixes not re-scored) — `CHANGELOG.md` 2026-10-05.
- [ ] **Android 16 large screens ignore the portrait lock, with no width cap on Today** (from the Impeccable native audit; its other open item, ⋯ menu subtitles, shipped in vc 48).
- When running the Impeccable audit, hand it the recorded decisions — raised +, brand fonts, predictive back off, no iPad, no Material You — or ~9 come back as defects.

## 📏 S21 — whole-app audit, six reviewers incl. the first on-device pass (2026-10-06)
Weighted code score **83.5**, ~**81** after blending the simulator pass; fixes shipped OTA — `CHANGELOG.md` 2026-10-06. Lesson: code-only re-scores ran 3–6 points hot against rendered screens.
- [ ] **Real VoiceOver / TalkBack pass** (placeholder hints in Train, focus moves) — same work as S23-9.

## 🤖 S22 — the first Android pass on the S21 work (2026-10-06)
Emulator pass found Android does not resize for the keyboard under `<KeyboardProvider>`; fixed in vc 48 + OTAs, remainder closed 2026-10-07 incl. a OnePlus 8T hardware pass — `CHANGELOG.md` 2026-10-06 / 2026-10-07. *(S21's open list still said "a hardware pass is still owed"; S22's 2026-10-07 close supersedes it.)*

## 🏋️ S23 — Train tab scored against 2026 standards, two passes (2026-10-12): 72.3 → 81.6 → 83.9
Rubric `docs/research/train-ux-standards-2026.md`, scored from rendered captures — `CHANGELOG.md` 2026-10-12 (both entries). JS alone reaches ~87–88; 9.5+ needs the items below plus a native build and a device a11y pass. Evidence lived in `apps/mobile/.maestro/capture/train-ux/` on `ignia-mac` (not in git; that Mac was sold 2026-11-13).

### Open — JS
- [ ] **S23-2** Android keeps the branded confirm over native sheets; a device check decides whether it moves to the system dialog too.
- [ ] **S23-3** AX5: "Sets | Clust…" label; "TOP WEIGH/T"; home hero pills overflow; one-line rest bar over a card. Re-capture the post-capture fixes (Finish tiles, exercise-detail Delete row, card title cap).
- [ ] **S23-5** Myo-rep rows still read 1a/1b/1c; "REPEAT — couldn't judge last time" shows twice.
- [ ] **S23-6** Editor: ↑↓ row doubles a collapsed card's height; More options is a third level; title close to Cancel; set row is 5 focus stops (grouping waits on S23-9).
- [ ] **S23-7b** Android Maestro flows 16/22 can't find their lift past the 5-row inline catalog (`CATALOG_INLINE`, `StartView.tsx`) — use Browse all; 18's keyboard-dismiss tap expands Template options; 18's drag workaround can go. Flow maintenance, not app bugs.

### Open — native build
- [ ] **S23-8** Whole-workout Live Activity / Android notification with lock-screen **Done set**; Android 16 promoted Live Update with −30/+30/Skip. Needs the device script in `FIX-N2.md`.

### Open — device
- [ ] **S23-9** Owner's VoiceOver + TalkBack pass (checklist `DEVICE-A11Y-CHECKLIST.md`, was on `ignia-mac`); then group the set row; measure tick feedback and cold paint on a mid-range Android.

### Owner calls still open
- [ ] **S23-13 (rest)** Red on status surfaces ("WORKOUT IN PROGRESS"); "Next up" picks never-done templates first.

---

## 🧭 S24 — "Is it hard to understand?" — comprehension audit + market refresh (2026-11-19)

**Different question from S18–S23.** Those scored conformance (a11y, platform, visual). This one asked whether a first-time, non-expert user understands the app, and what solid competitors have that Ignia lacks. Five reviewers read every surface in code plus the 2026-10-12 simulator captures; two surveyed the market (`docs/research/competitive-feature-scan.md`, 2026-11-19 addendum). **Not run on a device** (no Mac, no simulator), and the production sample is 43 signups — treat tap counts as measured in code, percentages as small-sample.

**Verdict.** On the right track where it counts: logging is 2 taps with no wait (search, typed kcal, preset), every write has Undo, the glossaries are plain, and the market moved toward Ignia's position this year (MyFitnessPal's Today redesign, Yazio's 78-step onboarding and Cal AI's subscription wall all drew backlash). **The gap is not features. It is that a new user is stopped before the first log, lands on a screen that does not point at the next action, and reads the owner's vocabulary.** Difficulty for a novice: logging easy · Today / Body moderate · Trends, Train, Settings hard. Every item below is JS (or rules) and ships by OTA.

### Scored against current standards (same day, second pass)

Rubric: `docs/research/app-ux-standards.md` — 92 rules A1–A92 read from primary sources on 2026-11-19 (Apple HIG for iOS 27, Android / Material 3 at target API 36, WCAG 2.2 AA, store policy, plain-language guidance), §S18 weights; Train also against `train-ux-standards-2026.md`. **Every score is CODE-ONLY** — no Mac, no simulator, no Android SDK on `winbox` — and §S21 found code-only scores 3–6 points above rendered ones. This rubric is stricter than October's (48 dp on Android, visible field labels, units and plain words on every number), so the totals are **not** a like-for-like drop from 83.5.

| Surface | Code-only | Lowest dimension |
|---|---|---|
| First run | 75.0 | Accessibility 6 (placeholder-only labels on sign-in; 33–40 pt links) |
| Today | 79.5 | Accessibility 7.5 |
| Add-food sheet + scan | 73.5 | Accessibility 6.5, Platform 6.5 (26–30 dp fields; scan controls in the home-indicator band) |
| Trends | 75.5 | Visual 7, Copy 7 |
| Body | 77.8 | Copy 7 |
| History | 69.5 | Accessibility 6 (colour-only dots; unit-less rows) |
| Train: home / logger / editor / finish | 81.5 / 81.0 / 79.3 / 83.0 → **81.2** | Editor Usability 7 |
| Settings + shell | 75.0 | Accessibility 7, Platform 7, Copy 7 |
| **Whole app, §S21 usage weights** | **≈ 77** (rendered would read ≈ 71–74) | |

**Train eroded.** 81.2 code-only against 83.9 *rendered* on 2026-10-12 means roughly 75–78 rendered: five weeks of additions (kg|lb, plate #, Gym busy, time cap, home-plan cards) put up to seven notes and switches above the first exercise, with new controls under 48 dp and spoken names that do not contain their visible text.

Measured, whole app: locale parity 2,755 keys × 3, 0 missing · roles and labels 0 missing (matches `a11y-roles.test.ts`) · reduce-motion 0 bypasses · 454 pressables, 0 under 44 without `hitSlop`/`TARGET`, but 8 use a literal 44 (4 dp short on Android) · contrast under the bar and **not pinned by `theme-contrast.test.ts`**: light `warn` on `tealSoft` 4.39, dark `faint` on `tealSoft` 4.04 and `danger` on `tealSoft` 4.20 (text, need 4.5); light `ring` 2.70, `protein` 2.89, `carbs` 2.04, `habitFasting` 2.85 (non-text, need 3.0).

**S24-20 … S24-26 shipped 2026-11-19** (`d9cb2e9a`, OTA on iOS build 75 + Android vc 53 — `CHANGELOG.md`), with the wrong-copy half of S24-7. Not seen on a screen before publishing; the owner's phone check is the first rendered look. What that batch left:

- [ ] **S24-27 · Left over from the sweep, all OTA.** **Done 2026-11-20 (`12ad5720`):** `GymBusyPanel` rows are `TARGET` tall; the two Quick add failure notes name no tile; sleep hours use the decimal keypad; the tour says its step once; `train.plateHead` and `recipe.invalidNumbers` are gone. Since `cae457e0` the spoken labels in food search, the diary, Quick add and the scan totals say grams with a singular ("1 gram of fat", `spokenGrams`), and the six spoken strings that said "kcal" say calories. **Still open:** chart descriptions were added to the three line charts only, not the sleep / fasting / water / budget strips. Deleting a fast still confirms where meals get Undo (`addFast` mints a new id, so undo would not restore a timer fast). No Increase Contrast handling (A19). Hero number capped at 1.2× text size (A14). Finish can chain three confirms. No "check with a doctor" line where targets are set (A73, Settings only).
- [ ] **S24-28 · Portrait lock vs WCAG 1.3.4 (AA).** An `app.json` value: waits for a binary. ("Not now" on pre-permission screens and the two hero rings were decided as keep, ADR-0049.)
- **Blocked on a binary:** the camera purpose string says barcodes only (photo scan uses it too) and the Health read string omits steps, active energy and workouts — **store-policy accuracy, fix in the next build of either platform**; the portrait lock is ignored at ≥ 600 dp on Android at API 36, so large-screen layout is unverified; predictive back; confirming the shipped `targetSdk` from the artifact.
- **Needs a device, not scored as passes:** real VoiceOver / TalkBack, clipping at 200 % / AX5, edge-to-edge scrims, keyboard reveal, paint and tick timing. No reader test of the copy exists (A65).

### Batch 1 — activation (the measured problem: 33% ever log, 34 min to the first one, 0 of 43 reminders)

**Shipped 2026-11-19 (`af651bff`, S24-1…4 + tracker switches; `CHANGELOG.md`).** Checked after publishing with a fresh unverified account: onboarding with no wall, first-meal card, a logged meal, the reminder card, Scan and Coach locked, and `analyzePhoto` refusing the account server-side. Re-measure "ever logged", time to first log and reminder opt-in two weeks after vc 53 is live. Left open:
- [x] **S24-1b · Welcome mail for an account that verifies after onboarding** — shipped 2026-11-20 (`bff138f8`, `functions/src/late-welcome.ts`, run by `hourlyTasks`): profiles completed 30 minutes to 14 days ago with no `welcomeEmailSentAt`, whose Auth record is verified and was itself created in those 14 days. A read-only dry run before the deploy found one candidate, a 126-day-old account that had been through onboarding again; the account-age rule exists because of it. Nobody was mailed by the first run.

### Batch 2 — legibility

**Shipped 2026-11-19 (`7ebe7c86`; `CHANGELOG.md`), checked rendered in a browser.** **Left open:**
- [ ] **S24-5 · Trends, what is left.** Below 3 logged days the three charts still draw empty under the checklist. No reader has seen the answer sentences.
- [ ] **S24-6 · Names, what is left.** "Volume" is weight × reps in the glossary and sets per muscle on the link; "Safety floors" / "minimum" / "floor"; es-PR "Volumen" is both the bulk phase and training volume; pt-BR "Cutting/Bulking"; the three two-line strings that said "burn" say maintenance since `12ad5720` (`today.addToSlotA11y` was checked: "Slot" is only in the key, the label says the meal).
- [ ] **S24-8 · "Day fully logged?"** still shows for an existing account before the measured number exists. Today does not hold the estimate's source; pass it down, then hide the row until then. **Left alone 2026-11-20, now an owner call:** the answer feeds the measurement (a day under 1,000 kcal counts only when marked fully logged), so hiding the row until the number exists would slow the number down for someone eating little.
- [ ] **S24-9 · Photo review is a form, not a confirm.** NOT STARTED, on purpose: it restructures the one AI-cost screen (28 test references), the median of `secsPerLog` has not been read, and nothing renders here to check it. Up to seven decisions after the model returns (name, per-item name and grams, add an item, portion, meal, time, another angle; `scan.tsx`). Add is already pinned in the footer. Fix: total + read-only items + Add, everything else behind one "Adjust".
- [ ] **S24-10 · Settings, what is left.** Two doors for targets: Daily targets shows the goal but cannot change it; Refine changes it but does nothing visible for a Custom user — put the goal picker on Daily targets and Safety floors there as "Minimums". The phase caption no longer says "cluster" (`12ad5720`). The build / bundle line stays in About on purpose: it is the only way to tell which OTA a phone is running.
- [ ] **S24-11 · Smaller, what is left.** Diary rows: Move to meal and Copy to today exist only behind long-press and swipe — add a ⋯ (needs a rendered check: it changes every row). History: reached by an unlabelled calendar icon; dots do not say over/under. Body: the weekly sleep chip. Recipe builder has no food lookup (`RecipeBuilder.tsx`; `MealText` already resolves foods). Camera and barcode appear twice in the add sheet. Coach is reachable only from Trends.

### Batch 3 — Train for someone who is not the owner
**Shipped 2026-11-19 (`2cd8511c`; `CHANGELOG.md`), checked rendered in a browser.** Every call opens with a plain sentence (a first session says how to pick a weight); form cues open from "How to do it" on the card; starters offer "Push / Pull / Legs" as one plan and each says its muscles and sets × reps; the kg | lb switch, the flat-reps question and "Gym busy" appear only where the lift or the account uses them; the glossary gained PREV, Gym busy, calibration, deload, rotation and Zone 2. **Left open:**
- [ ] **S24-12 · What is left.** (The cues are in the exercise detail sheet since `12ad5720`.) A lift with no progression rule and no history shows no first-time sentence (the sentence rides the engine's FIRST SESSION call).
- [ ] **S24-13 · What is left.** No picker (goal · days a week · equipment → a plan): the seeds have one variant each, so there is nothing to pick between until home / dumbbell-only versions exist. Starter rows do not show the days a week except Full Body.
- [ ] **S24-14 · What is left.** A lifter without a `gymBusy` template cannot turn "Gym busy" on at all (no editor switch writes the flag). The owner's cluster split still ships as a starter, last and tagged Advanced.
- [ ] **S24-15 · What is left.** The numbers still show under the plain sentence rather than behind a tap (kept: the note is the owner's most-read surface and collapsing it was not checked on a phone). Call labels do not open their glossary entry.

### Batch 4 — what the market has that Ignia lacks, OTA-able
**S24-16 and S24-17 shipped 2026-11-20 (`3762bca3`; `CHANGELOG.md`), checked rendered in a browser.** A past day in History has "Log again…": a checklist of its entries, added to today with one receipt and one Undo. Settings → Import reads a Hevy or Strong workout CSV and writes completed sessions. **Left open:**
- [ ] **S24-16 · What is left.** Only from a past day's own screen: no search across days ("that chicken bowl from last month"). (Each row says its meal since `12ad5720`.)
- [ ] **S24-17 · What is left.** (Tested against real exports 2026-11-20, `a1d8a64e`: a 7,211-row Hevy file and four Strong files, the two big ones imported end to end. A set marked "failure" imports as RIR 0.) Since `12ad5720` a lift matches by exact name, then by the same words in any order when exactly one of the account's lifts has them ("Bench Press (Barbell)" → "Barbell Bench Press", "Pull Up" → "Pull-Up"); only lifts ALREADY in the account are candidates, not the whole starter library, and the preview does not list which names were matched. No cardio, supersets or notes are carried. A workout over 40 lifts is cut to 40 (the rules' limit).
- [ ] **S24-18 · Exercise stills.** BLOCKED on a licence (looked again 2026-11-21): `yuhonas/free-exercise-db` is Unlicense for its data, and the issue asking what licence its images carry is unanswered; the Everkinetic / wger images are CC BY-SA 3.0 or 4.0 with per-image attribution and mixed origins. Shipping either means the owner accepting attribution and share-alike. Stills via `expo-image` are OTA (served from hosting, they would not grow the bundle); video is native (`expo-video` is not in the binary). The form cues are on the card since batch 3.
- [x] **S24-19 · The GLP-1 set — built 2026-11-20.** Protein-first mode (`9ed28fa5`); then, the same day: a **medication log** (dose days, what was logged, a reminder; on the phone only, removed on sign-out, with a Share log action), **protein first on Trends and the Android widget** (one core function decides the mode for a day; the iOS widget is native and unchanged; the share card has no calorie number), and an **AI label scan** into a custom food (a mode of `analyzePhoto`, on the photo scan's daily scans and spend ceiling). `CHANGELOG.md` has the detail. **Unseen on a device: all three.**
- **Blocked on a build, so parked:** Apple Watch food and workout logging (the reason lifters name for switching apps), a share extension, Control Center / Smart Stack, exercise video, S23-8.

**Keep (reviewers' lists agree):** the 2-tap ⊕ against the on-device index and "Food or kcal" in one field; Undo on every write; the first-log step that opens the add sheet; Next up + PREV + tick-to-accept; RIR asked only for lifts that use it; locked tiles that say what unlocks them; the replayable tour; the non-judgmental voice (no shaming copy was found).

**Not worth copying:** a paywall before the first log, streak-restore as a purchase, hiding the diary behind a "Today" feed, free-tier caps on routines and history, a generator that overwhelms beginners.

---

## 5. Notes for future additions

- When adding a new surface, check it against: (a) does copy work for a first-time user; (b) is every icon-only button labelled; (c) does it announce state changes via `aria-live`.
- The "Personal Calibration Log" aesthetic is the differentiator — preserve it in *typography and frames*, not in *function-gating* words.
- A feature claim inside a lifecycle email is a promise to every future signup: check it against the flags, not memory.
- Before treating an unticked box here as open work, check the code: this file has listed finished work as pending at least five times.

---

## Shipped, not in the changelog

- **S14 feature declutter (web, 2026-06-14, `c824b99d`)** — Trends Weekly panel + Coach panel; web code since retired (ADR-0036). Mobile one-Nudge gate (`useTodayNudge`) shipped 2026-08-12.
- **S16 design audit (2026-08-31, `fcdcea07` + `534b55c2`)** — unformatted numbers, dingbats → Ionicons, S16-1…S16-12 (light accent vs danger, short What's-new, single FAB on day detail, calendar legend, case drift, habit-shortcut scroll, sheet dismiss idiom, measurement labels, USDA badge, branded ConfirmSheet, es-PR "preset", "Ignia estimates").
- **Maestro findings (2026-08-09)** — Coach quota visible on mount (reads own `consultationQuota` doc); failed dictation start shows `voice.failed`.
