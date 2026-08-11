# STATUS — what is true right now

**Updated:** 2026-08-08 · **Owns:** current state only. Not history (`CHANGELOG.md`),
not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`).

If a statement here conflicts with any other file in this repo, **this file wins** —
or the other file is stale and should be deleted. Every claim below has a
verification command; if you are about to scope work off a claim, run the command
first. Three separate times this project scoped already-shipped features as new
work because a plan doc was read as a status doc.

---

## 1. Live right now

| Surface | State | Verify |
|---|---|---|
| Web PWA `ignia.fit` | **Live**, bilingual (EN + es-PR), **105** prerendered pages (en 52 / es 53), 114-URL sitemap | `npm run build` prints both counts |
| **Store-update banner** | **LIVE 2026-08-07, and it has a manual step that will rot silently.** `public/app-version.json` on the hosting site is the source of truth for "what is the newest binary"; `UpdateBanner` on Today compares it to the running versionCode and links to the store. **The number is DERIVED from the live Play tracks, not hand-written** — `node scripts/app-version-sync.mjs` rewrites it from `androidpublisher` (the same authority the signing-cert check uses), and `npm run doctor` fails on drift (*app-version.json matches what Play ships*). That guard exists because the failure is otherwise invisible: no error, no warning, every install quietly believing it is current, indistinguishable from the feature not existing. Deploying is still a separate act — `firebase deploy --only hosting`, or the corrected file reaches nobody. Currently `android.latestVersionCode: 21` (synced from Play and **deployed 2026-08-08**, verified live at `https://ignia.fit/app-version.json`, so every install below 21 is now prompted) and `ios.latestBuild: 0`, which **disables** the iOS prompt on purpose — TestFlight (build 24) runs ahead of the App Store, so it must be set to the live *App Store* build, never the TestFlight one, if it is ever turned on | `curl -s https://ignia.fit/app-version.json` |
| **OTA (EAS Update)** | **LIVE — the first update was published 2026-08-07.** `expo-updates` + `runtimeVersion: {"policy":"fingerprint"}` (deliberately *not* the `appVersion` default `eas update:configure` writes — `appVersion` would force new binaries on both platforms at every version bump). Channels match the build profiles. **Both enabling binaries have now SHIPPED** — iOS build **24** (`VALID` on TestFlight 2026-08-07) and Android **vc 11** (live on alpha), each verified to carry `expo-channel-name: production`. **Remaining gate is the testers themselves**: a device is only OTA-capable once it is RUNNING one of those binaries, so everyone must install from TestFlight/Play once. After that, JS/TS fixes ship in seconds with no build, no queue, no review — delivered on the launch AFTER the one that downloads them. **The first update WAS published 2026-08-07** (`b8306f9f`, branch `production`, groups `4a1795b2` Android / `f07df985` iOS), and it published under runtime versions `c0b85c15…` and `781be0c8…`. **Those were WINDOWS-generated fingerprints, and no verified binary carries them** — see below. It carries `UpdateBanner`, which is what makes every *subsequent* update visible: before it, an OTA applied silently on the next cold start and a resident app never noticed one at all. Free tier is 1,000 MAU; tester base is single digits.<br><br>**THE FINGERPRINT IS MACHINE-DEPENDENT HERE — publish from `ignia-mac`, never from Windows.** The same commit fingerprints `5758fe4f…`/`6c756c19…` on the Mac and `c0b85c15…`/`781be0c8…` on the Windows workstation. Causes are commit-independent: a gitignored `apps/mobile/android/` prebuild dir that exists only on Windows, CRLF-vs-LF in tracked files, and divergent `node_modules` (516 fingerprint sources vs 286). **Every binary is built on the Mac**, so the Mac's value is the one they carry — read out of the artifacts on 2026-08-07: vc 13's `.aab` (`base/assets/fingerprint`) holds `5758fe4f…` and build 25's `.ipa` (`Payload/*.app/EXUpdates.bundle/fingerprint`) holds `6c756c19…`. **All three OTAs published earlier that day used the Windows numbers and therefore reached neither verified binary.** The 22:00 update (`c3a7333a`, the ledger `already-exists` fix) is **the first published from the Mac and the first that provably matches a shipped binary** — groups `75705c93` android @ `5758fe4f…` / `1212ce21` ios @ `6c756c19…`. Ground truth is the file inside the artifact, never a locally generated hash.<br><br>**Latest update: the what's-new banner for quick-add, published from the Mac 2026-08-08** — groups `289e1b82` android @ `cc3da8b9…` (= vc 18) / `4fda63d9` ios @ `4734a4b6…` (= build 27), both gate-checked against the artifact fingerprints first. It exists because **vc 18 and build 27 shipped the headline feature with no announcement at all**: store release notes attach to App Store releases, not to TestFlight or an alpha track, so `UpdateBanner`/whatsNew is the only channel that reaches those cohorts. It reaches ONLY those two binaries — testers still on vc 13 / build 25 do not match these runtimes and see nothing, which is correct, because the tile and the Siri phrases are not in their binaries.

