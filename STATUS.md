# STATUS — what is true right now

**Updated:** 2026-09-17 · **Owns:** current state only. Not history
(`CHANGELOG.md`), not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`),
not commands (`docs/COMMANDS.md`), not build tooling
(`docs/build-infrastructure.md`).

If a statement here conflicts with any other file in this repo, **this file
wins** — or the other file is stale and should be deleted. Three separate times
this project scoped already-shipped features as new work because a plan doc was
read as a status doc.

**This file is a status doc, not a changelog. Budget: ~200 lines AND ~35 KB
(`wc -l STATUS.md; wc -c STATUS.md`).** When something ships, its entry is
*deleted* and the outcome goes to `CHANGELOG.md`. It hit 941 lines (2026-08-15),
293 lines / 65 KB (2026-08-26) and 249 (2026-09-17); nobody can hold that in their head.

---

## 1. Live right now

Numbers below are read from the APIs, never edited from memory. Re-read them the
same way before trusting them — `docs/COMMANDS.md` has every command.

| Surface | State |
|---|---|
| **Public App Store (iOS)** | **1.2.3 / build 64, `READY_FOR_SALE`, released 2026-09-06 00:01 UTC** (iTunes lookup + ASC API, read 2026-09-07). Runtime `52802bba…`, which IS what this tree produces, so **the iOS OTA channel is OPEN to the public**; the first publish on it is the 2026-09-07 IGNIA-MOBILE-V fix (`apps/mobile/AGENTS.md`). Carries the re-shot screenshots (en-US 5, es-MX 5) and `usesIdfa: false`. **Available in 175 of 175 territories** since 2026-08-28 (DSA trader declaration filed). Play matched on 2026-09-03: 158 of Play's attainable 158 |
| **TestFlight** | **build 64 / 1.2.3 (runtime `52802bba…`) is in the EXTERNAL *Public Beta Testers* group, `IN_BETA_TESTING`** (read 2026-09-08 via `asc-testflight-external.mjs --build 64`; it was `WAITING_FOR_BETA_REVIEW` from 09-05). Build 63 is in the group but can never reach an external tester — a build of an already-released version stays `READY_FOR_BETA_SUBMISSION` forever. **Read the group's builds AND each build's `externalBuildState`, never assume:** `VALID` + in the group ≠ installable |
| **Play production + alpha** | **LIVE — vc 45 / 1.2.3 (runtime `15c1cfc8…`, the IGNIA-MOBILE-V fix, plus the Ember-on-Ink icon, feature graphic and five re-shot screenshots), production 100% + alpha, released 2026-09-07 ~22:46 UTC** (store page reads 1.2.3 / *Updated on Sep 7, 2026*, read 2026-09-08). The review took ~7.5 h from the 15:05 UTC restart. **Nothing is in review; the next submit can go whenever there is a change to ship.** **The tracks API cannot tell "in review" from "live"** — the Console app row or the store page is the read. The 09-03 Data safety amendment (*Device or other IDs*) is PUBLISHED — it rode the vc 45 review; Publishing overview read *nothing in review, last published Sep 7* on 2026-09-08. `eas submit` has failed and exited 0 three times (lost Play edit on bundles > 60 MB; a missing health declaration) — **`play-upload-bundle.mjs` is the upload path; confirm every submit against the tracks API** |
| **Web `ignia.fit`** | **Shell + `/admin` — the web logging app was RETIRED 2026-08-30 (ADR-0036).** 113 prerendered pages, EN + es-PR. Links BOTH stores with the official badges since 2026-09-08 (`PLAY_STORE_LIVE = true`; Google's en / es-419 badge artwork on the landing, `/vs`, `/calculator`, the retired and auth-action pages, and `/download`). **`/download` said "Android coming soon — email me" until 2026-09-08** — this row claimed no such copy remained; grep `public/` as well as `src/` before repeating that. `/app` and the old tabs render a "moved to the apps" page; a safety worker evicts old PWA installs. SEO pages and `/u/**` are KEPT, owner-ratified |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call** (since 2026-08-19; Open Food Facts serves **barcode only** — its 10 req/min search cap cannot host typeahead behind one egress IP). Servings ship with each hit. `docs/research/off-branded-ingest.md` scopes getting branded text results back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **iOS OPEN** on `52802bba…` since 2026-09-06. **Android OPEN** on `15c1cfc8…` since vc 45 went live 2026-09-07 ~22:46 UTC — both channels open; first Android publish on the reopened channel 2026-09-08 (`cb330ecc…`, `update:list` reads runtime `15c1cfc8…`). Reminder: `app.json` is hashed whole, so a version string bump moves BOTH fingerprints (`437a90ce` did). **"Published" is not "delivered":** a user gets it on the launch AFTER the download. **This row is a POINTER: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** Re-check with `npx eas update:list --branch production --limit 3` |
| **`app-version.json`** | **Self-driving since 2026-09-05** — served from Firestore `public/appVersion` by the `appVersionJson` rewrite, refreshed hourly by `hourlyTasks` (Android from the Play tracks API as `647810616435-compute@…`, invited read-only to the org Play Console; iOS from Apple's public lookup) and on demand from `/admin` → System → **Sync now**. No static file, no deploy, no secret; `npm run doctor` compares the LIVE URL with both stores. See the Play row for the in-review wrinkle |

**The runtime fingerprints, and the three traps around them.**

| Platform | Tree now | Live binary | Channel |
|---|---|---|---|
| Android | `15c1cfc8…` (since `437a90ce`, the 1.2.3 bump) | **vc 45 ships `15c1cfc8…`** (read from the `.aab`), live on production since 2026-09-07 ~22:46 UTC (vc 44 / `68ea2dd3…` is superseded) | **OPEN** to the public |
| iOS | `52802bba…` | **build 64 ships `52802bba…`, `READY_FOR_SALE` as 1.2.3 since 2026-09-06** (read from the `.ipa`) | **OPEN** to the public |

- **Gate the COMMIT, not just the fingerprint. `eas update` prints a `Commit`
  line — read it.** The fingerprint is native-only, so a stale JS tree passes
  the hash gate (it did on 2026-09-17, `CHANGELOG.md`). **Never pipe the
  `git pull` that precedes a publish, and assert `git rev-parse HEAD` in the
  same shell.**
- **The fingerprint is machine-dependent — publish from the machine that BUILT
  the binary testers run: today Android from Windows, iOS from `ignia-mac`.**
  **Android's build host moved to `ignia-mac` on 2026-09-17** (toolchain,
  keystore and Play SA are there; `docs/build-infrastructure.md`), but the live
  Android runtime is still the Windows-built one, so **cutover is OPEN**: cut
  the first `eas build --local -p android --profile production` on the Mac,
  submit it, and in the same commit flip `OWNER["android"]` in
  `.claude/hooks/guard_eas_update.py`, update `test_guards.py`, and drop the
  Windows section of the `build-android` skill. Until then an Android OTA still
  publishes from Windows. Bare `eas update`
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

**`ignia-mac` is a dedicated, closed-lid Ignia box since 2026-09-10** (Tailscale
`100.83.226.52`, SSH + RustDesk; its fingerprint reproduces build 64's
`52802bba…`). Setup and disk: `docs/DEV_ENVIRONMENT.md` §3.15, `CLAUDE.local.md`.

## 2. Merged, on `main`, and not delivered anywhere

**Nothing.** Everything on `main` shipped in the 2026-09-21 OTA (the
verification-email resend fix, whose server half deployed the same day) or in
the 2026-09-17 one before it (ADR-0041, the rest-pause continuation rest, the
inline catalog, the What's New bump). Both channels are on `ebbe0147` (ledger
row 1); the ledger owns the group ids and the rollback commands.

Re-derive rather than trust this line: `git log --oneline` against the newest
OTA row in `apps/mobile/docs/fingerprint-ledger.md`, and
`node scripts/app-version-sync.mjs --check` for the live store numbers.

**The thing that will still look like a fault (ADR-0040, shipped 2026-09-16).**
An existing template opens showing its set structure as **Auto** with all three
add-buttons, not as `myo-reps`; and every clustered lift reads "Calibrating —
0 of 3 valid sessions logged" and makes no load call until three valid reads
accumulate at one load. Both are the ADRs working: absence means "infer with
the pre-0040 rule", and the band is derived per lift with the owner's 706
pre-cutoff sets excluded by design. **If this row is still here after the owner
has trained three times, delete it — it is a prediction, and it expires.**

**`drop` and `superset` are the only unread structures left, and they are NOT
the next cheap thing.** `hit` was, and it shipped. `drop` needs within-set load
reduction and `superset` needs a pairing between two exercises; the model
carries neither (ADR-0040 §Consequences). Do not read "two structures left" as
"two slices left".

**The iOS regression suite is at 21 of 21** (2026-09-17, `ignia-mac`, simulator
`Ignia-QA`; how it got there is in `CHANGELOG.md`). **Never compose a suite
number from individual flow runs** — the suite is order-dependent by design;
host setup and traps are in `.maestro/regression/README.md`.

## 3. Open work, and what each is blocked on

**Only genuinely open work belongs here.** A row whose work has shipped gets
deleted and its outcome goes to `CHANGELOG.md`.


### iOS builds on `ignia-mac` do not launch — Xcode 27 / UIScene. BLOCKS all iOS QA

A Release build cut here 2026-09-22 installs and dies on the first frame:
`UIScene life cycle is required for apps built with this SDK`. Xcode is now
**27.0** and the **iOS 26.5 runtime is gone** (`Ignia-QA` runs 27.0).
**No `app.json`-only fix exists** — neither `react-native@0.86.2` nor
`expo@57.0.14` ships a `UIWindowSceneDelegate`, so the manifest would point at
nothing. Build 64 in production is fine; the NEXT iOS binary is the exposure,
and the check is SDK-linked so treat a device build as blocked too.

Settle two facts before writing code: has Expo shipped UIScene support (57
patch or 58)? does Apple require the iOS 27 SDK to submit yet? Two noes make
pinning the host to Xcode 26.x the cheap move. Options and evidence:
`CODE_REVIEW_2026-09-22.md` §0. Consequences: no Maestro sweep ran on 09-22,
and the 09-17 binary is NOT a fallback — it only ran on the 26.5 runtime.

### Batch 1 of the 2026-09-22 review sits on `wt/review-batch-1`, unmerged

Five fixes, one commit each, every test verified to fail against the unfixed
source: the photo-scan per-keystroke gram rescale (corrupted macros; could park
a row at zero permanently), Recent relog dropping carbs/fat, onboarding protein
validation, the sign-in error slot one collision silenced for the session, and
the verify-email Resend latch. All JS-only and **the iOS fingerprint still
matches build 64 (`52802bba…`), so they ship by OTA with no binary** — the
blocker above does not gate them. Unmerged, unpublished, and NOT visually
verified. The remaining ~67 findings are unstarted.

### `ExerciseLibrarySheet` rows are untappable on iOS — cause UNKNOWN

Nothing inside that sheet's ScrollView fires `onPress`. The list scrolls, the
search field above it takes taps, both list halves are dead, and the identical
`ExerciseSearchList` works inside `TemplateEditorModal`. Not a harness
artifact: verified 2026-09-17 with a REAL macOS click at the row's own centre
(mapping calibrated against the search field first) and with an instrumented
handler whose marker was confirmed present in the installed `main.jsbundle`.

**Eight causes tested and DISPROVEN — do not retry them:** `flexShrink: 1` on
the ScrollView, `keyboardShouldPersistTaps="always"`, the `useDeferredFocus`
autofocus, content height (one filtered row still fails), a modal-presentation
conflict (ruled out — `onPress` never fires), synthetic-tap timing /
`delaysContentTouches` (a long press fails too), `GestureHandlerRootView` as
`TemplateEditorModal` carries, and making the ScrollView the sheet's only child
to match `SetRowSheet` exactly.

**Not user-facing today** — the sheet was reverted out of the Train tab on
2026-09-17 and the catalog is an inline list again, so nothing renders it. The
component is kept for this work. The cost of leaving it: no way to browse the
shipped seed library from Train (it stays reachable mid-session via
add-exercise, where it lived before ADR-0041).

Unit tests cannot see this class of bug — RNTL presses a TouchableOpacity
directly and never runs a native hit-test. Only the Maestro sweep caught it.

### Retention — the standing focus (owner's call, 2026-09-02)

**The numbers say activation and the daily habit are the problem, not late
churn.** `config/retention` **re-read 2026-09-16** (120-day window, synthetic
excluded, `insufficientSample: true`): 43 signups → **14 activated (33%)**;
**0.34 logs per activated user per day** (0.15 on 09-10); `timeToFirstLog`
median **34 m 43 s** / p75 4 h 49 m / **17.6% inside five minutes** (n=17);
`secsPerLog` **56.2 s** (n=38). **Lever 1 worked** — time-to-first-log more
than halved and logs/activated/day is up 2.3×; those are the two numbers it
was built to move.

**Two things are now the job.** **Reminders opt-in is a REAL zero** (0 of 43,
0 of 14 activated; verified 2026-09-16, the instrument is sound — `CHANGELOG.md`),
so **every notification-shaped lever currently reaches nobody**; the live move
is lever 10 below. Second: `secsPerLog` crossed the 30 s cliff, and the split
says why — **search 23.8 s (4 users, 16 logs) vs photo 79.8 s (3 users, 22
logs)**; that sits awkwardly against the research premise that photo loggers
retain better, and nobody has looked at where the 80 s goes.

Research levers, in the order they attack that: logging speed (<30 s/meal
retains 78% at six months vs 23% over 2 min; photo loggers 42% D30 vs 17%
search), a meaningful action in session one (2–3× at D30), triggers tied to
something the user did. **Re-read `config/retention` before claiming any of
this moved** — at ~40 signups per 120 days no A/B is readable; pair retention
work with acquisition. **The window's denominator is signups IN WINDOW, not
active users**: 8 accounts created in April 2026 still log daily (the owner's
among them) and sit outside the 120-day `createdAt` filter entirely, so a good
opt-in rate among the oldest users would still read as zero here.

| # | Lever | State |
|---|---|---|
| 5 | **Verify the zero-friction triggers** — Android widget on a real home screen, watch/Siri (rows below). A widget is a log path under 10 s. | **Android widget VERIFIED 2026-09-08** on the OnePlus (log → numbers move, tap → add sheet, sign-out → blank; row below). Watch/Siri stay open, owner with an iPhone. |
| 6 | **Guest mode (`UX_AUDIT.md` N5)** if lever 1 does not move D1 alone. | Deferred until 1 is measured. |
| 10 | **Ask for reminders AFTER the first log lands, not during onboarding** — the pre-committed response to lever 9's zero. | **Open.** Nothing else notification-shaped is worth building until this moves the opt-in. |

(Levers 1–4, 7, 8 and 9 SHIPPED — 2026-09-02 → 09-16, `CHANGELOG.md`; `meals-100`
stays parked, it needs a lifetime count no window answers honestly.)

Not taken with lever 2, deliberately: bounding the OS-repeating meal-window
dailies (silence after a week away) changes existing schedules — a separate call.

| Work | Blocked on |
|---|---|
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** Multi-photo capture is closed and was confirmed on a real meal (2026-08-26); ADR-0029 is `accepted`. **The asymmetry that must survive:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness). **Repeat detection FIRED on a device 2026-09-08** (LG, `qa-test@`: a seeded My Foods "Grilled chicken steak" + the note "grilled chicken steak" → *You have logged this before* → *Use it* logged 330 kcal with no model call; a first attempt on an app instance that predated the seed showed nothing — the list is subscribed on focus, so a fresh entry needs a cold start or a tab change). **`measured` is still unobserved, and the reason is now known:** a plate photo with a composited "245 g" readout came back with grams = 245 but `measured: false`, and the model's logged reasoning says why — *no visible weighing scale in the photo, only a text overlay*, exactly what the prompt asks. So the path needs a photo of a real scale under the plate; nothing synthetic will do. **Seam not to break:** `measured` drops if `clampGrams` altered the number. De-duplication is improved, not solved. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Cardio + Oura — shipped on both platforms; what remains unobserved is narrow** | **Nothing blocking on code.** Oura OAuth, token exchange and the Cloud fetch are VERIFIED with real data (`integrations/oura` on the ring account: `lastSyncedAt` 2026-08-30, `lastRecordCount: 2`); the two records were `strengthTraining`, which the importer deliberately DECLINES (issue 102). **Still unobserved: a cardio-classified record (walk/run/cycle) landing as a via-Oura block** — needs the ring's owner to record one; the `skipped` count is client-screen-only, so wire-shape confirmation rides on that too. Android's Health Connect read works since the 2026-09-04 OTA (`aggregateGroupByDuration`; the grant proven on the LG 2026-09-03). **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget — VERIFIED on the OnePlus 8T 2026-09-08 (vc 45)** | Read off home-screen screencaps, not the app: after the Play update it read *Open Ignia to start*; opening the app → **1,418 kcal / 93 g**; a 100 kcal / 5 g test row logged in-app → **1,318 / 88 g** (the `index.js` task handler); the row deleted → back to 1,418 / 93; tapping the face → the app opens with the add sheet up; sign-out → *Open Ignia to start*; restore via the Google picker → numbers back. **Still open:** midnight blanking (needs the clock moved; ColorOS refuses `settings put` from adb) and the es-PR wording check. Flows: `.maestro/capture/widget-log.yaml` / `widget-delete.yaml`; the widget read is `adb screencap` + a crop at the `uiautomator` bounds. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023: `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788) — what ships is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. **A simulator run was attempted 2026-09-08 and abandoned:** the sim build succeeded and the paired watch sim showed the *Waiting for iPhone* baseline, but the Mac's disk hit 100% mid sign-in and the owner reclaimed the machine; everything was torn down (§`ignia-mac`). A sim can only ever prove the pipeline, not the background-refresh budget the row is about. |
| **The website — Google started indexing it (6 of 7 sampled URLs *Submitted and indexed* since 2026-09-03); the sitemap is still never fetched** | **Nothing to do but wait and re-measure** with `node scripts/gsc.mjs inspect`. What moved it was the orphan-graph fix live since 08-31 (118 of 118 sitemap URLs reachable from `/`), not the sitemap (`lastDownloaded` still `not yet` after four submits). **The router/SSR migration stays DEFERRED** — its premise (Google never requests the pages) is now false. Next read: GSC Performance in ~2 weeks, and `/transformations`. Tables: `docs/seo-status.md`. |
| **Android device QA host** | **LG VS988 (Android 9 / API 28)** and the **OnePlus 8T (Android 14)** over adb; neither is the API 26 floor. The Maestro regression suite is clean against vc 44 (`apps/mobile/.maestro/regression/coverage.md` has the runs and the host prerequisites). **The suite WRITES** — it runs on `qa-test@ignia.fit`; `node scripts/qa-regression-verify.mjs cleanup --email qa-test@ignia.fit` after a sweep. Regaining adb after an LG reboot is PHYSICAL. |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2). |
| **MenuStat permission email — sent, no reply** | **Owner, awaiting NYC DOHMH.** The restaurant corpus is live on all three surfaces. The open risk is the **licence**: menustat.org published through 2022 all-rights-reserved and the site is now GONE; the only copy with a written grant (Harvard Dataverse, CC0 1.0) stops at 2018 and loses The Cheesecake Factory (399 items). Sent 2026-08-24 to `info@menustat.org` Cc `MenuStat@health.nyc.gov` (the Cc is what carried it); replies land in the `bermudezpr.com` Microsoft 365 tenant. Follow-ups: Pollo Tropical (absent from MenuStat's 91) and the mobile provenance chip (`dataType: restaurant_menu_2022`). |

**The maintenance 95% interval is computed and never shown.** `seTdee` /
`ci95Tdee` exist (`tdee.ts`); Today shows only the binary `holding`. An
account has read `confidence` 0.957 while its interval ran **1,775..3,242**,
and the caveat it sees blames gaps — which is not where that width came from.
Putting a range on the hero is a product decision (it is alarming, and
correctly so), which is why the 2026-09-16 trace fixed the four copy and
counting defects around it and left this one alone.

## 4. Decided and deliberately not happening

Do not re-propose these without new information; reasoning is in the linked ADR
or research note.

- **Pro tier / subscriptions** — v1 is free; `PRO_ENABLED = false` on mobile (the only copy). **Stripe is GONE** (extension removed 2026-08-31); if a paid tier ever ships it is Apple/Google IAP, nothing else. (ADR-0015; this row said "IAP / Stripe — dormant" until 2026-09-17)
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

Durable rules, not state — they moved verbatim to `docs/app-store-metadata.md`
§"Standing submission rules" on 2026-09-17 (this file is a status doc). Read
them before every submit: demo account, review notes, unverified features,
`supportsTablet`, frozen builds, Play's review-restart on listing edits.

## 6. What gets deleted

The housekeeping rule lives in `CLAUDE.md` (§"Where to look"): a plan document
is deleted the day its work ships — outcome to `CHANGELOG.md`, reasoning to an
ADR, state here; `git log --diff-filter=D --name-only` finds the original.
**The same rule applies to this file**: if adding a row would break the
~200-line budget, something above has already shipped and gets deleted, not amended.
