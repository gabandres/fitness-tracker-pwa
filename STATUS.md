# STATUS — what is true right now

**Updated:** 2026-09-04 · **Owns:** current state only. Not history
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
| **Public App Store (iOS)** | **1.2.2 / build 63, `READY_FOR_SALE`**, released 2026-09-04 — confirmed via `node scripts/app-version-sync.mjs --check`. Runtime `20a395de…`, which is what every iOS OTA targets now, so an iOS OTA reaches the public App Store. (1.2.1 / build 60 and its `7b347b0f…` are superseded; this tree can no longer produce that runtime.) **Available in 175 of 175 territories** as of 2026-08-28 — the last 30 (EU 27 + GBR, ISL, NOR) opened once the DSA trader declaration was filed. Play matched on 2026-09-03 evening: 158 of Play's attainable 158 (175 minus the 17 storefronts Play does not offer) |
| **TestFlight** | **build 63 / 1.2.2 (runtime `20a395de…`), released to the App Store 2026-09-04** — build 62 (the off-centre icon) was submitted first and cancelled. The EXTERNAL *Public Beta Testers* group holds `60,58,57,53,49,47,45,7,4` and **has not been given 63** — it was internal-only until 2026-08-24, when external testers had received nothing for six days. **Read the group's builds, never assume:** a build being `VALID` and on TestFlight does not mean any external tester can install it |
| **Play alpha** | **vc 44** (1.2.2), same bundle as production, runtime `68ea2dd3…`. Behaviourally identical to production; the track exists so the 15-address tester list gets builds before the public. **`eas submit` has failed and exited 0 twice** (`This Edit has been deleted`; a missing health declaration) — always confirm a submit against the tracks API |
| **Play production** | **LIVE — vc 44 / 1.2.2, the first Android production release, published 2026-09-03 evening.** The store URL returns 200; Play Console *Last published on September 3, 2026*; the androidpublisher tracks API reports production vc 44, alpha vc 44, internal vc 44. What is still in review is only the **Data safety** amendment (Device or other IDs, sent the same evening). Landing cleared the Block Store deadline (30 Sept) — issue 107 closed; the WebAuthn relying party is never needed. Runtime `68ea2dd3…`. History: vc 37 was rejected that morning (Health Connect *Steps* minimum-scope) after the reviewer crashed the app on *Connect Health Connect*; vc 44 fixed both (`CHANGELOG.md` 2026-09-03) |
| **Web `ignia.fit`** | **Shell + `/admin` — the web logging app was RETIRED 2026-08-30 (ADR-0036).** 113 prerendered pages, EN + es-PR. `/app` and the old tabs render a "moved to the apps" page; a safety worker evicts old PWA installs. ADR-0036 §7 CLOSED 2026-08-30: SEO pages and `/u/**` are KEPT, owner-ratified |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**: OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that. Servings ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **BOTH channels OPEN** — Android on `68ea2dd3…` (vc 44, Play production since 09-03 evening) and iOS on `20a395de…` (build 63, `READY_FOR_SALE` 2026-09-04). Both reach the public on next launch. iOS was SHUT for all of 09-04 while 1.2.2 sat in review, which is why that day's Android publishes outnumber iOS's — the iOS side caught up in one publish (group `886bba8b`) plus the caveat fix. **"Published" is still not "delivered":** a user gets it on the launch AFTER the download. The iOS crash re-ship is still UNDER TEST (§2). **This row is a POINTER, not a log: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** Re-check with `npx eas update:list --branch production --limit 3`, which prints the runtime each went out under |
| **`app-version.json`** | android **44**, ios **63** — re-synced and deployed 2026-09-04 when 1.2.2 went `READY_FOR_SALE`, verified live at `https://ignia.fit/app-version.json` and re-confirmed by `--check` on 2026-09-04. **Both numbers are DERIVED** by `scripts/app-version-sync.mjs` — never hand-edit them, and a change reaches nobody until `npm run build && firebase deploy --only hosting`. It drifted silently the moment 1.2.1 released, and again when 1.2.2 did; `npm run doctor` is what catches it. **Re-run the sync on every store release** — that is the only event that moves either number. |

**The runtime fingerprints, and the three traps around them.**