**Previous update: `edb86267` (quick-add JS), published from the Mac 2026-08-07**, groups `931fd3dc` android @ `5758fe4f…` / `9a9328eb` ios @ `6c756c19…` — both gate-checked against the artifact fingerprints above before publishing, so both landed. **It is the Android widget's quick-add button and the Settings picker** (ADR-0020). iOS receives the same JS, but its half of the feature is Swift and is not in it — the picker is deliberately gated to Android, so an iOS tester sees no change. **Android vc 18 does NOT need this update** — it embeds the same commit — but it publishes under a different runtime (`cc3da8b9…`), which currently has **no** published update. That is correct, not a gap: its JS is current. The next JS-only fix must be published against `cc3da8b9…` to reach vc 18, and against `5758fe4f…` to reach anyone still on vc 13 | `ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform android"` |
| **Maestro regression suite** | **15 flows + a fresh-account arc; Android 15/15, iOS 14/15, both run 2026-08-09.** Grew from 4 Android-only flows this session and immediately earned it: it found the **"Igni" splash** and the **untranslated `lb/wk`**, both shipped bugs on surfaces nothing had ever rendered, both now fixed and delivered by OTA. `apps/mobile/.maestro/regression/coverage.md` is the checklist — screen × state × platform, every ✓ carrying the run date that earned it, plus an explicit NOT-covered list with reasons. **Its screenshots do not reach the repo unless `~/qa-collect-shots.sh` runs** (Maestro writes them to a directory it purges after 14 days), which is why the splash bug went unseen for so long. `scripts/qa-regression-verify.mjs` is the Firestore ground truth behind the e2e rows. **Open**: `13-e2e-delete` on iOS only (row tap does not open the editor; deliberately left red, diagnosis notes in the suite README), the fresh-account arc has never been run, and the mic's listening state can only close on hardware | `apps/mobile/.maestro/regression/coverage.md` |
| **OTA 2026-08-11 (2nd) + web deploy — the measured TDEE stops fitting across a logging break** | **BOTH SHIPPED 2026-08-11**, from commit `5247b1cd`. Mobile: gate-checked on `ignia-mac` and matching both live binaries — ios `3752c757…` (builds 44/45), android `ca2dc124…` (vc 29); groups `d8fa9882` ios / `0b4a2434` android. Web: prod build + hosting deploy, copy read back out of the served bundle. **This is the FIRST change to the TDEE math**, made under an explicit owner decision that lifted the standing "do not change the TDEE math" for this candidate only (`docs/research/tdee-logging-gaps.md` §6 records what shipped and what did not). **(1) `weightTrendLbsPerDay` now fits only the run of weigh-ins since the last break of ≥7 days, and ignores the first 7 days of that run.** Ground truth 2,500 in every scenario: the step case (+4 lb over a break, then flat) went **2,038 → 2,500** — it had been discarding all seven post-break weigh-ins as outliers while reporting `reliable: true`; the rebound case (travel water leaving) went **2,392 → 2,500**. **The settle window is load-bearing**: segmenting *alone* moves the rebound to **3,469 (+969)**, five times the original error and in the direction that raises the target, which is why the research doc's claim that candidate 2 "kills 1a and 1b" now carries a correction. Two guards, both tested: a break under 7 days changes nothing, and a post-break run with <4 surviving weigh-ins falls back to the old whole-window fit rather than to `null` (null would hand the user the hardcoded 2,450 seed). **(2) Today now says when weigh-ins were discarded** — `outliersDropped` was computed since the guard shipped and displayed nowhere, and it is deliberately **not** gated on `reliable`, because the break case is exactly where `reliable` is true and wrong. **What's New bumped to `2026-08-11`** on both platforms — this one moves a number a user can see, unlike the row below. The web banner's item list was two months stale and was replaced, not appended to. **What this does NOT fix: partial logging** (§1c — the largest measured error at −635 kcal, and the one behind the owner's own 1,870). That is intake-side; this is a weight-trend fix. Candidate 1 (a hold state) is **deferred and still the right next move**; candidate 4 (imputation) needs its own research pass | `npx eas update:list --branch production --limit 2` |
| **OTA 2026-08-11 + web deploy — Refine targets names the pace your floor actually leaves** | **BOTH SHIPPED 2026-08-11**, from commit `1d41b431`. Mobile: published from `ignia-mac`, gate-checked first and matching both live binaries exactly — ios `3752c757…` (= **builds 44 and 45**, which share a runtime), android `ca2dc124…` (= **vc 29**). Groups `3c612608` ios / `78a42fa5` android. Web: prod build + `firebase deploy --only hosting`, and the copy was then **read back out of the served bundle** (`chunk-TDP4INAX.js` on `ignia.fit`), not inferred from the deploy exit. **What it closes:** the pace control was a promise the target math was free to break — the target is `trueTdee − pace × 3500 / 7` **clamped at `calorieFloor`**, so a floor above that number rewrote the pace silently. On the owner's own numbers, maintenance 1,870 · pace 0.9 lb/wk · floor 1,850 leaves a 20 kcal/day deficit = **0.04 lb/wk**. `paceReality` (`packages/core/src/pace-reality.ts`) re-derives `calculateTdee`'s own arithmetic and reports the effective pace; **no target math changed**, and a test pins `target === tdee.newDailyTarget` so the two cannot drift. The sentence appears only when the floor changes a number the user can see (binding is compared on the *rounded* pace), and a floor at or above maintenance gets its own sentence rather than a reassuring 0. **It also fixed the web preview**, which computed formula-mode TDEE over an empty log array *and* dropped the profile's `calorieFloor` — it showed ~2,418 where the app would hold that user to 1,850. **No What's New bump**: nothing a user does changes, and the affected user meets the sentence exactly where it applies; a banner would fire for everyone, most of whose floors bind on nothing. Verified in a browser against the emulator, signed in, both branches × both locales at 390×844. **The mobile half has NOT been seen on a device** — it is jest-verified only | `npx eas update:list --branch production --limit 2` |
| **OTA 2026-08-10 — maintenance on Today, and watch diagnostics** | Published from `ignia-mac`, gate-checked first and matching both live binaries: ios `3752c757…` (= **build 44**), android `ca2dc124…` (= vc 29, unmoved because the watch module is iOS-only). Groups `2d0e95f1` ios / `35a184b8` android. **(1) Today shows measured maintenance** under the rings with how far above or below it you are — the dashboard half of a pattern Ignia only had the detail half of (Trends). No TDEE math changed; `maintenanceView` in core only decides whether it is honest to show two existing numbers together, and returns null unless `source === 'measured'`. An unreliable reading is shown and marked, not withheld. **(2) Settings → Apple Watch now reports why the face is or is not current** — paired / app installed / **complication on the ACTIVE FACE** / wake-ups left today / running build. It exists because build 44 shipped the two-queue transport and the face is *still* stale, and the likeliest cause is invisible by design: `isComplicationEnabled` is false in the Smart Stack and identical to a face from the wearer's side. What's New bumped to `2026-08-10` | `npx eas update:list --branch production --limit 2` |
| **iOS build 45 — the Siri quick-add reaches the wrist** | **Uploaded to TestFlight 2026-08-11**, built locally at zero EAS quota, verifier green, fingerprint **`3752c757…` — the SAME as build 44**, because the change is Swift under `targets/_shared/` and that does not move the runtime. One `eas update` therefore covers both binaries. **What it closes:** a quick-add is the one write path that never passed through `syncWidget`, so it never inherited the watch push; the JS half shipped by OTA the same day, and this is the native half. **What it deliberately does NOT close, because Apple forbids it:** `WCSession` is unavailable in iOS app **extensions**, and the widget-BUTTON intent runs in `Today.appex` — it bails rather than burning one of the day's 50 complication transfers on a delivery that cannot happen. Those taps reach the wrist on the app's next foreground. Siri is the case this fixes: App Shortcuts launch the containing app, so `perform()` runs where the session is real. It never activates the session or sets a delegate — `WatchLinkModule` owns it, and a second delegate would displace the re-assert that keeps a newly-paired watch in step. **Behaviour UNVERIFIED on hardware** | ASC command below |
| **iOS build 44 — the watch complication fix** | **Uploaded to TestFlight 2026-08-10**, built locally on `ignia-mac` at **zero EAS quota**, version 1.2.0. Verifier green: all four targets nested, every required plist key, both URL schemes, both `.lproj` bundles, the appex entitlements. Fingerprint **`3752c757fc2882fa432c09d36715d9cd1bb61911`**, read from the `.ipa`. **What it fixes:** the complication never auto-updated because `updateApplicationContext` was the whole transport, and Apple delivers it opportunistically — it does not reliably wake a watch app that is not running, so nothing wrote the App Group and the face had nothing new. The phone now also sends `transferCurrentComplicationUserInfo` (the path documented to wake a backgrounded watch app; needs `isComplicationEnabled`, capped 50/day), **and the watch app finally implements `didReceiveUserInfo`**, which is the queue that lands on — without it the waking send was being delivered and dropped. **Its runtime is its own**: `modules/*/ios` is hashed even though `targets/` is not (see `AGENTS.md`), so the 2026-08-09 OTAs do not reach it. **Builds 42 and 43 do not exist** — a cloud attempt that died in *Configure expo-updates*, and a local one killed by a watchOS runtime this session had wrongly deleted. **BEHAVIOUR IS UNVERIFIED**: the structural checks passed on a binary nobody has worn. The proof is a face that moves after a meal is logged, with the complication on a watch face (owner confirmed it is; in the Smart Stack `isComplicationEnabled` is false and only the fallback path runs) | ASC command below |
| **Third OTA of 2026-08-09 — the meal-slot default moves to the write path** | Published from `ignia-mac` at commit `1fd60b62`, gate re-checked on the Mac first and **unchanged on both platforms** (android `ca2dc124…` = vc 29, ios `1d89fedf…` = build 41), so it lands on the live cohort. Groups `9a12e2c4` android / `65788597` ios. **No binary was built, and none was needed** — the change is entirely `.ts`/`.tsx`, so a new binary would have carried identical JS under the same runtime. **What it fixes: "meals file themselves" was only ever true on Today.** `useHistory` has its own add wrapper and never got the `slotForTime` line, so a meal added from the day-detail sheet filed into `other` — and never mirrored to Apple Health either. The default now lives at the ledger write (`addLog`, `withDefaultMealSlot` in core), which is the one call every in-app add passes through; the seven duplicated hook wrappers are one `useLogWrites` module. Marker rows stay untagged, an explicit choice still wins, and widget quick-add is untouched (it writes through `addLogWithId` on purpose). **What's New bumped to `2026-08-09`** in both locales — this one changes what a user sees happen, unlike the previous two. **Also in the commit but NOT in this update**: the Train derivations lifted to `packages/core/train-view.ts` (the web's "top set" counted warm-ups; mobile's did not), deployed to `ignia.fit` 2026-08-10. **The write-path slot default was NOT kept on the web, and the first attempt to add it was a regression** — see the row below |
| **The web meal-slot default is a FORM default, not a write default — and briefly wasn't** | **2026-08-10, found in a browser, fixed the same day.** The claim that "the web never had the slot rule in any form" was **wrong**: `defaultMealTypeForHour` (`packages/core/src/meal-draft.ts`) has pre-selected the chip in the entry form via `EntryFormManager` (`entry-form-manager.service.ts:100,392`) all along. It was missed by grepping for the Expo app's function name, `slotForTime`, which the web does not use. Acting on that wrong reading, `withDefaultMealSlot` was added to `FirestoreLedgerCore.addLog` and shipped — and it **broke a real affordance**: the web chip is a tri-state, and *deselecting* it is how a user asks for the diary's `Other` bucket. `parseMealDraft` drops a null `mealType` rather than forwarding it, so by the time a draft reaches the port "the user said no" is indistinguishable from "the caller forgot", and the write-path default silently overrode every deliberate deselection. **Measured against the emulator**: chip deselected at 11:36 → row written with `mealType: 'lunch'`. Reverted on both web adapters (the Expo ledger keeps it — mobile chips start unset and it has defaulted at the write since the slot feature shipped, which is what makes History match Today). Two contract tests on the in-memory adapter now pin it: an absent slot stays absent, an explicit one is preserved. **Still open, and a product call**: the two clock rules genuinely disagree — `slotForTime` (mobile) uses 10:30/14:30/17:30/21:30 boundaries, `defaultMealTypeForHour` (web) uses 11/15/17/22, so 10:45 is lunch on the phone and breakfast on the web, and 21:45 is snack on the phone and dinner on the web. Unifying them changes behaviour on one platform, so it is not a silent fix | `npm test` — *never invents a mealType* | `npx eas update:list --branch production --limit 2` |
| **`ignia-mac` disk — was 4.0 GB free, now ~18 GB** | **2026-08-10: binary builds on BOTH platforms were blocked and are not any more.** iOS wants ~17 GB and Android §3.11 wants 20; the Air was at 4.0. Reclaimed with no personal data touched: `CoreSimulator/Caches/dyld` (5.6 GB), all simulator **devices** (~5 GB, recreatable), Xcode `Archives` (1 GB), and the CocoaPods/npm/Homebrew caches. **One deletion in that sweep was WRONG and cost a build**: the watchOS simulator runtime was removed for ~8 GB on the reasoning that the platform SDK lives in Xcode.app — it does, and the archive still needs the *platform*, so the next iOS build died at *Run fastlane* with `watchOS 26.5 must be installed in order to archive the scheme` and burned **build 43**. `xcodebuild -showsdks` and `-showdestinations -scheme Ignia` both look fine after that deletion and are not authoritative; the check that is, is `xcrun simctl list runtimes` showing **watchOS as well as iOS**. Restored with `sudo xcodebuild -downloadPlatform watchOS`. Full method + the corrected table in `docs/DEV_ENVIRONMENT.md` §3.10. **Two traps worth knowing**: `df -h /` reads the sealed System snapshot and says ~12 GB used on a 228 GB disk — use `/System/Volumes/Data`; and the usual "purgeable / thin your Time Machine local snapshots" answer **does not apply here**, `tmutil listlocalsnapshots` is empty on both volumes, the space was genuinely used. Full method + what is left in `docs/DEV_ENVIRONMENT.md` §3.10. **Fingerprints re-verified unchanged after the cleanup** (`1d89fedf…` / `ca2dc124…`), which matters because `apps/mobile/ios/` is a fingerprint source and deleting it would have stranded every OTA. All build preflight gates green; no build was run, because both fingerprints are unchanged and a new binary would carry identical JS | `ssh ignia-mac "df -h /System/Volumes/Data"` |
| **Second OTA of 2026-08-09 — the two "the app knows but does not say" fixes** | Published from `ignia-mac` at commit `98b1163a`, gate re-checked (android `ca2dc124…` = vc 29, ios `1d89fedf…` = build 41 — unchanged, so it lands on the same cohort). Groups `de67131f` android / `cff648a8` ios. **(1) Coach now states the day's allowance before one is spent** — `remaining` used to arrive only inside a consultation's own response, so the count was unknowable until you used it. `firestore.rules` now lets a client read its OWN `consultationQuota` doc (ids `<uid>_<day>`; writes still denied), which is one document read on opening Coach and **no new Cloud Function**. **Rules were DEPLOYED before this update shipped**, per the standing order, with two tests covering the uid-scoping including the prefix case. Verified on device: "3/3 left today". **(2) A failed dictation start now says so** instead of silently reverting the icon. Its first implementation set state correctly and drew NOTHING — Android does not render a child outside its parent's bounds — which only the suite's screenshot could reveal; it is inline and width-capped now, verified on the emulator with the search field still full width. No What's New bump: neither changes what a user does | `npx eas update:list --branch production --limit 2` |
| **Latest OTA — 2026-08-09, both platforms, LANDS ON THE LIVE BINARIES** | Published from `ignia-mac` at commit `43f15149`, gate-checked first: the generated fingerprints matched the shipped artifacts **exactly** — android `ca2dc124…` (= vc 29), ios `1d89fedf…` (= build 41) — so this update reaches the current cohort on both platforms rather than a runtime nobody runs. Groups `3a764659` android / `d76e77b2` ios. **It carries two bugs found by the Maestro regression suite**, both on surfaces nothing had ever inspected: (1) **the Android splash rendered the brand as "Igni"** — `BrandLoader`'s wordmark clipped its trailing "a" on every cold start of every build ever shipped, because letterSpacing on the display font makes RN under-measure the text width and the view clips the overflow; the file already carried a comment describing this exact failure plus an iOS-era `paddingHorizontal` fix that did not cover Android, now replaced with a `minWidth` the word cannot exceed; (2) **`lb/wk` was hardcoded** in Trends and Body, so es-PR read an English rate unit beside Spanish copy while Refine targets and the whole web PWA already said `lb/sem`. Both verified fixed by re-capture on the emulator, not by reasoning. **No What's New bump**: the banner is the only user-facing channel for an OTA, and it was deliberately not fired for a wordmark and a unit label — nothing here changes what a user does. Testers get it on their **next** launch | `npx eas update:list --branch production --limit 2` |
| iOS App Store | **1.0.0, build 7** (uploaded 2026-07-20, `READY_FOR_SALE`), from commit `168e0394` | ASC command below |
| **iOS build 41 / Android vc 29** | **BOTH LIVE 2026-08-09 — these are the builds to test.** **Every other TestFlight build is EXPIRED (2026-08-09)** — only 41 and 24 (the released App Store build) remain installable; 17 builds including the mic-crashing 38/39 and the dead-scheme 27–40 can no longer be picked by a tester. Done via `PATCH /v1/builds/{id} {expired:true}`; 38/39 never appeared in ASC's list at all. Build 41 `VALID` on TestFlight, vc 29 `completed` on alpha, both 1.2.0, both passed `verify-mobile-artifact.mjs` before submission. Fingerprints from the artifacts: iOS `1d89fedf59c7975b06c43762cc6414547845c9fe`, Android `ca2dc124281f48e63c17111214f0ee8dfdc34784`. **They restore the `ignia://` URL scheme** — unregistered since build 29's CFBundleURLTypes "de-duplication", which left the iPhone widget's face tap (`ignia://?openAdd=1`) opening NOTHING on builds 29–40. Found by the Maestro regression suite's first iOS run; confirmed against build 40's shipped Info.plist; the verifier now requires both schemes with whole-line matching (its first draft used `includes()` and passed the broken binary because `ignia` is a substring of `fit.ignia.app`). Android rebuilt because the `app.json` edit moves both fingerprints. **vc 28 does not exist** — died on `No space left on device` with iOS DerivedData still on disk. `public/app-version.json` synced to 29 and hosting deployed, verified live. **Hardware QA owed on 41/vc 29**: widget face tap, dictation mic, es-PR Siri phrases | ASC + Play commands below |
| **iOS build 40 / Android vc 27** | **BOTH LIVE 2026-08-09** — build 40 `VALID` on TestFlight, vc 27 `completed` on alpha, both version **1.2.0**, both verified by `scripts/verify-mobile-artifact.mjs` (which exists because of this evening) and fingerprints read from the artifacts: iOS `c9abb3165ad1c381a0607f98e1886b267aab1ba3`, Android `f1786d8e7087437f23670cf3dbad03302f50c276`. **They carry Release 1 + Release 2 of the add-a-log redesign**: clock-defaulted meal slots (`slotForTime`, packages/core), the sheet reduced to one ranked recency list + a pinned Quick add strip + two labelled buttons, long-press-to-preset on diary rows, and **dictation** — a mic on the search field feeding the existing deterministic parser and USDA resolution, zero Gemini, on-device recognition when the resolved locale's model is installed. **Builds 38/39 exist on TestFlight and are POISON — do not test them**: both crash on the first mic tap (missing `NSMicrophoneUsageDescription`; expo-camera's `microphonePermission: false` deletes the key). **The R1 OTA shipped broken first**: its mode buttons rendered inside the search row and collapsed the field to a pill — caught by the owner on a device, hotfixed the same night from a branch pinned to build 37 / vc 26's fingerprints, and the layout was verified on the emulator before the corrected OTA went out. All 125 jest tests passed over that bug, which is why `.maestro/regression/` now exists: a 15-screen visual sweep, **15/15 clean on Android**, iOS run pending its simulator build. **Voice QA on real hardware is UNRUN** | ASC + Play commands below |
| **iOS build 37** | **UPLOADED TO TESTFLIGHT 2026-08-08**, built locally on `ignia-mac`, **zero EAS quota**. **Version 1.2.0** — 1.1.0 was released to the App Store today and ASC refuses any further build under a released version string (`eas submit` rejected build 34 outright), so the version had to move; 1.2.0 rather than 1.1.1 because the accumulated TestFlight content includes a new user-facing feature, the fasting Live Activity. All four targets verified nested. Runtime fingerprint **`84dafba371a083476d795b1e7408a51d1d6fb59b`**, read from the `.ipa`.<br><br>**It fixes the widget quick-add button, which had done nothing since build 27** — reported from a device and diagnosed from build 32's binary: `LogQuickAddSlotIntent` lives in `targets/_shared/`, so it compiles into `Today.appex` too, and **WidgetKit performs the extension's copy in the extension's process**, which held no `keychain-access-groups` entitlement. `credentials()` returned `nil`, `log` returned `.signedOut` — the one branch that skips the optimistic snapshot bump — so a tap produced no row, no error and no moved number, and nothing in Sentry, which does not exist in a Swift extension. Siri was unaffected throughout, because App Shortcuts really do launch the app. The appex now carries `AE6TTXW92K.fit.ignia.app.quickAdd`, verified in the shipped binary (ADR-0020 amendment).<br><br>Also carries: a **quick-add outbox** (`QuickAdd.record(outcome:)` parks the last result in the App Group and Settings surfaces failures — a widget cannot answer back, which is why this class of failure hid for five binaries), and **es-PR Siri phrases**, with both `en.lproj` and `es-PR.lproj` `AppShortcuts.strings` confirmed present in the `.ipa`. **Builds 33–36 do not exist**: four attempts at that one config plugin (bad path resolution, then a silent half-success that shipped `en` and dropped `es-PR`, then a throwing Xcode API) before a shell-script build phase worked. **N3 IS NOW VERIFIED — on an iPhone 17 Pro simulator, 2026-08-08.** A fast started, `liveactivitiesd` logged the activity created against `FastActivityAttributes` with a lockscreen scene target backed by `Today.appex`, and the Dynamic Island rendered the flame with a counting timer; ending the fast cleared it within seconds. That proves the `NSClassFromString` bridge resolves and the extension is wired to the presentation — the two things that could have failed silently. **Still unverified**: the 8-hour ceiling and its re-arm (needs nine real hours on hardware), and the widget quick-add fix | ASC command below |
| **iOS build 34** | **BUILT AND UNSHIPPABLE.** App version 1.1.0, and `eas submit` refused it: *"You've already submitted this version of the app"* — ASC keys on `CFBundleShortVersionString`, and that version had been released the same day. It is the record of why the version bumped. Its keychain fix was verified in the binary before the refusal, and rides build 37 instead | — |
| **iOS build 31** | **`VALID` ON TESTFLIGHT 2026-08-08** (read from the ASC API), built locally on `ignia-mac`, **zero EAS quota**. Version 1.1.0, build 31, from `main`. All four targets verified nested, `NSSupportsLiveActivities: true` in the shipped plist. Runtime fingerprint **`fb7398e51984ecb39f1bb411329ef293fc96e095`**, read from the `.ipa`. **On iOS it is behaviourally identical to build 30** — no iOS code changed between them. It exists for one reason: `plugins/withGradleJvmArgs.js`, an **Android-only** config plugin, moved the **iOS** fingerprint, because `app.json`'s plugin list is hashed for both platforms. Without it, `main` could not reach any iOS binary over the air. **Test N3 on this build or on 30; they are the same feature.** It remains **UNVERIFIED** — see the build 30 row for what that means and what would prove it | ASC command below |
| **iOS build 30** | **SUPERSEDED by build 31**, which is the same iOS code. **`VALID` ON TESTFLIGHT 2026-08-08** (state read from the ASC API, not the CLI exit), built locally on `ignia-mac` (`eas build --local`, **zero EAS quota**), submitted with `eas submit`. Version 1.1.0, build 30, from branch **`n3-live-activity`** (commit `7820de78`) — the first binary built off a branch rather than `main`. All four targets verified nested in the `.ipa`. **It is the fasting Live Activity — N3, ADR-0021**: a Lock Screen / Dynamic Island card showing a fast's elapsed time, drawn on-device by `Text(timerInterval:)` with **nothing pushed to it** — no APNs, no push token, no Cloud Function, no secret, no new Firestore field. `NSSupportsLiveActivities: true` verified in the shipped `Info.plist`; the three bridge selectors (`startWithStartedAt:locale:`, `endActivity`, `activityStatus`) verified present in the app binary and `FastActivityAttributes` in `Today.appex`. Runtime fingerprint **`249ba992975203bb91c23aaddd5bab9d54d034fe`**, read out of the `.ipa` — its own runtime again, because `app.json` is hashed. **THE FEATURE IS UNVERIFIED. No Live Activity has been started on a simulator or a device**, and its one likely failure is silent: the module reaches the app target through `NSClassFromString`, so a name mismatch would leave the fast working, Firestore written, and the Lock Screen simply empty — the same shape as build 27's dead Siri support. The starred rows in `WIDGET.md`'s N3 checklist are the only evidence that counts. **Two known ceilings, both by design**: iOS ends any Live Activity at 8 hours (+4 on the Lock Screen), which a 16:8 fast outlives — the app re-arms on foreground from the fast's *true* start, so the timer resumes at the right elapsed time rather than zero; and there is no Android or web equivalent. **Build 30 is NOT attached to the App Review submission** — Apple is reviewing build **24** | ASC command below |
| **iOS build 29** | **SUPERSEDED by build 30.** **`VALID` ON TESTFLIGHT 2026-08-08**, built locally on `ignia-mac` (`eas build --local`, **zero EAS quota**), submitted with `eas submit`. Version 1.1.0, build 29. All four targets verified nested in the `.ipa`. Adds **spoken preset names** — `"Log \(\.$preset) in \(.applicationName)"`, so *"log overnight oats in Ignia"* works outright instead of forcing the ask-then-pick round trip; the unparameterised phrases remain, so a phrase naming no preset still disambiguates. Both phrase sets verified present in the shipped `Metadata.appintents`. Also clears two chores that were explicitly waiting on a native build: the inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN: "0"` is deleted from both `eas.json` profiles (nothing read it), and `app.json`'s duplicated app-group entitlement and duplicated `CFBundleURLTypes` scheme are de-duplicated. **Runtime fingerprint `d0487ca7bfb2e7ac64ad12e03a88d452ed51ce9d`, read out of the `.ipa` — it is NOT `4734a4b6…`**: deleting the `eas.json` key moved it, because `eas.json` is hashed into the fingerprint even though Swift under `targets/` is not. So builds 27/28 and build 29 are on **different runtimes**, and an OTA aimed at one does not reach the other. **`updateAppShortcutParameters()` is called from `perform()`, which is the wrong place on purpose** — the picker is React and `modules/quick-add-credentials` is a CocoaPods target that cannot see `_shared`, so a RENAMED preset keeps its old spoken name until the next Siri log; disambiguation is unaffected because it reads `suggestedEntities()` live. **Device QA on the new phrases is UNRUN** | ASC command below |
| **iOS build 28** | **SUPERSEDED by build 29**, and still the binary the fix was proven on. **`VALID` ON TESTFLIGHT 2026-08-08**, built locally on `ignia-mac` (`eas build --local`, **zero EAS quota**), submitted with `eas submit`. Version 1.1.0, build 28. All four targets verified nested in the `.ipa`. **It exists for one reason: build 27's Siri support never registered, and this is the fix** (`92c6c2f7`). iOS validates `AppShortcutsProvider` on device at registration and reports nothing when it fails; one invalid shortcut invalidates the provider, so **none** of it registered — Ignia was absent from the Shortcuts app entirely and every phrase answered *"I can't help with that"*, confirmed on the owner's device 2026-08-08. Cause: an App Shortcut may not carry a **required** parameter, and may not take open-ended values ([WWDC22](https://developer.apple.com/videos/play/wwdc2022/10170/)); `LogPresetIntent.preset` was required and named in no phrase, and `LogMacrosIntent.calories` was required *and* an arbitrary number. Both are now optional — `preset` disambiguates against `suggestedEntities()`, `calories` is demanded via `requestValue`, so `LogEntry.calories` is still never invented. **Verified in the shipped binary**: `isOptional=True` for both, provider and both `autoShortcuts` intact in `Metadata.appintents`. **VERIFIED ON HARDWARE 2026-08-08.** Ignia now appears in the Shortcuts app, and *"Hey Siri, log a preset in Ignia"* asked which preset and **wrote a real row to History** — so the entire REST write path is proven end to end: Keychain envelope readable from the intent process, refresh-token exchange, `PATCH` accepted by `firestore.rules`, row visible in the app. That retires the largest unknown in ADR-0020 and unblocks N4b, which `WIDGET.md` gated behind exactly this row. **Its runtime fingerprint is `4734a4b6…` — IDENTICAL to build 27's**, because Swift under `targets/` is not hashed into the fingerprint (measured; see `apps/mobile/AGENTS.md`, which said the opposite until 2026-08-08). So one `eas update` reaches builds 27 and 28 together — but the gate could never have told you this change needed a build | ASC command below |
| **iOS build 27** | **SUPERSEDED by build 28 — its Siri half is BROKEN and was never usable.** The `AppShortcutsProvider` did not register on device (see the build 28 row); the widget button was never reachable for testing either, since nothing appeared in Shortcuts. Its `Metadata.appintents` is nonetheless flawless in the archive — provider, both `autoShortcuts`, all three intents, phrase templates, `CFBundleDisplayName` `Ignia` — which is exactly why every machine-side check passed on a broken binary. **Uploaded to TestFlight 2026-08-07**, built locally on `ignia-mac` (`eas build --local`, **zero EAS quota**). Version 1.1.0, build 27. **It is the first iOS binary that can log without the app being open** (ADR-0020): `AppShortcutsProvider` Siri phrases plus an iOS 17 `Button(intent:)` on the widget's `systemSmall` face, writing to Firestore over **REST** with an ID token minted from a refresh token in the app's own Keychain — no native Firebase SDK, no Cloud Function, no new secret. All four targets verified nested in the `.ipa` (`Ignia.app`, `Today.appex`, `IgniaWatch.app`, `IgniaWatchComplication.appex`), and `Metadata.appintents` verified present in the app bundle with all three intents extracted plus the `nlu` phrase artifacts — which is the evidence that Siri can discover the phrases at all. Runtime fingerprint **`4734a4b6ae3cb652db2a4f920ee0b7ed8c073429`**, read out of the `.ipa`. **Build 26 does not exist** — `autoIncrement` burns a number per attempt and one Swift compile failed (block comments nest in Swift; see `AGENTS.md`). **It is NOT attached to the App Review submission** — Apple is reviewing **build 24** (the submission was verified queued immediately before this upload and has since been approved; see the 1.1.0 row), and changing the attached build needs a new submission, so do not describe 27 as "in review". **Device QA is UNRUN**: no Siri phrase and no widget button has been exercised on hardware, so all 10 iOS quick-add rows in `WIDGET.md` stay unticked | ASC command below |
| **iOS build 25** | **SUPERSEDED by build 27**, still what un-updated TestFlight testers run, and the runtime the 2026-08-07 OTAs were published under. Uploaded 2026-08-07, built locally on `ignia-mac` (`eas build --local`, **zero EAS quota**), submitted with `eas submit`. Version 1.1.0, build 25. All four targets verified nested in the `.ipa` (`Ignia.app`, `Today.appex`, `IgniaWatch.app`, `IgniaWatchComplication.appex`), not inferred from exit 0. **It is NOT attached to the App Review submission** — Apple is reviewing **build 24**, and changing that needs a new submission, so do not describe 25 as "in review". It is the first binary built from `a7c568a4`, so it **embeds** photo-scan, the update banner and the current What's New copy rather than relying on the OTA. **Its runtime fingerprint is `6c756c19b3e35948b85e42a3b337eec588128d3c`, read out of the `.ipa` itself** (`Payload/*.app/EXUpdates.bundle/fingerprint`) — and it is the runtime the 22:00 OTA of 2026-08-07 was published under. Build 24's `781be0c8…` is a **Windows-generated, unverified** number; the earlier "the fleet is split across two runtime versions" claim rested on comparing it against this Mac-generated one, and is withdrawn (see the OTA row) | ASC command below |
| iOS 1.1.0 | **APPROVED AND LIVE ON THE APP STORE 2026-08-08 — state `READY_FOR_SALE`, with BUILD 24.** Read from the ASC API (`/v1/apps/{id}/appStoreVersions`), and independently caught by `npm run doctor`, which failed on this file still saying `IN_REVIEW`. `releaseType` was `AFTER_APPROVAL`, so it shipped on approval with no second action. **This is the first App Store release since 1.0 build 7 (2026-07-20)** and it carries 54 mobile/core commits. What reaches App Store users is **build 24 only** — not the Siri fix (28), not the Live Activity (30–32). Those are TestFlight-only and need a new version submission to reach the store.<br><br>**One consequence is now actionable**: `public/app-version.json` holds `ios.latestBuild: 0`, which disables the iOS update prompt, and the documented reason was that TestFlight ran ahead of the App Store so there was no safe number to point at. There now is one — **24** — so the iOS prompt can be turned on whenever wanted. It must be set to the live *App Store* build, never a TestFlight one. Not done here: it is a user-facing prompt and a product call, not a doc fix.<br><br>Historical, kept because it explains the build numbering: it was `IN_REVIEW` from 2026-08-07 21:xx PT. **Build 27 was NOT what was being reviewed** — a submitted version's build is frozen, so 27 sitting on TestFlight cannot and does not change it. Do not touch this submission while it is `IN_REVIEW`; swapping the build means cancel → re-point → resubmit, the cancel is irreversible, and it already cost ~19 h of queue position once. Originally re-submitted 2026-08-07. Review submission `93c329b1`, build **24** attached (`VALID`), verified live via the ASC API. `releaseType` is `AFTER_APPROVAL`, so it ships on approval without a second action. **The original submission `e4d32c0e` (02:15Z, build 19) was CANCELLED to do this, forfeiting ~19 h of queue position** — build 19 predates `expo-updates`, so every App Store user it reached would have needed a full review cycle for any JS fix, and it also lacked `ebf60dcb` (writing a food in yourself). Release notes were extended by exactly one bullet in both locales to match, and re-verified on the live version. **The swap is not an edit** — a submitted version's build is frozen, so it is cancel → re-point → resubmit, via `scripts/asc-swap-review-build.mjs`; the cancel is irreversible and the first run failed between those steps, leaving 1.1.0 cancelled-and-unsubmitted until it was resumed (`057a03f1` fixed both the resume path and the 409 transition race). This is the first App Review submission since 1.0 build 7 (2026-07-20) and carries 54 mobile/core commits. **It does NOT contain the Android widget fix or manual food entry** — both were merged after `fdcd92ed`. **Build 23 (2026-08-07, `VALID` on TestFlight) is now the newest iOS binary and DOES contain both.** It is **not** attached to the review submission — Apple is reviewing **19**, and changing that requires a new submission, so do not describe 23 as "in review". Build 23 is also **the first iOS binary built locally on the Mac** (`ignia-mac`, `eas build --local`, **zero EAS quota**, 15m57s — see `docs/DEV_ENVIRONMENT.md` §3.10 and the `build-ios` skill) and **the first iOS binary with mobile Sentry in testers' hands** (Sentry existed only in `f3e5daaf`, which was never submitted). Its four targets were verified nested correctly in the `.ipa`, not inferred from exit 0. **Build 24 (2026-08-07, `VALID` on TestFlight) supersedes it** — same contents plus `expo-updates`, so it is the first iOS binary that can receive over-the-air updates (`EXUpdatesRuntimeVersion = file:fingerprint` confirmed in its `Expo.plist`); also built locally, also four targets verified. Submitted via the ASC API (`POST /v1/reviewSubmissions` → `POST /v1/reviewSubmissionItems` → `PATCH …{submitted:true}`), not the console. Note `eas submit` printed *"Something went wrong when submitting your app to Apple App Store Connect"* for build 19 and the upload had in fact **succeeded**; a re-run then failed as a duplicate. Trust ASC, not the CLI exit — `/v1/builds?filter[app]=…&sort=-uploadedDate`. Build 16 (`6415fca7`, commit `cfc19a06`, 2026-08-03) is the predecessor. **Build 16 is the first binary anywhere that contains the Apple Watch app and complication** (`IgniaWatch.app` + `IgniaWatchComplication.appex`, both signed in its build log). It passing Apple's processing as `VALID` also settles the open **ITMS-90717** question: the watch app icon's alpha channel did **not** get it rejected. Build 13 (`5949a3ea`, commit `458d60db`) is the predecessor — first binary to actually carry the widget's `ExtensionStorage` pod, and the one the iPhone widget was verified from on a physical device | ASC command below |
| **Android vc 26** | **LIVE ON THE ALPHA TRACK 2026-08-08**, version 1.2.0, versionCode read from Play. Built locally, **zero EAS quota**, `BUILD SUCCESSFUL in 12m 4s`. Runtime fingerprint **`79e92d26082607ab50b8836f2e70155cfc090c4d`**, read from the `.aab`. **It carries the offline quick-add fix** — `logQuickAdd` now bounds its write with a 6s deadline, because **Firestore's `setDoc` does not reject when it cannot reach the backend, it waits**, so the `catch` that parks a row was unreachable and a tap on a bad connection was silently lost. That contradicted `WIDGET.md`'s airplane-mode row from the day the feature shipped, and it applied to the Android widget button as well as the tile. Found on the emulator from a **negative**: no pending-logs key had ever been created, proving the write neither landed nor threw. `public/app-version.json` synced to 26 and hosting deployed. An `eas update` was published against this runtime and iOS build 37's | `node scripts/app-version-sync.mjs --check` |
| **Android vc 25** | **LIVE ON THE ALPHA TRACK 2026-08-08** — submitted from Windows, `COMPLETED`, versionCode read from Play. Built locally on `ignia-mac`, **zero EAS quota**, 93 MB `.aab`, `BUILD SUCCESSFUL in 19m 38s` (slower than usual only because `~/.gradle` had just been deleted to free disk). Signer `CN=Macro Log Dev` and `{"expo-channel-name":"production"}` verified in the artifact. Runtime fingerprint **`7a0e4edf389423589c41b692db34e34984ea22cc`**, read from the `.aab`. **Version 1.2.0** — 1.1.0 was released to the App Store today and ASC refuses further builds under a released version string, so the app version bumped; Android follows it to keep the two platforms on one number. **It is the first Android binary anything has ever launched.** `ignia-a35`, a headless API-35 arm64 emulator on the Mac, runs the universal APK extracted from this exact `.aab` and signed with the real upload key: `android-smoke.yaml` passes 5/5, and `adb shell cmd statusbar click-tile` drove `QuickAddTileService` signed-out into opening `MainActivity` via an `ignia:///` deep link while writing no row — the first Android row in `WIDGET.md` confirmed by anything. Method in `apps/mobile/.maestro/README.md`. **The widget's own quick-add button is still unverified on Android**: no `adb` command places a home-screen widget, and signed-in flows need the demo password | `node scripts/app-version-sync.mjs --check` |
| **Android vc 24** | **LIVE ON THE ALPHA TRACK 2026-08-08** — submitted from Windows, `Release status: COMPLETED`, versionCode read from Play. Built locally on `ignia-mac`, **zero EAS quota**, 93.1 MB `.aab`, `BUILD SUCCESSFUL in 8m 57s`. Signer `CN=Macro Log Dev` and `{"expo-channel-name":"production"}` verified in the artifact. Runtime fingerprint **`01edf656412ecaab3a16363617f6f7f642fbe535`**, read from the `.aab`. **It exists because vc 21 was OTA-stranded within the hour it shipped**: N3 added `NSSupportsLiveActivities` under `ios.infoPlist`, and `app.json` is hashed as a *whole*, so an iOS-only key moved the **Android** fingerprint off vc 21's. It also carries N3's JS (inert on Android — there is no Android Live Activity) and **`plugins/withGradleJvmArgs.js`**, which is the real point: **this build proves the Metaspace fix works from committed config**, having run with no heap flags in `GRADLE_OPTS` at all and hit **0 OOMs**. **vc 22 and vc 23 do not exist** — `autoIncrement` burns a number per attempt and two attempts died on the wrapper script inheriting neither `JAVA_HOME` (45 s, "requires Java 17, using Java 11") nor `ANDROID_HOME` (5 s, "SDK location not found"); neither variable is in the Mac's shell config, and the `build-android` skill's launch template now exports both. `public/app-version.json` synced to 24 and **hosting deployed**. **Device QA remains UNRUN and the owner has no Android device** | `node scripts/app-version-sync.mjs --check` (the doctor fails on drift) |
| **Android vc 21** | **SUPERSEDED by vc 24 after less than an hour, un-stranded and re-stranded the same evening.** Live on alpha 2026-08-08 — submitted with `eas submit` from **Windows** (the Mac deliberately holds no `play-service-account.json`), `Release status: COMPLETED`. Built locally on `ignia-mac` with `eas build --local` at **zero EAS quota**, 93.1 MB `.aab`, `BUILD SUCCESSFUL in 10m 47s`. Verified before submitting: signed `CN=Macro Log Dev` SHA-1 `3C:E1:5E:…:E4:D5` (the real upload key) and `{"expo-channel-name":"production"}` in the manifest. **It exists for one reason: Android was OTA-STRANDED.** Source had moved to fingerprint `f101b1d4…` while live vc 18 carried `cc3da8b9…`, so every Android `eas update` was publishing successfully and reaching **nobody** — the exact failure `AGENTS.md` warns is indistinguishable from a working update. This binary carries `f101b1d4e942c2ad032786b27821807ee3cfb6cd`, read out of the `.aab`, so Android OTAs land again. It carries no new feature; its contents are vc 18's plus what merged since. **Its versionCode is 21, not the 20 the plan expected** — `autoIncrement` burns a number per *attempt* and the first try died on a Gradle `OutOfMemoryError: Metaspace` in `:react-native-health-connect:lintVitalAnalyzeRelease`, so **vc 19 and vc 20 do not exist**. The retry ran with `GRADLE_OPTS='-Dorg.gradle.jvmargs="-Xmx6g -XX:MaxMetaspaceSize=2g"'` and hit 0 OOMs. **That workaround is now closed** — `plugins/withGradleJvmArgs.js` writes it into `gradle.properties`, proven by vc 24 building with no heap flags in the environment. The number was read from **Play**, not the build log, per the standing rule. `public/app-version.json` is synced to 21 and **hosting is deployed** (verified live on `ignia.fit`), so vc 13/18 installs now see the update banner. **Device QA remains UNRUN and the owner has no Android device** | `node scripts/app-version-sync.mjs --check` (the doctor fails on drift) |
| **Android vc 18** | **SUPERSEDED by vc 21.** **LIVE ON THE ALPHA TRACK 2026-08-07** — `status=completed, versionCodes=["18"]`, read from the `androidpublisher` edits→tracks API. Built locally on `ignia-mac` with `eas build --local` at **zero EAS quota**, 88.8 MB `.aab`. **It is the first binary that can log without the app being open** (ADR-0020): a quick-add button on the 2×2 widget face and a **Quick Settings tile**, both writing through `ledger.ts` from a headless JS context — auth persists via `AsyncStorage`, which is the fact the whole Android design rests on. Verified before submitting: signed `CN=Macro Log Dev` (the real upload key), `{"expo-channel-name":"production"}` in the manifest, and both `QuickAddTileService`/`QuickAddTileTaskService` present in it. Runtime fingerprint **`cc3da8b9a22df7180c55e6cab5cd8decccdb98bb`**, read out of the `.aab` itself. **Its versionCode is 18 even though the build log printed "Version code: 19"** — the log describes the remote counter advancing for the *next* build; Play's `bundles` list gives vc 18 a `sha256` identical to the local artifact, byte for byte. vc 14–17 do not exist (`autoIncrement` burns one per failed attempt). **Device QA is UNRUN**: nothing here has been tapped on real hardware, so every Android box in `WIDGET.md`'s checklist stays unticked, including the tile's own rows. `public/app-version.json` is synced to 18 and **hosting is deployed** (verified live on `ignia.fit`), so vc 13 installs now see the update banner | `node scripts/app-version-sync.mjs --check` (the doctor fails on drift) |
| **Android vc 13** | **SUPERSEDED by vc 18**, but still what any tester who has not updated is running — and the runtime the 2026-08-07 22:xx OTAs were published under. Originally live on alpha 2026-08-07 — `status=completed, versionCodes=["13"]`, verified via the `androidpublisher` edits→tracks API (not the CLI). Built locally on `ignia-mac` with `eas build --local` at **zero EAS quota**, 89 MB `.aab`. Verified before submitting: signed `CN=Macro Log Dev` SHA-1 `3C:E1:5E:…:E4:D5` (the real upload key, **not** the debug cert) and `{"expo-channel-name":"production"}` present in `AndroidManifest.xml`, so it **can** receive OTA updates. Built from `a7c568a4`, so photo-scan, the update banner and current What's New are **embedded**, not OTA-dependent. Runtime fingerprint `5758fe4f232d5e6fe1ca369299512cfec0d39e13`, **read out of the `.aab` itself** (`base/assets/fingerprint`), and the runtime the 22:00 OTA of 2026-08-07 was published under. vc 11's `c0b85c15…` is a **Windows-generated, unverified** number — see the machine-dependence note in the OTA row and `apps/mobile/AGENTS.md`. **vc 12 does not exist**: `autoIncrement` burns a number per *attempt* and the first attempt failed in 23 s on an unset `ANDROID_HOME` (`DEV_ENVIRONMENT.md` §3.11 trap 3). `public/app-version.json` is synced to 13 and **hosting is deployed**, so older installs now see the update banner | `node scripts/app-version-sync.mjs` (fails the doctor on drift) |
| Android / Play | **Not launched.** Play Console account exists, **developer verification complete** and `fit.ignia.app` **package name registered** (both 2026-07-31), proven with an APK signed by `apps/mobile/credentials/dev.keystore` (alias `macrolog-dev`, SHA-256 `75:4B:03:19:…:F6:D8`) — **that keystore is load-bearing app identity; it is git-ignored and now exists in TWO places** (this machine and `ignia-mac`, both mode `600` — locations and disposal list in `CLAUDE.local.md`). **vc 11 (2026-08-07) is LIVE on the alpha track** (`status=completed, versionCodes=["11"]`, verified via the androidpublisher API) — built with `eas build --local` on the Mac at **zero EAS quota**, signed with the real upload key, and the first Android binary that can actually receive OTA updates (channel `{"expo-channel-name":"production"}` confirmed in its `AndroidManifest.xml`). **vc 10 is superseded and is an OTA dead end** — it was built with raw `./gradlew bundleRelease`, which omits the channel silently; do not point testers at it — plain `./gradlew bundleRelease` on the Mac, 1m51s incremental, **zero EAS quota**, signed with the real upload key and verified via `keytool -printcert` (`CN=Macro Log Dev`, not the debug cert Expo's template defaults to). It is also the first Android binary carrying `expo-updates`. The EAS remote versionCode was set to 10 by hand — a local Gradle build neither reads nor increments it, and skipping that step makes the next cloud build re-mint a colliding number. App entry created (`4975181896468259775`). **The first AAB is uploaded and the whole app is IN REVIEW at Google** as of 2026-08-02 — versionName 1.1.0 / **versionCode 4**, EAS build `2d36d121`, on the **Closed testing - Alpha** track (id `4699799777678836720`), 177 countries, signed by that same key (verified with `keytool -printcert -jarfile`). 14 changes went in one submission because it is the app's first: store listing, content rating, data safety, health declaration, the release itself. Reviews are quoted at up to 7 days. **vc 6 superseded it on 2026-08-03** — EAS build `d238d43f`, commit `87aee43b`, submitted with `eas submit` and **verified live on the alpha track by the Play Developer API: `status=completed, versionCodes=["6"]`**. `completed` means rolled out to the tester list, not a draft awaiting a console promote — that is `eas.json`'s `releaseStatus: "completed"` (from `87aee43b`) working. **vc 6 is the first Android binary containing Sentry and the Google sign-in diagnostics**, so Alejandro's `DEVELOPER_ERROR`-vs-`no-token` question is now answerable from Sentry rather than from guesswork — and on 2026-08-05 it was answered: `DEVELOPER_ERROR`, from a real Play split-APK install of vc 6 (see the sign-in row in §8). **The app is out of review**: the console shows the 1.1.0 release as *Available to selected testers*, released Aug 3 8:41 PM, and the opt-in link `https://play.google.com/apps/testing/fit.ignia.app` is live for the listed testers (it renders "App not available" for any account not on the list, including the developer's own — that is not a fault). Tester list `Ignia Beta Testers` holds **7 emails; 12 are required** — **personal developer account → production access requires closed testing with 12 testers opted in 14 CONTINUOUS days** ([policy](https://support.google.com/googleplay/android-developer/answer/14151465)). **Resolved 2026-08-05: Play's own production-access checklist (app Dashboard) reads "8 testers currently opted-in"** (4 → 6 → 8 over the course of that one day — it moves, so re-read it rather than trusting any number written down here). So opt-ins are real and the earlier "Installed audience 0" was a lag, not a dead track. **Updated 2026-08-07 by the owner from the Dashboard: 12 testers are now opted in — the threshold is MET.** That started the 14-day continuous clock, which runs from the **12th** person's opt-in (the policy is per-tester, not a group timer), so the earliest production-access application is ~2026-08-21 provided nobody drops out and rejoins — interrupted periods do not add up. The number climbed 4 → 6 → 8 → 12 across 2026-08-05..07, which is exactly why it must be re-read from the Dashboard rather than trusted from this file. **Play publishes no per-tester data at all** — not who opted in, not when. The Dashboard aggregate is the entire dataset: the `androidpublisher` `testers` resource covers only Google Groups, and Statistics → *Installed audience* returns "Data unavailable" at this volume. Firebase Auth can prove a *negative* (no account = that person never signed in anywhere) but cannot distinguish a web sign-in from an Android one, because the mobile app deliberately writes the same doc shapes as the PWA. To learn who is actually in, ask them for a screenshot of the opt-in URL — it states each person's own status back to them. **The 14 days are per-tester, not a group timer**: [policy](https://support.google.com/googleplay/android-developer/answer/14151465) requires that at application time ≥12 testers have each been opted in for *the last 14 days continuously*, and states that someone who opts in, tests under 14 days, opts out and rejoins does **not** get to add the periods up. So the 6 are already banking days; the earliest apply date is 14 days after the **12th** opt-in, because that person has the least time banked. Play exposes no per-tester breakdown — the aggregate on the Dashboard is the only number | Track state: the `androidpublisher` edits→tracks API with `credentials/play-service-account.json` (see `CLAUDE.local.md`) |
| Cloud Functions / rules | Deployed, project `fitness-tracker-gb-1775407101`. **`firestore.rules` redeployed 2026-08-04** to allow + range-validate the new `proteinFloor` profile field (`> 0 && < 1000`); deployed **before** any client writes it, per the standing rule | `firebase deploy --only functions --dry-run` |

**PHOTO-SCAN RESOLVES ITS MACROS FROM THE USDA DATABASE as of 2026-08-07**
(ADR-0019) — the split vision architecture ADR-0015 §1 specified and never
built. The vision model now returns a **list** of `{name, grams, state,
confidence}`; `functions/src/photo-resolve.ts` looks each one up in the bundled
dataset and scales its per-100 g macros by the portion. Items USDA does not
carry (mofongo, tostones, pernil, pan sobao) keep the model's own numbers and are
marked `source: "model"`; both clients label them.

**DEPLOYED 2026-08-07** — `analyzePhoto` revision `analyzephoto-00044`, and
hosting at release `dc3afd16`. **`analyzePhoto` runs at 512 MiB**, raised from
the 256 MiB default in the same deploy: the indexed dataset is 67 MB of heap
(123 MB RSS measured) and this function also holds the base64 image, capped at
20 MB of string which V8 stores as UTF-16 at ~40 MB. `searchFoods` keeps the
default — it holds the same index but never an image.

**The `analyzePhoto` response is ADDITIVE, and that is load-bearing.** `items[]`
is new; the flat `calories`/`protein`/`carbs`/`fat` remain and are now the sum of
the resolved items. Every shipped binary (iOS 24/25, Android vc 11/13, the
deployed web app) reads only the flat fields, so **the accuracy fix reaches every
existing install the moment the function deploys** — no app update, no OTA, no
review. The itemized review screens are what need new clients.

Verify against prod with a real signed-in scan, or locally on the compiled path:

```sh
cd functions && node -e "const{loadFoods}=require('./lib/usda-db.js');const{resolveItems,totalsOf}=require('./lib/photo-resolve.js');console.log(JSON.stringify(totalsOf(resolveItems(loadFoods(),[{name:'grilled chicken breast',grams:150,state:'cooked'},{name:'white rice',grams:180,state:'cooked'},{name:'black beans',grams:120,state:'cooked'}]))))"
# → {"calories":640,"protein":52.9,"carbs":66.2,"fat":16.9}
```

**Photo-scan HAS now had real end-to-end round trips against prod** — the first
in the feature's life, on 2026-08-07, with real photos on a real signed-in
account. `node scripts/smoke-photo-scan.mjs <image.jpg>` repeats it in ~20 s: it
creates a throwaway free-tier user, scans, prints the per-item USDA-vs-model
provenance, and deletes the user. **~8–13 s per scan** (Gemini dominates; the
timeout is 60 s), ~$0.0015, one of the caller's 3 daily scans.

That run is what found the two bugs 96 unit tests had passed over — "tomato
sauce" → *Sauce, steak, tomato based*, and "tomato-based sauce" beating it as an
exact three-token match. Read the `-> matched description` column, not the
calories: a wrong food looks perfectly reasonable as a number.

**Still owed** (ADR-0015 §2): the validation gate on 30–50 real photos, judging
the *item list and portions* — never the macros. `scripts/validate-photo-itemiser.mjs`
is the harness.

**Food search runs on a BUNDLED USDA database as of 2026-08-07** (ADR-0018).
`functions/data/usda-foods.json` — 13,272 foods, 3.6 MB, committed, generated by
`node scripts/ingest-usda.mjs` (which downloads and caches its own inputs; the
"multi-GB, owner-run" blocker in the old scoping doc was wrong — the three
archives total ~13 MB). `functions/src/usda-db.ts` loads it once per instance and
serves `searchFoods`/`getFoodDetail` with **no network call**. The live FDC API
is gone: no key, no 1,000 req/hour ceiling, no upstream outage. Open Food Facts
is unchanged and still serves branded + the whole barcode path.

**The wire contract did not change**, so this is a **functions-only** deploy —
both frontends and `packages/core` are untouched and no client release is
needed. Search-cache keys moved to `v3`; a stale `v2` page could name a Branded
`fdcId` the new backend cannot resolve.

**`USDA_FDC_API_KEY` is dead code but STILL BOUND — do not delete it.** No
function reads it any more, but the binding survives on the deployed revisions,
so destroying the secret would stop `searchFoods`/`getFoodDetail` booting
(gen2 resolves bindings at instance start). The count stays at **8 active
versions**, not 7. Two routes were tried on 2026-08-07 and both failed:

- `firebase deploy --only functions` (full, all functions) **does not prune**
  secret bindings — the source no longer declares the secret and the revision
  still carries it. Verified after both a targeted and a full deploy.
- `gcloud run services update <svc> --remove-secrets=USDA_FDC_API_KEY` crashes:
  `ValueError: Invalid secret path … in annotation` — gcloud cannot parse the
  annotation firebase-tools writes.

What is left to try: patch the Cloud Run service through the Admin REST API,
removing the secret env var **and** the `run.googleapis.com/secrets` annotation
together. Verify a search still returns hits, and only then
`gcloud secrets delete USDA_FDC_API_KEY`. Worth ~$0.06/mo — do it when
something else is already touching functions, not on its own.

```sh
gcloud functions describe searchFoods --region=us-central1 --gen2 \
  --format="value(serviceConfig.secretEnvironmentVariables)"   # empty == unbound
```

**Still open:** photo-scan does NOT yet resolve its recognized items against this
DB — the model still emits macros directly, so ADR-0015's split vision
architecture remains half-done. That is now a small change, not a blocked one.

```sh
cd functions && node -e "const{loadFoods,searchUsda}=require('./lib/usda-db.js');console.log(searchUsda(loadFoods(),'chicken breast',1))"
```

**Photo-scan is LIVE and free for everyone, both platforms, since 2026-08-07**
(ADR-0017). Web deployed at commit `01803846` (release stamp verified live on
`ignia.fit`); mobile published as an **OTA**, update group `93132738…`
(Android) / `bf5f9163…` (iOS). The meal-photo→macros loop was built, deployed
and fully guarded on the server all along — **only the clients were dark**. Two
flags changed and nothing else: web `FEATURES.photoScan` → `true`, mobile
`FEATURES.photoScan` → a **hardcoded `true`** replacing its
`process.env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN` read.

**`eas.json` was deliberately NOT touched, and the OTA gate is why.** Deleting
that env key was tried first and reverted: `eas.json` is hashed into the EAS
Update fingerprint, so it moved Android `c0b85c15…` → `30043793…` — an update
that publishes successfully and **reaches nobody**, and that would have forced
new binaries plus a resubmission of iOS build 24 mid-App-Review. JS source is
not hashed. The published runtime versions were confirmed identical to the
**Windows-generated** fingerprints (`c0b85c15e6631d99e8ccef61867d937389094ae6`
android, `781be0c885005e1d02bcf41408988c6622ff222e` ios) — which, as of
2026-08-07 22:00, is known **not** to be the same thing as matching the shipped
binaries; see the OTA row above. The `c0b85c15… → 30043793…` movement is still a
valid demonstration that `eas.json` is hashed and JS source is not; only the
"lands on vc 11 and build 24" conclusion is withdrawn. **The rule that
generalizes: an env-var flag is a build-gated switch
(hours); a hardcoded constant is an OTA-gated one (seconds) — for a kill
switch, use the constant.** A now-inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN: "0"`
still sits in `eas.json`'s `production` + `preview` profiles; **nothing reads
it**, and it is flagged in `apps/mobile/src/lib/features.ts` for deletion
alongside the next change that needs a native build anyway.

**No Cloud Function change was needed** — `analyzePhoto` was already deployed
with `PHOTO_REQUIRES_PAID = false` and the guards already in the right order:
`spendCeiling.check("photo")` before the per-user reserve, `dailyQuota.reserve`
(**3/day free · 30/day paid**), `spendCeiling.record` immediately after the
request leaves. ~$0.0015/scan on `gemini-2.5-flash`, so ~$0.14/user/month at
the free cap, and the ceiling bounds the worst *day* across all users at 2,000
scans ≈ $3. Functions were redeployed only for welcome-email copy ("three ways
to log a meal" → four, both locales). This **amends ADR-0015's paid gate**
("5 lifetime free scans, then Pro"), which never shipped and was incoherent
while `PRO_ENABLED` is false — `isPaid()` is forced `true`, so a client-side
paid check unlocks the feature for everyone. **The client flags are a kill
switch, not a cost control**; the cost control is server-side and cannot be
bypassed.

**Not yet verified end-to-end by a human**: no signed-in photo→macros round
trip has been run against production since the flip. One scan on `review@` or a
real account confirms it.

```sh
curl -s https://ignia.fit/index.html | grep -o '__MACROLOG_RELEASE__[^;]*'   # web build live
cd apps/mobile && npx eas update:list --branch production --limit 3           # OTA groups
```

**The `1.1.0` trap.** `app.json` says 1.1.0 and ASC has a 1.1.0 version page, but
**EAS has never built a 1.1.0 iOS binary**. Anything a doc describes as "shipped in
1.1.0" shipped in **1.0** or has not shipped at all. Do not trust a version number
in prose; ask ASC:

```sh
node -e "import('./scripts/asc-client.mjs').then(async({api,APP_ID})=>{const r=await api('GET','/v1/apps/'+APP_ID+'/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState');r.data.forEach(v=>console.log(v.attributes.versionString,v.attributes.appStoreState))})"
```

**The last step of `npm run build` is load-bearing — do not reorder or drop it**
(2026-08-04). `scripts/sentry-release.mjs` mutates `dist` *after* `ng build` has
already hashed it: `sentry-cli sourcemaps inject` rewrites every minified `.js`
to embed a debug ID, and the map-strip deletes files. `ngsw.json` pins a SHA1
per file, so it is **regenerated as the final step**; shipping the stale one
gives every returning user a service worker whose hashes do not match what the
server serves. The script exits non-zero rather than leave that dist behind.
Same reason the release stamp is injected there and not into `src/`. Verify a
build before deploying — 133/133 matched on 2026-08-04:

```sh
node -e "const{createHash}=require('crypto'),{readFileSync,existsSync}=require('fs'),{join}=require('path');const D='dist/fitness-tracker-pwa/browser',t=JSON.parse(readFileSync(join(D,'ngsw.json'),'utf8')).hashTable;let b=0;for(const[u,h]of Object.entries(t)){const f=join(D,u.slice(1));if(!existsSync(f)||createHash('sha1').update(readFileSync(f)).digest('hex')!==h){console.log('BAD',u);b++}}console.log(b?b+' BAD':Object.keys(t).length+' ok')"
```

**Web Sentry releases are per-commit as of 2026-08-04.** Before that nothing set
`__MACROLOG_RELEASE__` (despite a code comment claiming this script did), so the
app reported release `dev` and every web error since 2026-04-13 grouped under a
single `dev` release; the About screen and feedback emails showed `dev` too.
Builds now stamp the commit SHA into all 110 emitted HTML pages and create the
release via the API. Source maps were **not** broken by this — debug IDs match
frames to maps without a release — so do not read the old `dev` grouping as
"symbolication was down". `SENTRY_ORG` / `SENTRY_PROJECT` were **deleted as
GitHub Actions secrets**; both now default in `sentry-release.mjs`
(`gabriel-bermudez` / `ignia-web`, confirmed against the Sentry API). Re-adding
either secret overrides the default — only do that if the project is renamed
again. `SENTRY_AUTH_TOKEN` remains the one required credential, read from
`.env.local` on a workstation and from the Actions secret in CI.

## 2. Written, merged, and not yet in front of the public

All of this is on `main`. Do not re-scope anything here as new work.

**THE CUTLINE, updated 2026-08-07 — read this before the bullets, which are older
than it.** iOS build 19 and Android vc 8 were cut from `fdcd92ed` and submitted
(TestFlight + Play alpha, both verified at the destination). Since then **iOS
build 23 and Android vc 9 have shipped to testers**, and between them they close
the last gap for everything merged up to that point.

**Amended later on 2026-08-07 — photo-scan was turned on and SHIPPED the same
day**, web and mobile both (see §1). It never sat in this section. Every bullet
below remains in testers' hands on both platforms.

What is still pending is a different thing, and it is the one that matters:

| Audience | Has | Missing |
|---|---|---|
| TestFlight testers | **everything in §2** (build 23) | — |
| Play alpha testers | **everything in §2** (vc 9) | — |
| **App Review** | build **24** — everything through `ebf60dcb` | the update banner (`b8306f9f`), which landed after 24 was uploaded and reaches these users over the air instead |
| **Public App Store** | **1.0, build 7** (`168e0394`, uploaded 2026-07-20) | **54 mobile/core commits** — i.e. all of §2 |
| Play production | nothing — not launched | — |

So the gap is not a build, it is a **submission**: `1.1.0` has sat at
`PREPARE_FOR_SUBMISSION` since it was created and **has never gone to App
Review**. Cutting another build does not move that; submitting does. Verify
with the ASC command in §1.

- **Manual food entry is a first-class logging method on mobile** (2026-08-06,
  `ebf60dcb`). **LIVE ON ANDROID in vc 9** (2026-08-06) **and ON iOS in build 23**
  (2026-08-07) — so it is now in testers' hands on both platforms. It rode along
  with the widget fix exactly as intended when the owner declined to spend a build
  on it alone. Writing a food in yourself was
  a text link at the *bottom* of the Add-food browse list, under Recent + My
  Foods + Quick add; My Foods is uncapped, so the link sank further with every
  food saved through it, and typing two characters removed it entirely (the
  browse list only renders in the search's idle phase). A search miss was a dead
  end that discarded the typed name. Now: a `create-outline` icon leads the
  header icon row, and a no-results search offers to add the food with the query
  already in the name field. Diagnosis, the options not taken, and the still-open
  item **E** (cap the uncapped My Foods / presets lists) are in
  `docs/research/mobile-manual-food-entry.md`. The web needed no change — its
  sheet already opens on a Manual segment.

- **Mobile template editor reached parity with the web one** (2026-08-06).
  **In testers' hands** (iOS build 19+, Android vc 8+ — see the cutline). The
  first attempt — iOS 18 (`e8f0d86f`), Android vc 7
  (`e6d97826`), both from `e47fd366` — ERRORED in *Bundle JavaScript*, for a
  reason unrelated to this fix: colocated `*.test.tsx` files inside `src/app/`
  get swept into Expo Router's route `require.context` and bundled (see
  `apps/mobile/AGENTS.md`). That break landed 2026-08-05 with the first Expo
  tests and lay dormant because no EAS build ran in between. Tests moved to
  `src/__tests__/`. **The second attempt, from `fdcd92ed`, FINISHED on both
  platforms in 32 min: iOS build 19 (`4527017a`) and Android vc 8
  (`5584f181`). **BOTH SUBMITTED 2026-08-06 and verified at the destination,
  not from the CLI**: iOS 19 is `VALID` in App Store Connect (the submit CLI
  reported a failure that had actually uploaded — see §1), and Play's
  `androidpublisher` edits→tracks API reports the alpha track at
  `status=completed, versionCodes=["8"]`, i.e. rolled out to the tester list.
  **Those two binaries carry the template fix ONLY**: they were cut from
  `fdcd92ed`, before the food-entry work above, so testers have this and not
  that.** The mobile
  editor modelled an exercise's sets as a *count*, and `updateTemplate` writes
  `exercises` as a full overwrite, so opening a template authored on the web and
  tapping Save rewrote every cluster (activation/mini/mini) as N flat `working`
  sets and deleted `cues` and `progression` outright. It also could not see
  `restMiniSec`/`restClusterSec`. It now edits real `PlannedSet`s with derived
  cluster numbering (`normalizeClusterGroups`, same invariant as the PWA), plus
  cues, auto-progression and both rest timers; a failed save shows an error
  instead of looking like a no-op. **The owner's three templates are all
  cluster-format, so anyone on a current build should edit templates on the web
  until this ships.** Pinned by `apps/mobile/src/app/(app)/train.template-editor.test.tsx`
  (round-trip a cluster template unedited; renumber on append).

- **Account linking — "Sign-in methods"** (2026-08-05). **The web half is LIVE**
  (hosting deployed 2026-08-05); the mobile half is on `main` and **in no
  binary**. A user who signed up with email + password can now connect Google,
  Apple (mobile) or Microsoft (web) to the *same* account from Settings, and the
  mobile sign-in screen finally completes the collision flow the PWA already had
  (capture the credential, verify with the owning provider, `linkWithCredential`).
  **The Settings path is not a nicety — it is the only mechanism that covers
  Apple's Hide My Email**, whose `@privaterelay.appleid.com` address never
  collides with the password account and so silently creates a second account.
  Unlink refuses to remove the last provider. Note the mobile provider-hint code
  it replaces was already dead: this project has
  `emailPrivacyConfig.enableImprovedEmailPrivacy = true`, so
  `fetchSignInMethodsForEmail` returns `[]` unconditionally — **do not write new
  logic that branches on its result.**
- **Body-measurement fixes — mobile, in testers' hands** (2026-08-05; iOS build
  19+, Android vc 8+). Three, from
  tester report: (1) typed digits were invisible — `styles.input` carries
  `flex: 1` for the weight sheet's *row*, and reusing it inside the measurement
  *column* made `flexBasis: 0` collapse the box to its padding, so values saved
  but never appeared; (2) saved rows could not be edited at all —
  `toMeasurementPatch` existed in `@macrolog/core` but only the PWA called it,
  so mobile now has `updateMeasurement` and the sheet prefills and edits every
  site, not just waist; (3) nothing explained what a tape measurement was *for*,
  so both apps now carry the same intro plus a "How to measure" panel. Deletion
  moved from a hidden long-press to an explicit trash icon, matching the PWA's
  per-row pencil/trash controls.

- **The daily-target safety floors, and the onboarding shadow bug** (2026-08-04).
  **The web half is LIVE** (hosting deployed 2026-08-04); the mobile half is **in
  testers' hands** (iOS build 19+, Android vc 8+). Three defects, one seam:
  1. **`calorieFloor` was clamped on only two of the four branches that can
     produce a target** — `tdee.ts` measured and formula. The manual
     onboarding heuristic and the seed fallback bypassed it, so a user with
     `calorieFloor: 1850` was shown 1760 (their `manualCaloriesTarget`, =
     weight × 11) and 1800 (`SEED_RESULT`) respectively. Fixed with **one exit
     clamp in `dailyTargets`** (`packages/core/src/targets.ts`) rather than
     three patched return sites; `calorieFloor` is now exported from `tdee.ts`
     instead of duplicated. **`calculateTdee` arithmetic is untouched and
     `tdee.test.ts` is byte-identical green** — `Math.max` is idempotent, so
     measured/formula values that were already clamped upstream pass through
     unchanged (two guard tests assert exactly that).
  2. **Protein had no floor at all.** New **opt-in** `proteinFloor` (grams) with
     **no numeric default** — unset behaves exactly as before. Type, rules,
     writers on both clients, `LEDGER_PORT` + in-memory adapter, and a settings
     stepper on web and mobile in both locales, where "off" is a real state and
     stepping below the band minimum clears the field.
  3. **`saveOnboardingV2` could shadow the formula target forever.**
     `saveRefinedTargets` deletes the manual targets and stamps
     `targetsRefinedAt`; re-running onboarding restored a manual target and left
     the stamp, and manual outranks formula — so a refined user who changed
     their goal was pinned to a heuristic number derived from a pace they had
     already replaced. Both adapters hand-wrote that patch and had drifted, so
     the patch shape moved into **`toOnboardingV2Patch`** in
     `packages/core/src/firestore-writers.ts` (the module that exists to stop
     exactly this) and now clears the stamp. Invariant, unit-tested:
     **`targetsRefinedAt` present ⟺ manual targets absent.** Clearing it also
     re-shows the Refine Targets card, which is correct — the user is back on
     the heuristic and should be re-invited to refine.
  **One behaviour change wider than the bug report**, called out deliberately: a
  manual target below 1500 with no configured floor now lifts to
  `MIN_DAILY_TARGET`. Reachable — the `lose` heuristic is weight × 11, so anyone
  under ~136 lb onboards below 1500 (a 100 lb user goes 1100 → 1500). That is
  the floor doing its job on a branch that had been skipping it, but it does move
  existing users' numbers. **Verified 2026-08-04: `npm run test:rules` is green,
  161/161**, and `proteinFloor` now has four emulator specs of its own (in-range
  accepted, over-ceiling rejected, `0` rejected — "off" is an *absent* field, not
  a zero — and absent accepted). An earlier version of this entry claimed the
  suite could not run here because firebase-tools needs **Java 21+**; JDK 21 is
  installed, it is just not the PATH default. Export it first, per §7.
- **Photo-scan is provider-switchable, and gated paid server-side**
  (2026-08-04). On `main`, deployed nowhere. `analyze-photo.ts` now has two
  interchangeable adapters behind one `MacroDraft` contract, chosen by the
  `PHOTO_PROVIDER` constant:
  - `"gemini"` — `gemini-2.5-flash`, **the active default**. Has a real free
    tier, which is why photo-scan has cost approximately nothing to date.
  - `"anthropic"` — `claude-haiku-4-5`. **No free tier**: metered from the
    first request at ~$0.004/scan. Better structured-output guarantees, plus
    explicit refusal and truncation handling Gemini's path doesn't need.

  **It stays on Gemini until Pro launches** — v1 is free, so every scan today
  is unfunded. Flipping is a one-word change; both adapters compile and both
  secrets are declared on the callable, so switching is not a change to the
  deployment contract. Everything downstream of the dispatch (normalize,
  clamp, client response shape) is shared, which is what stops the two paths
  drifting into different numbers for the same photo.
  **`ANTHROPIC_API_KEY` exists** in Secret Manager as of 2026-08-04 (v1,
  enabled) and was verified live against `/v1/models`. Both it and
  `GEMINI_API_KEY` must exist to deploy, whichever provider is active.
  **The feature is still hidden** (web `FEATURES.photoScan: false`, mobile
  `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` in the prod build) — this is plumbing,
  not a launch.
  **Photo-scan is freemium, not Pro-only** — `PHOTO_REQUIRES_PAID = false`,
  and the tiering is the daily caps in `daily-quota.ts`: **3/day free, 30/day
  paid**, which is what the freemium table always promised. Costed before
  opening it: on Gemini a free user maxing 3/day *every day* is ~$0.14/month,
  and the `photo` ceiling bounds the worst possible day at 2,000 scans ≈ $3.
  **The earlier "30/day loses money" worry was Haiku-specific and is void on
  Gemini** — 30/day × 30 days × $0.0015 = $1.35/mo against $3.00/mo of
  revenue. Re-run that math before flipping `PHOTO_PROVIDER`, where the same
  usage costs ~2.7×; do not carry the conclusion across providers.
  **The gate, if it is ever re-closed, must stay server-side.** The client
  cannot express "Pro": `isPaid()` is forced `true` for everyone while
  `PRO_ENABLED === false`, so a client-side paid check unlocks the feature for
  the entire free tier. `caller.tier` reads the Stripe claim and ignores that
  flag.
  **Required before the Anthropic path ships to users:** it adds a new
  subprocessor, so the privacy policy's `dontShare` list (both locales), the
  Play **Data safety** form (which cleared Photos *because* photo-scan was
  off), and the App Store privacy labels all need updating.
  `functions/test/email-templates.spec.ts:132` asserts the welcome email does
  not advertise photo scanning; that assertion is deliberate and outlives all
  of this.
- **Input validation on four unguarded write paths** (2026-08-04). The web half
  is live; the mobile half is **in testers' hands** (iOS build 19+, Android vc
  8+). All four rules were
  shared in `packages/core` and mirrored in `firestore.rules` where rules can
  express them.
  - **RIR** was a bare `number` written straight from a numeric text input on
    both clients (a set was stored with `rir: 8`). Now a 0–5 integer via
    `clampRir`. **Rules cannot help here** — Firestore rules have no way to
    iterate a list, so individual sets inside `exercises[]` are unvalidated by
    construction and the clamp *has* to be client-side. Scale chosen 2026-08-04;
    nothing in the repo had ever defined one.
  - **Measurements** had ONE range for every field (`> 0 && < 200`), which is
    why a 15in chest stored fine — 15 is absurd for a chest and ordinary for a
    neck, and no single range can tell them apart. Per-field bands now, in
    `packages/core/src/measurement-bounds.ts` **and mirrored in the rules —
    keep the two in step.**
  - **Weigh-in dates** were never bounded, only weights were. A mistyped year
    plants a row decades from the series, and because the measured-TDEE window
    is bounded by ENTRY COUNT it stays in the regression indefinitely with
    maximum leverage on the slope. Rejected at the write path now. **The window
    semantics are deliberately unchanged** — a known, separately-scoped issue;
    do not "fix" it without deciding to move every sparse logger's target.
  - **Exercise duplicates** differing only by case/spacing now reuse the
    existing catalog entry instead of minting a second doc id (progression is
    keyed by `exerciseId`, so a duplicate splits the chart permanently).
  **The rules got STRICTER, and clients in the wild predate the client-side
  checks.** A user on App Store 1.0.0 (or a stale web tab) who enters an
  out-of-band measurement now gets a permission-denied instead of a friendly
  message. That is the intended enforcement, but it lands as a generic error
  until the next mobile binary ships. **Deliberately NOT done:** surfacing
  `tdee.outliersDropped` — it is computed on every TDEE run and read by no UI on
  either client, so the user still cannot see which weigh-in was discarded.
- **Sentry + Google sign-in diagnostics (mobile)** — **Live on Android in vc 6
  (alpha track, 2026-08-03 — §1). Still in no iOS binary**: build `f3e5daaf`
  contains it but has not been submitted to TestFlight. Originally: the Expo app had no error
  reporting of any kind, which is why the Play sign-in break below took a day to
  find. Sentry project **`ignia-mobile`** (org `gabriel-bermudez`, id
  `4511848397996032`); DSN wired into `apps/mobile/app.json`, ingestion verified
  end-to-end with a test event 2026-08-03. Google sign-in failures now carry the
  native code (`DEVELOPER_ERROR`, `PLAY_SERVICES_NOT_AVAILABLE`, …) instead of
  collapsing to one sentence.
  The web Sentry project was renamed `macrolog` → **`ignia-web`** in the same
  pass; its project id and DSN are unchanged, so `src/environments/environment.ts`
  needed no edit.
- **Home-screen widget — Android half was BROKEN in every shipped binary; fix
  shipped in Android vc 9** (`apps/mobile/src/widgets/`). Placed on a
  home screen for the first time on 2026-08-06 (vc 8) and it rendered an **empty
  transparent box**. Cause: `app.json` sets `experiments.reactCompiler: true`,
  and the React Compiler rewrites `TodayWidget` — PascalCase, returns JSX — to
  call `useMemoCache`. `react-native-android-widget` never mounts widgets in a
  React renderer; `buildWidgetTree` calls the component as a raw function, so
  the injected hook throws `Invalid Hook Call detected in TodayWidget` and
  nothing is drawn. Fixed with `'use no memo';` at the top of the widget file,
  enforced by `src/__tests__/widget-no-memo.test.ts`.
  **This was invisible to every gate we have** — tsc, jest and `expo export` all
  pass, and the widget appears in the picker and places normally. It surfaced
  only in **Sentry**, from the throw inside the widget task handler, which is
  the concrete payoff of vc 6 being the first Android binary with Sentry. **The
  Android widget never worked in vc 4, 6 or 8.** **The fix shipped in Android
  vc 9** (EAS `56a1af79`, commit `f3adeb83`), submitted 2026-08-06 and verified
  on the alpha track by the `androidpublisher` API:
  `status=completed, versionCodes=["9"]`.
  **VERIFIED ON A HOME SCREEN 2026-08-07 — a tester (Alejandro) confirmed the
  widget draws on his own device from a Play install.** That closes the check
  and, with it, the standing instruction not to describe the widget to testers:
  it is now fair to name in release copy and What's New. Two supporting signals,
  neither of which was sufficient alone: `IGNIA-MOBILE-3`
  (*"Invalid Hook Call detected in TodayWidget"*, 3 events, 1 user) last fired
  2026-08-06 22:24 from vc 8 and has not fired since vc 9 shipped — but silence
  also looks like "nobody has a widget placed", which is exactly why a human
  eye on a real home screen was the gate. If it ever fires from vc 9 or later,
  the fix did not take after all.
  **The device was on vc 11** (reported by the tester as "v11, I think" — the
  alpha track serves 11, so this is consistent, but it is a recollection and not
  a reading off the device). **It worked after simply updating the app**, with
  no report of having to remove and re-place the widget.
  That is one data point against the standing caveat, not a repeal of it. The
  caveat exists because Android caches the RemoteViews from the failed render,
  so a widget placed under vc 8 can keep drawing the blank frame after the
  binary is fixed. This case suggests it self-heals on update — but nobody
  confirmed that his widget pre-dated the update rather than being placed
  fresh afterwards, and those two stories are indistinguishable from the report
  as given. So: **if a widget is blank after updating, remove and re-add it**
  — as a remedy that is known to work, not as a step everyone must take.
  iOS is unaffected — its widget is SwiftUI and was never touched by this, and
  it was verified working on a physical iPhone from TestFlight build 13
  (2026-08-03), including refresh after a meal.
- **The Apple Watch complication and its transport** — the watch app
  (`targets/watch/`), the face complication (`targets/watch-widget/`), the
  three iOS **Lock Screen** accessory families, one shared Swift contract
  (`targets/_shared/Glance.swift`), and the repo's first custom Expo Module
  (`modules/watch-link/`) carrying the snapshot over
  `WCSession.updateApplicationContext`. **On TestFlight in build 16** (`VALID`, 2026-08-03) and **tested on a real Apple Watch 2026-08-04. Result: the transport works, the auto-refresh does not.** The mirror screen and the complication both render real kcal-left and protein numbers, which proves the whole delivery chain plus the App Group, the entitlement, the shared decoder and `_shared` at runtime. **But the face does not move after a meal is logged** — it only catches up when the watch app is launched fresh. Two fixes shipped in TestFlight build 19 and **the auto-refresh is CONFIRMED WORKING on the paired watch, 2026-08-06 — the face now updates after a meal without launching the watch app.** That closes the one defect the 2026-08-04 hardware test found. The fixes: `8cc2ba39` (the complication's `.atEnd` timeline meant one render decided the whole day — confirmed by remove/re-add restoring it) and `360662eb` (**the actual cure**: the `.backgroundTask(.watchConnectivity)` handler called `refresh()`, which re-reads but never *stores*, so no reload was ever requested — and it returned before activation completed). **The "log, then open the watch app" workaround is retired — stop telling testers to do it.** What remains unproven is only the layouts at 40mm/46mm in both locales (#46, needs a simulator). What is still unproven beyond that: the layouts at 40mm/46mm in both locales (#46, needs a simulator). What *was* verified locally: `tsc` clean, both `expo-target.config.js`
  files evaluate to the right entitlements, and
  `expo-modules-autolinking search -p apple` resolves `watch-link` →
  `WatchLinkModule` (the check that would have caught the `ExtensionStorage`
  disappearance in §3). **Credentials and compile are both cleared** — all four
  targets have App Store profiles, and #47 closed on the build rather than on a
  borrowed Mac. What is left needs hardware nobody can substitute for: a
  simulator for #46's layout readout, and a paired watch for the transport.
- **Health activity import** (steps / active energy → `dailyActivity`). Import +
  display only; deliberately does **not** feed measured-mode TDEE.
- **Per-meal reminder settings** (fixes the un-silenceable 1:30pm lunch nudge).
- **In-app rating prompt** (`84898243`).
- **Date localization** — dates followed the phone's locale, not the app's, so a
  Spanish user saw English weekday and month names throughout (`5028a9e8`).
- **Weigh-in outlier rejection** — one stray reading could rewrite the whole weight
  trend and drag the measured target to the floor (`946e7250`).
- **The Refine Targets catch** (`4f91b1f0`). Only the client half is pending: the
  `dailyWeights` index that commit added is *deployed*, and it already repaired
  Refine Targets for users on 1.0 without an app update.

Verify anything in this list with `git log 168e0394..HEAD -- <path>` — that range is
exactly "merged since the live binary". For a single commit, the sharper test is
`git merge-base --is-ancestor <sha> 168e0394` (exit 0 = it is *in* the live binary).

**Three items were wrongly listed here on 2026-07-29** and are called out so the
mistake is not re-made: the **recipe-URL import UI**, the **mobile verify-email
gate** (`a0049b84`), and **the App Review fixes from the two 1.0 rejections**
(`97662575`, `eb922813`, `04f30dcc`) are all **in 1.0**. The last of those is
provable without git: 1.0 is `READY_FOR_SALE`, and it only got there by passing the
review those commits fixed.

## 3. Builds: no longer the binding constraint

**As of 2026-08-07 this section is largely historical.** Both platforms now build
**locally on the MacBook Air (`ignia-mac`) at zero EAS quota**, and JS-only
changes need no build at all. The ceilings below still apply to cloud builds, but
cloud builds are now the fallback, not the default.

- **iOS: `eas build --local` on the Mac.** 15m57s cold, ~11m warm. Four targets
  verified nested in the `.ipa`. See `DEV_ENVIRONMENT.md` §3.10 + the `build-ios`
  skill. It also sidesteps the ASC 401 that breaks non-interactive *cloud* builds,
  so the ASC `.p8` never has to leave this machine.
- **Android: `./gradlew bundleRelease` on the Mac.** 10m36s cold, **1m51s
  incremental**, signed with the real upload key (`3C:E1:5E:…:E4:D5`, verified
  with `keytool -printcert`). See §3.11 + the `build-android` skill. **The Mac is
  the ONLY machine here that can do this**: Windows cannot compile RN's New
  Architecture C++ at all (260-char `MAX_PATH` vs a 350-char object path; upstream
  react-native-keyboard-controller#1247, open), and WSL2 cannot either because
  this is an ARM64 box and Google ships the NDK for `linux-x86_64` only.
- **Most fixes need NO build.** EAS Update ships JS/TS changes over the air in
  seconds — see the OTA row in §1. Run the fingerprint gate first
  (`apps/mobile/AGENTS.md`): an update published against a changed fingerprint
  succeeds and reaches **nobody**.
- The Mac holds `dev.keystore`, `credentials.json`, the Sentry token and an EAS
  session (locations + disposal list in `CLAUDE.local.md`).

### The cloud-build ceilings (fallback path only)

- iOS builds come from **EAS cloud, free tier**: 15 iOS builds/month, low-priority
  queue, 1 concurrent, 45-minute timeout. There are **two** ceilings, not one —
  a **30/month account total** and a **15/month per platform** sub-cap. Read
  both; the account total is the one that runs out first if the two platforms
  are used unevenly.
- **iOS 8/15, Android 5/15, account 13/30 for the 2026-08-01 → 2026-09-01
  period — measured 2026-08-06 from the API.** The counter is not the
  constraint this period. **Do NOT assume a failed build is free.** Measured
  2026-08-06 by reconciling `build:list` against `account:usage`: **six** Android
  builds were created this period and **five** were counted. The uncounted one is
  vc 7, which died early, in *Bundle JavaScript*. But vc 5 **also** errored — at
  the Gradle/Sentry-upload step, deep into the native build — and it **was**
  counted. So the exemption tracks how far the build got on the worker, not
  whether it succeeded; an earlier revision of this line claimed errors are
  always free, which was a generalisation from one observation and is wrong.
  Treat every queued build as a slot spent. The local bundle gate
  (`npx expo export`, see `apps/mobile/AGENTS.md`) therefore saves quota as well
  as the ~2h Android queue wait.
- **A duplicate build is the cheapest way to lose a slot, and it is silent.**
  On 2026-08-03 one `eas build -p ios` invocation produced TWO builds a minute
  apart on the same commit (`f3e5daaf` vc15 and `6415fca7` vc16, both
  `cfc19a06`, both finished). `autoIncrement` gives them different version
  codes, so nothing looks wrong in `build:list` — only the usage counter
  notices. After any `--no-wait` build, check `build:list --limit 2` before
  walking away. Note this is NOT the credential failure: that one genuinely
  cost nothing, exactly as this section claims.
- **The queue is the real cost, and it is not metered.** An Android build on
  2026-08-03 waited **2h05m** for a worker, ran Gradle for five minutes, and
  died on an HTTP 401 from Sentry's source-map upload. Both the build and the
  afternoon were gone. **Anything knowable before submitting must be checked
  before submitting** — `npm run doctor` now validates `SENTRY_AUTH_TOKEN`
  against the Sentry API for exactly this reason.

```sh
cd apps/mobile && npx eas-cli account:usage gabandres --non-interactive
```

  That command is the only authoritative source — `build:list` counts builds
  *started*, which over-counts (it includes errored builds) and cannot show the
  limit or the period boundary. It is easy to miss because it does not appear in
  `eas-cli --help`, which lists only the `account` topic.
- Android **APKs** build locally and free, via Gradle directly — *not* through
  `eas build --local`, which refuses to run on Windows. See §7. **Android AABs do
  not build here at all** — see the `bundleRelease` note in §4; they come from EAS,
  which has its own 15/month Android allowance.
- **Credentials are issued, `production` included — that blocker is fully gone
  as of 2026-08-03.** The scheme now has **four** targets and every one of them
  has an active App Store provisioning profile, all sharing one distribution
  certificate:

  | Target | Bundle id | Profile |
  |---|---|---|
  | Ignia | `fit.ignia.app` | `4N7B4FLGN4` |
  | Today | `fit.ignia.app.widget` | `S3KXW76C96` |
  | IgniaWatch | `fit.ignia.app.watchkitapp` | `534KZZ4G6U` |
  | IgniaWatchComplication | `fit.ignia.app.watchkitapp.watchkitextension` | `GTRBXF4G5D` |

  Distribution certificate `D48CC6237D` (serial `164DA7AA…`), expires
  **2027-07-07** — the same one that signed live 1.0 and TestFlight build 13.
  Targets **share** the cert and need **separate profiles**; do not mint a
  second cert, Apple caps them at 2 per account.

  Both watch targets reported `Synced capabilities: Enabled: App Groups` and
  `Linked: group.fit.ignia.app`. That is the explicit entitlement declaration in
  the two `expo-target.config.js` files doing its job — the plugin's
  `appGroupsByDefault` flag does **not** cover watch targets, and without those
  blocks the complication would ship unable to read what the watch app writes.

  **`.complication` is an unusable App ID suffix.** Apple's portal refuses any
  identifier whose final segment is `complication` — verified three times
  against the ASC API under two different parents, while `.watchkitextension`,
  `.face` and `.glance` all registered fine. The error says *"is not available.
  Please enter a different string"*, which reads like the name is taken and is
  not. Registering the parent first does not help.

  Run **once per distribution type** without `--non-interactive` and answer the
  Apple prompts. **ad-hoc** done 2026-08-01, **App Store** done 2026-08-03.
  EAS cannot mint credentials unattended: it refuses in non-interactive mode,
  *before* creating the build, so failed attempts cost no quota. Setting the ASC
  API key env vars does **not** help either — a `development`/`preview` build is
  **internal distribution**, which needs an ad-hoc profile, which needs a human
  to pick devices.

  The 2026-08-02 `production` failure at
  `Failed to register bundle identifier fit.ignia.app.widget` is what this pass
  cleared.

  That failure is **not** an ASC key problem, and the key's role is not the
  explanation (`47Z9RY8MT5` is Admin, and it answers ASC version queries fine —
  checked the same day). The failing call is a **Developer Portal** write, where
  EAS falls back to Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA. No
  API key covers that step. Credential failures cost **no build quota** — they
  happen before the build is created. `device:list` still needs
  `--apple-team-id AE6TTXW92K` when non-interactive.
- One iPhone is registered for ad-hoc distribution (UDID `00008140-0016199614C3801C`).
- **Two `development` builds exist.** `c539ab49` (commit `bb80759b`) was the first
  time the widget Swift ever compiled. **`de8fabd0` (commit `2a50e6e2`) is the one
  to install** — it carries the widget fix below. Install page:
  `https://expo.dev/accounts/gabandres/projects/macro-log/builds/de8fabd0-597c-4ebd-8f61-ccc75ec59dc5`

  These are dev-client builds, so the app shell needs `npx expo start --dev-client`
  to load JS; the widget itself is native and renders without Metro once the app has
  written data.
- **RESOLVED 2026-08-03 — kept because the trap is subtle and will be re-hit.**
  The widget now works on a physical iPhone from build 13; the fix below is what
  did it. Read this if autolinking ever drops a pod again.

  **The widget was dead because `ExtensionStorage`'s pod never reached the Podfile
  on EAS — and `ios.appleTeamId` was NOT the cause.** That earlier diagnosis was
  wrong; `2f7d0b0e` fixed a real warning but not this. Proven 2026-08-02 by
  grepping the build logs: `ExtensionStorage` appears **zero times** in the entire
  `INSTALL_PODS` phase of both `de8fabd0` (expo 54.0.35) and `f897f42f`
  (54.0.36), while ~34 other Expo module pods install normally. The device probe
  agrees — 42 native modules registered, that one absent.

  **The cause is a deployment-target mismatch, found 2026-08-02.**
  `ExtensionStorage.podspec` declares `s.platform = :ios, '16.4'`; the app was on
  SDK 54's default **15.1**. Expo's autolinking **silently drops** modules whose
  podspec floor is above the app's deployment target — no warning, no build
  failure, the pod simply never exists. Forcing the pod in explicitly is what
  finally made it speak: `CocoaPods could not find compatible versions for pod
  "ExtensionStorage" … they required a higher minimum deployment target`
  (build `ab70e74f`, the only one that has ever failed here).

  Fix: `ios.deploymentTarget: "16.4"` in `expo-build-properties`. **This raises the
  App Store minimum** — iPhone 6s / 7 / SE-1 cap out at iOS 15 and will no longer
  be offered updates. Accepted by the owner 2026-08-02 as the cost of the widget.
  The temporary force-link plugin was **deleted** in the same commit: with the
  target raised, autolinking adds the pod itself, and a second explicit `pod` line
  would be a duplicate declaration.

  Also settled by that build, so nobody re-investigates: the package resolves from
  the **monorepo root** `node_modules` on the worker (the plugin logged the path),
  so hoisting was never involved. Likewise not involved: `appleTeamId`, the App
  Group entitlement, the legacy `"ios"` config key, the pod cache, and the expo
  patch version — 54.0.35 and 54.0.36 fail identically.

  The general trap stands: this package fails *silently and completely* rather
  than throwing, which is why the `__DEV__` probes in `src/lib/widget.ts` are kept.
  They report, on first launch, which of "native module missing" / "not entitled to
  the App Group" / "wrote fine" is true — three different fixes that otherwise look
  identical. Reading them cost one build and settled what two builds of guessing
  had not.
- The build archive is **7.5 MB**, not 172 MB — see `.easignore`, added 2026-08-01.
  EAS keeps `.git` in the archive unless explicitly ignored, and this repo's history
  carries ~138 MB of committed-then-deleted `node_modules` binaries. **Editing that
  file is dangerous:** once it exists, EAS stops reading `.gitignore` entirely, so
  every pattern must be repeated there or the directory starts uploading.
- Budget **two** builds for the next release: one `development` for device QA (spent,
  above), one `production`. Shipping never-executed Swift straight to review is how
  the last two rejections happened, and each rejection cost a build anyway.

```sh
cd apps/mobile && npx eas-cli build:list --platform ios --limit 5   # what exists
```

## 4. Open work, and what each is actually blocked on

| # | Work | Blocked on |
|---|---|---|
| — | Next iOS binary (everything in §2) | Nothing structural. Build 13 exists, is on TestFlight, and its widget is verified on device — the device-QA gate this row used to name is **cleared**. What remains is submitting the 1.1.0 version page to App Review (it is still `PREPARE_FOR_SUBMISSION`), or cutting a newer build first if more of §2 should ride along. Quota and credentials are both resolved |
| — | Verify the **Android** widget on a device | Nobody has put it on an Android home screen. It is in Play vc 4, and its task handler registers through the custom `index.js` — a path no device has exercised. The iOS half is **done**: verified on a real iPhone 2026-08-03 from TestFlight build 13, kcal left + protein left, **and the numbers moved after a logged meal**, which proves the whole chain rather than the render alone |
| #46 | Read the watch layouts on a simulator | **a Mac with Xcode** (currently: borrow one). Its stated precondition — "the build session has written the watch Swift" — is now **met**: the real layouts exist, so the sitting is the readout it was designed to be |
| — | Compile the watch targets — **the compile gate, closed 2026-08-03** | **DONE — 2026-08-03, and it did NOT need a Mac.** An EAS iOS build *is* macOS running Xcode. Build `f3e5daaf` (commit `cfc19a06`) compiled, signed and packaged both `IgniaWatch.app` and `IgniaWatchComplication.appex`. **The load-bearing question is answered: `targets/_shared/Glance.swift` DOES resolve from the watch target** — the compiler read `Glance.strings(snap.locale)` at `targets/watch/index.swift:160` and emitted only an unrelated unused-binding warning. Had `_shared` not been linked in, that line would have been a hard "cannot find in scope" and the build would have failed. So the one-Swift-mirror design holds; the shared-contract plan needs no other vehicle. Also proven in the same build: `ViewThatFits` compiles at the watchOS `10.0` pin; the custom Expo module autolinks (`Installing WatchLink (1.0.0)` → `libWatchLink.a`); `ExtensionStorage` still installs alongside it, so no regression to the shipped iPhone widget. **One warning in the entire build** (an unused `protein` binding), since fixed |
| — | App Store screenshots | owner, on device (`store-assets/README.md`) |
| — | Play launch — **first AAB** | **DONE** (2026-08-02). Local `bundleRelease` is **permanently dead on this machine**: `LongPathsEnabled=1` and a reboot changed nothing, because the cap is **ninja**, not the registry — the SDK's `cmake/3.22.1/bin/ninja.exe` is not long-path-aware, and the `react-native-keyboard-controller` object path is 348 chars. Relocating `.cxx` cannot save it (the CMake target-dir prefix alone is 105 chars). **AABs come from EAS.** `eas.json` `production` now sets `android.credentialsSource: "local"` so EAS signs with `credentials/dev.keystore` instead of minting a new upload key — **that line is load-bearing; removing it silently changes app identity.** Artifact: EAS build `4b513a00`, vc 3, signer SHA-256 `75:4B:03:19:…:F6:D8` |
| — | Play launch — **upload the AAB to a closed track** | **DONE** (2026-08-02). vc 4 is on Closed testing - Alpha and submitted; the app is in Google review. Play does not accept an app's *first* upload through the Developer API, so this one went through the console UI. **vc 3 was discarded, not shipped** — it declared three health READ permissions the app never requests, and Play's health declaration demands a written justification per read permission. `07ce8e99` removed them; vc 4 declares 11 health permissions (5 read, 6 write). Do not resurrect vc 3 |
| — | Play launch — **the health declaration** | **DONE**, and it is per-permission prose that will need editing whenever the health permission set changes. Declared features: Activity and fitness, Nutrition and weight management, Sleep management — no Medical, no research. Each of the 5 read permissions has a justification stating the in-app surface, that data stays in the user's own account, and that it is never sold, shared, or used for ads. Active calories and steps additionally state they are display-only and excluded from the calorie target, which is true and is the honest answer to "why do you read activity" |
| — | Play launch — **`eas submit` for every upload after the first** | **DONE 2026-08-03 — the service account works** (`play-check` returns HTTP 200 on `applications/fit.ignia.app/reviews`). `eas.json` `submit.production.android` points at `apps/mobile/credentials/play-service-account.json` — **track `alpha` (= closed), `releaseStatus: "draft"`, so a submit uploads without rolling out to testers; it still has to be promoted in the console.** **Google DELETED the "Setup → API access" page** — do not go looking for it, and ignore any doc that says to link a Google Cloud project, [that requirement is gone](https://developers.google.com/android-publisher/getting_started). The only steps are: enable `androidpublisher.googleapis.com` on the GCP project (done), then **Users and permissions → Invite user** with the service-account email. Granted: app-scoped to Ignia, *Release apps to testing tracks* + *Manage testing tracks and edit tester lists*; deliberately **not** production release or financial data. Took effect immediately, not the documented 24h |
| — | Play launch — **Google Sign-In was broken for 100% of Play installs** | **STILL BROKEN after the 2026-08-03 fix; a second, different cause was found and fixed 2026-08-05 — see the row below.** The 08-03 diagnosis was correct but incomplete. Original writeup: **FIXED 2026-08-03, server-side, no build.** `fit.ignia.app` is enrolled in **Play App Signing**: Google strips the upload signature and re-signs every AAB with its own key before distribution. Android Google Sign-In authorizes the caller by *package name + signing-certificate SHA-1*, so a Play install presents **`8261e9d8c06a85725d84a5f53e24326e81a83cd4`** — which was not registered in Firebase. Play Services rejected the call with `DEVELOPER_ERROR` before it ever reached Firebase Auth, and the app rendered that as "Could not sign in. Please try again." Fixed by `firebase apps:android:sha:create` on app `1:647810616435:android:a6f4c5f9e200b3332c2e06`. **The trap: this is invisible to every build you test locally**, because those carry the upload key (`3ce15e38…`), which *was* registered — it breaks only for people who install from the store. It looked like a per-user bug for a day: one tester failed, another had "succeeded", but that second account was created 2026-08-01, a day before any AAB existed on Play, so he was never on a Play-signed build at all. **Whenever the signing key changes — key rotation, a new upload key, a second app — re-check `firebase apps:android:sha:list` against Play Console → Protected with Play → Play Store protection → Manage Play app signing** (the old "App integrity" page now just redirects there; the real URL is `.../app/<appId>/keymanagement`) |
| — | Play launch — **Google Sign-In broke a second time: the SHA-1 registered on 08-03 is not the key that signs the shipped APKs** | **FIXED 2026-08-05, server-side, no build — awaiting confirmation from a tester.** Sentry caught `DEVELOPER_ERROR` at `signInWithGoogle.picker` on 2026-08-05 03:00:17Z from a real Play split-APK install of **vc 6** (Samsung SM-S942U, Android 16, `is_split_apks: true`), **31.5 h after** the 08-03 SHA fix (audit log: `CreateShaCertificate` at 2026-08-03T19:32:13Z), so propagation delay is ruled out. The tester fell back to a password login 2 min later (Firebase Auth, 03:02:15Z), and **no `google.com` account has ever been created or signed in from a Play install** — the last Google sign-in anywhere is 2026-08-01, a day before the first AAB existed. **Cause, established from the `androidpublisher` API rather than inferred**: `GET applications/fit.ignia.app/generatedApks/6` returns exactly ONE signing-key group, `certificateSha256Hash = 37:5D:D3:E6:…:70:FE` — and that hash is **not** the app signing key the console shows as *In use* (`72:E8:39…` / SHA-1 `8261e9d8…`, the one registered on 08-03). It is the **Previous app signing keys** row, first used 1 Aug 2026 01:14, SHA-1 **`1483ddc326f972896e03d8db45ba4edd1d621da4`**. The console's own **Digital Asset Links JSON** snippet on the same page names `37:5D:D3:E6…` as the app's cert, confirming it. In other words the Play app signing key was **changed after vc 4/vc 6 were generated** (the *In use* key shows 0.0% install base), so the fingerprint the console shows first is the one that will sign the NEXT release, while every binary a tester can install today is signed by the previous one. Registering `8261e9d8…` on 08-03 was therefore a no-op for the installed app. **Registered 2026-08-05:** `1483ddc326f972896e03d8db45ba4edd1d621da4` (→ OAuth client `…h4j12fvoic0d3…`) — **this is the fix** — plus, forward-looking, the post-quantum cert `1106505210026f5c9c7fbba13c2b058375910ff4` (→ `…vearntjrg4dkj7…`), since Play App Signing here is enrolled in **Quantum-ready (beta)** and [Google's guidance](https://support.google.com/googleplay/android-developer/answer/9842756) is to register the classical, PQC, and older-device fingerprints with every API provider. All five confirmed in `firebase apps:sdkconfig ANDROID`. **Do not diagnose this from the App signing page alone**: its fingerprints sit behind copy-to-clipboard chips (not selectable text, absent from the DOM), the *Previous* key's SHA-1 hides behind the row's ⋮ menu, and the page gives no hint which key signs an existing release. **Ask the API which cert ships, per versionCode** | `node scratch: GET androidpublisher …/generatedApks/<vc>` → `certificateSha256Hash` must match a registered cert; and `npx firebase apps:android:sha:list 1:647810616435:android:a6f4c5f9e200b3332c2e06 --project fitness-tracker-gb-1775407101` must list **5** hashes |
| — | Play launch — **tester feedback URL** | **DONE — saved on the track, nothing pending.** Verified in the console 2026-08-05: the Testers tab holds `https://ignia.fit/support` with Save greyed out, and Publishing overview lists no changes awaiting review. Previously: **Saved but NOT submitted.** `https://ignia.fit/support` (same page the App Store listing uses) is staged on the closed track as "Change feedback channel", showing under *Changes not yet submitted for review*. Held back deliberately: the app's first review was already in flight, and whether a second submission joins that review or restarts it is not established. Submit it after approval — one click on **Submit 1 change for review** |
| — | Play launch — **12 testers × 14 consecutive days** | **owner, and this is now the only thing left.** **THE 12-TESTER REQUIREMENT IS MET — Google ticked it itself, verified on the app Dashboard 2026-08-06.** The *Apply for access to production* checklist now reads: ~~Publish a closed testing release~~ ✓ · ~~Have at least 12 testers opted-in to your closed test~~ ✓ · **Run your closed test with at least 12 testers, for at least 14 days** ← the only unticked item. *Apply for production* is still greyed out. The twelfth was `gabyfi0311@gmail.com` (Gabriel Figueroa), added 2026-08-06; he already had an Ignia account from the web (Firebase Auth, 2026-04-13), which is not itself evidence of an Android opt-in. **Do not compute the apply date by hand and do not trust one written here** — Google owns the 14-day clock and will tick the third box; the count is no longer the thing to watch, that box is. Naively it lands ~2026-08-20 (14 days from the twelfth opt-in), and it slips if anyone drops below 12 in the meantime, which is precisely why the checklist and not a calendar is the source. The prior reading was **11 currently opted-in** (Dashboard, 2026-08-05 ~20:40Z; it was 8 that morning), so this moved 8 → 11 → 12 in about 36 hours. Earlier the same day the email list `Ignia Beta Testers` held 10 of 12 invited — three of those accepted during the day, so the invited list itself now needs at least one more name. **Play reports the count and nothing else**: there is no per-tester opt-in status in the console, and none in the `androidpublisher` API either (`edits/{id}/testers/{track}` returns `{}` for all three tracks — email lists and opt-in state are simply not exposed). The only per-person evidence available is a Firebase Auth account, which proves *sign-in*, a strictly later step than opt-in. **Invited ≠ opted-in**: only the second number moves the checklist, and it is the one on the app Dashboard under *Apply for access to production*. **Recruit the remaining testers in one batch** — the group is gated by the last person through the door, so a straggler pushes the earliest apply date out by however late they join. **Tell testers that uninstalling the app is NOT the same as opting out**: opting out is an explicit *Leave the program* action on the opt-in URL or the app's Play listing, and only that resets their 14 days ([tester-side doc](https://support.google.com/googleplay/answer/15654751)). Uninstalling leaves the opt-in intact — but it also leaves no engagement, and Google asks what testers actually did with the app when you apply. **Opt in, install and sign in are three separate steps** and only the first moves the counter — `narvaezheydie@gmail.com` opted in on 2026-08-05 and still had no Firebase account afterwards, so she was counted while never having opened the app. **Measured engagement, 2026-08-05 20:40Z** (Firebase Auth × per-user Firestore subcollection counts, not a dashboard): of the four accounts created that day, `emmanuelpagan.16@` has 5 dailyLogs + 1 custom food + a workout session + sleep, `kcruz423@` has 7 dailyLogs + 3 custom foods, `christian.alicea24@` has a weight and a workout session, and `ignia@crna.casa` (Matt Salinas, password sign-up 20:26Z) finished onboarding in 74 s with nothing logged yet. `benrupr@` and `juanllanos13@` have accounts and zero rows. So roughly half of the people who sign in actually log something on day one — thin, but not the empty test the opt-in counter alone would suggest. Re-run that check before answering Google's "what did your testers do" questions. **A tester sent the link over WhatsApp will usually open it in WhatsApp's in-app browser, which does not share Chrome's Google session and shows "App not available" no matter what the list says** — tell them to open it in Chrome, signed in as the invited address. That, plus the propagation delay after an address is added (she was told to try 12 minutes later, and it failed), accounts for every "I'm not on the list" report so far. The build is **approved and live** — the opt-in link `https://play.google.com/apps/testing/fit.ignia.app` works for listed testers today. Personal account, so production access is gated on 12 testers staying opted in 14 CONTINUOUS days |
| — | Play launch — **Data safety form** | **DONE** (2026-08-01, filled directly in the console). Declares Personal info (Name, Email, User IDs) + Health and fitness (Health info, Fitness info); collected, **not shared**, required, App functionality + Account management. Nothing else. The saved draft had over-declared Photos, Crash logs, Device IDs, User-generated content and Other personal info — all cleared, each checked against the Android app (no analytics/crash SDK, no push token, photo-scan flag-off, RevenueCat is iOS-gated so it never configures on Android). CSV import was tried twice and failed with a generic "Couldn't upload"; the console UI worked |
| — | Play launch — **Advertising ID declaration** | **DONE** — declared **No**. App content now reads "You're all caught up" |
| — | Play launch — **delete-account URL** | **DONE and LIVE.** Verified 2026-08-01 and it *failed* — signed out, the page said only "sign in first to delete your account". `fb7d24d1` adds an unconditional "How to delete your account" section (iOS path, web path, and an email path for users who can't sign in) plus what is erased vs. what survives in backups, both locales. Deployed to `ignia.fit/privacy` and confirmed in a browser |
| — | Play launch — **store listing graphics** | **DONE.** `scripts/play-store-assets.mjs` generates all of them from artwork already in the repo → `store-assets/play/`. Play needs 16:9 or 9:16 and the captures are 1:2.17, so each is fitted onto a 1080×1920 canvas in the brand panel colour (the art already sits on that colour, so the letterboxing is invisible). Icon 512², feature graphic 1024×500, five phone screenshots — all uploaded and saved |

**Apple glanceable surfaces (map #31).** 14 of its 16 tickets are **closed** —
transport, staleness, layouts, tap targets, review surface and sign-out privacy
were decided first, and the on-device widget verification closed 2026-08-03. What remains is
**#46 alone — the layout readout, which needs a simulator.** The compile gate
closed on an EAS build: an EAS iOS build IS macOS running Xcode, so the compile half never
needed the borrowed machine and the map is down to one hardware-gated item.

The building is done. `apps/mobile/targets/` now holds `_shared`, `widget`,
`watch` and `watch-widget`, plus `apps/mobile/modules/watch-link` for the phone
half of the transport. **What is unproven is narrow and specific: none of that
Swift has ever been through a compiler.** Do not read "written" as "works" — the
iPhone widget was written, merged, and silently broken for two builds because a
pod never linked.

**The credentials gate is real and is not the Mac.** The scheme gains **two new
bundle ids** (`fit.ignia.app.watchkitapp` and
`fit.ignia.app.watchkitapp.complication`), neither of which exists in the Apple
portal. §3 already records that EAS cannot mint those unattended — it refuses in
non-interactive mode, and the failing call is a Developer Portal write where EAS
falls back to Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA, which no
ASC API key covers. `production` still has not had its interactive pass; this
adds two more ids to it. Credential failures cost **no build quota** — they
happen before the build is created.

## 5. Decided and deliberately not happening

Do not re-propose these without new information; the reasoning is in the linked ADR
or research note.

- **Pro tier / IAP / Stripe** — dormant, flag-gated off. v1 is free. (ADR-0015)
- **AI photo-scan** — deferred to a paid tier; runtime cost gate. (ADR-0015)
- **App Intents / Siri Shortcuts** — decided **no** for this batch, 2026-07-23.
- **Watch app reading Firestore directly** — structurally unavailable; no watchOS
  Firestore client. (`docs/research/watch-complication-transport.md`)
- **Activity feeding measured-mode TDEE** — would double-count. Formula mode only.
- **Shared subscription cache in mobile** — per-hook subscriptions are intentional.
  (ADR-0016)
- **A 4th scheduled Cloud Function** — Cloud Scheduler's free 3 jobs are spent; fold
  into `hourly-tasks.ts`.

## 6. App Store submission — standing rules

Carried over from the two 1.0 rejections. These are permanent, not a checklist to
do once.

- **Accounts are Individual, not an entity** — Apple Developer Individual ($99/yr,
  no D-U-N-S) and Play Individual ($25 one-time), decided 2026-07-07 after dropping
  the Wyoming-LLC plan. The owner's legal name shows publicly as seller. Known
  accepted risk: guideline 5.1.1(ix) prefers a legal entity for health apps that
  touch HealthKit; enforcement is inconsistent and a reviewer *can* raise it.
- **Always hand Apple `review@ignia.fit`** in the Demo Account fields — it is
  pre-verified and seeded. A fresh account is walled out by the email-verification
  gate, and 2.1 demo-account failures are Apple's largest rejection bucket. Never
  point them at `demo@ignia.fit` (screenshots only). Confirm it can still write
  before submitting.
- **Notes for Review must name the specific changes.** Generic text gets rejected
  under 2.3.1.
- **`supportsTablet` stays `false`.** Apple reviews on iPad anyway (that is how the
  1.0 layout clipping surfaced), but flipping it true obliges an iPad design pass
  *and* iPad screenshots — more rejection surface, not less.
- **Keep `NSPhotoLibraryUsageDescription`** even though photo-scan is unreachable:
  `expo-image-picker` is still linked, and a *missing* purpose string is an
  automated ITMS-90683 rejection. An extra one is never punished.
- **Privacy labels must match reality** — health data + email, no Photos.

## 7. Commands that answer questions faster than reading

**The emulator suites (`test:ledger`, `test:rules`) need JDK 21+.** `firebase-tools`
dropped Java <21, and this machine's PATH `java` is 17, so both suites fail with
`firebase-tools no longer supports Java version before 21` — a toolchain error that
reads like a broken test. JDK 21 **is** installed; just point at it first.

**`scripts/require-java21.mjs` now runs ahead of both suites and prints this fix
when PATH java is too old** — added 2026-08-09 because this note was still
missed, and the miss produced a written claim that the rules suite "cannot run
on this machine" plus a wrong test count. It only warns; it never picks a JDK,
because a hardcoded install path in committed config works on one machine and
lies on every other. The suites are **260 tests across 10 files** (`test:rules`
runs every functions spec, not only `firestore-rules.spec.ts`, which is 47 of
them):

```sh
export PATH="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin:$PATH"
```

Run the two suites **separately**, not back to back — the second one inherits the
first's emulator port before it is released and reports a phantom failed file.


```sh
npm start                  # web dev (emulators: npm run dev)
npm test                   # web unit tests
npm --prefix packages/core test
cd apps/mobile && npx expo start

# Android release APK on Windows (free, unlimited).
# `bundleRelease` does NOT work here — ninja's 260-char cap, see §4. AABs: EAS.
cd apps/mobile && npx expo prebuild -p android --no-install
cd android && ./gradlew.bat assembleRelease --no-daemon \
  -Pandroid.injected.signing.store.file=<abs path to credentials/dev.keystore> ...
```

**`npx expo prebuild -p ios` does NOT work on Windows** — SDK 54 skips it outright
(`Skipping generating the iOS native project files. Run npx expo prebuild again
from macOS or Linux`, then exits non-zero). An earlier version of this file claimed
it ran here and proved the Xcode project generates; it does not, and there is no
local way to inspect the generated Podfile or verify iOS autolinking. That is why
the widget's missing native module could only be caught by shipping a build and
reading a runtime probe.

## 8. Where things live (and what gets deleted)

| Question | File |
|---|---|
| What is this repo, how do I work in it | `CLAUDE.md` |
| What does this word mean | `CONTEXT.md` |
| **What is true right now** | **this file** |
| Why is it built this way | `docs/adr/` |
| What shipped, when | `CHANGELOG.md` (+ `CHANGELOG-archive.md`) |
| What did we research | `docs/research/` — each file opens with its verdict |
| What's still wrong in the UX | `UX_AUDIT.md` |
| Store listing field values | `docs/app-store-metadata.md` |
| Machine-local credential paths | `CLAUDE.local.md` (git-ignored) |

**The rule that keeps this from happening again: a plan document is deleted the day
its work ships.** Its outcome belongs in `CHANGELOG.md`, its reasoning in an ADR, its
current state here. Git keeps the original forever; `git log --diff-filter=D
--name-only` finds it. Never leave a shipped plan in the tree with a "CORRECTION"
block on top — that is how a status doc and a wish list become indistinguishable.
