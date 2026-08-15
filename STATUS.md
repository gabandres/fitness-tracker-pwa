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
| **Public App Store (iOS)** | **1.1.0 / build 24**, `READY_FOR_SALE`. Missing everything since 2026-08-08: dictation, the redesigned Add screen, the fasting Live Activity, the wide widget, every TDEE correction, and the verification-email fix |
| **App Review (iOS)** | **1.2.0 / build 55**, `WAITING_FOR_REVIEW` since 2026-08-15, **`releaseType: AFTER_APPROVAL` — it self-publishes on approval, with no human step** |
| **TestFlight** | build **53** external (1.2.0) + the 08-14 OTA. Builds 54/55 are internal-only and code-identical to 53 under OTA |
| **Play alpha** | **vc 30** (1.2.0) + the 08-14 OTA |
| **Play production** | not launched — gated on Google's 14-day checklist (§3) |
| **Web PWA `ignia.fit`** | Live, bilingual (EN + es-PR), 105 prerendered pages (en 52 / es 53), 114-URL sitemap. **Frozen for logging features** (ADR-0022); the shell keeps shipping |
| **Cloud Functions / rules** | Deployed, project `fitness-tracker-gb-1775407101` |
| **Photo-scan** | **ON and free to everyone, both platforms** (ADR-0017), resolving macros against the bundled USDA database (ADR-0019). Tiering is server-side only: `dailyQuota` 3/day free · 30/day paid, plus the `photo` `spendCeiling` |
| **Food search** | Bundled USDA DB, 13,272 foods, no network call (ADR-0018). Open Food Facts still serves branded + barcode |
| **OTA (EAS Update)** | Live. `runtimeVersion: {"policy":"fingerprint"}`, channels match build profiles. Free tier 1,000 MAU |
| **`app-version.json`** | android `30` (derived from Play by `scripts/app-version-sync.mjs`; `npm run doctor` fails on drift), ios `0`… see below |

**Two live facts that are easy to get wrong:**

- **`app-version.json` holds `ios.latestBuild: 24`, and the iOS prompt is
  effectively pinned to the store build on purpose.** It must name the live *App
  Store* build, never a TestFlight one — TestFlight runs ahead, and pointing a
  store user at a build they cannot install is worse than saying nothing. It
  needs a bump to 55 when 1.2.0 goes live, plus a `firebase deploy --only
  hosting`, or the corrected file reaches nobody.
- **The EAS Update fingerprint is machine-dependent — publish from `ignia-mac`,
  never from Windows.** The same commit fingerprints differently on the two
  machines (a Windows-only prebuild dir, CRLF-vs-LF, divergent `node_modules`).
  Every binary is built on the Mac, so the Mac's value is the one they carry.
  Three OTAs once published under Windows numbers and reached **nobody** — a
  failure indistinguishable from a working update.

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

- **The verification-email fix on mobile** (`86183368`, 2026-08-15). On `main`,
  in **no binary**, **not** OTA'd. Held on purpose: it is JS-only, so an
  `eas update` would land on runtime `886bf0b3…` — the binary Apple is reviewing
  — and perturbing a build under review buys nothing, because the only people it
  reaches are testers who already have accounts. **Publish it once 1.2.0 is
  approved**, from `ignia-mac`, gate first. Until then a new signup on the phone
  still gets its confirmation mail from `firebaseapp.com`.

## 3. Open work, and what each is blocked on

| Work | Blocked on |
|---|---|
| **Watch complication + Siri quick-add behaviour** | **UNVERIFIED on hardware.** ADR-0023 established that `transferCurrentComplicationUserInfo` cannot wake a **WidgetKit** complication (Apple FB12926788, open since 2023) — real-time delivery to the wrist is not achievable on this surface, and that is a requirement change, not a bug. What ships instead is an hourly pull. Nobody has watched a face move after a meal logged outside the app. Read *Settings → Apple Watch* on a device before writing any more code here |
| **Android widget on a real home screen** | Nobody has placed one. The task handler registers through the custom `index.js`, a path no device has exercised. **Maestro cannot close this** — no `adb` command places a home-screen widget (the Quick Settings tile *is* drivable via `adb shell cmd statusbar click-tile`). 1 of 21 checkboxes in `apps/mobile/WIDGET.md` is ticked. The iOS half is done and verified on a physical iPhone |
| **#46 — watch layouts at 40mm/46mm, both locales** | A Mac with Xcode running a simulator. Its precondition (the real layouts exist) is met; this is the readout it was designed to be. It is the **last open item** of the 16-ticket Apple glanceable-surfaces map |
| **Play production access** | **Owner + Google's clock.** The 12-tester requirement is MET; the only unticked box on the app Dashboard is *Run your closed test with at least 12 testers, for at least 14 days*. **Do not compute the apply date by hand** — Google owns the clock and ticks the box; naively ~2026-08-20, and it slips if anyone drops below 12. Play exposes no per-tester data at all, in the console or the API. Tell testers **uninstalling is not opting out** (that is an explicit *Leave the program* action), and that opt-in, install and sign-in are three separate steps — only the first moves the counter |
| **App Store screenshots** | Owner, on device (`store-assets/README.md`) |
| **Photo-scan validation gate** | 30–50 real photos, judging the **item list and portions** — never the macros. Harness: `scripts/validate-photo-itemiser.mjs` (ADR-0015 §2) |
| **`13-e2e-delete` on iOS** | Row tap does not open the editor. Deliberately left red; diagnosis notes in the Maestro suite README. The fresh-account arc has never been run, and the mic's listening state can only close on hardware |
| **Web retirement question** | **A measurement, not intuition** (ADR-0022): `node scripts/usage-report.mjs --days 30`, reading `platforms`. May not be revisited before that data exists |

**`ignia-mac` disk is the recurring constraint.** It was at 6.4 GB on 2026-08-14
against a 17 GB floor for iOS; `~/.gradle` (5.9 GB) was deleted to buy the build,
so **the next Android build there re-downloads the whole Gradle cache** — expect
the cold figure (~10m36s), not the incremental one. The remaining ~199 GB is the
machine owner's personal data and is not ours to reclaim, so the Mac holds
roughly one platform's build caches at a time. `df -h /` reads the sealed System
snapshot and lies; use `/System/Volumes/Data`.

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
