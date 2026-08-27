# STATUS — what is true right now

**Updated:** 2026-08-26 · **Owns:** current state only. Not history
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
| **Public App Store (iOS)** | **1.2.1 / build 60, `READY_FOR_SALE`**, released 2026-08-24 — confirmed via the ASC API (`appStoreVersions` + the version's `build`). Runtime `7b347b0f…`, which is what every iOS OTA since 1.2.0 targets, so an iOS OTA now reaches the public App Store rather than TestFlight alone. **Available in 145 of 175 territories** since 2026-08-26; the 30 held back are the EU 27 plus GBR, ISL, NOR (see §3) |
| **TestFlight** | **build 60 / 1.2.1**, runtime `7b347b0f…`, `VALID`, and on the EXTERNAL *Public Beta Testers* group (added 2026-08-24 — it was internal-only before that, and external testers had received nothing for six days). Group holds `60,58,57,53,49,47,45,7,4`. **Read the group's builds, never assume:** a build being `VALID` and on TestFlight does not mean any external tester can install it |
| **Play alpha** | **vc 37** (1.2.1), live on the track, confirmed from the **androidpublisher API** — runtime `ae526937…` read from the `.aab`, so the Android **OTA channel is OPEN**. Behaviourally it is vc 36 plus nothing; it exists to undo the fingerprint cost of the ABI cut. **vc 36 and the never-released vc 38 are orphan runtimes** — no OTA reaches either, and the update banner is what drains them. Do not publish a second update to "cover" them. **`eas submit` has failed and exited 0 twice**, on two different causes (`This Edit has been deleted`; a missing health declaration) — always confirm a submit against the tracks API |
| **Play production** | **NOT launched — production ACCESS applied for 2026-08-26, under review (≤7 days).** Access is per developer account and did not follow the app across the transfer to Bermudez Systems LLC. Tracks read live: `production` **empty**, `beta` empty, `alpha` completed vc 37, `internal` an EMPTY draft — **zero Android production users.** See §3 for the `countryTargeting` trap that governs the first production release |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), **113 prerendered pages (en 56 / es 57), 118-URL sitemap** — read off the generator 2026-08-23. Every content page ships its real copy, not just a `<head>` (`docs/seo-status.md`). **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**: OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that. Servings ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **Both channels OPEN.** Latest: **Android OTA 77 on vc 37 (`ae526937…`), iOS OTA 43 on build 60 (`7b347b0f…`)**. Both reach real users — build 60 is the public App Store binary. **This row is a POINTER, not a log: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** It is deliberately kept to two facts (newest number per platform, and who receives it) — the version that listed a dozen historical publishes went stale twice, once reading "Android 7 / iOS 5" against `AGENTS.md`'s Android 27 / iOS 12. Re-check with `npx eas update:list --branch production --limit 3`, which prints the runtime each went out under |
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

**`ignia-mac` disk is the recurring constraint.** **19.18 GiB free, measured
2026-08-25** on `/System/Volumes/Data`, against an iOS build's ~17 GB floor —
over the line, but a build consumes space as it runs. A second cleanup pass
returned only 646 MiB, so there is no easy headroom left; the one remaining
lever is the **8.1 GB watchOS simulator runtime**, and dropping it is the
OWNER'S CALL — it ends watch-target simulator testing there. Do NOT delete
`apps/mobile/ios/Pods` (forces a `pod install`) or
`~/Library/Developer/CoreSimulator` (live runtimes, and it is someone else's
laptop). **`df -h /` reads the sealed System snapshot and lies** — ask for
`/System/Volumes/Data`, and check the number before believing a build is blocked
on disk: this file once carried "~600 Mi free / 100% full" when the volume had
7.7 GiB, and clearing DerivedData alone returned 10.3 GiB.

## 2. Merged, on `main`, and not delivered anywhere

**Nothing.** Everything merged has shipped; outcomes are in `CHANGELOG.md`, and
`apps/mobile/AGENTS.md` carries which OTA delivered what, under which runtime.
Re-derive the live numbers with `node scripts/app-version-sync.mjs --check`
before trusting either platform's.

**iOS behaviour is UNVERIFIED for most of it.** The identical JS is
device-verified on Android in detail (`AGENTS.md`); no iOS device runs the
regression suite here. That is the standing shape of this project — the only
test device on hand is Android — not a new problem.

## 3. Open work, and what each is blocked on

**Only genuinely open work belongs here.** A row whose work has shipped gets
deleted and its outcome goes to `CHANGELOG.md` — see the budget note at the top
of this file.

