# STATUS — what is true right now

**Updated:** 2026-08-30 · **Owns:** current state only. Not history
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
| **TestFlight** | **build 60 / 1.2.1**, runtime `7b347b0f…`, `VALID`, and on the EXTERNAL *Public Beta Testers* group (added 2026-08-24 — it was internal-only before that, and external testers had received nothing for six days). Group holds `60,58,57,53,49,47,45,7,4`. **Read the group's builds, never assume:** a build being `VALID` and on TestFlight does not mean any external tester can install it |
| **Play alpha** | **vc 37** (1.2.1), live on the track, confirmed from the **androidpublisher API** — runtime `ae526937…` read from the `.aab`, so the Android **OTA channel is OPEN**. Behaviourally it is vc 36 plus nothing; it exists to undo the fingerprint cost of the ABI cut. **vc 36 and the never-released vc 38 are orphan runtimes** — no OTA reaches either, and the update banner is what drains them. Do not publish a second update to "cover" them. **`eas submit` has failed and exited 0 twice**, on two different causes (`This Edit has been deleted`; a missing health declaration) — always confirm a submit against the tracks API |
| **Play production** | **SUBMITTED AND IN REVIEW — not yet live. vc 37 / 1.2.1, `completed` (100%), committed 2026-08-29.** The first Android production release ever. **Three independent reads, because only one of them is about review:** (1) the androidpublisher tracks API shows the release on `production` with `countryTargeting: null` — correct, it INHERITS the track — and the track reads **128 countries, restOfWorld=false**; (2) Play Console → Publishing overview says **"Changes in review · Your changes are now in review"**; (3) the public store page `play.google.com/store/apps/details?id=fit.ignia.app` returns **404**, verified against a known-live app returning 200 from the same client. **So the release exists and is queued, and nobody can install it yet.** Do not call it live until that 404 becomes a 200 — that is the only user-visible truth. **There is NO API for review status** (checked against the v3 resource list 2026-08-29; the `appstoreappsreview` resource is for app-store-hosted apps and holds no persistent data). The Console and the store URL are the ONLY reads. A probe built on `ERROR_IF_IN_REVIEW` was tried and **disproved the same day** — it reported NOT IN REVIEW while the app was in review; don't rebuild it, the script header says why. `edits.commit` DID submit it: `changesNotSentForReview` was unset, and the documented default is to submit. When it publishes, vc 37 keeps runtime `ae526937…`, so production users receive every OTA already published. **128, not 145:** Play's picker offers 176 territories and does not offer 17 that iOS ships to (`NOT_OFFERED_BY_PLAY`) — a platform limit, not drift. EU 27 + GB/IS/NO remain deliberately absent pending Play's own DSA declaration (§3) |
| **Web `ignia.fit`** | **Shell + `/admin` — the web logging app was RETIRED 2026-08-30 (ADR-0036).** 113 prerendered pages, EN + es-PR. `/app` and the old tabs render a "moved to the apps" page; a safety worker evicts old PWA installs. OPEN for the owner (ADR-0036 §7): keep or drop the SEO pages and `/u/**` — both kept |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**: OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that. Servings ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **iOS OPEN; Android SHUT to real users** (§2). Latest: **iOS OTA 55 on build 60 (`7b347b0f…`), reaching every iOS user. Android OTA 88–91 are on `d7ea3629…` = vc 40, which is on NO track — they reach the test device and nobody else, while every real Android user is on vc 37 with OTA 87.** Publishing to vc 40 is deliberate: it is the only way to device-verify while the channel is shut, at zero user exposure. **"Published" is not "delivered" here.** The iOS crash re-ship is still UNDER TEST (§2); everything since rides on it. **This row is a POINTER, not a log: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** It is deliberately kept to two facts (newest number per platform, and who receives it) — the version that listed a dozen historical publishes went stale twice, once reading "Android 7 / iOS 5" against `AGENTS.md`'s Android 27 / iOS 12. Re-check with `npx eas update:list --branch production --limit 3`, which prints the runtime each went out under |
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