| Platform | Tree now | Live binary | Channel |
|---|---|---|---|
| Android | `68ea2dd3…` | **vc 44** ships `68ea2dd3…` (read from the `.aab`), live on production | **OPEN** |
| iOS | `20a395de…` | **build 63 ships `20a395de…`, `READY_FOR_SALE` 2026-09-04** — the tree and the live binary agree | **OPEN** |

Read them back with `npx eas update:list --branch production --limit 3` and the
OTA row above; this table says which runtime the *tree* produces today.

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

**TWO TDEE/onboarding fixes are merged on `main` and in NO published bundle** (2026-09-04, commits `5b4fb484` and `cf0953d4`). Both are JS-only, so both ship by OTA on both platforms whenever someone publishes — **deliberately not published in the session that wrote them**, because there is no iOS device here and neither change is device-verifiable on Android without a signed-in account, and the same day had already put four wrong Android OTAs in front of production users. **(1) An onboarding redo no longer overwrites a measured target with the wizard's heuristic seed.** Settings' "Edit goals" pushed the whole wizard and finishing it wrote `manualCaloriesTarget`/`manualProteinTarget` unconditionally; under `targetMode: 'auto'` a stored manual value outranks an unreliable measured estimate, which moved the owner's target **1,905 → 2,080** silently. Now omitted on an `'auto'` redo, still written on `'custom'` (the user's own digits) and on every first run (where the seed beats the hardcoded 2,450). The button now reads "Redo setup". **(2) The day still in progress is out of the intake mean.** `calculateTdee` takes a `now` and zeroes today's calories while keeping today's weigh-in in the regression. **This moves every user's displayed target** — measured on the owner's account at **+30 kcal**, and **+48 kcal at 08:00** with one meal logged; the old behaviour always erred toward a deeper deficit and was worst in the morning. Against a 1,850 floor that exists for a gallbladder, that is the reason it was done. Reasoning: `docs/training-backlog.md` §0–1.

