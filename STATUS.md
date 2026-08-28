# STATUS — what is true right now

**Updated:** 2026-08-27 · **Owns:** current state only. Not history
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
| **Play production** | **NOT launched — production ACCESS applied for 2026-08-26, under review (≤7 days).** Access is per developer account and did not follow the app across the transfer to Bermudez Systems LLC. Tracks read live: `production` **empty**, `beta` empty, `alpha` completed vc 37, `internal` an EMPTY draft — **zero Android production users.** See §3 for the `countryTargeting` trap that governs the first production release |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), **113 prerendered pages (en 56 / es 57), 118-URL sitemap** — read off the generator 2026-08-23. Every content page ships its real copy, not just a `<head>` (`docs/seo-status.md`). **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, plus the restaurant corpus (25,126 items / 91 chains, ADR-0027). **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**: OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that. Servings ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **Both channels OPEN.** Latest: **Android OTA 81 on vc 37 (`ae526937…`), iOS OTA 47 on build 60 (`7b347b0f…`)**. Both reach real users — build 60 is the public App Store binary. **This row is a POINTER, not a log: `apps/mobile/AGENTS.md` is the per-publish record and it wins.** It is deliberately kept to two facts (newest number per platform, and who receives it) — the version that listed a dozen historical publishes went stale twice, once reading "Android 7 / iOS 5" against `AGENTS.md`'s Android 27 / iOS 12. Re-check with `npx eas update:list --branch production --limit 3`, which prints the runtime each went out under |
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

