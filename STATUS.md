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
| **App Review (iOS)** | **1.2.1 / build 60 is `WAITING_FOR_REVIEW`** (submitted 2026-08-19, release **MANUAL**). Carries the Train template rebuild, the iOS hero-ring fix, `FEATURES.tips=false` embedded and the faster food search. The en-US description finally drops the tip sentence, and BOTH locales drop the "Open Food Facts" claim from the search bullet — text search stopped calling OFF the same day. `usesIdfa` is now explicitly `false`, which closes the open question in `docs/app-store-metadata.md`. Note `POST /v1/reviewSubmissionItems` 500s transiently and leaves an EMPTY submission behind — check the item count before creating a second one. **DECIDED 2026-08-22: build 60 ships as-is; no build 61.** Its embedded bundle is 08-19, so the ~98 commits since (F1–F7, custom targets, feedback, the sheet sweep) reach it only over the air — and `shouldAutoApplyOta` (`app-update.ts:290`) returns `pendingAtMount`, which is false on a first launch, so a **fresh install's first session — its onboarding — runs the OLD sex-blind `computeKcal` seed**. Bounded, not permanent: build 60 writes no `targetMode`, and `targets.ts:176` treats absent as non-custom, so a reliable measured estimate still overrides it later. What that cohort never gets is the four onboarding questions, leaving `toProfileFields` null until they find Settings → Refine targets. Owner accepted that over a return to the back of Apple's queue. **Do not re-open without new evidence** |
| **TestFlight** | **build 60 / 1.2.1** (SDK 57, runtime `7b347b0f…`), `VALID` 2026-08-19, internal group *Team (Expo)* — **not yet released to the external Public Beta Testers group**. Builds 57/58 remain, both stamped `1.2.0`. 1.2.1 exists because 55/57/58 all share the `1.2.0` version string and an App Store version only accepts builds whose string matches, so none could be promoted. **Rings fix is CONFIRMED on device** (owner-reported 2026-08-20), which clears the check that gated the App Store submission. `eas submit` hung at `- Submitting` and exited 0; ingestion still took ~50 min, so poll ASC `/v1/builds`, never the CLI |
| **Play alpha** | **vc 37** (1.2.1), live on the track, confirmed from the **androidpublisher API** — runtime `ae526937…` read from the `.aab`, so the Android **OTA channel is OPEN**. It exists to undo the fingerprint cost of the ABI cut (see the OTA block below); behaviourally it is vc 36 plus nothing. **vc 36 is now an orphan runtime** — no OTA reaches it, and the update banner is what drains it. `eas submit` **failed and exited 0** on the first attempt (`This Edit has been deleted`, Play's edit expired mid-upload); the retry worked. **Behaviour VERIFIED 2026-08-23** — first full Maestro sweep since vc 34/35: **12/19**, failures 04, 09, 10, 14, 16, 18, 19. Every failure is a `scrollUntilVisible` step and the captured hierarchies show the target present, on-screen, enabled and correctly bounded, so this is the HARNESS, not vc 37 — see `.maestro/regression/coverage.md` |
| **Play production** | not launched — gated on Google's 14-day checklist (§3) |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), **113 prerendered pages (en 56 / es 57), 118-URL sitemap** — read off the generator 2026-08-23; this row said 105/114 until then, which predated the four legal pages added on 08-17. Every content page now ships its real copy, not just a `<head>` (`docs/seo-status.md`). **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods. **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**. OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that: two of three probes came back throttled after paying full latency. Servings also ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU. **Latest: Android OTA 32 on vc 37 (`ae952001…`) and iOS 16 on build 60 (`ec5b3e54…`), 2026-08-23** — the offline-cache provenance fix, now covering **Today's seven slices as well as Train's three**; device-verified offline on Android. Preceded by Android 29–31 / iOS 14–15 — the Train offline cache: it was the only tab that could not render without the network, and it took THREE Android publishes because the device rejected what 345 green specs passed, twice. Device-verified offline. Preceded the same day by Android 28 / iOS 13, bundle size only, export **−24.2%** (19,023,854 → 14,429,325 B), gate run against the `.aab`, verified on the LG G6. **iOS is CAUGHT UP as of the same day**: number 13 on build 60 (`5ced7104…`), the identical JS published from `ignia-mac` behind its own gate (`7b347b0f…` = build 60). iOS assets fell **−87.3%** (4,778,400 → 607,184), total −25.7% — further than Android because the MaterialSymbols face is Android-only in the export. **Android is device-verified; iOS is NOT** — no iOS test device exists here, and this is a rendering change. Reaches TestFlight build 60 only; public iOS runs build 55 on a different runtime. **The numbers in this row were wrong until 2026-08-23** — it read "Android 7 / iOS 5" while `AGENTS.md` was already at Android 27 / iOS 12; `AGENTS.md` is the per-publish record and this row is the summary, so trust it and re-read it. Full rows there |
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
| **Maintenance/TDEE estimator — FIXED and shipped by OTA 2026-08-20, now needs eyes on real accounts** | **Nothing; watching.** A live account read maintenance **2,509** when its own gap-free history said **2,266**. The whole number came from a 9-day post-travel fragment whose slope was statistically indistinguishable from zero (t = −2.00, df 8; 95% CI on maintenance **1,775..3,242**). Two causes, both now fixed in `145221e2`: `lastTrendSegment` kept only the most recent run and discarded 28 of 38 weigh-ins across a 21-day travel gap — while the comment directly above it claimed `MIN_SEGMENT_POINTS`/`MIN_SEGMENT_SPAN_DAYS` were "no longer consulted", which the code twenty lines down still did; and `TDEE = intake + deficit` mixed a logged-day intake average with a calendar-day slope, biasing by `(U/N)(I_logged − I_unlogged)`. Measured mode now evaluates each contiguous-logging run against its OWN intake and pools by `1/SE²`. Same account, window ending 07-31 / 08-10 / 08-20: old **2,266 / 2,010 / 2,509**, new **2,265 / 2,184 / 2,320** — swing 499 → 136, and today's value lands inside the 2,250–2,350 that account's gap-free energy balance independently gives. **VERIFIED ON iOS on the owner's own account** (2026-08-20, build 60 + the OTA) — the platform the estimator work could not otherwise reach, since the only test device here is Android. **Every measured user's maintenance moves and the recalibration card fires for them.** **The follow-ups are DONE and SHIPPED by OTA 2026-08-20** (second update of the day; the soak was cut short on the reasoning that a 12-tester alpha cannot find a 1-in-N crash in 24 h and all three changes are stability-positive): the recalibration card now gates on `ci95Tdee` so it cannot announce a move it can't support (`6bb5efee`); the estimator **widens its window** to 63 then 84 logged days rather than acting on an interval wider than 250 kcal, and reports `estimateState` (`e54dd0dc`) — chosen over a stored carry-forward because the only persistence precedent here is device-local AsyncStorage, which would make web and mobile disagree about the same account's target; and Today now says **"holding steady"** with a cause the user can act on, replacing the two weaker caveats rather than stacking with them (`f7db69a0`). **One earlier claim of mine was wrong and is worth correcting:** `confidence` was never rendered anywhere — every `confidence` in the UI is photo-scan. It misleads in the data model, not on screen. Trigger was ordinary: **stop logging for four days and the window split** **2026-08-23 — the recurring "it rides on the wearable / it moved 173 in an afternoon" comparison against MacroFactor was answered with measurements, not argument.** It does not ride on the wearable: with 120 logged days, moving the stored activity multiplier across its whole legal range (1.40 / 1.55 / 1.90) leaves the target byte-identical, and that seam is now pinned by `packages/core/src/tdee-wearable-independence.test.ts`. Per-new-day movement is mean 18 kcal, max 129; a same-day re-weigh of ±2 lb moves it ≤15. The one real finding is a **−449 kcal unsmoothed cliff at the formula→measured crossing on day 14**, which is exactly what MacroFactor's weekly cadence avoids — a ramp is RECOMMENDED and deliberately NOT built, because it changes every user's target and is the owner's call. Full write-up `docs/research/activity-tdee-composition-survey.md` §9; the decision it rests on is now written down as **ADR-0024**, which three files cited before it existed. |
| **iOS is now SWEPT, not assumed — 17 of 19 on a simulator (2026-08-24)** | **Two harness selectors, no product defect.** A Release build from `main` was compiled on `ignia-mac`, installed on `QA-iPhone` and driven through the whole suite. **The first attempt read 0 of 19 with the identical line** — a fresh simulator install is SIGNED OUT, which is one fault and not nineteen; `android-signin.yaml` (misnamed, works on iOS) first turns it into 17/19, now step 0 of `DEV_ENVIRONMENT.md` §3.12. The two failures are the SAME two as the 2026-08-22 baseline, so the Android budget work neither fixed nor broke iOS. **`15-search`: the search is fine** — the USDA rows render and `.*[Bb]anana.*raw.*` is visible; only the anchored tap `^Banana, raw$` cannot match, because iOS merges a row's label with its macros. **`18-train-template` gets much further than the old note claims** — it no longer dies at `template-set-kind-0-0` but walks the editor, saves, re-opens, and fails only on the collapsed summary `3 × 8 · 20 lb`. Each is one platform-gated selector. **One regression was found and fixed the same night, and it was mine**: the `19-glossary` backdrop coordinate tuned for the LG G6 (5%) is wrong on iOS, where 8% is right and 5% is in the Dynamic Island — now `runFlow: when: platform:` with both measured values, verified green on both. Fix the remaining two with a verify pass on BOTH platforms; that regression is what happens otherwise. Detail in `.maestro/regression/coverage.md` |
| **`bermudezsystems.com` — RE-MEASURED 2026-08-23 from the registry and public DNS, and two of the three sub-items have moved** | **Owner, but no longer urgent and no longer blocked on Northwest.** The facts, read from RDAP and DNS rather than from the console: registered **2026-07-06**, **expires 2027-07-06**, registrar is **DomainRegistry.com LLC (IANA 128)** — Northwest resells through them, which is where a transfer actually has to happen — nameservers still Northwest, and registry status is plain **`active` with NO `clientTransferProhibited`**, so nothing needs unlocking. **① Transfer: cannot happen yet, and that is ICANN, not Northwest.** The Transfer Policy bars a transfer within 60 days of initial registration, so this domain is ineligible until **~2026-09-04**. That is why the console offered no Renew and no Auto Renewal, and it means the support email and the disabled buttons were never the real obstacle. There is **10.5 months of runway** to expiry, so this is a diary item, not an emergency: from ~Sept 4, transfer to a registrar with a card on file and carry the DNS. **② Recovery on the org Google account** — recovery email + phone + saved 2FA backup codes — **still open, still owner-only, and now the highest-value half**, because it is what survives a domain lapse. **③ Move the mailbox off the free suite: DONE, verified in public DNS** — `bermudezsystems.com` MX is `bermudezsystems-com.mail.protection.outlook.com`, SPF is `include:spf.protection.outlook.com -all`, `autodiscover` CNAMEs to `autodiscover.outlook.com`, and the `MS=ms93273856` verification TXT is present. Mail to `gabriel@bermudezsystems.com` now lands in the `bermudezpr.com` Microsoft 365 tenant, so the never-configured Gmail forward that lost the first real in-app feedback is no longer a mechanism anyone depends on. **The `google-site-verification=1EYLbXKH66lt3XNRVrp3o066X7NqEeKBhMwWO64P57U` TXT is still present** — do not delete it; Play's org website verification rides on it. One loose end: `_dmarc` still reports to `bounce@dmarc.businessidentity.llc`, so DMARC aggregate reports go to Northwest's collector rather than anywhere the owner reads. Harmless, worth repointing. Runbook: `docs/DEV_ENVIRONMENT.md` §4 |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here |
| **Push notification when an OTA publishes, tapping it to restart — OWNER DECISION, and it collides with the Apple migration** | **A native change on BOTH platforms, which is the whole problem.** Requested 2026-08-22. Researched before scoping, and the premise needs correcting first: **the app already auto-applies OTAs without a tap.** `useAutoApplyOta` (`apps/mobile/src/lib/app-update.ts`) reloads at cold start when a bundle was downloaded by an earlier run, and on the next foreground when one arrived mid-session; `UpdateBanner` is the *fallback* for whoever lands between those moments, not the main path. So "tap the notification instead of the update link" describes a path most users never take. The one real hole a push could close is narrow: telling someone who has not opened the app at all — but a cold start already auto-applies, so the gain is a faster first paint, not a delivered update. **Cost side.** The app has NO remote-push infrastructure: `expo-notifications` is installed but used only for LOCAL scheduled reminders (`src/lib/reminders.ts`), there is no `getExpoPushTokenAsync` call, no token storage, no sending function, no `google-services.json` in the tree, and no `aps-environment`/`UIBackgroundModes: remote-notification` in `app.json`. Adding them means: FCM V1 service-account key uploaded to EAS + `android.googleServicesFile` for Android, the push entitlement and background mode for iOS, a token collection path, and a sender. Every one of those is native config, so **the fingerprint moves on both platforms and both need a new binary** — and that is the collision: the Apple individual→organization migration is waiting on the measured fact that nothing on `main` owes an iOS binary, and while the migration runs the Certificates, Identifiers & Profiles portal is DOWN, so `eas build -p ios` is blocked for what two public developer reports put at 17 days and 3+ weeks. **So this is do-it-before-the-migration or wait weeks — it cannot be slipped in during.** Second consideration the owner should weigh: OTAs here are not rare (four Android publishes landed in a single day on 2026-08-22), and a push per publish is a notification per publish. If it ships, it wants a silent/data push that pre-downloads the bundle rather than a visible one per release. **Nothing built; awaiting the go/no-go and the ordering call** |
| **Ship to Bolivia — Play + App Store availability** | **PARKED behind the Bermudez Systems LLC greenlight, deliberately.** Requested 2026-08-22. Both stores gate territory availability on the *developer account*, and both accounts are mid-move: the Play app transfer to the org account is in progress and the Apple individual→organization conversion has not started. Adding a territory now would set it on accounts that are about to change hands, so it waits. **Nothing technical blocks it** — no code change, no build, no OTA: it is a territory checkbox in each console (Play Console → Countries/regions, ASC → Pricing and Availability). Two things to check when it is unparked, neither of which is availability: Bolivia is a Spanish-language market and the app already ships **es-PR**, whose vocabulary is Puerto Rican and not Bolivian (the i18n key sets are at parity, so this is wording, not plumbing); and the food database is USDA/FNDDS, which carries almost nothing of a Bolivian diet — search results will feel empty for local dishes in a way they do not in the US. Neither is a blocker; both are worth knowing before the first Bolivian user files feedback about them |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone |
| **Play production access** | **Owner + Google's clock.** The 12-tester requirement is MET; the only unticked box on the app Dashboard is *Run your closed test with at least 12 testers, for at least 14 days*. **Do not compute the apply date by hand** — Google owns the clock and ticks the box; the Dashboard read **12 testers opted in for 13 days continuously** on 2026-08-20, so it ticks ~2026-08-21 and slips if anyone drops below 12. **The transfer below will moot this** — org accounts are exempt — but **it has NOT lifted yet**: with the transfer *in progress*, the Dashboard still shows *Apply for production* **greyed out** and the 14-day box unticked (checked 2026-08-20, after the transfer was accepted). Nothing can be promoted to production until Google finishes the move. Play exposes no per-tester data at all, in the console or the API. Tell testers **uninstalling is not opting out** (that is an explicit *Leave the program* action), and that opt-in, install and sign-in are three separate steps — only the first moves the counter |
| **Public iOS (build 55) cannot receive the TDEE fixes over the air** | **Apple's review queue, and that is the right answer.** Live App Store is 1.2.0 / build 55, runtime `886bf0b3…`; the tree is `7b347b0f…` (build 60), so no OTA from `main` reaches public users. It *is* technically reachable — `packages/core` is not a fingerprint source, so tonight's JS could be cherry-picked onto the pre-SDK-57 commit `9c8a4b63` and published under `886bf0b3…`. **Rejected**: it requires swapping `ignia-mac` to SDK 54 `node_modules` (the fingerprint hashes `expoAutolinkingConfig` and `package:react-native`), and it would push a bundle built from a tree that exists nowhere in git, never compiled and never device-tested, to 100% of public iOS users. 1.2.1/build 60 supersedes build 55 within days and already carries every fix via OTA. **NEVER use `EXPO_UPDATES_FINGERPRINT_OVERRIDE` to force it** — that would run SDK 57 JS on an SDK 54 native runtime and reach everyone before it broke them |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`) |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **Android device QA — the suite is GREEN, and none of the failures was a product bug** | **Nothing blocking; one flow to watch.** Host is the **LG VS988 (LG G6), Android 9 / API 28** over adb from the Windows box — two levels above `minSdk` 26, so a pass here still does NOT prove the floor. Full sweep 2026-08-23 against vc 37: **18 of 19**. The three flows this row used to list as open (`06-scan-intro`, `15-search`, `18-train-template`) all **pass**. **Every failure found today was the harness, and each was chased to an artifact rather than reasoned about.** The dominant cause was a budget: a scroll from the top of Settings to *Quick add* takes **~31 s** on this device and the flows allowed 20 s — and it only ever passed because the settings ScrollView **retains its scroll position between opens**, so a flow fit inside 20 s whenever an earlier one had already paid part of the distance. That is why it broke in a batch the day the run order changed. Raised to 60 s on 04/09/10/20. Separately: `14-metrics` — the FIRST tap after the IME closes is swallowed (`maestro hierarchy` puts `sleep-save` exactly where it is painted and a real `adb shell input tap` writes on the first try), fixed with a repeated tap; `16-train-terms` failed only in its TEARDOWN and leaked a catalog row, so `qa-regression-verify.mjs cleanup` now also deletes `QA `-prefixed exercises and templates (it found six); `19-glossary` had three defects of its own and did NOT inherit a bad state from 18 — its boot budget, an assertion on the second-to-last glossary term, and a `50%,8%` backdrop tap that on 360x720dp lands ON the Train glossary. That last one also answers the question the flow exists to ask: **the last term IS reachable, so `Glossary`'s 460 cap is fine on this viewport.** **The one still to watch is `09-locale-es`** — raising its budget was necessary and not sufficient, so it now uses the end-anchored custom scroll loop (swipe to the end down the left gutter, search UP) that `coverage.md` recommended and that `settings-signout` verified. **09 re-verified green with that change.** A death in 09 strands the account in Spanish and cascades, so recover with `node scripts/qa-regression-verify.mjs set-locale --email qa-test@ignia.fit --locale en`. **Device hygiene:** it was found signed into the owner's personal Google account and set to pt-BR, left over from 08-21 — it is back on `qa-test@ignia.fit` in English, and that account's password was rotated (the value is in the session transcript, not in any file). Getting adb back after a reboot is still a PHYSICAL task. `coverage.md` carries the full diagnosis |
| **The website is invisible to Google** | **Content half DEPLOYED 2026-08-23 and verified live on `ignia.fit`; the other half is now SCOPED rather than vague.** The content half is done: every content route ships its real copy in the served HTML, read from the same i18n/`vs-data.ts` the components render — `/privacy` 7,471 chars and 10 sections where it had a title and one line, `/terms` 5,394, `/faq` 4,363 with 12 Q&A, `/vs/*` with a real comparison table, the 36 macro brackets with their figures, both locales. A build-time guard fails if a legal section is added to i18n and not carried over. **Real prerendering is blocked on something specific:** `@angular/ssr` prerenders by ROUTING, and this app has no router — `app.routes.ts` is one catch-all with no component, pages switch by signal off `window.location.pathname`, and `App` reads `navigator` in a field initialiser. So it is a router migration plus an SSR-safety pass on a frozen frontend (ADR-0022), not a build-config flag. Cost the router migration first. Evidence and numbers in `docs/seo-status.md`. **Crawling itself is still unmeasured** — this changes what Google finds, not whether it comes |
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
