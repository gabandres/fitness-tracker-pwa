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
- [ ] **S23-14** After collapse/re-expand, the ‹ › Done keyboard bar no longer attaches (`KeyboardBar.tsx`, `SetRow.tsx`).
- [ ] **S23-15** Deleting a finished workout leaves that day's "exercise completed" food-log entry (`ledger.ts` ~2183).

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

- [ ] **S24-27 · Left over from the sweep, all OTA.** Screen-reader labels in `FoodSearch.tsx` and the `trends.*A11y` keys still say "g protein" / "kcal"; the new spoken keys have no singular ("1 grams of fat"). `GymBusyPanel` rows have no `TARGET` height. `settings.quickAddSignedOut` / `quickAddNoSlot` still name the Android tile on iOS. The sleep-hours field uses the `numeric` keypad. The tour reads "Step n of m" twice (counter + dots). Chart descriptions were added to the three line charts only, not the sleep / fasting / water / budget strips. Deleting a fast still confirms where meals get Undo (`addFast` mints a new id, so undo would not restore a timer fast). No Increase Contrast handling (A19). Hero number capped at 1.2× text size (A14). Finish can chain three confirms. No "check with a doctor" line where targets are set (A73, Settings only). Unused keys: `train.plateHead`, `recipe.invalidNumbers`.
- [ ] **S24-27b · Contrast — owner call, not a bug.** The three text pairs under 4.5:1 (`warn`, `faint`, `danger` on `tealSoft`) are **not rendered anywhere** (checked 2026-11-19), so nothing changed. The non-text ones are brand and chart colours in the light theme: `ring` 2.70 (the + button fill, the weight line), `protein` 2.89, `carbs` 2.04, `habitFasting` 2.85 against a 3.0 bar. Moving them is a design decision (§S21 kept the accent).
- [ ] **S24-28 · Owner calls from the rubric.** Pre-permission screens carry "Not now" beside the action (HIG asks for one button; the two-button form is what keeps the one-time iOS prompt unspent) — record as a decision or change. Portrait lock vs WCAG 1.3.4 (AA). Hero rings' resemblance to Apple's Activity rings (A77).
- **Blocked on a binary:** the camera purpose string says barcodes only (photo scan uses it too) and the Health read string omits steps, active energy and workouts — **store-policy accuracy, fix in the next build of either platform**; the portrait lock is ignored at ≥ 600 dp on Android at API 36, so large-screen layout is unverified; predictive back; confirming the shipped `targetSdk` from the artifact.
- **Needs a device, not scored as passes:** real VoiceOver / TalkBack, clipping at 200 % / AX5, edge-to-edge scrims, keyboard reveal, paint and tick timing. No reader test of the copy exists (A65).

### Batch 1 — activation (the measured problem: 33% ever log, 34 min to the first one, 0 of 43 reminders)

**Shipped 2026-11-19 (`af651bff`, S24-1…4 + tracker switches; `CHANGELOG.md`).** Not seen on a screen before publishing. Re-measure "ever logged", time to first log and reminder opt-in two weeks after vc 53 is live. Left open:
- [ ] **S24-1b · A user who finishes onboarding before verifying never gets the welcome mail** — `sendWelcomeEmail` fires once, on the completion flip, and now skips an unverified address. Fix: a sweep in `hourly-tasks.ts` for completed profiles with no `welcomeEmailSentAt` whose Auth record has since verified.
- [ ] **S24-1c · Unverified accounts now count** in retention cohorts, admin signups / activation and the public user count (`publishUserCount`), which bulk signups could inflate. Decide whether the public number counts verified accounts only.
- [ ] **S24-1d · Leftovers.** Comments in `lib/auth.tsx` and `lib/persisted-session.ts` still describe the wall. Dead keys: the eight `onboarding.reminders*`, `onboarding.saveErrVerify`. An unverified comped address still shows the comped badge while its AI calls are refused. From S24-4: the optional goal-weight step is still in onboarding, `onboarding.tagline` is still in the dictionaries, and the Plan step still shows protein with no reason.

