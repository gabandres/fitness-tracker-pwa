# STATUS — what is true right now

**Updated:** 2026-08-15 · **Owns:** current state only. Not history
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
| **Play alpha** | **vc 35** (1.2.1) — carries the template-editor scroll fix, the hero-ring rework and `FEATURES.tips=false` embedded. Live on the track, confirmed from the **androidpublisher API**; `eas submit` sat on `- Submitting` and never said so. It also **reopens the Android OTA channel** (`ae526937…`), shut since the 1.2.1 bump moved the tree off vc 34. **Behaviour UNVERIFIED** — re-run `18-train-template` first, since vc 35 fixes the bug it dies on |
| **Play production** | not launched — gated on Google's 14-day checklist (§3) |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), 105 prerendered pages (en 52 / es 53), 114-URL sitemap. **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods. **Text search makes NO network call at all as of 2026-08-19** — Open Food Facts was removed from it and now serves **barcode only**. OFF caps search at 10 req/min against 100/min for barcode GETs, and typeahead behind one shared egress IP could not live in that: two of three probes came back throttled after paying full latency. Servings also ship with each hit, so tapping a result makes no `getFoodDetail` call. Branded **text** results are the cost; `docs/research/off-branded-ingest.md` scopes getting them back |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU |
| **`app-version.json`** | android `35`, ios `55` — synced and **deployed** 2026-08-19. **Both derived** by `scripts/app-version-sync.mjs`; `npm run doctor` fails on drift in either direction |

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

  **No Android OTA currently reaches ANY shipped binary, and that is expected.**
  The fleet spans vc 30 `6519916…`, vc 31 `3d3bc410…`, vc 32 `d8741525…` and
  vc 33 `c1c010ac…`; the tree now reads `641cf5d4…` because the Gradle memory
  fixes edited `plugins/withGradleJvmArgs.js`, which is hashed. **The next
  Android JS fix needs a build, not an update** — vc 34 will re-open the channel.
  vc 32 is additionally an orphan: its hash is only reproducible from a CRLF
  worktree, a state `.gitattributes` removes. The banner
  (`app-version.json` = 33, deployed) is what drains the older cohorts. Do not
  publish from the Mac to "cover" an older one; the guard blocks it.

  **iOS was in the same state, and this claim used to say otherwise.** Measured
  2026-08-18: the tree gates at `b3c50e91…` while build 57 ships `25e953e9…`,
  read out of the `.ipa`. The cause is the same `withGradleJvmArgs.js` change
  that shut Android's channel — an Android-only plugin, but the plugins array is
  hashed as part of `app.json`, so it moved BOTH. That consequence was written
  down for Android only, and this line read "healthy" for a day while the iOS
  channel was shut.

  **Closed by build 58** (2026-08-18, 1.2.0, verifier green, `b3c50e91…` = the
  gate) — **on TestFlight and `VALID`**, uploaded 11:37:45-07:00. It is built
  from the current tree, so a JS fix can reach it over the air, and it carries
  the two layout bugs the Maestro sweep found. The submit needed two attempts:
  the first hung at `- Submitting` for 1h35m and **exited 0 when killed**, so
  treat only an ASC `/v1/builds` read as proof (`AGENTS.md`, build 58 row).
  Apple is still reviewing build 55 on `886bf0b3…`, a third runtime, and that
  submission is deliberately untouched — swapping its build forfeits the queue
  position.

  **BOTH channels are open again as of 2026-08-18, and the Train template
  rebuild has shipped on both.**

  - **iOS: OTA on build 58**, update group `66e6f663-…`, runtime `b3c50e91…` —
    the same fingerprint build 58 ships, which is why no binary was needed.
    `react-native-sortables` (drag-to-reorder) is pure JS and autolinks no
    native module, so it did **not** move the hash. **Build 58 is now with
    Public Beta Testers** (the group's newest was 57), so they get the update on
    the launch after installing it.
  - **Android: vc 34** on the Play alpha track, fingerprint `b6f97259…` read
    from the `.aab`. Android could NOT take the OTA — the gate refused it, tree
    `b6f97259…` against vc 33's `c1c010ac…`, exactly as this section predicted —
    so the binary is what reopens it. `app-version.json` = 34 and hosting is
    deployed, so the update banner fires.

  **Device QA now exists for iOS and only iOS**: the Maestro suite ran 17/17
  against an SDK 57 Release build (73 captures), and the drag library was
  separately confirmed to mount before the OTA went out. **Android behaviour
  remains unverified on any SDK 57 binary** — there is still no Android host for
  the suite, and Google Sign-In on a Play-signed install is the check that has
  broken twice and that nothing here can make.

  **vc 32 has had NO device QA, and it is the riskiest binary yet shipped here** —
  a three-SDK jump (54 → 57, RN 0.81.5 → 0.86.2), built from a branch that is not
  on `main`, on a toolchain where CMake declines to guarantee object placement
  (`CMAKE_OBJECT_PATH_MAX`). vc 31 was never device-QA'd either. **The check that
  matters most is Google Sign-In on a Play install** — broken twice here,
  structurally invisible on a local build. The cert `375dd3e6…` is registered
  (`npm run doctor`), so it is *expected* to pass; nobody has watched it.

  **This lands during the Play production 14-day window** (§3), whose only
  unticked box is 12 testers for 14 days, naively ~2026-08-20. A crash-on-launch
  here costs testers, and testers dropping below 12 slips that date. If anything
  is wrong, the fastest remedy is a new alpha release of vc 31's tree, **not** an
  OTA — no OTA reaches vc 32's predecessors.

### The measurement that should shape the next decision

**The junk-mail verification bug was eating roughly half of password sign-ups.**
Measured 2026-08-15: 33 accounts created in 45 days; 12 (36%) ever wrote a single
row. Narrowing to accounts the bug could touch: **17 password sign-ups, 8 of
which never verified their email — and all 8 logged zero meals.** Google/Apple
sign-ups arrive pre-verified and are unaffected. `firestore.rules` blocks every
write until `email_verified`, so an unverified account is a walled account.

Both halves are now fixed (Resend sender alignment, and `sendVerificationEmail`
replacing Firebase's own `firebaseapp.com` mail). **But the fix is not in the
live App Store binary** — web and Android have it; iOS gets it only when 1.2.0 is
approved. **So driving iOS traffic before 1.2.0 is live sends new users into the
same wall this measured.**

Auth → custom SMTP is **not available on this project**: every write to
`notification.sendEmail` returns `400 EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` because
`enableImprovedEmailPrivacy` is on. **Do not turn that off to unlock it** — it is
also why `fetchSignInMethodsForEmail` returns `[]` unconditionally, so never
write logic that branches on its result.

## 2. Merged, on `main`, and not delivered anywhere

Everything else that was in this section has shipped and is in `CHANGELOG.md`.

- **The verification-email fix, iOS OTA only** (`86183368`, 2026-08-15).
  Everything else about this fix has shipped — the **server half is deployed**
  (it is a Cloud Function, so it needs no client release), **web is live**, and
  **Android alpha has it** as an OTA published 2026-08-15 onto runtime
  `6519916642…` (= vc 30). **iOS build 55 carries it embedded** and is the
  binary in review.

  What is held is the **iOS OTA**, and it is held for one narrow reason: it
  would land on runtime `886bf0b3…`, which is the binary Apple is reviewing.
  Its only beneficiaries are TestFlight testers on build 53, who already have
  accounts, so it buys nothing and perturbs a live submission.

  **It can no longer be published from `main`.** SDK 57 merged on 2026-08-17 and
  moved the iOS fingerprint off `886bf0b3…`, so an OTA cut from `main` reaches
  none of builds 50–55. If it is still wanted after 1.2.0 approves, publish it
  from the **pre-SDK-57 commit `9c8a4b6`**, on `ignia-mac`, gating first — or
  skip it, since the next iOS binary carries the fix embedded anyway.

  **It is NOT the reason public iOS users lack the fix.** They are on build 24,
  a different runtime that has never been an OTA target, so no OTA can reach
  them — only the 1.2.0 release can.

- **The mobile timezone self-heal** (`145d8b88`, 2026-08-17). `ensureProfile`
  now writes `timezoneOffsetMin` on every cold start; nothing in the mobile app
  had ever written it, so mobile-only digest opt-ins were computed **and sent**
  as UTC (06:00 in Puerto Rico, not 10:00 local). The server half shipped the
  same day and is live. This client half reaches nobody until a build or an
  OTA, and the iOS OTA is the one held above.

## 3. Open work, and what each is blocked on

| Work | Blocked on |
|---|---|
| **Expo SDK 57 — shipped to BOTH stores' test tracks, merged, NOT device-tested** | **Device QA. That is the only thing left.** The app moved 54 → 57 (RN 0.86.2, React 19.2), merged to `main`, and is live as **Play alpha vc 32** and **TestFlight build 57 (external)**. Green everywhere it can be: `tsc`, 26/26 jest suites, the Metro gate, all four buildable units, `expo-doctor` 20/21, artifact verifier 0 on both binaries. **Nobody has run either one on a device.** The checks that matter and cannot be automated: **Google Sign-In on a Play install** (broken twice here, structurally invisible locally) and a normal log/read pass on each tab, both platforms |
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone |
| **#46 — watch layouts at 40mm/46mm, both locales** | A Mac with Xcode running a simulator. Its precondition (the real layouts exist) is met; this is the readout it was designed to be. It is the **last open item** of the 16-ticket Apple glanceable-surfaces map |
| **Play production access** | **Owner + Google's clock.** The 12-tester requirement is MET; the only unticked box on the app Dashboard is *Run your closed test with at least 12 testers, for at least 14 days*. **Do not compute the apply date by hand** — Google owns the clock and ticks the box; naively ~2026-08-20, and it slips if anyone drops below 12. Play exposes no per-tester data at all, in the console or the API. Tell testers **uninstalling is not opting out** (that is an explicit *Leave the program* action), and that opt-in, install and sign-in are three separate steps — only the first moves the counter |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`) |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **Android device QA — a host now exists, and it found three failures** | **Triage, not tooling.** The blocker is gone: an **LG VS988 (LG G6)** runs the suite over adb from the Windows box (the ARM emulator situation is unchanged and irrelevant now). It is **Android 9 / API 28**, not the "Android 8.0 / API 26" this file claimed until 2026-08-19 — two levels above `minSdk` 26, so a pass here does NOT prove the floor. First run 2026-08-19 against Play-signed **vc 34** (**vc 35 now supersedes it — re-run the suite against that**): `android-smoke` green, email/password sign-in green, suite **14 of 17**. Open: **`06-scan-intro`** ("Scan meal" not found), **`15-search`** ("banana raw" not found), **`18-train-template`** (`template-set-kind-0-0` missing — **vc 35 carries the fix; this is the first flow to re-run**). **Google Sign-In fails with `ApiException: INTERNAL_ERROR` (8)** — NOT `DEVELOPER_ERROR`; the signing cert of vc 34 (`1483ddc3…`, the *previous* Play key — Play still has not rotated), its OAuth Android client, the `webClientId`, the clock and the network were each verified good, and the failure happens inside Google's own picker activity. Sentry count=1, i.e. only the reproduction — no user has hit it. Cold start **6.6s**; the brand-loader wait in `01-today` sits right on its 15s budget and flaked once. **The hero rings render AND animate correctly here** — the iOS ring bug is not cross-platform. QA account `qa-test@ignia.fit` (uid in `CLAUDE.local.md`). `coverage.md` Android rows updated 2026-08-19 |
| **The website is invisible to Google** | **A decision, not a task.** Measured 2026-08-17: 110 of 114 sitemap URLs are *unknown to Google*, the sitemap has never been downloaded, and 90 days of Search Console show 4 impressions and 0 clicks. Cause is structural — "prerendered" writes the `<head>` only, so a first-pass crawler sees `<app-root></app-root>`, and `routerLink` appears in zero files so there is no link graph to crawl either. Fixing it means real prerendering + crawlable anchors; neither is scoped. Full evidence in `docs/seo-status.md` |
| **Web retirement question** | **A measurement, not intuition** (ADR-0022): `node scripts/usage-report.mjs --days 30`, reading `platforms`. May not be revisited before that data exists |
| **Transfer of operations to Bermudez Systems LLC (WY)** | **Owner console steps, in this order**: ① ~~EIN~~ **DONE 2026-08-19** (number + CP 575 location in `CLAUDE.local.md`) → ② ~~D-U-N-S~~ **DONE 2026-08-19** — Apple issued it same-day (number in `CLAUDE.local.md`) → ③ Apple Developer individual→organization **conversion** of the existing team — NEVER a fresh org enrollment, which strands the app on the old team (support request; Team ID/apps/reviews survive, seller name changes) → ④ ~~deactivate the 3 `fit.ignia.tip.*` consumables in ASC~~ **DONE** — all three read `DEVELOPER_REMOVED_FROM_SALE` from the ASC API 2026-08-19 (`inAppPurchasesV2`); that state is reversible, so re-enabling tips is a flip, not a re-create → ⑤ ~~LLC bank account~~ **DONE 2026-08-19 — Relay approved** (details in `CLAUDE.local.md`) → ⑥ new Play org account ($25) + app transfer — **IN PROGRESS since 2026-08-19** (owner un-deferred it same day): org signup under a NEW Google account on gabriel@bermudezsystems.com (one Google account = one Play developer account, so the personal Gmail cannot own both), then Google org verification (D-U-N-S 145071589 — brand-new, may take days to be visible), then the app-transfer form, which needs the ORIGINAL $25 transaction ID from the personal account (find it at pay.google.com). Org accounts are exempt from the 12-tester/14-day production gate. Separate Google deadline found in Gmail 2026-08-19: **all Play apps + signing keys must complete "Android developer verification" by Sep 30, 2026** or be removed — after the transfer this is the ORG account's task for `fit.ignia.app`, do not assume the personal account's Jul-8 identity verification covers it. **Donation intake is paused on all surfaces meanwhile** (`FEATURES.tips=false` both platforms, `/tip`→`/support`) so neither the owner nor the LLC earns anything while the owner is still a PR resident — that is what keeps PR foreign registration + a PR tax filing off the table before the move (~2 months out). Do NOT re-enable tips or ship the Pro tier until payouts land in the LLC's bank account. PR foreign registration deliberately skipped: zero revenue + interstate-commerce exemptions; worst case is back-fees, not veil loss |

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