| Work | Blocked on |
|---|---|
| **Play production access — APPLIED 2026-08-26, awaiting Google (≤7 days). THE TRAP IS NOW DISARMED.** | **Nothing but the email — and when it lands, the release is ONE command.** `node scripts/play-production-release.mjs --commit`. **The trap this closes was real and was verified, not assumed**: read off the androidpublisher API on 2026-08-26, `countryTargeting` is **`null`** on the live alpha release, which means *inherit the track* — all 177 Play countries, EU 27 included. An app distributed in the EU with no DSA trader declaration is **removed from all 27 EU territories**. The script pins the release to exactly the **145 territories iOS already ships to**, with **`includeRestOfWorld: false`** so a country Google adds later is not opted in silently, which is how the carve-out would otherwise defeat itself. **The country table is a MIRROR of App Store Connect, not a hand-kept list** — `--check-source` re-reads ASC and diffs it (in sync, 145/145, 2026-08-26), and the codes are validated against ICU before anything touches Play, because a wrong two-letter code does not fail loudly: Play accepts it and just does not ship somewhere. `XK` (Kosovo) is the one row ICU cannot validate — Apple calls it `XKS`, Play calls it `XK`, ISO has never assigned it a code. **Promotion needs no build**: vc 37 keeps runtime `ae526937…`, so the same binary moves tracks and production users immediately receive every OTA already published. The service account already holds *Release to production*. **Two of the application's six answers were the owner's own testimony** and were answered on inference (testers recruited personally, friends/family, no paid provider; how easy: Difficult) — that is why, if Google queries either. |
| **DSA trader status — the last 30 iOS territories** | **Owner.** iOS is available in **145 of 175** territories as of 2026-08-26. The 30 held back are the EU 27 plus GBR, ISL, NOR, because EU distribution triggers Apple's trader declaration, which **publishes** the trader's name, address, phone and email on every EU product page. Values to use are in `CLAUDE.local.md` — the Sheridan address and `+1 307 201 8420`, never the personal number. Set *ASC → Business → Trader Status* first, then flip the 30. `availableInNewTerritories` is **FALSE on purpose** so a territory Apple adds later cannot silently defeat the carve-out. **API note that cost two failed attempts:** `POST /v2/appAvailabilities` is a CREATE and 409s once an availability record exists (it always does, post-launch); the mutation path is `PATCH /v1/territoryAvailabilities/{id}`, one territory at a time, with the base64 ids from `GET /v2/appAvailabilities/{app}/territoryAvailabilities`. |
| **#107 Zero-Tap Sign-In — BUILT on `feat/zero-tap-block-store`, NOT merged. A 30 Sept deadline decides which implementation counts.** | **Play production access and one question for Play support — the Health-apps deadlock is CLEARED (2026-08-27).** #101 is closed: R8 shipped and is device-verified in vc 39, bitmaps are fine, dynamic memory needs production traffic. Zero-Tap is all that is left, and the shape changed. Play names the **Restore Credentials API**, whose own guide makes *"set up a relying party server"* a prerequisite — it is WebAuthn end to end, and this project has no app server by design. **Google accepts a Block Store integration instead, "only if completed and in production on or before September 30, 2026"** — no server, no new secret, no new collection in a rules file already at Firestore's 1,000-expression limit (#100). That is a day of work against several, and it is done: an Android-only Expo module storing Firebase's own persistence blob with the access token blanked (<1 KB), written **only** under end-to-end encryption, deleted on sign-out and on account deletion. **ADR-0035.** **Measured, and it is why the dependency lives in `modules/` and not `app.json`:** Android moved `ae526937…` → `5facf778…`, **iOS did not move at all**. Via `app.json` it would have moved both and shut the iOS channel while build 60 is public — the 2026-08-25 failure. **On a branch deliberately**: merging shuts the Android OTA channel until vc 40 is on the track. **The restore leg is UNVERIFIED and cannot be verified here** — it fires only on a real Android-to-Android migration, which needs two devices; 13 tests pin the guards, which is not the same claim. **Play support ticket FILED 2026-08-27** from the ORG account (gabriel@bermudezsystems.com), topic *Android vitals and technical quality* / common issue *Restore credentials*, app-scoped to Ignia; **Case ID pending**, reply by email within 2 business days — read it back at Play Console -> Help -> *Your support tickets*. It quotes the two sentences on Google's own page that contradict each other and asks three questions: does "in production" mean the production track; does a testing track before 30 Sept count if production access lands after it; is a qualifying Block Store integration compliant indefinitely. **Play's AI pre-triage answered all three, pessimistically, and it is NOT authoritative** (its own banner says it may be wrong) — which is why the human ticket was taken anyway: *"in production" refers specifically to having the compliant release active on the production track*; internal or closed testing before 30 Sept does **not** meet it; production access granted after 30 Sept voids the Block Store exception **even if the bundle was on a testing track first**, leaving Restore Credentials as the only route to April 2027; and an integration that *was* in production by 30 Sept stays compliant with no migration. **Plan against that reading until support confirms or contradicts it in writing**: it makes 30 Sept a production-track deadline that Ignia does not control, since production access was only applied for on 26 Aug. If the date is missed the branch still delivers the UX and nothing is wasted. |
| **Stretching / mobility in Train — decided, not built** | **Nothing; ready to implement, and it is UNTICKETED.** The research ticket is closed and **ADR-0028 is `accepted`** (2026-08-26): **mobility is a timed exercise in the existing `exercises[]` array** — one new `SetKind` value, one line in `isWorkingSet`, a seeded catalog list and one pure dose-guardrail predicate. **No new collection, no session field, no `firestore.rules` change, no fingerprint move** — it ships by OTA. The research is what shaped it: static stretching before lifting costs measurable strength (Simic et al., 104 studies: **−5.4%** max strength, **−1.9%** power, dose-dependent past ~60 s), and the Cochrane review (n=**2,377** in one trial) finds **no clinically important soreness reduction** — so **no copy anywhere may claim soreness relief, recovery or injury prevention**, which is a decision and not a tone preference. Ignia already implements RAMP's *Potentiate* (`warmup.ts` is the load ramp), so the honest description is "add M". Vocabulary is in `CONTEXT.md` (`warmup` re-scoped to the load ramp, `activation` flagged as cluster vocabulary rather than RAMP's A). **Widening `SetKind` touches FOUR sites, not the three the ADR named** — the fourth is `template-editor.component.ts`'s `SET_KINDS`, and missing it compiles cleanly and silently omits the kind on web. Amendment 1 settles the two points decision 5 left under-specified. |
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** #76 is closed, ADR-0029 is `accepted`, and multi-photo capture was confirmed working by the owner on a real meal (2026-08-26) — the quota fix that confirmation forced is in `CHANGELOG.md`. **The asymmetry it established must survive:** `spendCeiling` counts IMAGES because it is the solvency guard, `dailyQuota` counts SCANS because it is the fairness one. Still never observed: **repeat detection has never fired** (needs a My Foods entry matching a typed note; it is deliberately quiet, so "never suggested anything" and "broken" look identical) and **`measured` has never appeared** (needs a legible scale AND unit in one photo). **The seam not to break:** `measured` drops if `clampGrams` altered the number, so a badge never names a weight the scale did not show. **Known-weak neighbour:** de-duplication is improved, not solved — one run sent the same photo three times and returned two hamburger patties. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Resolver head-noun mis-matches** | **Nothing; a dedicated sitting.** Two classes were fixed and deployed 2026-08-26 (substring matches, meat analogues — `CHANGELOG.md`). What remains needs the resolver to know which word is the *food*: `unsalted butter` → a pretzel row, `pancakes with syrup` → `Pancake syrup`, `black coffee` → `Coffee, Cuban`. That means retuning a ranker against the real dataset. **Treat it as high-risk:** the first attempt at a much simpler guard returned `null` for every single-token phrase — `bacon` resolved to nothing — and the 44-test suite did not catch it; a bare word tested by hand did. There is now a test pinning it, and the remaining cases are listed in the header of `functions/test/photo-resolve-description-hitrate.spec.ts`. Re-run it with `--reporter=verbose --disable-console-intercept` or the output is swallowed. |
| **Cardio + Oura — shipped; verification and one Android binary are what is left** | **Nothing blocking on code.** The chain is merged and delivered by OTA on both platforms (`CHANGELOG.md`). **(1) No Oura record has ever been read, by either transport.** There is exactly one ring on this project, so this cannot be closed from a workstation: connect in Settings → Connected apps, tap *Import now*, and check a real workout lands in Train with a **via Oura** chip. The card reports a `skipped` count because the wire shape is corroborated by third-party clients rather than a captured payload — **a non-zero `skipped` means the parser is wrong, and is the finding.** **(2) Android's health-store workout read needs a binary — the Health-apps deadlock that blocked it is CLEARED.** The code half is done (`READ_EXERCISE` declared via step 4b of `patch-android-release.mjs`, `ExerciseSession` requested read); a manifest permission exists only in a binary, so through vc 37 Health Connect refuses the read and `readWorkouts` returns empty. **BROKEN 2026-08-27, and the ordering is the whole trick:** a `draft` commits but Play never re-scans; the same call as `completed` returns **403 from `androidpublisher` itself**; **publishing to INTERNAL testing through the Console succeeds and makes Play detect the permission**, which is what makes it declarable. vc 39 is on internal (no testers, so it reaches nobody) and the declaration is **submitted for review**. **alpha is untouched at vc 37, so production access is undisturbed.** The fastlane issue that looks like the cause is a red herring — the 403 was reproduced with hand-rolled API calls. Full write-up on the vc 39 row in `apps/mobile/AGENTS.md`. **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. |
| **Push notification when an OTA publishes** | **Owner go/no-go, and the ordering matters.** The premise needs correcting first: **the app already auto-applies OTAs without a tap** — `useAutoApplyOta` reloads at cold start and on the next foreground; `UpdateBanner` is the fallback, not the main path. The one hole a push could close is telling someone who has not opened the app at all, and a cold start already auto-applies, so the gain is a faster first paint rather than a delivered update. **Cost side: there is no remote-push infrastructure at all** — `expo-notifications` serves LOCAL reminders only, with no push token, no sender, no `google-services.json`, no `aps-environment`. Adding them is native config on both platforms, so **the fingerprint moves and both need a new binary.** Also weigh the volume: four Android publishes landed in one day on 2026-08-22, and a push per publish is a notification per publish — if it ships, it wants a silent data push that pre-downloads the bundle. |
| **The website is invisible to Google** | **The content half is DEPLOYED and verified live; the other half is SCOPED rather than vague.** Every content route now ships its real copy in the served HTML, both locales, with a build-time guard that fails if a legal section is added to i18n and not carried over. **Real prerendering is blocked on something specific:** `@angular/ssr` prerenders by ROUTING, and this app has no router — `app.routes.ts` is one catch-all with no component, pages switch by signal off `window.location.pathname`, and `App` reads `navigator` in a field initialiser. So it is a router migration plus an SSR-safety pass on a frozen frontend (ADR-0022), not a build-config flag. Cost the router migration first. **Crawling itself is still unmeasured** — this changes what Google finds, not whether it comes. Numbers in `docs/seo-status.md`. |
| **Android device QA — the suite is GREEN; one flow to watch** | **Nothing blocking.** Host is the **LG VS988 (LG G6), Android 9 / API 28** over adb from the Windows box — two levels above `minSdk` 26, so a pass here does NOT prove the floor. Best full sweep against vc 37 is **18 of 19**, and **every failure ever found on it was the harness, not the build** (scroll budgets, a swallowed first tap after the IME closes, a teardown leak, a backdrop coordinate). The one to watch is **`09-locale-es`** — a death there strands the account in Spanish and cascades; recover with `node scripts/qa-regression-verify.mjs set-locale --email qa-test@ignia.fit --locale en`. Getting adb back after a reboot is a PHYSICAL task (the RSA prompt cannot render behind a locked keyguard). Full diagnosis and the two known harness defects: `apps/mobile/.maestro/regression/coverage.md`. |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`). |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2). |
| **Web retirement question** | **A measurement, not intuition** (ADR-0022): `node scripts/usage-report.mjs --days 30`, reading `platforms`. May not be revisited before that data exists. |
| **`bermudezsystems.com` — the domain is the exposure, not the mailbox** | **Owner, on a diary.** Registered 2026-07-06, **expires 2027-07-06**, registrar DomainRegistry.com LLC (Northwest resells through them), registry status plain `active` with no `clientTransferProhibited`. **① The lapse risk is GONE — Northwest confirmed in writing on 2026-08-26** that *"the Domain Name is provided as part of your Registered Agent service and will automatically renew each year that you still have that service active with us."* There is no 2027-07-06 deadline; this row previously said there was ~10 months of runway and that was wrong. **What is left is a coupling, and it is worth removing at leisure rather than urgently:** the domain now lives exactly as long as the RA subscription does, so cancelling that service — or its card failing — takes the org Play developer account's login with it. **Transfer is still the fix and it is nearly eligible:** ICANN bars a transfer within 60 days of registration, so ~2026-09-04. The mailbox is on Microsoft 365 and does NOT ride on Northwest, so a registrar move no longer risks it; what must be carried is the DNS — the M365 MX, the `google-site-verification` TXT, and `_dmarc`. **② Recovery on the org Google account — recovery email, phone, saved 2FA backup codes — is still open, owner-only, and is the highest-value item on this list**, because it is what survives a lapse: the org Play developer account's login IS `gabriel@bermudezsystems.com`. **Do NOT delete the `google-site-verification=1EYLbXKH66lt3XNRVrp3o066X7NqEeKBhMwWO64P57U` TXT** — Play's org website verification rides on it. Mailbox is now on Microsoft 365 (verified in public DNS), so the never-configured Gmail forward is no longer a mechanism anyone depends on. One loose end: `_dmarc` still reports to Northwest's collector. Runbook: `docs/DEV_ENVIRONMENT.md` §4. |
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
  delete-account URL, both on `ignia.fit`. (ADR-0022)

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