### Batch 2 — legibility
- [ ] **S24-5 · Trends opens on a method, not an answer.** First read is "Maintenance estimate 2,665 kcal" + MEASURED/FORMULA badge and five lines of method (±95% range, blended, completeness, outliers). Fix: one sentence on top from values already computed ("losing about 0.5 kg a week, eating 150 under target"); method text behind the existing "About your maintenance" sheet; below 3 logged days show a checklist ("Log food 3 days · Weigh in twice") instead of empty charts; label the weight readout "−1.2 lb over 3 months", not "Trend" (Body's "Pace" is per week).
- [ ] **S24-6 · One concept, several names.** Maintenance is also "measured burn", "what you actually burn", "maintenance estimate", "Profile estimate → measured"; target is also "goal"; saved foods are Quick add / My Foods / preset / Slot / recipe; "Volume" is weight × reps in the glossary and sets per muscle on the link; "Safety floors" / "minimum" / "floor". Keep: **maintenance · target · left / over · entry · Quick add + My Foods · workout + template · minimum**. Drop "preset", "Slot", "engine", "burn". Same pass in es-PR ("Volumen" is both the bulk phase and training volume; two names for Quick add) and pt-BR ("Cutting/Bulking").
- [ ] **S24-7 · Copy that is wrong — what is left.** (The Health privacy line, the below-minimum error, the iOS tile wording, `connected.intro` and `signIn.errWrong` shipped 2026-11-19.) The RIR glossary says "nothing else in the app depends on it" while Finish reads a blank as 0. Five non-actionable errors ("Lookup failed.", "it was refused", "Something went wrong").
- [ ] **S24-8 · What is left of the tracker switches** (the switches and the new-account defaults shipped 2026-11-19): "Day fully logged?" still shows for an existing account before the measured number exists. Fix: hide it until then.
- [ ] **S24-9 · Photo review is a form, not a confirm.** Up to seven decisions after the model returns (name, per-item name and grams, add an item, portion, meal, time, another angle; `scan.tsx`). The model is ~3–7 s; the rest of the 80 s is framing plus this screen. Fix: total + read-only items + Add, everything else behind one "Adjust". Read the median of `secsPerLog` first — it is a mean capped at 300 s.
- [ ] **S24-10 · Settings shows the owner's program to everyone.** Volume gate, "cluster", dumbbell-step switch, auto-apply and a training Phase that defaults to **Cut** regardless of the diet goal (`core workout.ts` `DEFAULT_TRAINING_PHASE`); Watch diagnostics and the bundle id line; two doors for targets (Daily targets shows the goal but cannot change it; Refine changes it but does nothing visible for a Custom user). Fix: one "Advanced training" group hidden until a template exists; phase follows the goal; diagnostics behind taps on the version line; goal picker on Daily targets, Safety floors there too as "Minimums".
- [ ] **S24-11 · Smaller.** Diary rows: Move to meal and Copy to today exist only behind long-press — add a ⋯. History: reached by an unlabelled calendar icon; rows show a bare "1,850"; dots do not say over/under. Body: body fat + measurements always shown — collapse to one "Track measurements (optional)" row until first use; drop the sleep chip and the "(Nedeltcheva 2010)" citation. Recipe builder has no food lookup (`RecipeBuilder.tsx`; `MealText` already resolves foods). Camera and barcode appear twice in the add sheet. Coach is reachable only from Trends.

### Batch 3 — Train for someone who is not the owner
- [ ] **S24-12 · Nothing says how to train.** A first set is refused until a weight is typed and nothing says how to pick one; ~70 seeded lifts ship form cues in three locales that are visible only in the template editor's More options. Fix: on a no-history card, "Pick a weight you can lift 10 times with 2 left in the tank; Ignia adjusts from there"; cues as a collapsible "How to" on the card and in the exercise detail sheet.
- [ ] **S24-13 · No plan is offered.** Starters are separate adds showing a name, a count and three lift names — not sets × reps, days, or the template's own notes. Fix: a "Push / Pull / Legs" bundle row with notes, then a rule-based picker (goal · days a week · equipment → a bundle). No generative AI.
- [ ] **S24-14 · Advanced prompts reach novices.** The flat-reps warning ("are these sets close to RIR 0?") fires after two sessions of tick-to-accept; "Gym busy" renders on every session with 2+ lifts; a kg|lb switch sits on every weight card and saves on a stray tap; the owner's cluster split (Paramount machines, "This REPLACES vertical Smith bench") ships as a starter. Fix: gate each on the lift's own data (`liftUsesRir`, template `gymBusy`, `unitByGym`), move the cluster starter out.
- [ ] **S24-15 · Recommendation notes lead with numbers.** "{reps} reps, but {next} (+{pct}%) predicts only {predicted} — under {min}. Build reps first." Fix: a plain verb sentence first ("Same weight, aim for one more rep"), numbers behind a tap. Glossary gains deload, Zone 2, calibration, rotation, PREV, Gym busy; call labels open their entry.

### Batch 4 — what the market has that Ignia lacks, OTA-able
- [ ] **S24-16 · Re-log from history with multi-select** (FoodNoms, Cronometer "repeat items"). Ignia has Repeat yesterday and per-meal copy; per-item re-log from any past day is missing.
- [ ] **S24-17 · Import a Hevy / Strong CSV.** Switchers bring history; MacroFactor Workouts cannot import. `expo-document-picker` is in the binary.
- [ ] **S24-18 · Exercise stills.** Every serious logger ships how-to media. Video is native (`expo-video` is not in the binary); stills via `expo-image` are OTA. `yuhonas/free-exercise-db` is Unlicense but its image provenance is unstated — **check before use**. S24-12's cues come first and cost nothing.
- [ ] **S24-19 · Owner calls, not queued.** A GLP-1 / protein-first mode (MyFitnessPal, Lose It!, MyNetDiary all shipped one in 2026; Ignia is already protein-first — mostly positioning plus a medication log). AI label scan → custom food (MacroFactor, FoodNoms, SnapCalorie) — an AI cost.
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
