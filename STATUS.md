# STATUS — what is true right now

**Updated:** 2026-11-20 · **Owns:** current state only. Not history
(`CHANGELOG.md`), rationale (`docs/adr/`), vocabulary (`CONTEXT.md`), commands
(`docs/COMMANDS.md`), build tooling (`docs/build-infrastructure.md`) or
fingerprints (`apps/mobile/AGENTS.md`, `apps/mobile/docs/fingerprint-ledger.md`).

If a statement here conflicts with any other file in this repo, **this file
wins** — or the other file is stale and should be deleted.

**Budget: 200 lines and 35 KB; `npm run doctor` fails past either.** When
something ships, its entry is *deleted* and the outcome goes to `CHANGELOG.md`.
A row that would break the budget means something above has already shipped.

## 1. Live right now

Read from the APIs, never edited from memory (`docs/COMMANDS.md`);
`node scripts/app-version-sync.mjs --check` reads both stores (last run 2026-11-19).

| Surface | State |
|---|---|
| **App Store (iOS)** | **1.2.11 / build 75 LIVE** since 2026-11-06 21:49Z, runtime `e6d2973e…`. 175 of 175 territories. A **1.2.12 *Prepare for Submission* draft** holds the new screenshots (§3) |
| **TestFlight** | **Not re-read since 2026-09-08.** Read the group's builds AND each build's `externalBuildState` (`asc-testflight-external.mjs`) — `VALID` + in the group ≠ installable |
| **Play** | **Production: vc 53 / 1.2.10 LIVE** (2026-11-20: `androidpublisher` production track = 53 and the public listing reads 1.2.10). Alpha: vc 53. The tracks API cannot tell "in review" from "live", so the store page is the read. Upload path: `play-upload-bundle.mjs`, then `play-production-release.mjs --complete --commit --vc N`; `eas submit` has exited 0 on failure three times |
| **Web `ignia.fit`** | **Shell + `/admin`** (ADR-0036). 113 prerendered pages, EN + es-PR, both store badges. Grep `public/` as well as `src/` before claiming copy is gone |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101`. Last deployed 2026-11-20 (rules: `proteinFirst`; functions: `lateWelcome` in `hourlyTasks`, the verified-only public user count, and `analyzePhoto` with the label mode) |
| **Photo-scan** | **ON and free, both platforms** (ADR-0017), macros from the bundled USDA DB (ADR-0019). Tiering server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling`. **A nutrition-label read is the same function (`mode: 'label'`) and spends the same scans** |
| **Food search** | Bundled USDA DB (13,272 foods) + restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call**; Open Food Facts serves barcode only |
| **OTA (EAS Update)** | **Two runtimes take OTAs: iOS build 75 (`e6d2973e…`) and Android vc 53 (`e989353d…`, PINNED).** Update-required minimum: iOS `1.2.11`, Android vc `53` (raised 2026-11-20; read from the live `app-version.json`). Every OTA comes from `main` and reaches every user who is not behind the update screen. **Newest: 2026-11-20, the medication log, protein first on Trends and the Android widget, and the label scan (`f2576113`).** Android vc 52 is below the minimum and owed nothing more (its last JS: `25a93848`, tag `archive/ota/vc52-2026-11-10`). "Published" ≠ "delivered": a device applies an OTA on the launch AFTER the download, and on foreground only after 30+ min in the background. The ledger is the record and wins |
| **`app-version.json`** | **Self-driving** — served from Firestore `public/appVersion`, refreshed hourly by `hourlyTasks` and by `/admin` → System → **Sync now**. `npm run doctor` compares the live URL with both stores |

**Publishing:** OTAs for both platforms go out from the Windows PC (`winbox`,
checkout `Z:\fitness-tracker-pwa`) with `bash scripts/ota-release.sh "<what
changed>"`: tests, the fingerprint gate, the size budget, one publish per
runtime, the read-back and the ledger rows (`build-android` skill for the why).
Current artifact fingerprints: the table in `apps/mobile/AGENTS.md`.

**There is no build machine** (`ignia-mac` was sold 2026-11-13): no iOS binary
can be built until another Mac is set up, and the Windows raw-Gradle path is
unverified since vc 45 (`winbox` has no Android SDK beyond `platform-tools`).
**Anything that moves a fingerprint — a new native library, a permission, an
`app.json` change — is blocked. All work ships as JS over OTA.** Build 75's
`.ipa` and the Mac's git-ignored files are in `C:\Users\gabri\build-artifacts`.
**No native screen can be looked at before a publish:** there is no simulator,
and the Android emulator needs the Windows Hypervisor Platform, which is OFF
(owner call, §3; even then a release binary loads only PUBLISHED updates). The
rendered check is the app in a browser (`test-mobile-web` skill).

## 2. Merged, on `main`, and not delivered everywhere

- Nothing: iOS build 75 and Android vc 53 carry everything on `main`.

**iOS regression suite: 21 of 21** (2026-09-22, simulator). It predates every
Train change since and **cannot be re-run without a Mac**
(`apps/mobile/.maestro/regression/README.md`).

