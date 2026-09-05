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

**The 70% reliability cliff is removed — SHIPPED BY OTA TO BOTH PLATFORMS, 2026-09-04** (`c93a740c`; Android group `fe837aba`, iOS group `31b3f1e2`, both from `11e75966`). **Both reach the public on next launch** — Android Play production vc 44, iOS 1.2.2 build 63. `dailyTargets` no longer gates on `tdee.reliable`; a measured estimate governs from the moment measured mode opens, damped by `confidence` as before. **Measured against all 42 PROD accounts before publishing — it reaches exactly two**: `review@` +144 and one real user −140; the other twenty byte-identical. **The owner's account cannot demonstrate it** (cliff height 0), so the OnePlus pass is a predicted NEGATIVE verification, not a demonstration — `review@` is the only account that would show it. **Known and accepted:** the real user's `ci95Tdee` is null, so their −140 lands with no recalibration notice. Detail: `apps/mobile/AGENTS.md` top row, `CHANGELOG.md` 2026-09-04, `docs/training-backlog.md` §0.

**The iOS Today-header question is CLOSED, and it was never a risk (2026-09-04).** `minWidth: 96` was measured from Android glyph ink, and the standing worry was that iOS font metrics differ. They do not here, for a reason the original note could not see: the title is `Manrope_800ExtraBold`, a **bundled** face, so both platforms read advances from the same TTF. **CoreText — the iOS text engine — on that exact file at `font.h1`: Today 87.15pt, Hoy 57.33, Hoje 68.10**, against a 96 floor (10.2% headroom); the Android screenshot number that set the floor read 86.7dp, agreeing to 0.5%.

**That check found a real accessibility bug instead, on BOTH platforms, now FIXED AND SHIPPED** (`37fd4462`; Android group `a4e958a0`, iOS group `ed0b17a8`). The floor is fixed dp while the text scales, so at `fontScale >= 1.102` the title outgrew it and — carrying no `numberOfLines`, deliberately — hard-clipped rather than ellipsizing. **Reproduced on the LG at `font_scale 1.15`: the header read "Toda".** Two notches of iOS *Larger Text* reaches it. Fixed with `maxFontSizeMultiplier` (the `EntrySheet` precedent), capped at the derived 1.1 so the title cannot outgrow its floor by construction; `header-title-fit.test.ts` pins the two numbers together and was verified to fail when they drift. **Device-verified at 1.15 and 1.3** — nothing clipped at either. Detail: `apps/mobile/AGENTS.md` top row.

**The two copy defects that OTA caused are FIXED AND SHIPPED to both platforms** (`50e6c844`, `5245d8a8`; Android group `7df89551`, iOS group `e034a60f`, both from `5245d8a8`). Same mechanism for both, worth stating once because it will recur: `c93a740c` decoupled two events that had always coincided — crossing into `reliable` used to be the exact moment the target switched to the estimator — so two accurate strings became wrong when the pairing broke. (1) *"held steady"* sat next to *"just recalibrated"*; (2) the card announced a recalibration and "set" a target that had not moved. **Neither was catchable by a gate** — `tsc`, 734 tests, i18n parity and the perf budget were green with both live; a device was the only instrument that could see them. Device-verified on the OnePlus. Detail: `apps/mobile/AGENTS.md` top row.