**vc 40 — Zero-Tap Sign-In (#107) — is BUILT, DEVICE-VERIFIED, and on NO track.** Merged `fa19916f`, runtime `d7ea3629…` read from the `.aab`. Held back deliberately: vc 37 is in production review and an `eas submit` would cancel it. Submit once the store URL returns 200. **The Android OTA channel is SHUT** until vc 40 is on a track; iOS is unaffected at `7b347b0f…`. Evidence, the two defects fixed today, and what is still unverified: the vc 40 row in `apps/mobile/AGENTS.md`.

**Milestones (#108/#109/#110) + the Trends stub labels (#115) — published, delivered on iOS ONLY.** iOS OTA 55 reaches every iOS user; the Android halves (OTA 88–91) sit on vc 40 and reach only the test device. Device-verified in both themes on the LG VS988, writes read back from PROD, rules deployed. The Today note is **dismissable for the day** — the first run backfills every past milestone at once, which the owner's iPhone showed as four stacked rows. **`goal-reached` ships behind a confirmation** because `dailyWeights` has no `source`; its positive path is unit-tested only. Detail: the OTA 88–91 and iOS OTA 55 rows in `apps/mobile/AGENTS.md`.

**The Trends water card (#115 §3) — merged `b79f9a7f`, delivered on iOS ONLY.** iOS OTA 56 on build 60 reaches every iOS user (2026-08-30); Android OTA 92 sits on vc 40 and reaches only the test device. A fourteen-day water strip with the three-state contract, plus the Habits strip generalised to "whichever faces have a card", which is what made a third face safe. Measured first (`scripts/trends-water-states.mjs`): **34 of 43 accounts (79%) have no water in the window**, so the stub row is the feature and only 4 accounts would see a chart. Ceiling is **100 fl oz, deliberately not 128** — a gallon a day is not a target this product holds, and a test defends it. **DEVICE-VERIFIED on the LG VS988 in both themes:** three tabs on one row at 360 dp, chart state with every number reconciled against PROD `dailyWater` rows. The stub row and its dismiss are unit-tested only — the QA account has 11 water days and emptying it would delete what flow 14 writes against. iOS behaviour is unverified, as standing. **Announced:** `WHATS_NEW_VERSION` bumped to `2026-08-30-water-trends` and published as Android OTA 93 / iOS OTA 57 the same day; the banner is device-verified, and it sits *behind* a pending recalibration card by design. Detail: the OTA 92/56 and 93/57 rows in `apps/mobile/AGENTS.md`.

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

| Work | Blocked on |
|---|---|
| **Play's DSA trader declaration — the last thing standing between Android and 30 more territories.** Apple's does NOT carry over | **Owner, in Play Console.** The iOS half is **done** — filed 2026-08-28, iOS is 175/175, and the outcome is in `CHANGELOG.md`. Google keeps its own declaration and it is still unfiled, so the production track stays at **128** and the EU 27 + GB/IS/NO stay off. **Order matters and has a 27-country blast radius:** file Play's declaration FIRST, then move the 30 rows out of `EU_PENDING_PLAY_DSA` and re-run `--availability`. Opening them first ships into the EU with no Google-side trader info, which removes the app from all 27 — so do **not** sync the table to 175 beforehand. Two things that read as drift and are not: `play-production-release.mjs` is pinned to 145 on purpose and `--check-source` explains the hold-back rather than failing on it; and the 17 in `NOT_OFFERED_BY_PLAY` can never be opened at all (Play has no storefront for them), so Android's ceiling is 175 − 17 − (30 while unfiled). Expect the flow to demand a **six-digit code emailed to the contact address**, as Apple's did — it lands in Outlook, not Gmail. |
| **#107 Zero-Tap Sign-In — a dated critical path, and the date is 30 SEPT** | **One Google review, not pollable, ~31 days.** Play Developer Support confirmed in writing (08-28): the Block Store exemption needs the integration on the **Production track** by 30 Sept — testing tracks do not count, production access granted after the date does not count — and clearing it keeps Block Store valid **indefinitely** (no WebAuthn relying party, ever). Missing it costs the whole WebAuthn build in an app with no server by design. **Every step but the last is done** (§2: vc 40 built, device-verified, merged) — what is left is `eas submit` vc 40 to a track and promote to production, and that is queued behind vc 37's production review because a submit now would cancel it. **The Android OTA channel is SHUT meanwhile.** The promotion is the first-ever Android production release under a deadline: keep production pinned to 128 countries until Play's DSA trader declaration is filed (row above). Restore leg still unverifiable here (needs two devices). |
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** Multi-photo capture is closed and was confirmed on a real meal (2026-08-26); ADR-0029 is `accepted`. **The asymmetry that must survive:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness). Never observed: **repeat detection has never fired** (needs a My Foods entry matching a typed note; it is deliberately quiet, so "never suggested anything" and "broken" look identical) and **`measured` has never appeared** (needs a legible scale AND unit in one photo). **Seam not to break:** `measured` drops if `clampGrams` altered the number, so a badge never names a weight the scale did not show. De-duplication is improved, not solved — one run returned two hamburger patties from the same photo sent three times. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Resolver head-noun mis-matches — the ABSTAIN half is DEPLOYED 2026-08-27; what is left is a ranker, not a filter** | **Nothing; a dedicated sitting.** Four classes are now fixed. Three earlier (substring matches, meat analogues, and a variety name the corpus cannot portion), and today the one the spec header called out for a month: `unsalted butter` returned *Pretzels, soft, unsalted, buttered* and now returns `Butter, tub`. `headIsIdentity` in `functions/src/photo-resolve.ts` requires the head noun to appear in the first two comma segments of the USDA description — the ones saying what the food IS — on every pass. **Live: `analyzePhoto`/`searchFoods`/`getFoodDetail` deployed 2026-08-27.** Measured over an 80-phrase corpus: 4 changes, **0 regressions**. **The spec header's own diagnosis was wrong and is corrected in place** — it blamed the relaxed shortening pass, but the pretzel is an EXACT-pass hit (`buttered` clears `butter` on the two-character suffix tolerance), so a guard on the shortening loop would have done nothing. **WHAT REMAINS is a different family and a genuinely harder one:** a correct genus that acquires a qualifier nobody asked for — `black coffee` → `Coffee, CUBAN`, `greek yogurt` → `Yogurt, Greek, plain, WHOLE MILK`, `bacon` → `Bacon, TURKEY`, `grilled chicken breast` → `Chicken breast, rotisserie, SKIN EATEN`. No filter fixes those; it is the ranker, retuned against the real dataset. **Treat it as high-risk:** an earlier simple guard returned `null` for every single-token phrase — `bacon` resolved to nothing — and the 44-test suite missed it; today's guard was caught twice by the suite before it was right. Cases listed in the header of `functions/test/photo-resolve-description-hitrate.spec.ts`; re-run with `--reporter=verbose --disable-console-intercept` or output is swallowed. |
| **Cardio + Oura — shipped; verification and one Android binary are what is left** | **Nothing blocking on code.** Merged and delivered by OTA on both platforms (`CHANGELOG.md`). **(1) No Oura record has ever been read, by either transport.** One ring on this project, so this cannot close from a workstation: Settings → Connected apps → *Import now*, then check a real workout lands in Train with a **via Oura** chip. The card reports a `skipped` count because the wire shape is corroborated by third-party clients, not a captured payload — **a non-zero `skipped` means the parser is wrong, and is the finding.** **(2) Android's health-store workout read needs a binary.** `READ_EXERCISE` is declared (step 4b of `patch-android-release.mjs`) and `ExerciseSession` requested, but a manifest permission exists only in a binary, so through vc 37 Health Connect refuses the read and `readWorkouts` returns empty. The Health-apps declaration that gated it is **CLEARED — verified in the Console 2026-08-29** (*Need attention* empty, Health apps under *Actioned*, step 1 detects `READ_EXERCISE`, Policy status *No issues found*), so **vc 40 is unblocked on this axis**; alpha stayed at vc 37 throughout, so production access was never disturbed. How it cleared (a `draft` never re-scans, `completed` 403s, INTERNAL via the Console is what makes Play detect the permission — vc 39, no testers) is on the vc 39 row in `apps/mobile/AGENTS.md`. **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. |
| **Push notification when an OTA publishes** (#112, #114) | **Owner go/no-go, and the ordering matters.** The premise needs correcting first: **the app already auto-applies OTAs without a tap** — `useAutoApplyOta` reloads at cold start and on the next foreground; `UpdateBanner` is the fallback. The gain is a faster first paint, not a delivered update; if it ships it wants a **silent pre-download push** (#114), not a notification per publish. **Cost side, corrected 2026-08-30 (this row said "no remote-push infrastructure at all" until then):** an FCM sender exists and runs hourly (`push-reminders.ts`) but has **never delivered a push** — 0 of 43 accounts hold an `fcmToken`, and since ADR-0036 deleted the web push client **nothing writes one**. Treat the send path as untested. The mobile client + credentials (`google-services.json`, `aps-environment`, an `expoPushToken` field and a mobile-shaped sender) are all missing; adding them is native config on both platforms, so **both fingerprints move → vc 41 + a new iOS build**, and it may not start until vc 40 is on the production track (#107, 30 Sept). |
| **The website is invisible to Google — and after 2026-08-27 the reason is MEASURED, not theorised** | **Owner go/no-go on a cheaper plan than the one this row used to name.** The content half is deployed and verified live. **It moved nothing:** `node scripts/gsc.mjs inspect` returns *URL is unknown to Google* on **7 of 7** sampled URLs, unchanged from the 2026-07-29 baseline, 29 days on. **And the front door is shut: the sitemap has NEVER been downloaded** — re-submitted 2026-08-27, `lastDownloaded: not yet`, **0 warnings, 0 errors**. That is the third consecutive submission (07-29, 08-17, 08-27) Google has not fetched, and a clean bill of health each time, so it is **not** a sitemap-quality problem. **Server-rendering the body of a URL Google never requests changes nothing**, which is why the router migration is now DEFERRED rather than scheduled. **The orphan graph, measured:** the built sitemap has **118** URLs, **18** reachable by a real `<a href>`, so **100 are orphans** — every calculator variant and all 57 Spanish URLs (**0** links to any `/es/` path). `routerLink` is in zero files, yet **20 plain anchors already ship and work**, so linking the rest needs no router. **The migration WAS costed:** 21 route branches, 12 SEO components (only ~14 browser-global refs — the cheap half) against a shell `app.ts` with 28 plus 8 services and 7 utils on the server-render path, and a hard blocker at `app.ts:503` — `signal(!navigator.onLine)` in a FIELD INITIALISER, which throws before any route renders. Largest change anyone would make to a FROZEN frontend (ADR-0022), on a surface whose retirement is itself awaiting `usage-report.mjs`. **Order: link the 100 orphans (a hub page or footer index — a design call the owner has not made), re-measure, and only then reconsider the router.** Numbers and both tables: `docs/seo-status.md`. |
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