**Nothing.** Everything merged has shipped. The two Sentry fixes that sat here
went out as **Android OTA 80 / iOS OTA 46** on 2026-08-28, under
`ae526937…` (= vc 37) and `7b347b0f…` (= build 60, the public App Store
binary), so both reach real users; per-OTA detail is on that row in
`apps/mobile/AGENTS.md`.

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
| **Play production access — APPLIED 2026-08-26, awaiting Google (≤7 days). THE TRAP IS DISARMED.** | **Nothing but the email — and when it lands the release is ONE command:** `node scripts/play-production-release.mjs --commit`. **The trap it closes was verified, not assumed:** `countryTargeting` is `null` on the live alpha release, which means *inherit the track* — all 177 Play countries, EU 27 included, and an app distributed in the EU with no DSA trader declaration is removed from all 27. The script pins the release to exactly the 145 territories iOS ships to, with `includeRestOfWorld: false`. **Its own header carries the full reasoning, the ASC mirror rule (`--check-source`, in sync 145/145) and the `XK`/`XKS` Kosovo exception — read it there rather than duplicating it here.** Promotion needs no build: vc 37 keeps runtime `ae526937…`, so the same binary moves tracks and production users immediately receive every OTA already published. The service account holds *Release to production*. **SEQUENCING, decided 2026-08-28 and it is not obvious: promote vc 37 the moment access lands, and do NOT let vc 40 be the first-ever production release.** vc 37 is one command, establishes the production track, and exercises this script and its `countryTargeting` pinning while nothing is at stake. vc 40 then goes out as a routine SECOND release rather than a first release under the 30 Sept deadline. Doing the never-done-before thing and the deadline thing in the same step is exactly how the country trap gets skipped. **Two of the six application answers were the owner's own testimony**, answered on inference (testers recruited personally, friends/family, no paid provider; how easy: Difficult) — which is what to revisit if Google queries either. |
| **DSA trader status — iOS side DONE 2026-08-28 (175/175). The PLAY side is now the open half, and Apple's declaration does NOT carry over.** | **Owner, in Play Console.** **What shipped:** the DSA declaration on the Bermudez Systems LLC entity (`94754902`) was flipped from Apple's default *"I'm not a trader"* to **"I'm a trader under the DSA"**, verified by *Last Updated* changing from blank to **Aug 28, 2026** — blank is the default, a date means somebody filed it. Published on the EU product page: the Sheridan address (read-only, pulled from D&B), `+1 307 201 8420`, `gabriel@bermudezsystems.com` — no personal number, no personal email. **The flow needs an emailed 6-digit code to that contact address**, so it cannot be finished without the Northwest/M365 mailbox; the Gmail forward has never been configured. All 30 held-back territories then opened via `node scripts/asc-eu-territories.mjs --commit --trader-status-is-live`: **iOS is 175/175, 0 blocked**, and `availableInNewTerritories` re-read **false** afterwards, so the carve-out against territories Apple adds later still holds. **WHAT IS LEFT, and it is a trap with a 27-country blast radius:** Google has its OWN DSA trader declaration in Play Console and **Apple's does not carry over**. `play-production-release.mjs` is therefore still pinned to **145**, and `--check-source` no longer calls that drift — it now names the 30 as a deliberate hold-back and explains why, while still failing on any other divergence. **Do not sync the table to 175 before filing Play's declaration**: the first-ever Android production release would ship into the EU 27 with no Google-side trader info, which removes the app from all 27. File it, then move the rows and delete `EU_PENDING_PLAY_DSA` — in that order. |
| **#107 Zero-Tap Sign-In — ANSWERED BY GOOGLE IN WRITING 2026-08-28. It is now a dated critical path, not an open question, and the date is 30 SEPT.** | **Two Google reviews neither of which is pollable, and ~33 days.** Play Developer Support ("Drei") confirmed all three questions, and confirmed them the PESSIMISTIC way the AI pre-triage had guessed: **(1)** the exemption "specifically requires the Block Store integration to be on the **Production track**. Testing tracks (Internal, Closed, or Open testing) do not qualify." **(2)** "If your app's production access is granted after September 30, **even if the integration was live on a testing track before that date**, the app will not qualify... Any other integration types or setups completed after the cutoff date are not considered compliant." **(3)** the one piece of good news, and it is real: the cutoff "was established specifically to ensure that existing zero-tap sign-in implementations using Block Store remain valid **indefinitely**", so clearing 30 Sept means **never** migrating to Restore Credentials. **THE COST OF MISSING IT is the whole WebAuthn build this project dodged:** a relying-party server as Cloud Functions, a public-key collection with rules, custom-token minting, a native `CredentialManager` module — by April 2027, in an app with no server by design. **THE CRITICAL PATH, and every step is serial:** Play **production access** (applied 08-26, ~7 days, NOT yet granted) → **Health-apps declaration** (submitted 08-27, ~09-03) which is what unblocks vc 40 → merge `feat/zero-tap-block-store` → build vc 40 → alpha → **promote to production**, before 30 Sept. **The merge shuts the Android OTA channel** (`ae526937…` → `5facf778…`) until vc 40 is on a track, so it must not happen before something needs to ship by OTA. **This also forces the FIRST-EVER Android production release to happen under a deadline**, which is exactly when the `countryTargeting` trap gets skipped — use `scripts/play-production-release.mjs`, never the console. **Still unverified and unverifiable here:** the restore leg fires only on a real Android-to-Android migration and needs two devices; 13 tests pin the guards, which is not the same claim. Design, alternatives and Google's full reply: ADR-0035 and issue #107. |
| **The Today count-up animates through numbers that were never true** | **Nothing; a small sitting, and it wants a device.** Found while fixing the ring clipping (OTA 81, `2f2777dc` — that half is SHIPPED and device-verified). The clipped `1,14` was only visible because the ring was mid-animation showing a 4-digit value when the answer was **461**. `loading` releases as soon as the OFFLINE CACHE paints (`!snapshotArrived && !logsFromCache` in `useToday`) — deliberate — so `HeroRings` mounts on cached numbers and count-ups to the live snapshot, sweeping through values the user never had. **The precedent is ten lines above it:** the protein flare uses a null-first ref so a day that ALREADY met its target does not flare on mount. **Not done because it is a behaviour change on the most visible component and RNTL runs no Yoga pass**, so a device is the only place to judge it. |
| **Photo scan — two things have still never been seen on a device** | **Owner, with a phone.** Multi-photo capture is closed and was confirmed on a real meal (2026-08-26); ADR-0029 is `accepted`. **The asymmetry that must survive:** `spendCeiling` counts IMAGES (solvency), `dailyQuota` counts SCANS (fairness). Never observed: **repeat detection has never fired** (needs a My Foods entry matching a typed note; it is deliberately quiet, so "never suggested anything" and "broken" look identical) and **`measured` has never appeared** (needs a legible scale AND unit in one photo). **Seam not to break:** `measured` drops if `clampGrams` altered the number, so a badge never names a weight the scale did not show. De-duplication is improved, not solved — one run returned two hamburger patties from the same photo sent three times. **Owner-only call:** whether a matched repeat should land on an editable draft rather than logging straight to Today. |
| **Resolver head-noun mis-matches — the ABSTAIN half is DEPLOYED 2026-08-27; what is left is a ranker, not a filter** | **Nothing; a dedicated sitting.** Four classes are now fixed. Three earlier (substring matches, meat analogues, and a variety name the corpus cannot portion), and today the one the spec header called out for a month: `unsalted butter` returned *Pretzels, soft, unsalted, buttered* and now returns `Butter, tub`. `headIsIdentity` in `functions/src/photo-resolve.ts` requires the head noun to appear in the first two comma segments of the USDA description — the ones saying what the food IS — on every pass. **Live: `analyzePhoto`/`searchFoods`/`getFoodDetail` deployed 2026-08-27.** Measured over an 80-phrase corpus: 4 changes, **0 regressions**. **The spec header's own diagnosis was wrong and is corrected in place** — it blamed the relaxed shortening pass, but the pretzel is an EXACT-pass hit (`buttered` clears `butter` on the two-character suffix tolerance), so a guard on the shortening loop would have done nothing. **WHAT REMAINS is a different family and a genuinely harder one:** a correct genus that acquires a qualifier nobody asked for — `black coffee` → `Coffee, CUBAN`, `greek yogurt` → `Yogurt, Greek, plain, WHOLE MILK`, `bacon` → `Bacon, TURKEY`, `grilled chicken breast` → `Chicken breast, rotisserie, SKIN EATEN`. No filter fixes those; it is the ranker, retuned against the real dataset. **Treat it as high-risk:** an earlier simple guard returned `null` for every single-token phrase — `bacon` resolved to nothing — and the 44-test suite missed it; today's guard was caught twice by the suite before it was right. Cases listed in the header of `functions/test/photo-resolve-description-hitrate.spec.ts`; re-run with `--reporter=verbose --disable-console-intercept` or output is swallowed. |
| **Cardio + Oura — shipped; verification and one Android binary are what is left** | **Nothing blocking on code.** The chain is merged and delivered by OTA on both platforms (`CHANGELOG.md`). **(1) No Oura record has ever been read, by either transport.** There is exactly one ring on this project, so this cannot be closed from a workstation: connect in Settings → Connected apps, tap *Import now*, and check a real workout lands in Train with a **via Oura** chip. The card reports a `skipped` count because the wire shape is corroborated by third-party clients rather than a captured payload — **a non-zero `skipped` means the parser is wrong, and is the finding.** **(2) Android's health-store workout read needs a binary — the Health-apps deadlock that blocked it is CLEARED.** The code half is done (`READ_EXERCISE` declared via step 4b of `patch-android-release.mjs`, `ExerciseSession` requested read); a manifest permission exists only in a binary, so through vc 37 Health Connect refuses the read and `readWorkouts` returns empty. **BROKEN 2026-08-27, and the ordering is the whole trick:** a `draft` commits but Play never re-scans; the same call as `completed` returns **403 from `androidpublisher` itself**; **publishing to INTERNAL testing through the Console succeeds and makes Play detect the permission**, which is what makes it declarable. vc 39 is on internal (no testers, so it reaches nobody) and the declaration is **submitted for review**. **alpha is untouched at vc 37, so production access is undisturbed.** The fastlane issue that looks like the cause is a red herring — the 403 was reproduced with hand-rolled API calls. Full write-up on the vc 39 row in `apps/mobile/AGENTS.md`. **The seam not to break:** an imported `kcal` is display provenance and never reaches a target (ADR-0024 decision 4, pinned by `cardio-energy-independence.test.ts`). |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone. |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here. |
| **Push notification when an OTA publishes** | **Owner go/no-go, and the ordering matters.** The premise needs correcting first: **the app already auto-applies OTAs without a tap** — `useAutoApplyOta` reloads at cold start and on the next foreground; `UpdateBanner` is the fallback, not the main path. The one hole a push could close is telling someone who has not opened the app at all, and a cold start already auto-applies, so the gain is a faster first paint rather than a delivered update. **Cost side: there is no remote-push infrastructure at all** — `expo-notifications` serves LOCAL reminders only, with no push token, no sender, no `google-services.json`, no `aps-environment`. Adding them is native config on both platforms, so **the fingerprint moves and both need a new binary.** Also weigh the volume: four Android publishes landed in one day on 2026-08-22, and a push per publish is a notification per publish — if it ships, it wants a silent data push that pre-downloads the bundle. |
| **The website is invisible to Google — and after 2026-08-27 the reason is MEASURED, not theorised** | **Owner go/no-go on a cheaper plan than the one this row used to name.** The content half is deployed and verified live. **It moved nothing:** `node scripts/gsc.mjs inspect` returns *URL is unknown to Google* on **7 of 7** sampled URLs, unchanged from the 2026-07-29 baseline, 29 days on. **And the front door is shut: the sitemap has NEVER been downloaded** — re-submitted 2026-08-27, `lastDownloaded: not yet`, **0 warnings, 0 errors**. That is the third consecutive submission (07-29, 08-17, 08-27) Google has not fetched, and a clean bill of health each time, so it is **not** a sitemap-quality problem. **Server-rendering the body of a URL Google never requests changes nothing**, which is why the router migration is now DEFERRED rather than scheduled. **The orphan graph, measured:** the built sitemap has **118** URLs, **18** reachable by a real `<a href>`, so **100 are orphans** — every calculator variant and all 57 Spanish URLs (**0** links to any `/es/` path). `routerLink` is in zero files, yet **20 plain anchors already ship and work**, so linking the rest needs no router. **The migration WAS costed:** 21 route branches, 12 SEO components (only ~14 browser-global refs — the cheap half) against a shell `app.ts` with 28 plus 8 services and 7 utils on the server-render path, and a hard blocker at `app.ts:503` — `signal(!navigator.onLine)` in a FIELD INITIALISER, which throws before any route renders. Largest change anyone would make to a FROZEN frontend (ADR-0022), on a surface whose retirement is itself awaiting `usage-report.mjs`. **Order: link the 100 orphans (a hub page or footer index — a design call the owner has not made), re-measure, and only then reconsider the router.** Numbers and both tables: `docs/seo-status.md`. |
| **Android device QA — the suite is GREEN; one flow to watch** | **Nothing blocking.** Host is the **LG VS988 (LG G6), Android 9 / API 28** over adb — two levels above `minSdk` 26, so a pass does NOT prove the floor. Best sweep against vc 37 is **18 of 19**, and **every failure ever found on it was the harness, not the build**. Watch **`09-locale-es`** — a death there strands the account in Spanish; recover with `node scripts/qa-regression-verify.mjs set-locale --email qa-test@ignia.fit --locale en`. Regaining adb after a reboot is PHYSICAL (the RSA prompt cannot render behind a locked keyguard). Detail and the known harness defects: `apps/mobile/.maestro/regression/coverage.md`. **Residue:** four `QA Tpl Check` templates, one per run — the teardown leak `coverage.md` suspects. |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`). |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2). |
| **Web retirement question** | **A measurement, not intuition** (ADR-0022): `node scripts/usage-report.mjs --days 30`, reading `platforms`. May not be revisited before that data exists. |
| **`bermudezsystems.com` — the domain is the exposure, not the mailbox** | **Owner, on a diary.** Registered 2026-07-06, **expires 2027-07-06**, registrar DomainRegistry.com LLC (Northwest resells through them), registry status plain `active` with no `clientTransferProhibited`. **① The lapse risk is GONE — Northwest confirmed in writing on 2026-08-26** that *"the Domain Name is provided as part of your Registered Agent service and will automatically renew each year that you still have that service active with us."* There is no 2027-07-06 deadline; this row previously said there was ~10 months of runway and that was wrong. **What is left is a coupling, and it is worth removing at leisure rather than urgently:** the domain now lives exactly as long as the RA subscription does, so cancelling that service — or its card failing — takes the org Play developer account's login with it. **Transfer is still the fix and it is nearly eligible:** ICANN bars a transfer within 60 days of registration, so ~2026-09-04. The mailbox is on Microsoft 365 and does NOT ride on Northwest, so a registrar move no longer risks it; what must be carried is the DNS — the M365 MX, the `google-site-verification` TXT, and `_dmarc`. **② Recovery on the org Google account — recovery email, phone, saved 2FA backup codes — is still open, and it is OWNER-ONLY IN A WAY THAT WAS CONFIRMED, not assumed (2026-08-27): setting it needs that account's password, and generating backup codes produces secrets an agent must not hold. Checked from Chrome, which is signed in as the PERSONAL account — the org account is not reachable from this profile without a sign-in.** It remains the highest-value item on this list, because it is what survives a lapse: the org Play developer account's login IS `gabriel@bermudezsystems.com`. **Do NOT delete the `google-site-verification=1EYLbXKH66lt3XNRVrp3o066X7NqEeKBhMwWO64P57U` TXT** — Play's org website verification rides on it. Mailbox is now on Microsoft 365 (verified in public DNS), so the never-configured Gmail forward is no longer a mechanism anyone depends on. One loose end: `_dmarc` still reports to Northwest's collector. Runbook: `docs/DEV_ENVIRONMENT.md` §4. **Adjacent finding, same sitting:** the PERSONAL Google account (`gabrielandresbermudez@gmail.com` — the SOURCE Play developer account and the Apple account email) is in good shape — 2-Step on since Oct 2022, 6 passkeys, recovery phone and recovery email (`gabriel@bermudezpr.com`) both set — but **Backup codes and Recovery contacts are NOT configured**; both still sit under *You can add more sign-in options*. Backup codes are the thing that survives losing the phone. |
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
