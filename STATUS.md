# STATUS — what is true right now

**Updated:** 2026-10-23 · **Owns:** current state only. Not history
(`CHANGELOG.md`), not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`),
not commands (`docs/COMMANDS.md`), not build tooling
(`docs/build-infrastructure.md`), not fingerprints or publish rules
(`apps/mobile/AGENTS.md`, `apps/mobile/docs/fingerprint-ledger.md`).

If a statement here conflicts with any other file in this repo, **this file
wins** — or the other file is stale and should be deleted. Three separate times
this project scoped already-shipped features as new work because a plan doc was
read as a status doc.

**This file is a status doc, not a changelog. Budget: ~200 lines AND ~35 KB
(`wc -l STATUS.md; wc -c STATUS.md`).** When something ships, its entry is
*deleted* and the outcome goes to `CHANGELOG.md`. It hit 941 lines (2026-08-15),
293 (2026-08-26), 249 (2026-09-17) and 282 (2026-10-16, trimmed the same day).

---

## 1. Live right now

Numbers below are read from the APIs, never edited from memory. Re-read them the
same way before trusting them — `docs/COMMANDS.md` has every command;
`node scripts/app-version-sync.mjs --check` reads both stores in one call.

| Surface | State |
|---|---|
| **App Store (iOS)** | **1.2.8 / build 72 LIVE** (read 2026-10-22 via `app-version-sync --check`). **1.2.10 / build 74 `WAITING_FOR_REVIEW`** since 2026-10-22 16:59 UTC (AFTER_APPROVAL, §3). 175 of 175 territories since 2026-08-28. This Mac reads ASC (`ASC_ISSUER_ID` + `ASC_KEY_PATH` in `.env.local`) |
| **TestFlight** | **Not re-read since 2026-09-08** (build 64 was the external build then). Read the group's builds AND each build's `externalBuildState` (`asc-testflight-external.mjs`) — `VALID` + in the group ≠ installable; a build of an already-released version never reaches an external tester |
| **Play** | **Production: vc 52 / 1.2.8 is the newest COMPLETED release** (tracks API, 2026-10-16). **The tracks API cannot tell "in review" from "live"** — the store page or the Console row is the read. Upload path: `play-upload-bundle.mjs`, then `play-production-release.mjs --complete --commit --vc N`; `eas submit` has exited 0 on failure three times |
| **Web `ignia.fit`** | **Shell + `/admin`** — the web logging app was retired 2026-08-30 (ADR-0036). 113 prerendered pages, EN + es-PR, both store badges. `/app` and the old tabs render "moved to the apps"; SEO pages and `/u/**` KEPT, owner-ratified. Grep `public/` as well as `src/` before claiming copy is gone |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101`. Rules last deployed 2026-10-22 (Program v2.2: exercise `effortStandard` `rir2`, template `templateVersion`) |
| **Photo-scan** | **ON and free, both platforms** (ADR-0017), macros from the bundled USDA DB (ADR-0019). Tiering server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB (13,272 foods) + restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call**; Open Food Facts serves barcode only. `docs/research/off-branded-ingest.md` scopes branded text results |
| **OTA (EAS Update)** | **Every runtime in use — twelve — has S-v2 (2026-10-24)**: template archive, the 15 % jump cap retired, calibration raise, RIR required on the last straight set, flat-reps warning, complete-day maintenance (ADR-0047) + Today "Day fully logged?". The ten Sentry-7.11 runtimes from `ota/perf-2026-10-21` @ `4ef6df01` (iOS builds 73 / 72 / 71 / 70 / 68, Android vc 52 / 51 / 50 / 48-49 / 47 — = `main` minus `0c30979d`), and the 1.2.10 runtimes from `main` @ `71655283` (build 74 `a55af49c…`, vc 53 `e989353d…` pinned). Rules (`archivedAt`, `dailyLogged`) deployed first. Groups and rollbacks in the ledger, which is the record and wins. "Published" ≠ "delivered": a device applies it on the launch AFTER the download, and on foreground only after 30+ min in the background |
| **`app-version.json`** | **Self-driving** — served from Firestore `public/appVersion`, refreshed hourly by `hourlyTasks` (Play tracks API; Apple's public lookup) and by `/admin` → System → **Sync now**. `npm run doctor` compares the live URL with both stores |

**Fingerprints and publishing:** current artifact values are the two-row table
in `apps/mobile/AGENTS.md`; the publish procedure (one runtime per command,
older runtimes PINNED to the artifact value and reverted, both platforms from
`ignia-mac`, assert `git rev-parse HEAD` before publishing) is the
`build-android` skill. After an Android Gradle build, restore the masked-view
manifest before an iOS gate (AGENTS.md).

**`ignia-mac` is a dedicated, closed-lid Ignia box since 2026-09-10** (Tailscale
`100.83.226.52`, SSH + RustDesk). Setup and disk: `docs/DEV_ENVIRONMENT.md`
§3.15, `CLAUDE.local.md`. Its PATH has no `firebase` CLI: run it from the npx
cache, and the emulator suites through `scripts/require-java21.mjs`.

## 2. Merged, on `main`, and not delivered anywhere

**`0c30979d` — Sentry RN 8.31, Expo patch bumps, sampled tracing, the metro trim** — in the 1.2.10 binaries only
(iOS build 74, TestFlight; Android vc 53, alpha; §3), in no store release and never OTA-able to older runtimes.
Everything else on `main` is in an OTA on every runtime (2026-10-23, §1), including `ae03c475` (the equal-segment fast
path), which build 74 lacks natively and receives by OTA.
The native halves of 1.2.7/1.2.8 (lock-screen Done set, Android Live Update,
widget/watch day rollover, QuickAdd queue cap) reach users only with 1.2.8.
Re-derive rather than trust this: `git log --oneline` against the newest ledger
row.

**iOS regression suite: 21 of 21** (2026-09-22, `ignia-mac`, simulator
`Ignia-QA-26`; the 09-23 sweep ran on iOS 27 `Ignia-QA`). It predates every
Train change since. **Never compose a suite number from individual flow runs**
— the suite is order-dependent; setup and traps in
`.maestro/regression/README.md`.

## 3. Open work, and what each is blocked on

**Only genuinely open work belongs here.** A row whose work has shipped gets
deleted and its outcome goes to `CHANGELOG.md`.

### 1.2.8 — live on iOS (2026-10-22); raise the minimum

- **iOS** build 72 is LIVE (2026-10-22, iTunes lookup). **Android** vc 52 is
  the completed production release — confirm on the store page that it is live,
  not in review; then the minimum can be raised.
- **When BOTH are live:** `/admin` → Overview → System → Update required:
  iOS `1.2.8`, Android `52`. Then OTAs go to the 1.2.8 runtimes only
  (`50a47f62…`, `dfb995ea…`) plus any newer TestFlight/alpha build — nine
  publishes per change until then.
- **Flip `ACCEPT_LEGACY_PROMPT_SHAPE` to `false`** (`functions/src/ai-prompt-input.ts`
  + spec) once `legacyPromptShape` stops appearing in the functions logs.
- **Owner:** coach on `GEMINI_MODEL` (flash-lite) since 2026-10-15 — confirm
  quality. Check `emailRateLimits/pw_ip_*` differ per caller.
- Health nutrition samples exported before 2026-10-15 carry no Ignia id;
  undo/edit of those older entries cannot reach Health.

### 1.2.10 — Sentry RN 8.31 + the native library fixes (built 2026-10-22)

- **iOS** build 74 / 1.2.10 at `07cff821`, Xcode 27.1 `27A9275`, runtime
  `a55af49c…` (artifact) — `VALID` in ASC 2026-10-22, internal TestFlight only.
  **Android** vc 53 / 1.2.10 at `ae03c475` (raw Gradle + patch script),
  runtime `e989353d…` (artifact) — Play **alpha**, committed and sent for
  review. **iOS submitted 2026-10-22: 1.2.10 `WAITING_FOR_REVIEW`**
  (AFTER_APPROVAL; What's New in `docs/app-store-metadata.md`). Play
  production for vc 53 not yet promoted (owner's call).
- Contains `0c30979d` (Sentry RN 7.11 → 8.31 with sampled tracing,
  reanimated 4.5.5, worklets 0.10.4, keyboard-controller 1.22.8, Expo 57
  patches) and everything on `main`. Built on the 27.1 SDK, so it carries
  1.2.9's iPhone Duo fix too: **1.2.9 / build 73 will not be submitted** — 1.2.10 supersedes it.
- **Owed:** device QA on both (Sentry init and tracing, Reanimated sheets,
  keyboard handling); the equal-segment fast path (`ae03c475`) still needs
  an OTA to reach build 74 and the older runtimes.

### 1.2.9 — superseded by 1.2.10 (never submitted)

- Build 73 (`d7aad40d…`, the iPhone Duo SDK fix) stays a TestFlight-only
  runtime that OTAs still reach; 1.2.10 / build 74 carries the same fix.
  **Still owed, now on 1.2.10:** device QA on a real Duo (the simulator covered
  closed / open landscape / open portrait, Release; the partly-folded "book"
  pose was not tried).

### Train — owner calls and device checks owed

- **Program v2.1 owner calls (2026-10-15):** Seated DB Shoulder Press set
  70 → 80 per the spec (the engine had called 72.5); Leg Curls at 100 while the
  saved stack is 70/80/90 (not snapped; next step assumed 110); the three v2
  drafts still hold pre-v2.1 copies, so "back to v1" and forward would undo
  v2.1.
- **Not device-QA'd** — simulator/emulator and jest only: progression rules
  (ADR-0044), supersets + Program v2, the Train UX passes (open list
  `UX_AUDIT.md` §S23), Program v2.1 (deload card, dumbbell toggle, Zone 2 on
  Trends). The Android guarded-sheet fix touches every guarded sheet in the app.
- **1.2.7 features in 1.2.8, submitted without device QA:** the script in
  `FIX-N2.md` (on `ignia-mac`, `apps/mobile/.maestro/capture/train-ux/reviews/`)
  — lock-screen Done set on an iPhone and on the OnePlus 8T; the Android 16
  promoted chip on the `pixel_api36` emulator. Plus the owner's
  VoiceOver/TalkBack pass (`DEVICE-A11Y-CHECKLIST.md`, same folder). Also
  simulator-only: the glass tab bar, the fit-sheet underlap, `UISegmentedControl`.
- **`ExerciseLibrarySheet` needs one real finger on an iPhone.** Rows were dead
  inside the JS sheet's RN `Modal` (2026-09-17, cause never found); revived
  2026-10-04 as a native `UISheetPresentationController` sheet, and a Maestro
  tap opened a row on 2026-10-11 — but the original failure was proven with a
  real click. Fallback if it fails: the home screen's 5 inline rows.
- **Predictive back is OFF on Android** despite `predictiveBackGestureEnabled:
  true` in `app.json` — `patch-android-release.mjs` step 4e rewrites the
  manifest (with it on, back from History backgrounded the app, OnePlus 8T
  2026-10-05). Leave `app.json` alone until the next binary of BOTH platforms.
- **Device QA hosts:** the OnePlus 8T on adb over Tailscale
  (`apps/mobile/scripts/phone.sh`) — it holds an adb-installed vc 48 signed with
  the upload key, so Play's update FAILS on it (reinstall from Play to prove a
  Play update); OTAs do land. The LG VS988 (Android 9) too; neither is the
  API 26 floor. **The Maestro suite WRITES** — run it on `qa-test@ignia.fit`,
  then `node scripts/qa-regression-verify.mjs cleanup --email qa-test@ignia.fit`.

### Retention — the standing focus (owner's call, 2026-09-02)

**Activation and the daily habit are the problem, not late churn.**
`config/retention` re-read 2026-09-16 (120-day window, `insufficientSample:
true`): 43 signups → **14 activated (33%)**; **0.34 logs per activated user
per day**; `timeToFirstLog` median **34 m 43 s** (17.6% inside five minutes);
`secsPerLog` **56.2 s**. Lever 1 worked — time-to-first-log more than halved,
logs/activated/day up 2.3×.

**Two things are the job.** **Reminders opt-in is a REAL zero** (0 of 43;
instrument verified 2026-09-16), so every notification-shaped lever reaches
nobody — lever 10 is the live move. And `secsPerLog` is past the 30 s cliff:
**search 23.8 s vs photo 79.8 s**; nobody has looked at where photo's 80 s goes.
**Re-read `config/retention` before claiming anything moved** — at ~40 signups
per 120 days no A/B is readable. The denominator is signups IN WINDOW: 8 April
accounts that still log daily (the owner's among them) sit outside it.

| # | Lever | State |
|---|---|---|
| 5 | **Verify the zero-friction triggers** (a widget logs in under 10 s) | Android widget VERIFIED 2026-09-08 (row below); watch/Siri open, owner with an iPhone |
| 6 | **Guest mode (`UX_AUDIT.md` N5)** if lever 1 does not move D1 alone | Deferred until 1 is measured |
| 10 | **Ask for reminders AFTER the first log lands**, not during onboarding | **Open.** Nothing else notification-shaped is worth building first |

Levers 1–4, 7, 8, 9 shipped (2026-09-02 → 09-16, `CHANGELOG.md`). Not taken,
deliberately: bounding the OS-repeating meal-window dailies — a separate call.

| Work | Blocked on |
|---|---|
| **Photo scan — `measured` never seen on a device** | **Owner, with a phone and a real scale under the plate** — a composited "245 g" overlay correctly came back `measured: false`. Repeat detection FIRED on a device 2026-09-08. **Seams:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness); `measured` drops if `clampGrams` altered the number. **Owner call:** should a matched repeat land on an editable draft instead of logging straight to Today? |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions**, never the macros — `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **Oura — a cardio record via Oura never observed** | The ring's owner recording a walk/run/cycle (the two synced records were `strengthTraining`, deliberately declined — issue 102). **Seam:** an imported `kcal` never reaches a target (ADR-0024 decision 4, `cardio-energy-independence.test.ts`) |
| **Android widget — two checks left** | Verified on the OnePlus 2026-09-08 (numbers move on log/delete, tap opens add, sign-out blanks). Open: midnight blanking (ColorOS refuses a clock change from adb) and the es-PR wording. Flows: `.maestro/capture/widget-*.yaml` |
| **Watch complication + Siri quick-add** | **UNVERIFIED on hardware.** A WidgetKit complication cannot be woken (FB12926788, ADR-0023) — what ships is an hourly pull. Read *Settings → Apple Watch* on a device before writing more code; a simulator cannot test the refresh budget |
| **Website indexing** | **Wait and re-measure** (`node scripts/gsc.mjs inspect`): 6 of 7 sampled URLs indexed since 2026-09-03, the sitemap still never fetched. Router/SSR migration DEFERRED. Tables: `docs/seo-status.md` |
| **MenuStat permission — sent 2026-08-24, no reply** | **Owner, awaiting NYC DOHMH.** Licence risk: menustat.org (through 2022) was all-rights-reserved and is gone; the CC0 Dataverse copy stops at 2018 and loses The Cheesecake Factory. Replies land in the `bermudezpr.com` M365 tenant. Follow-ups: Pollo Tropical; the mobile provenance chip |

**The maintenance 95% interval is computed and never shown.** `seTdee` /
`ci95Tdee` exist (`tdee.ts`); Today shows only the binary `holding`. One account
read `confidence` 0.957 with an interval of **1,775..3,242**, and its caveat
blames gaps, which is not where that width came from. A range on the hero is a
product decision (alarming, and correctly so).

## 4. Decided and deliberately not happening

Do not re-propose these without new information; reasoning is in the linked ADR
or research note.

- **Pro tier / subscriptions** — v1 is free; `PRO_ENABLED = false` on mobile. **Stripe is GONE** (2026-08-31); a paid tier would be Apple/Google IAP only. (ADR-0015)
- **Watch app reading Firestore directly** — there is no watchOS Firestore
  client. (`docs/research/watch-complication-transport.md`)
- **Real-time push to a WidgetKit complication** — Apple-side, FB12926788. (ADR-0023)
- **Activity feeding measured-mode TDEE** — would double-count. Formula mode only.
- **Shared subscription cache in mobile** — per-hook subscriptions are
  intentional. (ADR-0016)
- **A 4th scheduled Cloud Function** — Cloud Scheduler's free 3 jobs are spent;
  fold into `hourly-tasks.ts`.
- **A Strava integration** — its June 2026 API Agreement forbids AI/ML use of
  API data. (`docs/research/connected-apps-candidates.md`)
- **A fourth connected-apps provider** — Withings only, and iOS already
  aggregates it. The cheaper win: give Apple Health Oura's evidence surface.
- **A Google Group for the Play tester list** — reCAPTCHA on every member-add,
  no public API. (`CLAUDE.local.md`)
- **Deleting the website** — Apple needs the privacy URL, Play the
  delete-account URL, plus the Oura redirect, `app-version.json`, `/admin`. (ADR-0036)
- **A web logging surface** — retired on ADR-0022's own measurement (2.9% of
  active days). (ADR-0036)
- **Transferring `bermudezsystems.com` off Northwest** — owner's call
  2026-09-05; it renews free with the Registered Agent service. **Revisit when
  the LLC has income.**

## 5. App Store submission — standing rules

They live in `docs/app-store-metadata.md` §"Standing submission rules" (moved
2026-09-17). Read them before every submit: demo account, review notes,
unverified features, `supportsTablet`, frozen builds, Play's review-restart on
listing edits.

## 6. What gets deleted

The housekeeping rule lives in `CLAUDE.md` (§"Where to look"): a plan document
is deleted the day its work ships — outcome to `CHANGELOG.md`, reasoning to an
ADR, state here; `git log --diff-filter=D --name-only` finds the original.
**The same rule applies to this file**: if adding a row would break the
~200-line budget, something above has already shipped and gets deleted, not amended.
