# STATUS — what is true right now

**Updated:** 2026-09-07 · **Owns:** current state only. Not history
(`CHANGELOG.md`), not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`),
not commands (`docs/COMMANDS.md`), not build tooling
(`docs/build-infrastructure.md`).

If a statement here conflicts with any other file in this repo, **this file
wins** — or the other file is stale and should be deleted. Three separate times
this project scoped already-shipped features as new work because a plan doc was
read as a status doc.

**This file is a status doc, not a changelog. Budget: ~200 lines AND ~35 KB
(`wc -l STATUS.md; wc -c STATUS.md`).** When something ships, its entry is
*deleted* and the outcome goes to `CHANGELOG.md`. It reached 941 lines once
(2026-08-15, four self-contradictions) and 293 lines / 65 KB once (2026-08-26,
4,500-character cells); a status file nobody can hold in their head stops being read.

---

## 1. Live right now

Numbers below are read from the APIs, never edited from memory. Re-read them the
same way before trusting them — `docs/COMMANDS.md` has every command.

| Surface | State |
|---|---|
| **Public App Store (iOS)** | **1.2.3 / build 64, `READY_FOR_SALE`, released 2026-09-06 00:01 UTC** (iTunes lookup + ASC API, read 2026-09-07). Runtime `52802bba…`, which IS what this tree produces, so **the iOS OTA channel is OPEN to the public**; the first publish on it is the 2026-09-07 IGNIA-MOBILE-V fix (`apps/mobile/AGENTS.md`). Carries the re-shot screenshots (en-US 5, es-MX 5) and `usesIdfa: false`. **Available in 175 of 175 territories** since 2026-08-28 (DSA trader declaration filed). Play matched on 2026-09-03: 158 of Play's attainable 158 |
| **TestFlight** | **build 64 / 1.2.3 (runtime `52802bba…`) is in the EXTERNAL *Public Beta Testers* group, `WAITING_FOR_BETA_REVIEW` since 2026-09-05.** Build 63 is in the group but can never reach an external tester — a build of an already-released version stays `READY_FOR_BETA_SUBMISSION` forever. **Read the group's builds AND each build's `externalBuildState`, never assume:** `VALID` + in the group ≠ installable |
| **Play production + alpha** | **LIVE — vc 44 / 1.2.2 (runtime `68ea2dd3…`), the first Android production release, published 2026-09-03.** **vc 45 / 1.2.3 (runtime `15c1cfc8…`, the IGNIA-MOBILE-V fix) is committed to production at 100% AND on alpha, IN REVIEW.** First sent 2026-09-07 ~14:30 UTC via `play-upload-bundle.mjs` → `play-production-release.mjs`; **the review was RESTARTED 2026-09-07 ~15:05 UTC** when the listing changes (Ember-on-Ink icon, feature graphic, five re-shot phone screenshots) were sent for review from the same submission — Play warned it would restart, and that was the accepted trade. **The tracks API cannot tell "in review" from "live"** — `app-version-sync --check` already reports production 45 / alpha 45; the Console app row (*In review*) or the store page is the read. **Knock-on:** `hourlyTasks` reads the same tracks API, so `app-version.json` will advertise 45 while the store still serves 44 until the review lands — self-healing, noted, not fixed. The Data safety amendment (09-03) is also still open. `eas submit` has failed and exited 0 three times (lost Play edit on bundles > 60 MB; a missing health declaration) — **`play-upload-bundle.mjs` is the upload path; confirm every submit against the tracks API** |
| **Web `ignia.fit`** | **Shell + `/admin` — the web logging app was RETIRED 2026-08-30 (ADR-0036).** 113 prerendered pages, EN + es-PR. Landing links BOTH stores since 2026-09-07 (`PLAY_STORE_LIVE = true`); no "coming soon" copy or i18n key remains. `/app` and the old tabs render a "moved to the apps" page; a safety worker evicts old PWA installs. SEO pages and `/u/**` are KEPT, owner-ratified |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call** (since 2026-08-19; Open Food Facts serves **barcode only** — its 10 req/min search cap cannot host typeahead behind one egress IP). Servings ship with each hit. `docs/research/off-branded-ingest.md` scopes getting branded text results back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **iOS OPEN** on `52802bba…` since 2026-09-06. **Android SHUT** — the tree produces `15c1cfc8…`, which only vc 45 ships, and vc 45 is in review; reopens the moment it is live. Cause: the 1.2.3 bump (`437a90ce`) — `app.json` is hashed whole, so a version string moves BOTH fingerprints. **"Published" is not "delivered":** a user gets it on the launch AFTER the download. **This row is a POINTER: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** Re-check with `npx eas update:list --branch production --limit 3` |
| **`app-version.json`** | **Self-driving since 2026-09-05** — served from Firestore `public/appVersion` by the `appVersionJson` rewrite, refreshed hourly by `hourlyTasks` (Android from the Play tracks API as `647810616435-compute@…`, invited read-only to the org Play Console; iOS from Apple's public lookup) and on demand from `/admin` → System → **Sync now**. No static file, no deploy, no secret; `npm run doctor` compares the LIVE URL with both stores. See the Play row for the in-review wrinkle |

**The runtime fingerprints, and the three traps around them.**

| Platform | Tree now | Live binary | Channel |
|---|---|---|---|
| Android | `15c1cfc8…` (since `437a90ce`, the 1.2.3 bump) | **vc 44** ships `68ea2dd3…` (read from the `.aab`), live on production. **vc 45** ships `15c1cfc8…` (read from the `.aab`), in review | **SHUT** until vc 45 is live |
| iOS | `52802bba…` | **build 64 ships `52802bba…`, `READY_FOR_SALE` as 1.2.3 since 2026-09-06** (read from the `.ipa`) | **OPEN** to the public |

- **The fingerprint is machine-dependent — publish from the machine that BUILDS
  that platform: Android from Windows, iOS from `ignia-mac`.** Bare `eas update`
  publishes both and is correct on neither — always `--platform`-scope it
  (`.claude/hooks/guard_eas_update.py` enforces it). Three OTAs once reached
  **nobody** this way. Why the hosts disagree is settled (`@expo/fingerprint`
  is CRLF-vs-LF sensitive) and is not worth another session.
- **`app.json` and `eas.json` are hashed as WHOLES** — a submit profile or a
  version bump alone moves both runtimes; it has shut both channels three
  times. Android-only manifest/Gradle changes belong in
  `patch-android-release.mjs` (gitignored prebuild output). `apps/mobile/AGENTS.md`.
- **`plugins/withGradleJvmArgs.js` is FROZEN** — any byte, *including a
  comment*, moves both platforms. Its docstring is stale on purpose.

**`ignia-mac` disk is a recurring build constraint** — 19.18 GiB free against
an iOS build's ~17 GB floor, and `df -h /` lies (`docs/build-infrastructure.md`).

## 2. Merged, on `main`, and not delivered anywhere

**The IGNIA-MOBILE-V fix (`2d89e26c`, 2026-09-07)** — a workout session
deleted mid-import is skipped rather than re-created as a malformed doc. On
iOS by OTA (public, on the open channel). **On Android it reaches nobody until
vc 45 is live** — the reviewer who hit it is on vc 44. Behaviour is
unit-tested only; device-verify on the OnePlus 8T once vc 45 installs from
Play: discard a workout with a set input focused, confirm no Sentry event, then
resolve `IGNIA-MOBILE-V` (`prod-errors`).

Everything else merged has shipped (`node scripts/app-version-sync.mjs --check`
re-derives the live numbers).

**iOS behaviour is UNVERIFIED for most of it.** The identical JS is
device-verified on Android in detail (`AGENTS.md`); no iOS device runs the
regression suite here. That is the standing shape of this project — the only
test devices on hand are Android — not a new problem.

## 3. Open work, and what each is blocked on

**Only genuinely open work belongs here.** A row whose work has shipped gets
deleted and its outcome goes to `CHANGELOG.md`.

**`ignia-mac` is being REBUILT as a dedicated box — decided 2026-09-05, NOT STARTED.**
The M1 Air gets wiped and becomes Ignia-only (iOS builds, uploads, simulator);
Stephanie moves to the new Air. Runbook and ordering in `docs/DEV_ENVIRONMENT.md`
§3.15; `scripts/mac-bootstrap.sh` does every non-physical step. **Blocked on:**
the new Air arriving (this week); Stephanie's Apple Account password for the
erase (Activation Lock); an Xcode 26.6 install on the fresh account (App Store
or `.xip`, GUI). **Backup DONE 2026-09-07** (LLC OneDrive, `CLAUDE.local.md` has the path) — the wipe no longer
risks the keystore. **Gate before wiping counts as done:** the rebuilt host must print iOS
fingerprint `52802bba…` (build 64's), or the next iOS binary is cut from it
before any iOS OTA. The old install's cleanup (B in §3.15) must run **before**
any Migration Assistant to the new Air, and it closes the iOS OTA channel until
the rebuilt host passes that gate — so B→C→D happen in one sitting.
**Amended 2026-09-07:** the target state is closed-lid, USB-C Ethernet first, FileVault
OFF + auto-login, updates manual — so any reboot comes back on its own; §3.15
has the table and the why. Shopping list before D: a USB-C Ethernet adapter.

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
| 1–4, 7 | First log inside onboarding · lapsed local nudges · the two deciding numbers instrumented · first-scan celebration · maintenance mode (ADR-0037) | **SHIPPED** (2026-09-02, 09-04, 09-05 — `CHANGELOG.md` has the device evidence). Watch: `config/retention` `timeToFirstLog` (first read: median 1 h 32 m, p75 4 h 49 m, 17% inside five minutes, n=12 — the number lever 1 has to move) and `secsPerLog`. `meals-100` stays parked — it needs a lifetime count no window answers honestly. |
| 5 | **Verify the zero-friction triggers** — Android widget on a real home screen, watch/Siri (rows below). A widget is a log path under 10 s. | Widget placed on the OnePlus 2026-09-05 (owner-reported; renders). Its log path and the watch/Siri rows stay open, owner with a device. |
| 6 | **Guest mode (`UX_AUDIT.md` N5)** if lever 1 does not move D1 alone. | Deferred until 1 is measured. |

Not taken with lever 2, deliberately: bounding the OS-repeating meal-window
dailies (silence after a week away) changes existing schedules — a separate call.

| Work | Blocked on |
|---|---|
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** Multi-photo capture is closed and was confirmed on a real meal (2026-08-26); ADR-0029 is `accepted`. **The asymmetry that must survive:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness). Never observed: **repeat detection has never fired** (needs a My Foods entry matching a typed note; it is deliberately quiet, so "never suggested anything" and "broken" look identical) and **`measured` has never appeared** (needs a legible scale AND unit in one photo). **Seam not to break:** `measured` drops if `clampGrams` altered the number. De-duplication is improved, not solved. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Cardio + Oura — shipped on both platforms; what remains unobserved is narrow** | **Nothing blocking on code.** Oura OAuth, token exchange and the Cloud fetch are VERIFIED with real data (`integrations/oura` on the ring account: `lastSyncedAt` 2026-08-30, `lastRecordCount: 2`); the two records were `strengthTraining`, which the importer deliberately DECLINES (issue 102). **Still unobserved: a cardio-classified record (walk/run/cycle) landing as a via-Oura block** — needs the ring's owner to record one; the `skipped` count is client-screen-only, so wire-shape confirmation rides on that too. Android's Health Connect read works since the 2026-09-04 OTA (`aggregateGroupByDuration`; the grant proven on the LG 2026-09-03). **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget on a real home screen — PLACED, owner-reported 2026-09-05** | Renders on the OnePlus 8T. **Still unverified on Android:** the numbers moving after a log (the `index.js` task handler), the tap-to-log button, midnight blanking, sign-out blanking — the rest of `WIDGET.md` §Device QA. **Maestro cannot close these** (no `adb` command places a widget; the Quick Settings tile IS drivable via `adb shell cmd statusbar click-tile`). The iOS half is done and verified on a physical iPhone. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023: `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788) — what ships is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. |
| **The website — Google started indexing it (6 of 7 sampled URLs *Submitted and indexed* since 2026-09-03); the sitemap is still never fetched** | **Nothing to do but wait and re-measure** with `node scripts/gsc.mjs inspect`. What moved it was the orphan-graph fix live since 08-31 (118 of 118 sitemap URLs reachable from `/`), not the sitemap (`lastDownloaded` still `not yet` after four submits). **The router/SSR migration stays DEFERRED** — its premise (Google never requests the pages) is now false. Next read: GSC Performance in ~2 weeks, and `/transformations`. Tables: `docs/seo-status.md`. |
| **Android device QA host** | **LG VS988 (Android 9 / API 28)** and the **OnePlus 8T (Android 14)** over adb; neither is the API 26 floor. The Maestro regression suite is clean against vc 44 (`apps/mobile/.maestro/regression/coverage.md` has the runs and the host prerequisites). **The suite WRITES** — it runs on `qa-test@ignia.fit`; `node scripts/qa-regression-verify.mjs cleanup --email qa-test@ignia.fit` after a sweep. Regaining adb after an LG reboot is PHYSICAL. |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2). |
| **MenuStat permission email — sent, no reply** | **Owner, awaiting NYC DOHMH.** The restaurant corpus is live on all three surfaces. The open risk is the **licence**: menustat.org published through 2022 all-rights-reserved and the site is now GONE; the only copy with a written grant (Harvard Dataverse, CC0 1.0) stops at 2018 and loses The Cheesecake Factory (399 items). Sent 2026-08-24 to `info@menustat.org` Cc `MenuStat@health.nyc.gov` (the Cc is what carried it); replies land in the `bermudezpr.com` Microsoft 365 tenant. Follow-ups: Pollo Tropical (absent from MenuStat's 91) and the mobile provenance chip (`dataType: restaurant_menu_2022`). |

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
- **A Strava integration** — rejected on **licence**: its June 2026 API
  Agreement forbids AI/ML use of API data. (`docs/research/connected-apps-candidates.md`)
- **A fourth connected-apps provider** — Withings is the only candidate with
  marginal value and iOS already aggregates it. The cheaper win: give Apple
  Health the evidence surface Oura has.
- **A Google Group for the Play tester list** — reCAPTCHA on every member-add,
  no public API. The Play email list is the mechanism. (`CLAUDE.local.md`)
- **Deleting the website** — Apple needs the privacy URL, Play the
  delete-account URL, plus the Oura redirect, `app-version.json`, `/admin`. (ADR-0036)
- **A web logging surface** — retired on ADR-0022's own measurement (2.9% of
  active days). (ADR-0036)
- **Transferring `bermudezsystems.com` off Northwest** — owner's call
  2026-09-05; it renews free with the Registered Agent service (Northwest, in
  writing). The coupling to the org Play login is accepted. **Revisit when the LLC has income.**

## 5. App Store submission — standing rules

Carried over from the two 1.0 rejections. Permanent, not a checklist to do once.

- **Both accounts are the LLC** (Apple since 08-25, Play org account
  `6598754086801415923` since 08-26). Guideline 5.1.1(ix) prefers a legal
  entity for health apps that touch HealthKit; that accepted risk is retired.
- **Always hand Apple `review@ignia.fit`** in the Demo Account fields — it is
  pre-verified and seeded. A fresh account is walled out by the
  email-verification gate. Never point them at `demo@ignia.fit` (screenshots
  only). Confirm it can still write before submitting.
- **Notes for Review must name the specific changes.** Generic text gets rejected
  under 2.3.1.
- **Do not advertise a feature that is `BEHAVIOUR UNVERIFIED`.** The watch
  complication and Siri quick-add are deliberately claimed to no reviewer.
- **`supportsTablet` stays `false`.** Flipping it obliges an iPad design pass
  *and* iPad screenshots — more rejection surface, not less.
- **Keep `NSPhotoLibraryUsageDescription`.** A *missing* purpose string is an
  automated ITMS-90683 rejection; an extra one is never punished.
- **Privacy labels must match reality** — health data + email, no Photos.
- **A submitted version's build is frozen.** Swapping it is cancel → re-point →
  resubmit (`scripts/asc-swap-review-build.mjs`), the cancel is irreversible, and
  it has cost ~19h of queue position once and ~4h once.
- **On Play, sending ANY listing change while a release is in review restarts
  that review** (measured 2026-09-07). Bundle listing changes with the release
  submit, or hold them until the release lands.

## 6. What gets deleted

`CLAUDE.md` §"Where to look" is the one-file-per-question map; it is not
repeated here.

**A plan document is deleted the day its work ships.** Its outcome belongs in
`CHANGELOG.md`, its reasoning in an ADR, its current state here. Git keeps the
original forever; `git log --diff-filter=D --name-only` finds it. Never leave a
shipped plan in the tree with a "CORRECTION" block on top — that is how a status
doc and a wish list become indistinguishable.

**The same rule applies to this file.** Every section above is subject to the
~200-line budget; if adding a row would push it over, something in it has already
shipped and should be deleted rather than amended.
