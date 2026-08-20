# STATUS — what is true right now

**Updated:** 2026-08-19 · **Owns:** current state only. Not history
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
| **TestFlight** | **build 60 / 1.2.1** (SDK 57, runtime `7b347b0f…`), `VALID` 2026-08-19, internal group *Team (Expo)* — **not yet released to the external Public Beta Testers group**. Builds 57/58 remain, both stamped `1.2.0`. 1.2.1 exists because 55/57/58 all share the `1.2.0` version string and an App Store version only accepts builds whose string matches, so none could be promoted. **Rings fix is UNVERIFIED on device** — that confirmation gates the App Store submission. `eas submit` hung at `- Submitting` and exited 0; ingestion still took ~50 min, so poll ASC `/v1/builds`, never the CLI |
| **Play alpha** | **vc 37** (1.2.1), live on the track, confirmed from the **androidpublisher API** — runtime `ae526937…` read from the `.aab`, so the Android **OTA channel is OPEN**. It exists to undo the fingerprint cost of the ABI cut (see the OTA block below); behaviourally it is vc 36 plus nothing. **vc 36 is now an orphan runtime** — no OTA reaches it, and the update banner is what drains it. `eas submit` **failed and exited 0** on the first attempt (`This Edit has been deleted`, Play's edit expired mid-upload); the retry worked. **Behaviour UNVERIFIED** — re-run `18-train-template` first |
| **Play production** | not launched — gated on Google's 14-day checklist (§3) |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), 105 prerendered pages (en 52 / es 53), 114-URL sitemap. **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods. **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**. OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that: two of three probes came back throttled after paying full latency. Servings also ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU |
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
  were removed (13 → **19 GB free**, which is back over the iOS threshold).

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

Everything else that was in this section has shipped and is in `CHANGELOG.md`.

- **The mobile timezone self-heal** (`145d8b88`, 2026-08-17). `ensureProfile`
  now writes `timezoneOffsetMin` on every cold start; nothing in the mobile app
  had ever written it, so mobile-only digest opt-ins were computed **and sent**
  as UTC (06:00 in Puerto Rico, not 10:00 local). The server half shipped the
  same day and is live. The client half has now reached **TestFlight build 60**
  and **Play alpha vc 37** over the air. It has NOT reached public iOS: they
  are on build 55 (`886bf0b3…`), a runtime no OTA from `main` can address, so
  1.2.1's approval is what delivers it.

## 3. Open work, and what each is blocked on

| Work | Blocked on |
|---|---|
| **Expo SDK 57 — shipped to BOTH stores' test tracks, merged, NOT device-tested** | **Device QA. That is the only thing left.** The app moved 54 → 57 (RN 0.86.2, React 19.2), merged to `main`, and is live as **Play alpha vc 32** and **TestFlight build 57 (external)**. Green everywhere it can be: `tsc`, 26/26 jest suites, the Metro gate, all four buildable units, `expo-doctor` 20/21, artifact verifier 0 on both binaries. **Nobody has run either one on a device.** The checks that matter and cannot be automated: **Google Sign-In on a Play install** (broken twice here, structurally invisible locally) and a normal log/read pass on each tab, both platforms |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone |
| **#46 — watch layouts at 40mm/46mm, both locales** | A Mac with Xcode running a simulator. Its precondition (the real layouts exist) is met; this is the readout it was designed to be. It is the **last open item** of the 16-ticket Apple glanceable-surfaces map |
| **Play production access** | **Owner + Google's clock.** The 12-tester requirement is MET; the only unticked box on the app Dashboard is *Run your closed test with at least 12 testers, for at least 14 days*. **Do not compute the apply date by hand** — Google owns the clock and ticks the box; naively ~2026-08-20, and it slips if anyone drops below 12. Play exposes no per-tester data at all, in the console or the API. Tell testers **uninstalling is not opting out** (that is an explicit *Leave the program* action), and that opt-in, install and sign-in are three separate steps — only the first moves the counter |
| **Public iOS (build 55) cannot receive the TDEE fixes over the air** | **Apple's review queue, and that is the right answer.** Live App Store is 1.2.0 / build 55, runtime `886bf0b3…`; the tree is `7b347b0f…` (build 60), so no OTA from `main` reaches public users. It *is* technically reachable — `packages/core` is not a fingerprint source, so tonight's JS could be cherry-picked onto the pre-SDK-57 commit `9c8a4b63` and published under `886bf0b3…`. **Rejected**: it requires swapping `ignia-mac` to SDK 54 `node_modules` (the fingerprint hashes `expoAutolinkingConfig` and `package:react-native`), and it would push a bundle built from a tree that exists nowhere in git, never compiled and never device-tested, to 100% of public iOS users. 1.2.1/build 60 supersedes build 55 within days and already carries every fix via OTA. **NEVER use `EXPO_UPDATES_FINGERPRINT_OVERRIDE` to force it** — that would run SDK 57 JS on an SDK 54 native runtime and reach everyone before it broke them |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`) |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **Android device QA — a host now exists, and it found three failures** | **Triage, not tooling.** The blocker is gone: an **LG VS988 (LG G6)** runs the suite over adb from the Windows box (the ARM emulator situation is unchanged and irrelevant now). It is **Android 9 / API 28**, not the "Android 8.0 / API 26" this file claimed until 2026-08-19 — two levels above `minSdk` 26, so a pass here does NOT prove the floor. First run 2026-08-19 against Play-signed **vc 34** (**vc 35 now supersedes it — re-run the suite against that**): `android-smoke` green, email/password sign-in green, suite **14 of 17**. Open: **`06-scan-intro`** ("Scan meal" not found), **`15-search`** ("banana raw" not found), **`18-train-template`** (`template-set-kind-0-0` missing — **vc 35 carries the fix; this is the first flow to re-run**). **Google Sign-In fails with `ApiException: INTERNAL_ERROR` (8)** — NOT `DEVELOPER_ERROR`; the signing cert of vc 34 (`1483ddc3…`, the *previous* Play key — Play still has not rotated), its OAuth Android client, the `webClientId`, the clock and the network were each verified good, and the failure happens inside Google's own picker activity. Sentry count=1, i.e. only the reproduction — no user has hit it. Cold start **6.6s**; the brand-loader wait in `01-today` sits right on its 15s budget and flaked once. **The hero rings render AND animate correctly here** — the iOS ring bug is not cross-platform. QA account `qa-test@ignia.fit` (uid in `CLAUDE.local.md`). `coverage.md` Android rows updated 2026-08-19 **The LG G6 stalls and needs a power cycle before the next run** (owner-reported 2026-08-20) — reboot it, re-check `adb devices`, and remember a *phantom* `PID_633A` means USB debugging is off rather than a driver fault (`CLAUDE.local.md`). Re-run against **vc 37** |
| **The website is invisible to Google** | **A decision, not a task.** Measured 2026-08-17: 110 of 114 sitemap URLs are *unknown to Google*, the sitemap has never been downloaded, and 90 days of Search Console show 4 impressions and 0 clicks. Cause is structural — "prerendered" writes the `<head>` only, so a first-pass crawler sees `<app-root></app-root>`, and `routerLink` appears in zero files so there is no link graph to crawl either. Fixing it means real prerendering + crawlable anchors; neither is scoped. Full evidence in `docs/seo-status.md` |
| **Web retirement question** | **A measurement, not intuition** (ADR-0022): `node scripts/usage-report.mjs --days 30`, reading `platforms`. May not be revisited before that data exists |
| **Transfer of operations to Bermudez Systems LLC (WY)** | **Owner console steps, in this order**: ① ~~EIN~~ **DONE 2026-08-19** (number + CP 575 location in `CLAUDE.local.md`) → ② ~~D-U-N-S~~ **DONE 2026-08-19** — Apple issued it same-day (number in `CLAUDE.local.md`) → ③ Apple Developer individual→organization **conversion** of the existing team — NEVER a fresh org enrollment, which strands the app on the old team (support request; Team ID/apps/reviews survive, seller name changes) → ④ ~~deactivate the 3 `fit.ignia.tip.*` consumables in ASC~~ **DONE** — all three read `DEVELOPER_REMOVED_FROM_SALE` from the ASC API 2026-08-19 (`inAppPurchasesV2`); that state is reversible, so re-enabling tips is a flip, not a re-create → ⑤ ~~LLC bank account~~ **DONE 2026-08-19 — Relay approved** (details in `CLAUDE.local.md`) → ⑥ ~~new Play org account ($25)~~ **DONE** and ~~Google org verification~~ **GREEN as of 2026-08-20 (owner-reported)** — identity docs cleared, website already verified. **⑦ THE APP TRANSFER IS NOW THE LIVE ACTION and nothing else blocks it.** File Play Console → app transfer; every field value it asks for is already recorded in `CLAUDE.local.md` (both developer account IDs and both original $25 transaction IDs — **strip the `PDS.` prefix on the form**). Org accounts are exempt from the 12-tester/14-day production gate, so completing this also removes the Play production blocker above. Separate Google deadline found 2026-08-19: **all Play apps + signing keys must complete "Android developer verification" by Sep 30, 2026** — after the transfer that is the ORG account's task for `fit.ignia.app`; do NOT assume the personal account's Jul-8 identity check carries over. **Donation intake stays paused** (`FEATURES.tips=false` both platforms, `/tip`→`/support`) until payouts land in the LLC's bank account; do NOT re-enable tips or ship Pro before then. PR foreign registration deliberately skipped: zero revenue + interstate-commerce exemptions; worst case is back-fees, not veil loss |

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