## 3. Open work, and what each is blocked on

### UX + competitive audit, 2026-11-19 — all OTA

Verdict: **the feature set is at or past parity; what is missing is activation
and legibility** (≈ 77 against the 92 rules of
`docs/research/app-ux-standards.md`; findings in `UX_AUDIT.md` §S24). The
audit's batches and their follow-ups, through protein-first mode, shipped
2026-11-19 / 20 on build 75 + vc 53 (`CHANGELOG.md`). All but the first were
checked rendered in a browser only: safe areas, the keyboard, native menus and
both screen readers are unseen.
**The 2026-11-20 active-session OTA (`cc8ff46f`) was published on tests alone**
(owner's call): no rendered check of start → log a set → finish. Rollback:
republish the previous groups (ledger, top rows).

**Open, in order:** `UX_AUDIT.md` §S24 "what is left" (S24-1c/1d); exercise
stills once an image source with a clear licence is found (S24-18); the owner
calls S24-27b and S24-28. **Re-measure activation** (`config/retention`) about
two weeks after 2026-11-19.
**The three features of 2026-11-20 evening have been seen on NO screen** — the
medication log, protein first on Trends and the Android widget, the label
scan. Tests only, plus the label reader run for real against the deployed
function on GENERATED panels (not phone photos). First things to look at on a
phone: Settings → Medication; + → More ways → Scan a nutrition label.

### Blocked on a Mac

- **New App Store screenshots** — ten frames (en-US 5, es-MX 5) sit in the
  1.2.12 draft in ASC (id `30305a82…`) and go live with the next iOS binary,
  which must be 1.2.12. What's New is empty and must be written first
  (`docs/app-store-metadata.md`, *Screenshots on file*).
- **Background steps** — the HealthKit plugin's AppDelegate hook does not match
  Expo 57's multi-line `didFinishLaunching`, so observers register from
  `index.js` → `steps-background.ts` a second or two into each launch. If
  deliveries stop, the fix is a config plugin (native).
- **S23-8** lock-screen Done set / Android promoted Live Update, Apple Watch
  logging, a share extension, exercise video (`expo-video` is not in the binary).

### Device QA owed (owner's phone; no simulator exists now)

- **1.2.11:** steps update with Ignia closed for an hour or more (Settings →
  Connected apps says "update in the background").
- **1.2.10 changes, live in 1.2.11 / vc 53:** Sentry init and tracing, Reanimated
  sheets, keyboard handling; a real iPhone Duo in the partly-folded pose.
- **Train, simulator/jest only so far:** progression rules (ADR-0044),
  supersets + Program v2/v2.1, pause / resume, the kg / unit work, the workout
  timer, everything in the 2026-11-17 and 2026-11-19 OTAs; lock-screen Done set
  on an iPhone and the OnePlus 8T; the VoiceOver / TalkBack pass (S23-9).
- **`ExerciseLibrarySheet` needs one real finger on an iPhone** — rows were
  dead inside the JS sheet's `Modal` (2026-09-17), revived as a native sheet
  2026-10-04, proven only by a Maestro tap. Fallback: the home screen's rows.
- **Hosts:** the OnePlus 8T on adb over Tailscale (`apps/mobile/scripts/phone.sh`)
  holds an adb-installed vc 48 signed with the upload key, so Play's update
  FAILS on it (OTAs do land). The Maestro suite WRITES: `apps/mobile/.maestro/regression/README.md`.

### Bugs known and not fixed

- **Predictive back is OFF on Android** despite `predictiveBackGestureEnabled:
  true` in `app.json` (`patch-android-release.mjs` step 4e; with it on, back
  from History backgrounded the app). Leave `app.json` alone until the next
  binary of BOTH platforms.
- Open JS items from the Train audit: `UX_AUDIT.md` §S23.

### Owner calls

- **Enable the Windows Hypervisor Platform + reboot** so the Android emulator
  can run: `Enable-WindowsOptionalFeature -Online -FeatureName
  HypervisorPlatform -All` in an elevated PowerShell.
- **Travel mode for everyone?** Decide once maintenance leaves "Rebuilding
  n/14" (14 complete days home after 2026-11-18): `FEATURES.travelMode`.
- **`FEATURES.maintenanceDisplay`** (7-day mean + 95% range on the hero) is
  `'admin'`; rollout waits on the owner, because the range can read wide (one
  account: 1,775..3,242).
- **Program v2.1 (2026-10-15):** Seated DB Shoulder Press 70 → 80 per the spec
  (the engine had called 72.5); Leg Curls at 100 while the saved stack is
  70/80/90; the three v2 drafts still hold pre-v2.1 copies.
- **Coach on `GEMINI_MODEL` (flash-lite)** since 2026-10-15 — confirm quality.
  Check `emailRateLimits/pw_ip_*` differ per caller.
- **S23-13:** red on status surfaces ("WORKOUT IN PROGRESS"); "Next up" picks
  never-done templates first.

### Small and open

- Flip `ACCEPT_LEGACY_PROMPT_SHAPE` to `false` (`functions/src/ai-prompt-input.ts`
  + spec) once `legacyPromptShape` stops appearing in the functions logs.
- Health nutrition samples exported before 2026-10-15 carry no Ignia id;
  undo/edit of those older entries cannot reach Health.

### Retention — the standing focus (owner's call, 2026-09-02)

**Activation and the daily habit are the problem, not late churn.**
`config/retention` re-read 2026-09-16 (120-day window, `insufficientSample:
true`): 43 signups → **14 activated (33%)**; **0.34 logs per activated user
per day**; `timeToFirstLog` median **34 m 43 s**; `secsPerLog` **56.2 s**
(search 23.8 s vs photo 79.8 s — a mean capped at 300 s per log, so read the
median before acting on it). **Reminders opt-in is a REAL zero** (0 of 43).
**Re-read `config/retention` before claiming anything moved** — at ~40 signups
per 120 days no A/B is readable, and the denominator is signups IN WINDOW.

| # | Lever | State |
|---|---|---|
| 5 | **Verify the zero-friction triggers** | Android widget VERIFIED 2026-09-08; watch/Siri open, owner with an iPhone |
| 6 | **Guest mode (`UX_AUDIT.md` N5)** | Deferred; the verification wall came down 2026-11-19 (§S24-1). Re-measure "ever logged" before building this |
| 10 | **Ask for reminders AFTER the first log lands** | **Open, not built** — the ask is still an onboarding step (`UX_AUDIT.md` §S24-3) |

| Work | Blocked on |
|---|---|
| **Photo scan — `measured` never seen on a device** | **Owner, with a phone and a real scale under the plate.** Seams: `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness); `measured` drops if `clampGrams` altered the number. **Owner call:** should a matched repeat land on an editable draft instead of logging straight to Today? |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions**, never the macros — `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **Oura — a cardio record via Oura never observed** | The ring's owner recording a walk/run/cycle. **Seam:** an imported `kcal` never reaches a target (ADR-0024 decision 4) |
| **Android widget — two checks left** | Midnight blanking (ColorOS refuses a clock change from adb) and the es-PR wording. Flows: `.maestro/capture/widget-*.yaml` |
| **Watch complication + Siri quick-add** | **UNVERIFIED on hardware.** A WidgetKit complication cannot be woken (ADR-0023) — what ships is an hourly pull. Read *Settings → Apple Watch* on a device before writing more code |
| **Website indexing** | **Wait and re-measure** (`node scripts/gsc.mjs inspect`). Router/SSR migration DEFERRED. Tables: `docs/seo-status.md` |
| **MenuStat permission — sent 2026-08-24, no reply** | **Owner, awaiting NYC DOHMH.** Licence risk in `docs/research/restaurant-foods-menustat.md`. Replies land in the `bermudezpr.com` M365 tenant |

## 4. Decided and deliberately not happening

Do not re-propose these without new information; the reasoning is in the linked ADR or note.

- **Pro tier / subscriptions** — v1 is free; `PRO_ENABLED = false` on mobile. **Stripe is GONE** (2026-08-31); a paid tier would be Apple/Google IAP only. (ADR-0015)
- **Watch app reading Firestore directly** — there is no watchOS Firestore client. (`docs/research/watch-complication-transport.md`)
- **Real-time push to a WidgetKit complication** — Apple-side, FB12926788. (ADR-0023)
- **Activity feeding measured-mode TDEE** — would double-count. Formula mode only.
- **Shared subscription cache in mobile** — per-hook subscriptions are intentional. (ADR-0016)
- **A 4th scheduled Cloud Function** — Cloud Scheduler's free 3 jobs are spent; fold into `hourly-tasks.ts`.
- **A Strava integration** — its June 2026 API Agreement forbids AI/ML use of API data. (`docs/research/connected-apps-candidates.md`)
- **A fourth connected-apps provider** — Withings only, and iOS already aggregates it.
- **Social feed / challenges / leaderboards** — needs a server and moderation, and contradicts "calm". (`UX_AUDIT.md` N8; re-confirmed against Hevy's gym leaderboards 2026-11-19)
- **A paid or generative-AI program builder** — a rule-based picker is the shape if one ships (`UX_AUDIT.md` §S24-13).
- **A Google Group for the Play tester list** — reCAPTCHA on every member-add, no public API.
- **Deleting the website** — Apple needs the privacy URL, Play the delete-account URL, plus the Oura redirect, `app-version.json`, `/admin`. (ADR-0036)
- **A web logging surface** — retired on ADR-0022's own measurement (2.9% of active days). (ADR-0036)
- **Transferring `bermudezsystems.com` off Northwest** — owner's call 2026-09-05. **Revisit when the LLC has income.**

## 5. App Store submission — standing rules

`docs/app-store-metadata.md` §"Standing submission rules": read them before every submit
(demo account, review notes, unverified features, `supportsTablet`, frozen builds, Play's review-restart).