**Everything else merged is in a binary — vc 44 (Android) and build 63 (iOS), both built 2026-09-03, and BOTH ARE NOW LIVE:** Android on Play production, iOS 1.2.2 `READY_FOR_SALE` 2026-09-04. What rode in: Zero-Tap Sign-In (#107), Milestones (#108–#110), the Trends stub labels and water card (#115), the welcome intro, the onboarding reminders + first-log steps, the funnel events, the lapsed nudges, the log stopwatch, the rest-timer change — every Android OTA 88–109 that only ever reached the LG — plus the Ember-on-Ink icon, the dark splash, FCM (token registration verified in PROD), the iOS push entitlement, and the two Health Connect fixes. `CHANGELOG.md` 2026-09-03 has the evidence; the AGENTS.md rows for vc 44 and build 63 have the artifact reads (vc 41–43 and build 62 were the same evening's iterations: 41 lacked the Android 14 alias, 42 carried version 1.2.1, 43 had the off-centre icon).

**PR #120 and #121 shipped by OTA on both platforms, 2026-09-04** — `first-scan`
(#109) and the Health Connect active-energy fix, on Android `68ea2dd3…` (vc 44)
and iOS `20a395de…` (build 63). Android reaches Play production users on next
launch, and **iOS reaches its users too** — 1.2.2 went `READY_FOR_SALE` later
that day, which opened build 63's channel; the publish had been made ahead of
approval precisely so the fix was already in place when it landed. The Health
Connect fix took two attempts and the first one
shipped a second failure for about an hour; the account is in `CHANGELOG.md`
2026-09-04, and the short version is that `aggregateGroupByPeriod` cannot read
`ActiveCaloriesBurned` at all on `react-native-health-connect@3.5.3`.
**Verified on the LG VS988** — the only device that has ever held a working
Health Connect grant — where *Sync now* went from throwing at 13:39 UTC to
*"Synced 0 day(s) from Health"* at 13:41. **The OnePlus KB2005 cannot verify
it**: every `android.permission.health.*` there is `granted=false`.

**The progression fixes shipped by OTA to Android ONLY, 2026-09-04** — `bf1385c7`, group `8f165a13`. The app no longer suggests a load off an activation set logged at RIR 0 or RIR 4+ (it says which of four reasons applied instead), and `keySets` now requires EVERY activation in a clustered lift to clear the threshold rather than just the first — the defect behind the 2026-08-26 shoulder-press call. Drop sets needed no code; `setKind: 'drop'` was already excluded from progression. **iOS caught up the same day**, in one publish (group `886bba8b`) once 1.2.2 went `READY_FOR_SALE` — carrying the final state only, so the four wrong Android intermediates never existed on iOS. **Five further Android publishes the same day fixed one Today-header bug** (the avatar was clipped off the right edge at 360dp); four of the five were wrong and reached production users before the sixth was device-verified on both phones. `apps/mobile/AGENTS.md` carries the full account and the cause — Yoga has no `min-width: auto`, so the min-content floor that three of those fixes assumed does not exist.

**#109 is CLOSED with PROD evidence, same session.** A real photo of chicken,
rice and peas scanned to **441 kcal / P38 C39 F15**, two items; the log row at
`2026-09-04T14:18:35.260Z` carries **`source: "photo"`** while every older row
has the field absent, and `milestones/first-scan` is stamped
`2026-09-04T14:18:35Z` — the same second as the write, which is the award
happening at the write rather than on render. A relaunch afterwards ran the
recovery path and left **exactly one** doc with an unchanged `earnedAt`.

**Two follow-ups this turned up, neither blocking.** (1) The user-facing message
for a provider 429 is *"Couldn't read that photo. Try another angle."* —
`scanErrorMessage` maps our own typed codes properly but an upstream 429 falls
to the default, so the app blamed the photograph for five days. Mapping it to
`scan.errBusy` is worth doing. (2) **AI Studio flags "Fitness Tracker Gemini
(client)" as a publicly exposed API key.** It is restricted to
`generativelanguage.googleapis.com` and nothing in the app should need it (the
app calls the `analyzePhoto` callable, never Gemini directly), so it is a
delete-after-checking candidate. It matters more now that the account carries a
card and auto-reload; the $25/month cap and the $250 tier cap bound the exposure
deliberately.

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
| 1–3 | First log inside onboarding · lapsed local nudges · the two deciding numbers instrumented | **SHIPPED 2026-09-02** — outcomes and device evidence in `CHANGELOG.md` 2026-09-02. Every real user gets them with vc 44 / build 63 (iOS build 60 already has them by OTA). Watch: `config/retention` `timeToFirstLog` (first read: median 1 h 32 m, p75 4 h 49 m, 17% inside five minutes, n=12 — the number lever 1 has to move), `secsPerLog` (null until a timed log reaches the 09:00 UTC pass), and the first lapsed 6pm banner, which no device here can produce before 09-05. |
| 4 | **Celebrate the first log and first week** — award `first-scan` (issue 109, closed), a first-log `MilestoneNote`, `recordPositiveMoment` there so the review prompt lands after a win. §S12 still bans shame mechanics. | **Merged (issue 109 closed, PR 120) and PUBLISHED by OTA on both platforms 2026-09-04 — Android reaches production users now, iOS reaches build-63 installs only (§2).** `LogSource` (`'photo'`) is written at the scan, the award is made at the write, the rules carry it and are deployed. **Device-verified in PROD 2026-09-04** (§2): a real scan wrote `source: "photo"` and exactly one `milestones/first-scan`, both stamped `14:18:35`; a relaunch added no second doc. `meals-100` stays parked — it needs a lifetime count no window answers honestly, and a profile counter is a separate call behind the `isValidProfile` expression ceiling (issue 100, closed). |
| 5 | **Verify the zero-friction triggers** — Android widget on a real home screen, watch/Siri (rows below). A widget is a log path under 10 s. | Open, owner with a device. |
| 6 | **Guest mode (`UX_AUDIT.md` N5)** if lever 1 does not move D1 alone. | Deferred until 1 is measured. |
| 7 | **Maintenance mode** after goal reached — looser logging, keeps the account alive through the week 8–12 fatigue. | Open, unscoped. |

Not taken with lever 2, deliberately: the meal-window dailies are OS-repeating
and fire forever for a user who never returns. Bounding them (silence after a
week away) would be kinder but changes existing schedules — a separate call.

| Work | Blocked on |
|---|---|
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** Multi-photo capture is closed and was confirmed on a real meal (2026-08-26); ADR-0029 is `accepted`. **The asymmetry that must survive:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness). Never observed: **repeat detection has never fired** (needs a My Foods entry matching a typed note; it is deliberately quiet, so "never suggested anything" and "broken" look identical) and **`measured` has never appeared** (needs a legible scale AND unit in one photo). **Seam not to break:** `measured` drops if `clampGrams` altered the number, so a badge never names a weight the scale did not show. De-duplication is improved, not solved — one run returned two hamburger patties from the same photo sent three times. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Cardio + Oura — shipped; the Android binary (`READ_EXERCISE`) is vc 44; Health Connect grant proven on the LG 2026-09-03** | **Nothing blocking on code.** Merged and delivered by OTA on both platforms (`CHANGELOG.md`). **(1) ~~No Oura record has ever been read~~ — VERIFIED WITH REAL DATA 2026-08-31, read from PROD.** The ring account's `integrations/oura` doc: connected 2026-08-24, scope `workout daily`, **`lastSyncedAt` 2026-08-30, `lastRecordCount: 2`** — OAuth, token exchange and the Cloud fetch all work against the one real ring. The two records produced **no cardio block in her sessions, and that is the importer's designed behavior (issue 102, closed)**, not a failure: Oura classifies her dumbbell sessions as `strengthTraining`, which the importer deliberately DECLINES (importing them as cardio would duplicate hand-logged Train sessions). One session (08-26) carries `cardio: []`, the import's empty write. **What remains genuinely unobserved is narrow: a cardio-classified record (walk/run/cycle) landing as a via-Oura block** — needs the ring's owner to record one. The `skipped` count is client-screen-only (not persisted), so wire-shape confirmation to zero also rides on that first cardio record. **(2) Android's health-store read is now blocked on an OTA, not on a binary — and the reason is new.** The `READ_EXERCISE` binary shipped as vc 44, and the very first device to hold a working Health Connect grant showed that the import never ran at all: `aggregateGroupByPeriod` cannot read `ActiveCaloriesBurned` on `react-native-health-connect@3.5.3` at all (both the local-naive and the instant form throw, for different reasons), and the rejection took `importScalars` down with it — so `importHealthWorkouts`, which runs after it, never executed. **Fixed and SHIPPED by OTA on both platforms 2026-09-04** (PR 120 then 121 — the first fix shipped the second failure; `CHANGELOG.md` 2026-09-04), using `aggregateGroupByDuration`. Android production users get it on next launch; iOS on 1.2.2's approval. The paragraph below is the history that led to vc 44 and is still accurate about the manifest. **(2, history) Android's health-store workout read needs a binary.** `READ_EXERCISE` is declared (step 4b of `patch-android-release.mjs`) and `ExerciseSession` requested, but a manifest permission exists only in a binary, so through vc 37 Health Connect refuses the read and `readWorkouts` returns empty. The Health-apps declaration that gated it is **CLEARED — verified in the Console 2026-08-29** (*Need attention* empty, Health apps under *Actioned*, step 1 detects `READ_EXERCISE`, Policy status *No issues found*), so **vc 40 is unblocked on this axis**; alpha stayed at vc 37 throughout, so production access was never disturbed. How it cleared (a `draft` never re-scans, `completed` 403s, INTERNAL via the Console is what makes Play detect the permission — vc 39, no testers) is on the vc 39 row in `apps/mobile/AGENTS.md`. **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. |
| **The website — Google started indexing it, measured 2026-09-03; the sitemap is still never fetched** | **Nothing to do but wait and re-measure.** `node scripts/gsc.mjs inspect` 2026-09-03: **6 of 7 sampled URLs are *Submitted and indexed*** (`/cutting-calculator`, `/protein-calculator`, `/tdee-calculator-women`, `/weight-loss-calculator`, `/es/calculator`, `/es/vs/macrofactor`); only `/transformations` is still *unknown*. That is against **0 of 7** on 07-29, 08-17 and 08-27, so the thing that moved is the **orphan-graph fix live since 08-31** (1 → 118 of 118 sitemap URLs reachable from `/`), not the sitemap — `lastDownloaded` is **still `not yet`** after a fourth submit today (0 warnings, 0 errors), so Google is crawling by links and ignoring the file. **The router/SSR migration stays DEFERRED** — the premise it rested on (Google never requests the pages) is now false. Next read: impressions/clicks in GSC Performance in ~2 weeks, and `/transformations`. Costing and both tables: `docs/seo-status.md`. |
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
