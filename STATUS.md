# STATUS — what is true right now

**Updated:** 2026-11-19 · **Owns:** current state only. Not history
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
*deleted* and the outcome goes to `CHANGELOG.md`. It hit 941 lines (2026-08-15)
and 328 (2026-11-19, with the Travel section pasted in twice and a §1 row
carrying a month of OTA history); rewritten that day.

---

## 1. Live right now

Numbers below are read from the APIs, never edited from memory. Re-read them the
same way before trusting them — `docs/COMMANDS.md` has every command;
`node scripts/app-version-sync.mjs --check` reads both stores in one call (last
run 2026-11-19).

| Surface | State |
|---|---|
| **App Store (iOS)** | **1.2.11 / build 75 LIVE** since 2026-11-06 21:49Z, runtime `e6d2973e…`. 175 of 175 territories. A **1.2.12 *Prepare for Submission* draft** holds the new screenshots (§3) |
| **TestFlight** | **Not re-read since 2026-09-08.** Read the group's builds AND each build's `externalBuildState` (`asc-testflight-external.mjs`) — `VALID` + in the group ≠ installable |
| **Play** | **Production: vc 53 / 1.2.10 COMMITTED 2026-11-19 and sent for review; vc 52 / 1.2.8 is what the listing serves until that clears.** Alpha: vc 53. The tracks API cannot tell "in review" from "live" — it already reports vc 53 as production — so the store page or the Console row is the read. Upload path: `play-upload-bundle.mjs`, then `play-production-release.mjs --complete --commit --vc N`; `eas submit` has exited 0 on failure three times |
| **Web `ignia.fit`** | **Shell + `/admin`** (ADR-0036). 113 prerendered pages, EN + es-PR, both store badges. Grep `public/` as well as `src/` before claiming copy is gone |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101`. Functions and rules last deployed 2026-11-19 with the activation batch (`CHANGELOG.md`): unverified owners may write; AI callables refuse an unverified email |
| **Photo-scan** | **ON and free, both platforms** (ADR-0017), macros from the bundled USDA DB (ADR-0019). Tiering server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB (13,272 foods) + restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call**; Open Food Facts serves barcode only |
| **OTA (EAS Update)** | **Three runtimes take OTAs: iOS build 75 (`e6d2973e…`), Android vc 52 (`dfb995ea…`) and vc 53 (`e989353d…`), both Android ones PINNED.** Update-required minimum: iOS `1.2.11`, Android vc `52` (set 2026-11-07 in `/admin`). **Newest: 2026-11-20, spoken labels (`cae457e0`), on build 75 + vc 53 ONLY. vc 52 last took 2026-11-10** (`25a93848`, tag `archive/ota/vc52-2026-11-10`) and cannot take `main`'s JS (it lacks `0c30979d`). **Next step, once the Play listing shows vc 53: raise the Android minimum to 53** (`/admin` → System → *Update required*, after "Sync now") — then every OTA comes from `main` and reaches every user. Do NOT raise it while vc 53 is still in review: vc 52 users would be sent to a store page with nothing to install. "Published" ≠ "delivered": a device applies an OTA on the launch AFTER the download, and on foreground only after 30+ min in the background. The ledger is the record and wins |
| **`app-version.json`** | **Self-driving** — served from Firestore `public/appVersion`, refreshed hourly by `hourlyTasks` and by `/admin` → System → **Sync now**. `npm run doctor` compares the live URL with both stores |

**Publishing:** OTAs for both platforms go out from the Windows PC (`winbox`,
checkout `Z:\fitness-tracker-pwa`); all three so far (2026-11-17, 2026-11-19
twice) were read back with `eas update:list`. Procedure: the `build-android` skill (one
runtime per command, Android pinned to the artifact value and reverted, assert
`git rev-parse HEAD` first). Current artifact fingerprints: the table in
`apps/mobile/AGENTS.md`.

**There is no build machine.** `ignia-mac` was sold 2026-11-13, so **no iOS
binary can be built** until another Mac is set up. Android: the Windows
raw-Gradle path is unverified since vc 45 and `winbox` has no Android SDK
installed beyond `platform-tools` (`Z:\packages\android-sdk`, 2026-11-19).
**No screen can be looked at before a publish:** there is no simulator, and the
Android emulator for this ARM64 PC (preview-channel `emulators;latest` 37.1.9 +
an `arm64-v8a` image) needs the Windows Hypervisor Platform, which is OFF —
`Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All`
in an elevated PowerShell, then a reboot (owner). Even then a release binary
only loads PUBLISHED updates, so the emulator checks an OTA after it goes out,
not before. **Anything that moves a fingerprint — a new
native library, a permission, an `app.json` change — is blocked. All work ships
as JS over OTA.** The Mac's git-ignored local files (`.env.local`, the ASC
`.p8`, Android signing, Train-UX captures, build 75's `.ipa` in
`C:\Users\gabri\build-artifacts`) were copied to the PC on 2026-11-12.

## 2. Merged, on `main`, and not delivered everywhere

- **Android production (vc 52) is behind `main`** by everything since
  2026-11-10: the 2026-11-17 and 2026-11-19 Train changes, the 2026-11-19
  standards sweep (labels, units, targets, the corrected Health privacy line) and
  `0c30979d` (Sentry RN 8.31, Expo patches — native, in vc 53 and iOS build 75
  only). Re-derive: `git log --oneline` against the newest ledger row per
  runtime.
- iOS build 75 and Android vc 53 carry everything on `main`.

**iOS regression suite: 21 of 21** (2026-09-22, simulator). It predates every
Train change since and **cannot be re-run without a Mac**. Never compose a
suite number from individual flow runs — the suite is order-dependent
(`.maestro/regression/README.md`).

## 3. Open work, and what each is blocked on

**Only genuinely open work belongs here.** A row whose work has shipped gets
deleted and its outcome goes to `CHANGELOG.md`.

### UX + competitive audit, 2026-11-19 — the next work, all OTA

Seven reviewers (five per surface, two on the market). Verdict: **the feature
set is at or past parity; what is missing is activation and legibility.**
Then scored against standards re-read that day (`docs/research/app-ux-standards.md`,
92 rules): **≈ 77 code-only, whole app** — Train 81.2, History lowest at 69.5.
Findings, the score table and the OTA batches: `UX_AUDIT.md` §S24; the market refresh:
`docs/research/competitive-feature-scan.md` (2026-11-19 addendum).
**Shipped 2026-11-19 / 20, all on build 75 + vc 53 — the five OTAs the
`UX_AUDIT.md` §S24 audit asked for:** the standards sweep (`d9cb2e9a`),
activation (`af651bff`), legibility (`7ebe7c86`), Train for non-owners
(`2cd8511c`) and the market gaps (`3762bca3`: re-log from a past day, Hevy /
Strong workout import), **plus two of leftovers on 2026-11-20
(`12ad5720`, `cae457e0`)**. The sweep was passed by the owner on the iPhone; the
other five were checked RENDERED IN A BROWSER against production with
throwaway accounts, deleted after (`docs/COMMANDS.md` → "A rendered check
without a device"). That is the same JavaScript on react-native-web, not the
native render: safe areas, the keyboard, native menus and both screen readers
are still unseen. Rollback is one republish per platform (ledger).
Behaviour changes the owner will meet: with no phase picked in Settings the
training phase follows the diet goal; the kg | lb switch is on a lift's card
only when that lift already uses another unit (else its ⋯ menu); "Gym busy"
is offered only to an account with a `gymBusy` template.
**Owed by the owner:** try the workout import with a REAL Hevy or Strong
export — neither app documents its file, so the parser was built to the
column names their exports are known by and tested on a hand-made sample.
A file it does not recognise is refused, not half-read. Since `12ad5720` a lift
is also matched by the same words in another order ("Bench Press (Barbell)" →
"Barbell Bench Press"), only when exactly one of the account's lifts has them.
**Error sweep 2026-11-20:** no production error needed a fix. Four of the six
open Sentry issues and all five `sendVerificationEmail` errors were the
browser check itself (resolved; the browser run no longer reports, and check
accounts use the mail provider's test inbox — `docs/COMMANDS.md`).
`hourlyTasks` gained `lateWelcome` (`bff138f8`, deployed): the welcome mail for
an account that verifies after onboarding.
**Next:** what the batches left open (`UX_AUDIT.md` §S24 "what is left",
S24-1b/1c/1d), then exercise stills once an image source with a clear
licence is found (S24-18), then the owner calls (S24-19, S24-27b, S24-28).
The Android bundle baseline was re-set 2026-11-20 at 6,570,230 bytes
gzipped (`scripts/perf-budget.json`; the reason is in that commit).

### Blocked on a Mac

- **New App Store screenshots** — ten frames (en-US 5, es-MX 5) sit in the
  1.2.12 draft in ASC (id `30305a82…`). ASC cannot edit a live version's
  screenshots, so they go live with the next iOS binary, which must be 1.2.12
  (or delete the draft and re-upload: `asc-upload-screenshots.mjs --locale
  <en|es> --replace`). What's New is empty and must be written first
  (`docs/app-store-metadata.md`, *Screenshots on file*).
- **Background steps** — the HealthKit plugin's AppDelegate hook does not match
  Expo 57's multi-line `didFinishLaunching`, so observers register from
  `index.js` → `steps-background.ts` a second or two into each launch. If
  deliveries stop, the fix is a config plugin (native).
- **S23-8** lock-screen Done set / Android promoted Live Update, Apple Watch
  logging, a share extension, exercise video (`expo-video` is not in the
  binary).

### Device QA owed (owner's phone; no simulator exists now)

- **1.2.11:** steps update with Ignia closed for an hour or more (Settings →
  Connected apps says "update in the background").
- **1.2.10 changes, live in 1.2.11 / vc 53:** Sentry init and tracing,
  Reanimated sheets, keyboard handling; a real iPhone Duo in the partly-folded
  pose.
- **Train, simulator/jest only so far:** progression rules (ADR-0044),
  supersets + Program v2/v2.1, pause / resume, the kg / unit work, the workout
  timer, everything in the 2026-11-17 and 2026-11-19 OTAs; lock-screen Done set
  on an iPhone and the OnePlus 8T; the VoiceOver / TalkBack pass (S23-9).
- **`ExerciseLibrarySheet` needs one real finger on an iPhone** — rows were
  dead inside the JS sheet's `Modal` (2026-09-17), revived as a native sheet
  2026-10-04, proven only by a Maestro tap. Fallback: the home screen's inline
  rows.
- **Hosts:** the OnePlus 8T on adb over Tailscale (`apps/mobile/scripts/phone.sh`)
  holds an adb-installed vc 48 signed with the upload key, so Play's update
  FAILS on it (OTAs do land). The Maestro suite WRITES — run it on
  `qa-test@ignia.fit`, then `node scripts/qa-regression-verify.mjs cleanup
  --email qa-test@ignia.fit`.

### Bugs known and not fixed

- **A session held open in the phone's memory beats the server copy**
  (`useTrain`: "a session started, resumed or edited in THIS runtime wins"), so
  a session closed by a script was finished again on the phone at the 24 h cap
  (2026-11-06; repaired by `scripts/owner-data-2026-11-06-haven.mts`). Fix:
  drop the local copy when the server says `completed`.
- **Predictive back is OFF on Android** despite `predictiveBackGestureEnabled:
  true` in `app.json` (`patch-android-release.mjs` step 4e; with it on, back
  from History backgrounded the app). Leave `app.json` alone until the next
  binary of BOTH platforms.
- Open JS items from the Train audit: `UX_AUDIT.md` §S23.

### Owner calls

- **Raise the Android minimum to 53** once the Play listing shows vc 53 live (§1).
- **Enable the Windows Hypervisor Platform + reboot** so the Android emulator can run (§1).
- **After the trip (ended 2026-11-18):** home v2.4 is locked in and the travel
  templates are archived and tagged (`CHANGELOG.md` 2026-11-19). First Push /
  Pull / Leg session each is a re-entry; maintenance shows "Rebuilding n/14"
  until 14 complete days home. Then decide whether `FEATURES.travelMode` goes to
  everyone.
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

Levers 1–4, 7, 8, 9 shipped (2026-09-02 → 09-16, `CHANGELOG.md`).

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
  aggregates it.
- **Social feed / challenges / leaderboards** — needs a server and moderation,
  and contradicts "calm". (`UX_AUDIT.md` N8; re-confirmed against Hevy's gym
  leaderboards 2026-11-19)
- **A paid or generative-AI program builder** — a rule-based picker is the
  shape if one ships (`UX_AUDIT.md` §S24-13).
- **A Google Group for the Play tester list** — reCAPTCHA on every member-add,
  no public API.
- **Deleting the website** — Apple needs the privacy URL, Play the
  delete-account URL, plus the Oura redirect, `app-version.json`, `/admin`. (ADR-0036)
- **A web logging surface** — retired on ADR-0022's own measurement (2.9% of
  active days). (ADR-0036)
- **Transferring `bermudezsystems.com` off Northwest** — owner's call
  2026-09-05. **Revisit when the LLC has income.**

## 5. App Store submission — standing rules

They live in `docs/app-store-metadata.md` §"Standing submission rules". Read
them before every submit: demo account, review notes, unverified features,
`supportsTablet`, frozen builds, Play's review-restart on listing edits.

## 6. What gets deleted

The housekeeping rule lives in `CLAUDE.md` (§"Where to look"): a plan document
is deleted the day its work ships — outcome to `CHANGELOG.md`, reasoning to an
ADR, state here; `git log --diff-filter=D --name-only` finds the original.
**The same rule applies to this file**: if adding a row would break the
~200-line budget, something above has already shipped and gets deleted, not amended.