**OPEN — the sign-in flash on an OTA apply.** The owner's iPhone landed on `sign-in.tsx` after taking the cliff update, and reopening restored the session, so it is transient. **It is not caused by any OTA's content**: `git diff eb1e3c2c..11e75966` touches no auth, routing, session or storage file, and the OnePlus took the same bundle two minutes earlier and came up signed in. It is the cold-start auth-rehydration flash `sessionPresumed` (#83) exists to suppress — `auth.tsx:679` records `onAuthStateChanged` at ~771 ms to ~8,690 ms. **An OTA apply forces exactly that cold start, so it is most likely to be seen right after a publish and will recur on every publish until that guard is widened.** Nobody has scoped widening it.

**Everything else merged is in a binary — vc 44 (Android) and build 63 (iOS), both built 2026-09-03, and BOTH ARE NOW LIVE:** Android on Play production, iOS 1.2.2 `READY_FOR_SALE` 2026-09-04. What rode in: Zero-Tap Sign-In (#107), Milestones (#108–#110), the Trends stub labels and water card (#115), the welcome intro, the onboarding reminders + first-log steps, the funnel events, the lapsed nudges, the log stopwatch, the rest-timer change — every Android OTA 88–109 that only ever reached the LG — plus the Ember-on-Ink icon, the dark splash, FCM (token registration verified in PROD), the iOS push entitlement, and the two Health Connect fixes. `CHANGELOG.md` 2026-09-03 has the evidence; the AGENTS.md rows for vc 44 and build 63 have the artifact reads.

**The unexplained iOS reload crash is CLOSED as moot, 2026-09-04.** It was one event, one device, no telemetry, on **build 60's runtime `7b347b0f…` — which this tree can no longer produce** (§1). Build 63 carries **0 `diagnosticSignatures`** (ASC, read 2026-09-04) and iOS has since taken six OTAs on `20a395de…` with no report. There is nothing left to reproduce it on; the rollback group it named targets a runtime no user is running. History and the decision tree, if it ever recurs: `apps/mobile/AGENTS.md`.

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
| 4 | **Celebrate the first log and first week** — award `first-scan` (issue 109, closed), a first-log `MilestoneNote`, `recordPositiveMoment` there so the review prompt lands after a win. §S12 still bans shame mechanics. | **Merged (issue 109 closed, PR 120) and PUBLISHED by OTA on both platforms 2026-09-04 — Android reaches production users now, iOS reaches build-63 installs only (§2).** `LogSource` (`'photo'`) is written at the scan, the award is made at the write, the rules carry it and are deployed. **Device-verified in PROD 2026-09-04** (`CHANGELOG.md`): a real scan wrote `source: "photo"` and exactly one `milestones/first-scan`, both stamped `14:18:35`; a relaunch added no second doc. `meals-100` stays parked — it needs a lifetime count no window answers honestly, and a profile counter is a separate call behind the `isValidProfile` expression ceiling (issue 100, closed). |
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
| **The website — Google started indexing it; re-measured 2026-09-04, unchanged. The sitemap is still never fetched** | **Nothing to do but wait and re-measure.** `node scripts/gsc.mjs inspect`, re-run 2026-09-04 and identical to 09-03: **6 of 7 sampled URLs are *Submitted and indexed*** (`/cutting-calculator`, `/protein-calculator`, `/tdee-calculator-women`, `/weight-loss-calculator`, `/es/calculator`, `/es/vs/macrofactor`); only `/transformations` is still *unknown*. That is against **0 of 7** on 07-29, 08-17 and 08-27, so the thing that moved is the **orphan-graph fix live since 08-31** (1 → 118 of 118 sitemap URLs reachable from `/`), not the sitemap — `lastDownloaded` is **still `not yet`** after a fourth submit today (0 warnings, 0 errors), so Google is crawling by links and ignoring the file. **The router/SSR migration stays DEFERRED** — the premise it rested on (Google never requests the pages) is now false. Next read: impressions/clicks in GSC Performance in ~2 weeks, and `/transformations`. Costing and both tables: `docs/seo-status.md`. |
| **Android device QA — the four known failures are FIXED; sweep is clean** | **Nothing blocking.** Host is the **LG VS988 (LG G6), Android 9 / API 28** over adb — two levels above `minSdk` 26, so a pass does NOT prove the floor. **2026-09-04, against the published vc 44 bundle (update id `01a06e70…` confirmed in logcat): a clean full sweep**, after 19/20 and 15/20 runs that are worth reading together — `apps/mobile/.maestro/regression/coverage.md` has all three. The 2026-08-30 `scrollUntilVisible` family is fixed with `optional: true` plus a bounded `repeat`/`while: notVisible` loop (Maestro's own adapter idiom), **additive on purpose** so iOS — where the command works and no device here can re-validate — cannot regress; the logs show it `SKIPPED` when the original succeeds. Flow 18 also needed two fixes that were NOT the scroll: a second `template-more-0` tap with no scroll in front of it, and three `start-workout` waits left at 15s when this file already documents the Train tab taking ~2 minutes on this device (**15s survived standalone and died in the suite**). **Swipe loops are at x=10%, not centre** — dead centre lands on the multiline cues `TextInput`, which scrolls itself rather than the sheet. **New host prerequisite: `settings put global wifi_networks_available_notification_on 0`.** At −77 dBm this device drops Wi-Fi and pops a system modal over the app; that, not the flows, caused the 15/20 run, and the failure SCREENSHOT is what showed it. `17-coach-ask` stays excluded (real Gemini money). **The suite WRITES** (11–13 log/edit/delete, 14 moves water, 09 changes locale) — check which account the device holds first; it is on `qa-test@ignia.fit`. Flow 12 creates a preset BY DESIGN and `node scripts/qa-regression-verify.mjs cleanup --email qa-test@ignia.fit` is the documented out-of-band teardown — run it after a sweep. Regaining adb after a reboot is PHYSICAL. |
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
