# STATUS — what is true right now

**Updated:** 2026-09-02 · **Owns:** current state only. Not history
(`CHANGELOG.md`), not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`),
not commands (`docs/COMMANDS.md`), not build tooling
(`docs/build-infrastructure.md`).

If a statement here conflicts with any other file in this repo, **this file
wins** — or the other file is stale and should be deleted. Three separate times
this project scoped already-shipped features as new work because a plan doc was
read as a status doc.

**This file is a status doc, not a changelog. It has a size budget: ~200 lines.**
When something ships, the entry does not get an update — it gets *deleted*, and
its outcome goes to `CHANGELOG.md`. On 2026-08-15 this file had grown to 941
lines and ~42k tokens, most of it superseded build rows already recorded in
`CHANGELOG.md`, and it carried four self-contradictions: two rows disagreeing on
which iOS build was in review, and two disagreeing on whether photo-scan resolved
against USDA. A status file nobody can hold in their head stops being read, and a
stale line here outranks the file that was right.

**Count characters, not lines.** On 2026-08-26 this file was 293 lines and
**65 KB** — inside the line budget on paper while single table cells ran to
4,500 characters each, which is the same failure wearing a smaller number. It
came back to ~30 KB by deleting ten rows whose work had shipped, not by
rewording. `wc -c STATUS.md` is the check that would have caught it: **keep it
under ~35 KB.**

---

## 1. Live right now

Numbers below are read from the APIs, never edited from memory. Re-read them the
same way before trusting them — `docs/COMMANDS.md` has every command.

| Surface | State |
|---|---|
| **Public App Store (iOS)** | **1.2.1 / build 60, `READY_FOR_SALE`**, released 2026-08-24 — confirmed via the ASC API (`appStoreVersions` + the version's `build`). Runtime `7b347b0f…`, which is what every iOS OTA since 1.2.0 targets, so an iOS OTA now reaches the public App Store rather than TestFlight alone. **Available in 175 of 175 territories** as of 2026-08-28 — the last 30 (EU 27 + GBR, ISL, NOR) opened once the DSA trader declaration was filed. Play is still pinned to 145 on purpose (§3) |
| **TestFlight** | **build 62 / 1.2.2 uploaded 2026-09-03 via altool after the EAS Submit queue stalled (runtime `3d6f4b68…`) — poll ASC for `VALID`, then `node scripts/asc-release-version.mjs --version 1.2.2 --build 62 --submit` creates App Store 1.2.2 and sends it to review (AFTER_APPROVAL release).** Before that: **build 60 / 1.2.1**, runtime `7b347b0f…`, `VALID`, and on the EXTERNAL *Public Beta Testers* group (added 2026-08-24 — it was internal-only before that, and external testers had received nothing for six days). Group holds `60,58,57,53,49,47,45,7,4`. **Read the group's builds, never assume:** a build being `VALID` and on TestFlight does not mean any external tester can install it |
| **Play alpha** | **vc 37** (1.2.1), live on the track, confirmed from the **androidpublisher API** — runtime `ae526937…` read from the `.aab`, so the Android **OTA channel is OPEN**. Behaviourally it is vc 36 plus nothing; it exists to undo the fingerprint cost of the ABI cut. **vc 36 and the never-released vc 38 are orphan runtimes** — no OTA reaches either, and the update banner is what drains them. Do not publish a second update to "cover" them. **`eas submit` has failed and exited 0 twice**, on two different causes (`This Edit has been deleted`; a missing health declaration) — always confirm a submit against the tracks API |
| **Play production** | **REJECTED 2026-09-03 (vc 37, Health Connect Minimum Scope: `StepsCadence/Steps`) — the reviewer had crashed the app on *Connect Health Connect* eleven minutes earlier. Nothing is live; the store URL 404s. The resubmission is **vc 43 / 1.2.2, BUILT, VERIFIED and DEVICE-CHECKED the same day** (`CHANGELOG.md` 2026-09-03): no `READ_STEPS`, the permission delegate + the Android 14 privacy alias (the alias is ALSO what makes the grant succeed on Android 9), Zero-Tap #107, the Ember-on-Ink icon, dark splash, FCM. Runtime `eb0e6212…` read from the `.aab`. **Three owner steps close it (the session classifier refuses Play publishing):** (1) `node scripts/play-upload-bundle.mjs apps/mobile/android/app/build/outputs/bundle/release/app-release.aab --track alpha --commit`; (2) `node scripts/play-production-release.mjs --complete --commit --vc 43` — the track is still 128 countries / restOfWorld=false; (3) Play Console → *Publishing overview* → **Send changes for review** (Play refuses to auto-submit while a rejection stands; both scripts commit with `changesNotSentForReview`). Before (3), open App content → Health apps and confirm `READ_STEPS` has dropped off step 1 now that vc 43 is scanned. Landing on production also clears the **#107 Block Store deadline (30 Sept)**. The 128-not-145 and no-API-for-review-status facts from 08-29 still hold; vc 41 and vc 42 are uploaded bundles on no track, superseded |
| **Web `ignia.fit`** | **Shell + `/admin` — the web logging app was RETIRED 2026-08-30 (ADR-0036).** 113 prerendered pages, EN + es-PR. `/app` and the old tabs render a "moved to the apps" page; a safety worker evicts old PWA installs. ADR-0036 §7 CLOSED 2026-08-30: SEO pages and `/u/**` are KEPT, owner-ratified |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**: OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that. Servings ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **BOTH channels SHUT to real users as of 2026-09-03 evening:** the icon + `app.json` changes moved both runtimes (Android → `eb0e6212…` = vc 43, iOS → build 62's). Android reopens the moment vc 43 is on a track; iOS the moment build 62 is on the App Store. Every OTA from here targets those two. Latest: **iOS OTA 70 on build 60 (`7b347b0f…`), reaching every iOS user. Android OTA 88–109 are on `d7ea3629…` = vc 40, which is on NO track — they reach the test device and nobody else, while every real Android user is on vc 37 with OTA 87.** Publishing to vc 40 is deliberate: it is the only way to device-verify while the channel is shut, at zero user exposure. **"Published" is not "delivered" here.** The iOS crash re-ship is still UNDER TEST (§2); everything since rides on it. **This row is a POINTER, not a log: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** It is deliberately kept to two facts (newest number per platform, and who receives it) — the version that listed a dozen historical publishes went stale twice, once reading "Android 7 / iOS 5" against `AGENTS.md`'s Android 27 / iOS 12. Re-check with `npx eas update:list --branch production --limit 3`, which prints the runtime each went out under |
| **`app-version.json`** | android **37**, ios **60** — deployed and verified live at `https://ignia.fit/app-version.json`. **Both numbers are DERIVED** by `scripts/app-version-sync.mjs` (android from androidpublisher tracks, ios from the `READY_FOR_SALE` version) — never hand-edit them, and a change reaches nobody until `npm run build && firebase deploy --only hosting`. It drifted silently the moment 1.2.1 released (still said ios 55, so every build-55 user was told they were up to date); `npm run doctor` is what caught it |

**The runtime fingerprints, and the three traps around them.**

| Platform | Tree now | Live binary | Channel |
|---|---|---|---|
| Android | `ae526937…` | **vc 37** ships `ae526937…` (read from the `.aab`) | **OPEN** |
| iOS | `7b347b0f…` | build 60 ships `7b347b0f…` | **OPEN** |

- **The fingerprint is machine-dependent — publish from whichever machine BUILDS
  that platform.** Since 2026-08-17 that is two machines: **Android from
  Windows, iOS from `ignia-mac`.** Bare `eas update` publishes both and is
  correct on neither — always `--platform`-scope it.
  `.claude/hooks/guard_eas_update.py` enforces the full table, and the
  `--environment` flag eas-cli requires from SDK 55 on. Three OTAs once
  published under the wrong machine's numbers and reached **nobody**,
  indistinguishable from a working update. **Why the hosts disagree is settled
  and is not worth another session:** it is `@expo/fingerprint` behaving
  differently per OS (CRLF-vs-LF in two files); `dir:android` and divergent
  `node_modules` were both investigated and disproven. They cannot be made to
  agree and do not need to.
- **`app.json` and `eas.json` are hashed as WHOLES**, so a key for one platform
  moves the other's runtime — a submit profile alone is enough. This has shut
  both channels twice, once silently off build 60, the public App Store binary.
  Android-only permissions and Gradle properties belong in
  `patch-android-release.mjs` (steps 1b and 4b), which writes **gitignored**
  prebuild output. Full write-up in `apps/mobile/AGENTS.md`.
- **`plugins/withGradleJvmArgs.js` is FROZEN** — any byte, *including a
  comment*, moves both platforms and shuts both channels. Its docstring is
  knowingly stale and is left that way on purpose; correcting the prose would
  strand every shipped binary. Full box in `build-android/REFERENCE.md`.

**`ignia-mac` disk is a recurring build constraint** — 19.18 GiB free against
an iOS build's ~17 GB floor, and `df -h /` lies. Numbers, the traps and the one
remaining lever are in `docs/build-infrastructure.md`.

## 2. Merged, on `main`, and not delivered anywhere

**Everything merged is in a binary — vc 43 (Android) and build 62 (iOS), both built 2026-09-03 — and neither binary is on a store yet.** That is the only sense in which anything here is undelivered. Android: the three owner steps in the Play production row (§1). iOS: build 62 goes to TestFlight and App Store 1.2.2 via `scripts/asc-release-version.mjs` (see the App Store row). What rode in: Zero-Tap Sign-In (#107), Milestones (#108–#110), the Trends stub labels and water card (#115), the welcome intro, the onboarding reminders + first-log steps, the funnel events, the lapsed nudges, the log stopwatch, the rest-timer change — every Android OTA 88–109 that only ever reached the LG — plus the Ember-on-Ink icon, the dark splash, FCM (token registration verified in PROD), the iOS push entitlement, and the two Health Connect fixes. `CHANGELOG.md` 2026-09-03 has the evidence; the AGENTS.md rows for vc 43 and build 62 have the artifact reads.

**Otherwise nothing — but one iOS question is still open.** `2f2777dc` (the Today ring could clip a digit) and `86f72754` (a hero drawn from seed targets before the profile landed) are live on both platforms — Android OTA 82, device-verified on the LG G6; **iOS OTA 49, re-shipped on the owner's call** after one native crash on reload forced a rollback the same day. **That crash is unexplained and the re-ship was an experiment, not a fix** — one event, one device, no telemetry (nothing in Sentry, 0 `diagnosticSignatures` on build 60); `textAlignVertical` ruled out, and OTA 82's diff cannot crash natively, so the frame is `motion.tsx`, the reload path, or something unrelated. The decision tree: crash on Restart then fine = the reload path; crash every time Today opens = `motion.tsx`; no crash = transient. **Record none of these until one is observed.** iOS has since taken OTA 54 and 55 on the same runtime with no report, which is absence of evidence, not the answer. Rollback is one command: republish group `2318d259`. Write-up: `apps/mobile/AGENTS.md`.

Everything else merged has shipped. Re-derive the live numbers with
`node scripts/app-version-sync.mjs --check` before trusting either platform's.

**iOS behaviour is UNVERIFIED for most of it.** The identical JS is
device-verified on Android in detail (`AGENTS.md`); no iOS device runs the
regression suite here. That is the standing shape of this project — the only
test device on hand is Android — not a new problem.

## 3. Open work, and what each is blocked on

**Only genuinely open work belongs here.** A row whose work has shipped gets
deleted and its outcome goes to `CHANGELOG.md` — see the budget note at the top
of this file.

### Retention — the standing focus (owner's call, 2026-09-02)

**The numbers say activation and the daily habit are the problem, not late
churn.** `config/retention` read 2026-09-02 (120-day window, synthetic
excluded, `insufficientSample: true`): 30 signups → **11 activated (37%)**;
D1 **20%**, D7 **8%**, D30 7%; **0.48 logs per activated user per day**
(category: D1 30–35%, D7 15–18%, D30 8–12%). Research levers, in the order
they attack that: logging speed (<30 s/meal retains 78% at six months vs 23%
over 2 min; photo loggers 42% D30 vs 17% search), a meaningful action in
session one (2–3× at D30), triggers tied to something the user did.
**Re-read `config/retention` before claiming any of this moved** — at ~30
signups per 120 days no A/B is readable; pair retention work with acquisition.

| # | Lever | State |
|---|---|---|
| 1 | **First log inside onboarding** — after the plan step, "log what you last ate" with photo/presets as the default path; reminders step moves after it. Attacks the 37% activation directly. | **SHIPPED 2026-09-02 — Android OTA 105–106 on vc 40, iOS OTA 67–68 on build 60.** Device-verified with a throwaway signup and the new `empty/03-onboarding-first-log` Maestro arc: first log landed 1 m 44 s after the plan was saved, the tour waited for it. Reminders step stays BEFORE it (the CTA leaves onboarding). The run also found the reminders step's rows had been invisible since 08-30 — fixed in the same publish (`CHANGELOG.md`). Watch `firstEntryAt − createdAt` in the retention doc once lever 3 lands. |
| 2 | **Lapsed nudges by LOCAL notification** — +3 and +7 days after the last food log, 6pm, cancelled by any log; anchored on today for anyone ≥7 days away. No server, no FCM, no scheduler slot. | **SHIPPED 2026-09-02 — Android OTA 102–104 on vc 40 (test device only while vc 40 is on no track), iOS OTA on build 60 (every App Store user).** Device-verified in all three states off AlarmManager, and it surfaced a pre-existing race that doubled every reminder — fixed in the same publish (`CHANGELOG.md`). First real observation: a lapsed user's 6pm banner, which no device here can produce before 09-05. |
| 3 | **Instrument the two deciding numbers** — seconds-per-log by method, D7 split by dominant logging method, `time_to_first_log` from `firstEntryAt − createdAt`. | **SHIPPED 2026-09-02 — server `4b8aef99` (rules + `hourlyTasks`), client Android OTA 107 on vc 40, iOS OTA 69 on build 60.** The retention pass writes `byMethod`, `timeToFirstLog`, `secsPerLog` to `config/retention` and the admin Overview prints them (`CHANGELOG.md`). The `log_secs` stopwatch is device-verified: the LG's first timed log flushed `log_added 1, log_secs 37`. `secsPerLog` is `null` until the 09:00 UTC pass sees a timed log — the denominator counts only timed logs, by design. **First PROD read 2026-09-02, 11 activated: time to first log median 1 h 32 m, p75 4 h 49 m, 17% inside five minutes (n=12)** — the number lever 1 has to move; the split is 7 `unknown` (activated before analytics shipped 08-12), 3 search, 1 photo, so the method comparison is months away. |
| 4 | **Celebrate the first log and first week** — award `first-scan`, a first-log `MilestoneNote`, `recordPositiveMoment` there so the review prompt lands after a win. §S12 still bans shame mechanics. | Open. `first-scan` is blocked on `FoodSource` having no photo variant. |
| 5 | **Verify the zero-friction triggers** — Android widget on a real home screen, watch/Siri (rows below). A widget is a log path under 10 s. | Open, owner with a device. |
| 6 | **Guest mode (`UX_AUDIT.md` N5)** if lever 1 does not move D1 alone. | Deferred until 1 is measured. |
| 7 | **Maintenance mode** after goal reached — looser logging, keeps the account alive through the week 8–12 fatigue. | Open, unscoped. |

Not taken with lever 2, deliberately: the meal-window dailies are OS-repeating
and fire forever for a user who never returns. Bounding them (silence after a
week away) would be kinder but changes existing schedules — a separate call.

| Work | Blocked on |
|---|---|
| **Play DSA trader status — RESOLVED 2026-08-30: there is NOTHING to file. What is left is opening the 30 territories, deliberately AFTER the vc 43 production review clears.** | **Sequencing, not a filing.** Driven through the org console and measured: no trader/DSA form exists anywhere on account `6598754086801415923` (account hub, Account details tabs, Settings, Policy center all checked), account-level Policy status reads *No issues found*, and the app's Publishing overview carries no trader task. Google folded the DSA trader requirements into ORGANIZATION verification — legal name/address, developer email and phone, all verified 2026-08-20 and labeled *shown on Google Play* — so the "unfiled declaration" premise dated from the personal-account era and died with the transfer. The standalone trader question exists for personal accounts, not verified orgs. **Do NOT open the EU 30 yet anyway:** a countries change submits through the same review pipeline, and vc 37's first-ever production review is in flight with #107's 30 Sept deadline chained behind it — resetting it buys nothing while the app is live nowhere. **Order: vc 37 goes live (store URL 200) → vc 40 submit/promote (#107) → move the 30 rows out of `EU_PENDING_PLAY_DSA` and re-run `--availability`.** The 17 `NOT_OFFERED_BY_PLAY` stay unopenable; Android's ceiling is 158. |
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** Multi-photo capture is closed and was confirmed on a real meal (2026-08-26); ADR-0029 is `accepted`. **The asymmetry that must survive:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness). Never observed: **repeat detection has never fired** (needs a My Foods entry matching a typed note; it is deliberately quiet, so "never suggested anything" and "broken" look identical) and **`measured` has never appeared** (needs a legible scale AND unit in one photo). **Seam not to break:** `measured` drops if `clampGrams` altered the number, so a badge never names a weight the scale did not show. De-duplication is improved, not solved — one run returned two hamburger patties from the same photo sent three times. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Resolver qualifier mis-matches — the last family CLOSED 2026-08-31; what is left is one deliberate non-change** | **Nothing on code; a `firebase deploy --only functions:analyzePhoto` when the owner wants it.** All four classes the #76 header named are now fixed. The three earlier ones (substring matches, meat analogues, the `unsalted butter` pretzel) shipped by 2026-08-27; today closed the family the header called "the ranker retuned", and **it was not a tuning problem at all.** Measured against the real dataset: every `Coffee, X` row clears `leadingSegmentsCover`, so the base score is **saturated** and the only term left separating candidates is `usda-db`'s brevity reward — `Coffee, Cuban` (13 chars) led `Coffee, brewed` (14) by **0.333 points**. No weight on that term orders them correctly, because `Cuban` genuinely is shorter. The ranker had **no signal for "this row names a variety the query did not ask for"** and length was standing in for one. Three signals now supply it, all in `photo-resolve.ts` so **`searchFoods`/`getFoodDetail` are untouched** (`usda-db.ts` unchanged; the only caller is `analyzePhoto`), and all of them **penalties or bonuses, NEVER filters** — the first analogue guard was a filter and made `bacon` resolve to nothing, so a demotion that cannot empty the candidate set is the shape this has to take: **(1)** an unasked-for **Title-case** qualifier after the first word is USDA's proper-noun marker (nationality, style, cultivar) and costs 5, waived for anything the query said; **(2)** `scoreFood` docks `nfs`/`ns as to` 25 for vagueness, which is right for a typeahead list and **backwards for a photo** — the unspecified-type average is the honest match when the model named no variety, so photo context cancels exactly that 25; **(3)** `skin eaten` costs 5 when the phrase never mentioned skin (USDA writes the pair `skin eaten`/`skin not eaten`, both docked 25, separated only by the four characters of `not `). **Measured over a 117-phrase corpus: 21 changes, 0 regressions.** The wins are bigger than the four named cases — a bare `taco` returned `Taco, fish`, `cheeseburger` returned `Cheeseburger, from school cafeteria`, `steak` returned `Beef, steak, country fried`, `protein shake` returned a Slim Fast row, `hot dog` returned beef. **The sizing is the finding, and a regression proved it:** at 25 points the variety penalty overrode the raw-state preference and sent `walnuts` from `Nuts, walnuts, English, halves, raw` to `Walnuts, honey roasted` — `English` is the default cultivar. At 5 every intended change survives and that regression is gone. A tie-breaker sized like a real signal stops being a tie-breaker. **Six tests pin all of it, walnuts included.** **The one deliberate NON-change:** `greek yogurt` → `Yogurt, Greek, plain, whole milk`. The nonfat row outscores it and loses on `productPenalty`, which docks `nonfat` 40 — the same penalty that stopped `grilled chicken breast` reaching `oven-roasted, fat-free, sliced`. Whole milk is a defensible default and errs high on calories; touching `PRODUCT_QUALIFIERS` to change it would reopen a fix that cost real macro accuracy. Left alone on purpose. **NOT DEPLOYED** — code is on `main`, the callable still runs the old ranking. |
| **Cardio + Oura — shipped; the Android binary (`READ_EXERCISE`) is vc 43; Health Connect grant proven on the LG 2026-09-03** | **Nothing blocking on code.** Merged and delivered by OTA on both platforms (`CHANGELOG.md`). **(1) ~~No Oura record has ever been read~~ — VERIFIED WITH REAL DATA 2026-08-31, read from PROD.** The ring account's `integrations/oura` doc: connected 2026-08-24, scope `workout daily`, **`lastSyncedAt` 2026-08-30, `lastRecordCount: 2`** — OAuth, token exchange and the Cloud fetch all work against the one real ring. The two records produced **no cardio block in her sessions, and that is #102's designed behavior**, not a failure: Oura classifies her dumbbell sessions as `strengthTraining`, which the importer deliberately DECLINES (importing them as cardio would duplicate hand-logged Train sessions). One session (08-26) carries `cardio: []`, the import's empty write. **What remains genuinely unobserved is narrow: a cardio-classified record (walk/run/cycle) landing as a via-Oura block** — needs the ring's owner to record one. The `skipped` count is client-screen-only (not persisted), so wire-shape confirmation to zero also rides on that first cardio record. **(2) Android's health-store workout read needs a binary.** `READ_EXERCISE` is declared (step 4b of `patch-android-release.mjs`) and `ExerciseSession` requested, but a manifest permission exists only in a binary, so through vc 37 Health Connect refuses the read and `readWorkouts` returns empty. The Health-apps declaration that gated it is **CLEARED — verified in the Console 2026-08-29** (*Need attention* empty, Health apps under *Actioned*, step 1 detects `READ_EXERCISE`, Policy status *No issues found*), so **vc 40 is unblocked on this axis**; alpha stayed at vc 37 throughout, so production access was never disturbed. How it cleared (a `draft` never re-scans, `completed` 403s, INTERNAL via the Console is what makes Play detect the permission — vc 39, no testers) is on the vc 39 row in `apps/mobile/AGENTS.md`. **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. |
| **Push notification when an OTA publishes** (#112, #114) — **client + server + native all SHIPPED; two credential uploads left** | **Owner, two CLI steps.** (1) **FCM V1 sender key on EAS** — `cd apps/mobile && npx eas credentials -p android` → production → *Google Service Account Key for FCM V1* → `credentials/fcm-v1-service-account.json` (minted 2026-09-03; the expo.dev page is a native file picker an agent cannot drive). Until then `adminAnnounceOta` gets `InvalidCredentials` from Expo's push API. (2) **APNs key** — `eas build` on the Mac either created one during build 62 (check `~/ios-build.log` for `push key`) or `npx eas credentials -p ios` → production → Push Notifications key. Token registration is proven on Android (QA profile `expoPushToken`, 2026-09-03); the first real `scripts/announce-ota.mjs` run after both uploads is the end-to-end proof. |
| **The website is invisible to Google — and after 2026-08-27 the reason is MEASURED, not theorised** | **Owner go/no-go on a cheaper plan than the one this row used to name.** The content half is deployed and verified live. **It moved nothing:** `node scripts/gsc.mjs inspect` returns *URL is unknown to Google* on **7 of 7** sampled URLs, unchanged from the 2026-07-29 baseline, 29 days on. **And the front door is shut: the sitemap has NEVER been downloaded** — re-submitted 2026-08-27, `lastDownloaded: not yet`, **0 warnings, 0 errors**. That is the third consecutive submission (07-29, 08-17, 08-27) Google has not fetched, and a clean bill of health each time, so it is **not** a sitemap-quality problem. **Server-rendering the body of a URL Google never requests changes nothing**, which is why the router migration is now DEFERRED rather than scheduled. **The orphan graph: CLOSED AND DEPLOYED — live since 2026-08-31** (release `70c40ec2` confirmed in the live `build-info.json`; the noscript link block and footer directory both serve from `/`). Before: **1 of 118** sitemap URLs reachable from `/`; after: **118 of 118, 0 orphans** (BFS over real `<a href>`s in dist; mechanism in `CHANGELOG.md` 2026-08-31). Re-measure with `node scripts/gsc.mjs inspect` (give Google days-to-weeks) before claiming movement. **The migration WAS costed** (21 route branches, a hard blocker at `app.ts:503`, largest possible change to a FROZEN frontend — full costing in `docs/seo-status.md`). **Order: re-measure, and only then reconsider the router.** Numbers and both tables: `docs/seo-status.md`. |
| **Android device QA — 16 of 20, and all four failures are the harness** | **Nothing blocking.** Host is the **LG VS988 (LG G6), Android 9 / API 28** over adb — two levels above `minSdk` 26, so a pass does NOT prove the floor. Latest sweep **16 of 20, 2026-08-30, against the published vc 40 bundle** (`17-coach-ask` excluded — it spends real Gemini money). All four failures are the documented `scrollUntilVisible` family and **every failure ever found on this device has been the harness, not the build**; `07-coach` was disproved rather than assumed (the element is present and correctly bounded). Fixing them would likely take it to 20/20 — the remedy is a custom scroll loop, and lowering `visibilityPercentage` does **not** work. The flows are shared with iOS, so validate there before changing them. Watch **`09-locale-es`**: a death there strands the account in Spanish; recover with `node scripts/qa-regression-verify.mjs set-locale --email qa-test@ignia.fit --locale en`. **The suite WRITES** (11–13 log/edit/delete, 14 moves water, 09 changes locale) — check which account the device holds first; it is on `qa-test@ignia.fit` now, having been found on a real personal one. Regaining adb after a reboot is PHYSICAL (the RSA prompt cannot render behind a locked keyguard). Detail: `apps/mobile/.maestro/regression/coverage.md`. |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`). |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2). |
| **`bermudezsystems.com` — the domain is the exposure, not the mailbox** | **Owner, on a diary.** Registered 2026-07-06 via Northwest (registrar DomainRegistry.com LLC), status plain `active`, no `clientTransferProhibited`. **① The lapse risk is GONE — Northwest confirmed in writing 2026-08-26** that the domain *"will automatically renew each year that you still have that service active with us."* There is no 2027-07-06 deadline. **What is left is a coupling:** the domain lives exactly as long as the RA subscription, so cancelling it — or its card failing — takes the org Play developer account's login with it. **Transfer is the fix and is eligible ~2026-09-04** (ICANN's 60-day bar). The mailbox is on Microsoft 365 and does not ride on Northwest; what must be carried is the DNS — the M365 MX, the `google-site-verification` TXT, `_dmarc` (still reporting to Northwest's collector). **Do NOT delete the `google-site-verification=1EYLbXKH66lt3XNRVrp3o066X7NqEeKBhMwWO64P57U` TXT** — Play's org website verification rides on it. Runbook: `docs/DEV_ENVIRONMENT.md` §4. **② Recovery on the org Google account — recovery email, phone, saved 2FA backup codes — is still open and OWNER-ONLY, confirmed 2026-08-27:** it needs that account's password, backup codes are secrets an agent must not hold, and the working Chrome profile is signed in as the PERSONAL account. It is the highest-value item here because it is what survives a lapse: the org Play login IS `gabriel@bermudezsystems.com`. **Adjacent, same sitting:** the PERSONAL Google account (source Play account + Apple account email) has 2-Step since Oct 2022, 6 passkeys, recovery phone and email (`gabriel@bermudezpr.com`) — but **Backup codes and Recovery contacts are NOT configured**, and backup codes are what survives losing the phone. |
| **MenuStat permission email — sent, no reply** | **Owner, awaiting NYC DOHMH.** The restaurant corpus is live on all three surfaces (`CHANGELOG.md`). The open risk is the **licence**: menustat.org published through 2022 under an all-rights-reserved notice and the site is now GONE (SERVFAIL, last Archive 200 is 2026-06-12), while the only copy carrying a written grant — Harvard Dataverse, CC0 1.0 — stops at 2018. The request was sent 2026-08-24 to `info@menustat.org` Cc `MenuStat@health.nyc.gov`; **the Cc is what carried it** (Delivered), the first address will NDR because that domain has no resolvable MX. Replies land in the `bermudezpr.com` Microsoft 365 tenant, not Gmail. The CC0 2018 file is the priced fallback (it loses The Cheesecake Factory, 399 items). Two smaller follow-ups: Pollo Tropical (major in PR, publishes official nutrition, absent from MenuStat's 91) and the mobile provenance chip — the wire already carries the year as `dataType: restaurant_menu_2022`. |

## 4. Decided and deliberately not happening

Do not re-propose these without new information; reasoning is in the linked ADR
or research note.

- **Pro tier / IAP / Stripe** — dormant, flag-gated off. v1 is free. (ADR-0015)
- **Watch app reading Firestore directly** — structurally unavailable; there is
  no watchOS Firestore client. (`docs/research/watch-complication-transport.md`)
- **Real-time push to a WidgetKit complication** — Apple-side, FB12926788.
  (ADR-0023)
- **Activity feeding measured-mode TDEE** — would double-count. Formula mode only.
- **Shared subscription cache in mobile** — per-hook subscriptions are
  intentional. (ADR-0016)
- **A 4th scheduled Cloud Function** — Cloud Scheduler's free 3 jobs are spent;
  fold into `hourly-tasks.ts`.
- **A Strava integration** — rejected on **licence, not preference**: its June
  2026 API Agreement forbids using API data for AI/ML, and Ignia has a coach and
  photo scan. Cronometer, a nutrition tracker, dropped its own Strava
  integration for the same reason.
  (`docs/research/connected-apps-candidates.md`)
- **A fourth connected-apps provider** — none is scheduled. Withings is the only
  candidate with real marginal value (body weight, the input TDEE rides on) and
  even that is largely redundant on iOS, where Apple Health already aggregates
  Withings/Fitbit/Whoop/Garmin. **The cheapest large win adds no provider at
  all:** give the Apple Health path the same evidence surface Oura now has.
- **A Google Group for the Play tester list** — cannot be maintained by an
  agent: consumer Google Groups gates every member-add behind a reCAPTCHA and
  `@googlegroups.com` has no public API. One was created and deleted the same
  day. The Play email list is the working mechanism. (`CLAUDE.local.md`)
- **Deleting the website** — Apple requires the live privacy URL and Play the
  delete-account URL, both on `ignia.fit`; the Oura redirect, `app-version.json`
  and `/admin` live there too. The web *logging app* is already gone. (ADR-0036)
- **A web logging surface** — retired on ADR-0022's own measurement (web 2.9%
  of active days). (ADR-0036)

## 5. App Store submission — standing rules

Carried over from the two 1.0 rejections. Permanent, not a checklist to do once.

- **Both accounts are now the LLC, and that closed a standing risk.** This bullet
  said "Accounts are Individual, not an entity" until 2026-08-26; it stopped
  being true on 08-25 (Apple) and 08-26 (Play). Apple Developer and App Store
  Connect are **Bermudez Systems LLC**; the Play app was transferred to org
  account `6598754086801415923`. Guideline 5.1.1(ix) prefers a legal entity for
  health apps that touch HealthKit, and that accepted risk is now retired. The
  App Store seller name may lag until Apple propagates the entity — see §3.
- **Always hand Apple `review@ignia.fit`** in the Demo Account fields — it is
  pre-verified and seeded. A fresh account is walled out by the
  email-verification gate, and 2.1 demo-account failures are Apple's largest
  rejection bucket. Never point them at `demo@ignia.fit` (screenshots only).
  Confirm it can still write before submitting.
- **Notes for Review must name the specific changes.** Generic text gets rejected
  under 2.3.1.
- **Do not advertise a feature that is `BEHAVIOUR UNVERIFIED`.** The watch
  complication and Siri quick-add are deliberately claimed to no reviewer.
- **`supportsTablet` stays `false`.** Apple reviews on iPad anyway, but flipping
  it true obliges an iPad design pass *and* iPad screenshots — more rejection
  surface, not less.
- **Keep `NSPhotoLibraryUsageDescription`.** A *missing* purpose string is an
  automated ITMS-90683 rejection; an extra one is never punished.
- **Privacy labels must match reality** — health data + email, no Photos.
- **A submitted version's build is frozen.** Swapping it is cancel → re-point →
  resubmit (`scripts/asc-swap-review-build.mjs`), the cancel is irreversible, and
  it has cost ~19h of queue position once and ~4h once.

## 6. Where things live (and what gets deleted)

| Question | File |
|---|---|
| What is this repo, how do I work in it | `CLAUDE.md` |
| What does this word mean | `CONTEXT.md` |
| **What is true right now** | **this file** |
| How do I check that claim | `docs/COMMANDS.md` |
| Why is it built this way | `docs/adr/` |
| What shipped, when | `CHANGELOG.md` (+ `CHANGELOG-archive.md`) |
| Which binary carries what | `apps/mobile/AGENTS.md` (read from the artifact) |
| Build ceilings, credentials, traps | `docs/build-infrastructure.md` |
| Dev loop + owner runbook | `docs/DEV_ENVIRONMENT.md` |
| What did we research | `docs/research/` — each file opens with its verdict |
| What's still wrong in the UX | `UX_AUDIT.md` (§S13 = launch readiness) |
| Store listing field values | `docs/app-store-metadata.md` |
| Machine-local credential paths | `CLAUDE.local.md` (git-ignored) |

**A plan document is deleted the day its work ships.** Its outcome belongs in
`CHANGELOG.md`, its reasoning in an ADR, its current state here. Git keeps the
original forever; `git log --diff-filter=D --name-only` finds it. Never leave a
shipped plan in the tree with a "CORRECTION" block on top — that is how a status
doc and a wish list become indistinguishable.

**The same rule applies to this file.** Every section above is subject to the
~200-line budget; if adding a row would push it over, something in it has already
shipped and should be deleted rather than amended.
