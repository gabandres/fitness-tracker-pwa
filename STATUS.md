# STATUS — what is true right now

**Updated:** 2026-08-20 · **Owns:** current state only. Not history
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

---

## 1. Live right now

Numbers below are read from the APIs, never edited from memory. Re-read them the
same way before trusting them — `docs/COMMANDS.md` has every command.

| Surface | State |
|---|---|
| **Public App Store (iOS)** | **1.2.0 / build 55**, approved and self-released (`AFTER_APPROVAL`) **2026-08-19** — confirmed via ASC API by `app-version-sync`. The 2026-08-08 feature gap is closed |
| **App Review (iOS)** | **1.2.1 / build 60 is `WAITING_FOR_REVIEW`** (submitted 2026-08-19, release **MANUAL**). Carries the Train template rebuild, the iOS hero-ring fix, `FEATURES.tips=false` embedded and the faster food search. The en-US description finally drops the tip sentence, and BOTH locales drop the "Open Food Facts" claim from the search bullet — text search stopped calling OFF the same day. `usesIdfa` is now explicitly `false`, which closes the open question in `docs/app-store-metadata.md`. Note `POST /v1/reviewSubmissionItems` 500s transiently and leaves an EMPTY submission behind — check the item count before creating a second one |
| **TestFlight** | **build 60 / 1.2.1** (SDK 57, runtime `7b347b0f…`), `VALID` 2026-08-19, internal group *Team (Expo)* — **not yet released to the external Public Beta Testers group**. Builds 57/58 remain, both stamped `1.2.0`. 1.2.1 exists because 55/57/58 all share the `1.2.0` version string and an App Store version only accepts builds whose string matches, so none could be promoted. **Rings fix is CONFIRMED on device** (owner-reported 2026-08-20), which clears the check that gated the App Store submission. `eas submit` hung at `- Submitting` and exited 0; ingestion still took ~50 min, so poll ASC `/v1/builds`, never the CLI |
| **Play alpha** | **vc 37** (1.2.1), live on the track, confirmed from the **androidpublisher API** — runtime `ae526937…` read from the `.aab`, so the Android **OTA channel is OPEN**. It exists to undo the fingerprint cost of the ABI cut (see the OTA block below); behaviourally it is vc 36 plus nothing. **vc 36 is now an orphan runtime** — no OTA reaches it, and the update banner is what drains it. `eas submit` **failed and exited 0** on the first attempt (`This Edit has been deleted`, Play's edit expired mid-upload); the retry worked. **Behaviour UNVERIFIED** — re-run `18-train-template` first |
| **Play production** | not launched — gated on Google's 14-day checklist (§3) |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), 105 prerendered pages (en 52 / es 53), 114-URL sitemap. **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods. **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**. OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that: two of three probes came back throttled after paying full latency. Servings also ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **Latest: Android OTA number 7 on vc 37 (`2e0b017b…`) and iOS OTA number 5 on build 60 (`c4339b05…`), both 2026-08-22** — custom targets, in-app feedback, the speed-dial fix. Android verified on device; iOS not. Full rows in `apps/mobile/AGENTS.md` |
| **`app-version.json`** | android `37`, ios `55` — synced and **deployed** 2026-08-19, read back from `https://ignia.fit/app-version.json`. **Both derived** by `scripts/app-version-sync.mjs`; `npm run doctor` fails on drift in either direction |

**Two live facts that are easy to get wrong:**

- **`app-version.json` is now derived on BOTH platforms** (2026-08-15) — android
  from the androidpublisher tracks API, ios from the App Store Connect version in
  `READY_FOR_SALE`. iOS used to be hand-held with a note asking a human to
  remember it must name the live *App Store* build and never a TestFlight one;
  deriving it from `READY_FOR_SALE` enforces that structurally, since a
  TestFlight build is by definition not in that state. 1.2.0's approval was executed through exactly that pipeline on 2026-08-19.
- **The EAS Update fingerprint is machine-dependent — publish from whichever
  machine BUILDS that platform.** Since 2026-08-17 that is two machines:
  **Android from Windows, iOS from `ignia-mac`.** Bare `eas update` publishes
  both and is correct on neither — always `--platform`-scope it.
  `.claude/hooks/guard_eas_update.py` enforces the full table, and also the
  `--environment` flag that eas-cli requires from SDK 55 on. Three OTAs once
  published under the wrong machine's numbers and reached **nobody** —
  indistinguishable from a working update.
  **The Air is iOS-only now**: its Android SDK, Gradle caches and `~/.android`
  were removed. **Its free space is NOT 19 GB any more — measured 2026-08-22 it
  is at 100% with ~600 Mi free** on `/System/Volumes/Data`. That is enough to
  gate and publish an OTA (a 17 MB Metro export, deleted after) and **not**
  enough for an iOS build, whose floor is ~17 GB. Clear it before promising a
  binary; `df -h /` reads the sealed System snapshot and lies.

  **Why the hosts disagree is now settled, and two of the three published causes
  were wrong** (measured 2026-08-17). Real: **CRLF-vs-LF**, in exactly two files.
  Disproven: **`dir:android`** — a `dir:` source hashes only git-*tracked*
  content, so an ignored or untracked directory contributes nothing — and
  **divergent `node_modules`**, where all 228 files Windows walks and the Mac
  does not were confirmed present on the Mac at identical versions from a
  byte-identical lockfile. It is `@expo/fingerprint` behaving differently per OS.
  **So the two hosts cannot be made to agree, and do not need to** — each
  platform is gated on the machine that builds it. Do not spend another session
  aligning Node or re-running `npm ci` to chase it.

**BOTH OTA channels are OPEN as of 2026-08-19.** They were not, for a few hours:
the ABI cut (`1ddb51fa`) put `reactNativeArchitectures` in
`plugins/withGradleJvmArgs.js`, whose *file contents* are a hashed fingerprint
source, so an **Android-only** build-speed tweak also moved the **iOS** runtime —
off build 60, the binary in App Store review. 1.2.1 was heading for release with
no over-the-air fix path.

Fixed by `4ec7d2d7`: the plugin is restored byte-for-byte and the ABI set moved to
step 1b of `patch-android-release.mjs`, which writes the **gitignored**
`android/gradle.properties` — the same place the release signing config and the
EAS Update channel already live, for the same reason. The rehome is
fingerprint-neutral, and the ABI cut is preserved (vc 37's `.aab` carries exactly
`arm64-v8a` + `armeabi-v7a`, 66 MB, built in 8m 56s).

| Platform | Tree now | Live binary | Channel |
|---|---|---|---|
| Android | `ae526937…` | **vc 37** ships `ae526937…` (read from the `.aab`) | **OPEN** |
| iOS | `7b347b0f…` | build 60 ships `7b347b0f…` | **OPEN** |

**`plugins/withGradleJvmArgs.js` is now FROZEN** — any byte, *including a
comment*, moves both platforms and shuts both channels. Its docstring is
knowingly stale and is left that way on purpose; correcting the prose would
strand every shipped binary. Full box in `build-android/REFERENCE.md`.

**vc 36 is an orphan runtime** — no OTA will ever reach it. That is accepted: vc
37 supersedes it on the same alpha track, `app-version.json` = 37 is deployed, so
the update banner drains it. Do not publish a second update to "cover" it.

## 2. Merged, on `main`, and not delivered anywhere

**Nothing on Android.** Everything that was in this section has shipped and its
outcome is in `CHANGELOG.md` — the latency work, Tier D on-device search, the
photo-quota refund, and (2026-08-22) custom targets, in-app feedback and the
speed-dial fix. The OTA rows in `apps/mobile/AGENTS.md` carry which update
delivered what, with the runtime each went out under.

**One real gap, and it is Apple's queue, not ours.** The 2026-08-22 iOS OTA
(`c4339b05…`) targets build 60's runtime `7b347b0f…`, which is **TestFlight
only**. Public iOS runs build 55 (`886bf0b3…`), a different runtime, and
receives none of it until 1.2.1 is released. Do not report any of this as
"shipped to iOS users".

**iOS behaviour is UNVERIFIED for all of it.** The identical JS is
device-verified on Android in detail (see the OTA #6/#7 rows in `AGENTS.md`);
no iOS device has run any of it. That is the standing shape of this project —
the only test device here is Android — not a new problem.


## 3. Open work, and what each is blocked on

| Work | Blocked on |
|---|---|
| **Maintenance/TDEE estimator — FIXED and shipped by OTA 2026-08-20, now needs eyes on real accounts** | **Nothing; watching.** A live account read maintenance **2,509** when its own gap-free history said **2,266**. The whole number came from a 9-day post-travel fragment whose slope was statistically indistinguishable from zero (t = −2.00, df 8; 95% CI on maintenance **1,775..3,242**). Two causes, both now fixed in `145221e2`: `lastTrendSegment` kept only the most recent run and discarded 28 of 38 weigh-ins across a 21-day travel gap — while the comment directly above it claimed `MIN_SEGMENT_POINTS`/`MIN_SEGMENT_SPAN_DAYS` were "no longer consulted", which the code twenty lines down still did; and `TDEE = intake + deficit` mixed a logged-day intake average with a calendar-day slope, biasing by `(U/N)(I_logged − I_unlogged)`. Measured mode now evaluates each contiguous-logging run against its OWN intake and pools by `1/SE²`. Same account, window ending 07-31 / 08-10 / 08-20: old **2,266 / 2,010 / 2,509**, new **2,265 / 2,184 / 2,320** — swing 499 → 136, and today's value lands inside the 2,250–2,350 that account's gap-free energy balance independently gives. **VERIFIED ON iOS on the owner's own account** (2026-08-20, build 60 + the OTA) — the platform the estimator work could not otherwise reach, since the only test device here is Android. **Every measured user's maintenance moves and the recalibration card fires for them.** **The follow-ups are DONE and SHIPPED by OTA 2026-08-20** (second update of the day; the soak was cut short on the reasoning that a 12-tester alpha cannot find a 1-in-N crash in 24 h and all three changes are stability-positive): the recalibration card now gates on `ci95Tdee` so it cannot announce a move it can't support (`6bb5efee`); the estimator **widens its window** to 63 then 84 logged days rather than acting on an interval wider than 250 kcal, and reports `estimateState` (`e54dd0dc`) — chosen over a stored carry-forward because the only persistence precedent here is device-local AsyncStorage, which would make web and mobile disagree about the same account's target; and Today now says **"holding steady"** with a cause the user can act on, replacing the two weaker caveats rather than stacking with them (`f7db69a0`). **One earlier claim of mine was wrong and is worth correcting:** `confidence` was never rendered anywhere — every `confidence` in the UI is photo-scan. It misleads in the data model, not on screen. Trigger was ordinary: **stop logging for four days and the window split** |
| **The 2026-08-22 work is unverified on iOS** | **No iOS test device.** Custom targets, in-app feedback and the speed-dial fix are all live on TestFlight build 60 via OTA `c4339b05…`, and every one of them is device-verified on Android (LG G6, in detail — see the OTA number 6 and number 7 rows in `apps/mobile/AGENTS.md`). Nobody has run any of it on an iPhone. The riskiest of the three on iOS is the speed dial, because its two defects were platform hit-testing behaviour: iOS `RCTView` hit-tests subviews outside its own bounds when `clipsToBounds` is off, which is exactly why the label pill was tappable on iOS and dead on Android, so the fix should be inert there rather than a regression — *should be* is not *measured* |
| **`bermudezsystems.com` is a single point of failure for the Play org account — OWNER CONSOLE STEPS** | **Owner, and step 1 is blocked on a Northwest login code.** The trigger was small: the first real in-app feedback was `delivered` to `gabriel@bermudezsystems.com` on 2026-08-22 and the owner never saw it — the message was sitting in the Northwest webmail, and the forward to Gmail that this repo recorded as *"owner to configure"* had never been configured. Delivery was fine; the forward is what does not exist. **The forward is not the real risk.** The org Play developer account's Google login IS `gabriel@bermudezsystems.com`, auto-renew on that domain is **OFF**, and the free Northwest year lapses **~July 2027**. If it lapses: the developer-account login goes with it, Apple's org-website precondition breaks, and the GSC TXT record Google's website verification rides on disappears — and the domain becomes registerable by anyone, who then receives mail addressed to the owner, which is a live account-recovery path into his own accounts. Do in this order: **① renew the domain for multiple years, or transfer it to a registrar with a card on file** (load-bearing, and not really about email — Northwest console → Services → Domains; the Cloudflare bot check invalidates the session and re-login emails a code, which is why an agent cannot finish it); **② put non-domain recovery on the org Google account** — recovery email + phone pointing at the personal Gmail and number, plus saved 2FA backup codes, so a lapse cannot lock him out of the developer account; **③ move the mailbox off the free suite** — `bermudezpr.com` is already on a paid Microsoft 365 tenant, so adding this domain there gives real IMAP and no forwarding rule to fail silently; the Northwest suite also caps sends at **5/day**, which is not a thing to discover mid-thread with Apple. If ③ is declined, the minimum is ① + ② **plus fixing the forward and sending a test through it** — the failure mode was silent, and "it is configured" is not evidence. Meanwhile the feedback ping no longer depends on any of this: it goes straight to the personal Gmail, one constant in `functions/src/feedback-notify.ts` with a `MACROLOG_FEEDBACK_TO` override |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone |
| **#46 — watch layouts at 40mm/46mm, both locales** | A Mac with Xcode running a simulator. Its precondition (the real layouts exist) is met; this is the readout it was designed to be. It is the **last open item** of the 16-ticket Apple glanceable-surfaces map |
| **Play production access** | **Owner + Google's clock.** The 12-tester requirement is MET; the only unticked box on the app Dashboard is *Run your closed test with at least 12 testers, for at least 14 days*. **Do not compute the apply date by hand** — Google owns the clock and ticks the box; the Dashboard read **12 testers opted in for 13 days continuously** on 2026-08-20, so it ticks ~2026-08-21 and slips if anyone drops below 12. **The transfer below will moot this** — org accounts are exempt — but **it has NOT lifted yet**: with the transfer *in progress*, the Dashboard still shows *Apply for production* **greyed out** and the 14-day box unticked (checked 2026-08-20, after the transfer was accepted). Nothing can be promoted to production until Google finishes the move. Play exposes no per-tester data at all, in the console or the API. Tell testers **uninstalling is not opting out** (that is an explicit *Leave the program* action), and that opt-in, install and sign-in are three separate steps — only the first moves the counter |
| **Public iOS (build 55) cannot receive the TDEE fixes over the air** | **Apple's review queue, and that is the right answer.** Live App Store is 1.2.0 / build 55, runtime `886bf0b3…`; the tree is `7b347b0f…` (build 60), so no OTA from `main` reaches public users. It *is* technically reachable — `packages/core` is not a fingerprint source, so tonight's JS could be cherry-picked onto the pre-SDK-57 commit `9c8a4b63` and published under `886bf0b3…`. **Rejected**: it requires swapping `ignia-mac` to SDK 54 `node_modules` (the fingerprint hashes `expoAutolinkingConfig` and `package:react-native`), and it would push a bundle built from a tree that exists nowhere in git, never compiled and never device-tested, to 100% of public iOS users. 1.2.1/build 60 supersedes build 55 within days and already carries every fix via OTA. **NEVER use `EXPO_UPDATES_FINGERPRINT_OVERRIDE` to force it** — that would run SDK 57 JS on an SDK 54 native runtime and reach everyone before it broke them |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`) |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **Android device QA — a host now exists, and it found three failures** | **Triage, not tooling.** The blocker is gone: an **LG VS988 (LG G6)** runs the suite over adb from the Windows box (the ARM emulator situation is unchanged and irrelevant now). It is **Android 9 / API 28**, not the "Android 8.0 / API 26" this file claimed until 2026-08-19 — two levels above `minSdk` 26, so a pass here does NOT prove the floor. First run 2026-08-19 against Play-signed **vc 34** (**vc 35 now supersedes it — re-run the suite against that**): `android-smoke` green, email/password sign-in green, suite **14 of 17**. Open: **`06-scan-intro`** ("Scan meal" not found), **`15-search`** ("banana raw" not found), **`18-train-template`** (`template-set-kind-0-0` missing — **vc 35 carries the fix; this is the first flow to re-run**). **Google Sign-In is RESOLVED — it works on Android, and the `INTERNAL_ERROR` was transient device/GMS state, not the app** (2026-08-21). Retested on the same LG G6 against Play-signed **vc 37**, both paths: Settings → *Connect Google* and a full signed-out *Continue with Google*. Both succeeded — GMS `SignInActivity` displayed in +74–97ms, **zero `ApiException` anywhere in logcat**, and Firebase Auth recorded `lastSignIn` for `gabilon2011@gmail.com` at the exact tap. Nothing in the auth config changed between the two binaries: `google-services.json` and `src/lib/auth.tsx` are untouched since before vc 34, and `generatedApks` says **vc 37 and vc 34 ship the identical cert** (`37:5D:D3:E6…:70:FE` = the *previous* Play key, SHA-1 `1483ddc3…`) — so Play still has not rotated and the cert was never the variable. All **5 expected SHA-1s are registered** in Firebase (plus 3 SHA-256). Same code, same config, same cert, same device, opposite outcome → transient GMS state on the 08-19 run (the device had booted 28 min earlier; today's logcat shows GMS re-provisioning its `signin` module config with `Stale snapshot … new configuration available`). Sentry `IGNIA-MOBILE-C` remains **1 event, 0 affected users**, still tagged `build:34` — nothing on vc 37. **This no longer blocks the Android launch.** Cold start **6.6s**; the brand-loader wait in `01-today` sits right on its 15s budget and flaked once. **The hero rings render AND animate correctly here** — the iOS ring bug is not cross-platform. QA account `qa-test@ignia.fit` (uid in `CLAUDE.local.md`). `coverage.md` Android rows updated 2026-08-19 **The LG G6 is BACK and the suite ran green against vc 37 on 2026-08-20.**  `18-train-template` and `15-search` — the two flows that had been open — are **fixed and passing** (`774c0784`); neither was an app bug. `15-search` gave `searchFoods` 20s against a Cloud Function cold start, and the row it wanted (`Banana, raw`, USDA) was the first result once it landed. `18-train-template` failed three ways, all viewport or latency: the Train tab needs ~2 min to settle after a cold start against a 15s budget; re-opening a saved template puts the sheet back at the top so the first set row is below the fold; and `scrollUntilVisible`'s mid-screen gesture gets swallowed by the set table's own TextInputs, so it is now swipe-to-end-then-search-UP. **Getting adb back is a PHYSICAL task** — after `adb reboot` the device returns `authorizing` → `offline` → absent and enumerates charge-only until someone unlocks it and turns USB debugging back on; `kill-server`/`reconnect` cannot recover it. Also: a mid-flow failure in `18-train-template` strands a `QA Tpl Check` template, and a stranded one makes the NEXT run open *Edit template* instead of *New template* — a different layout that fails elsewhere and reads as a new bug. Clean it before chasing anything. Trap recorded in `CLAUDE.local.md`. **The suite is FLAKY on this device and it is latency, not regressions**: two full passes each returned 14/17 with **zero overlap** in which three failed, and every individual flow passes when re-run alone (verified for `05-history`, `16-train-terms`, `12-e2e-edit`). The captures show the app correct at the moment of failure — `QA E2E Sandwich` plainly on screen when `13-e2e-delete` called it missing. Budget-tuning the remaining flakes is timeout work, not bug-finding. **The iOS hero-ring fix in build 60 IS confirmed on hardware** (owner-reported 2026-08-20) — that was the check gating the App Store submission and it is done. What remains untested on iOS is a normal log/read pass over each tab on an SDK 57 binary |
| **The website is invisible to Google** | **A decision, not a task.** Measured 2026-08-17: 110 of 114 sitemap URLs are *unknown to Google*, the sitemap has never been downloaded, and 90 days of Search Console show 4 impressions and 0 clicks. Cause is structural — "prerendered" writes the `<head>` only, so a first-pass crawler sees `<app-root></app-root>`, and `routerLink` appears in zero files so there is no link graph to crawl either. Fixing it means real prerendering + crawlable anchors; neither is scoped. Full evidence in `docs/seo-status.md` |
| **Web retirement question** | **A measurement, not intuition** (ADR-0022): `node scripts/usage-report.mjs --days 30`, reading `platforms`. May not be revisited before that data exists |
| **Transfer of operations to Bermudez Systems LLC (WY)** | **Owner console steps, in this order**: ① ~~EIN~~ **DONE 2026-08-19** (number + CP 575 location in `CLAUDE.local.md`) → ② ~~D-U-N-S~~ **DONE 2026-08-19** — Apple issued it same-day (number in `CLAUDE.local.md`) → ③ Apple Developer individual→organization **conversion** of the existing team — NEVER a fresh org enrollment, which strands the app on the old team (Team ID/apps/reviews survive, seller name changes). **APPLE HAS REPLIED — case `20000141771877`, a senior advisor is assigned and waiting on the owner's word to begin** (2026-08-21, `devprograms@apple.com`). **OWNER REPLIED 2026-08-21 20:41 AST, in-thread from the account-holder Gmail** — stating intent to start now, and asking three things first: the bank-account ORDER (Apple says switch before starting, but an individual membership's account must match the individual and Relay is in the LLC's name, so it may be impossible as stated), whether 1.2.1 sitting in `WAITING_FOR_REVIEW` is a reason to hold, and the realistic length of the certs-portal outage. **Sent from `gabrielandresbermudez@gmail.com`, deliberately NOT the LLC address.** Apple's own flow is *sign in as the Account Holder, then Submit a request*, and support takes this request only from the account holder; a conversion request arriving from an address Apple has never seen buys an identity round trip on a case that is already slow. The LLC address is named in the body as the org contact instead. **Do NOT assume a days-long outage: two developers publicly report migrations still running at 17 days and at 3+ weeks** (developer.apple.com forum threads 816092 and 814367; the latter only resolved via the callback escalation). If Certificates, Identifiers & Profiles is down for that whole window then `eas build -p ios` is gone for WEEKS, not days, and no native hotfix is possible while it runs — which is why Apple's timing answer, not impatience, should decide when to start. **The constraint that governs iOS scheduling: during the migration the Certificates, Identifiers & Profiles portal is UNAVAILABLE, so `eas build -p ios` is BLOCKED. ASC stays up, so submitting/releasing an existing build and any `eas update` OTA are unaffected** (an OTA touches no cert). **Land every iOS binary you expect to need BEFORE telling Apple to start.** **REPO-SIDE PRECONDITION IS NOW CLEARED, measured 2026-08-21 — nothing on `main` owes an iOS binary, so the migration can start whenever the owner is ready.** Two checks, not an opinion: `git diff --stat f0130b01..HEAD` over `package*.json`, `app.json`, `plugins/`, `modules/`, `targets/` and `eas.json` is **empty** (build 60 was cut from `f0130b01`), and the iOS fingerprint generated on `ignia-mac` still reads `7b347b0f…`, build 60's exact runtime — **including after Tier D**, whose 1.4 MB bundled index is a Metro asset and moves no native surface. The fourth iOS OTA shipped the latency work on 2026-08-21, so nothing is stranded. Re-run BOTH checks if any native surface changes before the owner gives the word. **The open question is not technical but sequencing: 1.2.1 is `WAITING_FOR_REVIEW`** (ASC, 2026-08-21) and Apple does not document what a seller-name change does to an in-review version — that, and the bank-account ordering, are asked in the drafted reply rather than guessed, since a wrong guess costs a rejection or a stalled review. Note the bank-account precondition may be **impossible as stated**: an individual membership's account normally has to match the individual, and Relay is in the LLC's name. Apple's other stated preconditions: 2FA on the developer Apple Account; a publicly-available org website on an org-owned domain (bermudezsystems.com — note `CLAUDE.local.md` warns it is free year-one only, auto-renew OFF, lapsing ~Jul 2027); and **the payout bank account must be switched to the LLC BEFORE the migration starts**, since Apple routes pre-completion earnings to whatever account was active at start — low-stakes here (~$0: tips paused, no paid product) but irreversible once begun. Sales and Trends for the individual membership are lost afterwards; export first if wanted → ④ ~~deactivate the 3 `fit.ignia.tip.*` consumables in ASC~~ **DONE** — all three read `DEVELOPER_REMOVED_FROM_SALE` from the ASC API 2026-08-19 (`inAppPurchasesV2`); that state is reversible, so re-enabling tips is a flip, not a re-create → ⑤ ~~LLC bank account~~ **DONE 2026-08-19 — Relay approved** (details in `CLAUDE.local.md`) → ⑥ ~~new Play org account ($25)~~ **DONE** and ~~Google org verification~~ **GREEN, verified from the console 2026-08-20**. **⑦ ~~APP TRANSFER~~ FILED AND ACCEPTED 2026-08-20 — Google reports it *in progress* and will notify on completion.** It is a **two-sided** flow: the source account files it (personal `/u/1/` → Settings → App transfers → Transfer apps), then the **target account must accept** it (org `/u/0/` → same page → *Apps being transferred to you* → Review request → Agree and transfer). Filing alone does nothing. The first submission was **rejected** because this repo's notes said to strip the `PDS.` prefix from the transaction ID — **wrong; Google wants the value verbatim**, exactly as Google Payments prints it under TRANSACTION ID (read it at `pay.google.com` → Activity → the $25 Developer Registration Fee row, not from an email). Org verification was independently confirmed from the console the same day. Field map and the browser-automation traps are in `CLAUDE.local.md`. Org accounts are exempt from the 12-tester/14-day production gate, so completing this also removes the Play production blocker above. Separate Google deadline found 2026-08-19: **all Play apps + signing keys must complete "Android developer verification" by Sep 30, 2026** — after the transfer that is the ORG account's task for `fit.ignia.app`; do NOT assume the personal account's Jul-8 identity check carries over. **Donation intake stays paused** (`FEATURES.tips=false` both platforms, `/tip`→`/support`) until payouts land in the LLC's bank account; do NOT re-enable tips or ship Pro before then. PR foreign registration deliberately skipped: zero revenue + interstate-commerce exemptions; worst case is back-fees, not veil loss |

**`ignia-mac` disk is the recurring constraint.** 18 GB free as of 2026-08-17,
against a ~17 GB floor for iOS — over the line, but not by much. It is an
**iOS-only host now**, so its Android caches are gone and are not coming back;
budget for one platform's build caches, not two. The remaining ~199 GB is the
machine owner's personal data and is not ours to reclaim. `df -h /` reads the
sealed System snapshot and lies; use `/System/Volumes/Data`.

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
- **Deleting the website** — Apple requires the live privacy URL and Play the
  delete-account URL, both on `ignia.fit`. (ADR-0022)

## 5. App Store submission — standing rules

Carried over from the two 1.0 rejections. Permanent, not a checklist to do once.

- **Accounts are Individual, not an entity** — Apple Developer Individual, Play
  Individual. The owner's legal name shows publicly as seller. Known accepted
  risk: guideline 5.1.1(ix) prefers a legal entity for health apps that touch
  HealthKit; enforcement is inconsistent and a reviewer *can* raise it.
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
