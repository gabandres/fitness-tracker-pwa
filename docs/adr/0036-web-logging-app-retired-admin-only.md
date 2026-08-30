# ADR-0036: The web logging app is retired; `ignia.fit` becomes a shell plus one admin page

- **Status:** **accepted** 2026-08-30 — supersedes decision 5 of
  [ADR-0022](0022-web-pwa-frozen-not-retired.md) (the "endgame is measured"
  clause) and closes the question ADR-0015 left open. Decisions 1–4 of 0022
  survive unchanged: mobile-first, `packages/core` for shared math, the shell
  keeps shipping.
- **Date:** 2026-08-30
- **Touches:** `src/**` (most of it deleted), `angular.json`, `firebase.json`,
  `ngsw-config.json` (deleted), `scripts/sentry-release.mjs`,
  `scripts/prerender-seo.mjs`, `.claude/hooks/guard_firebase_deploy.py`,
  `functions/src/password-reset.ts` and `verify-email.ts` (one default URL
  each). It deliberately touches **no** `firestore.rules`, **no** mobile code,
  and adds **no** secret and **no** scheduled job.

## Context

ADR-0022 froze the web logging surfaces on 2026-08-12 and refused to retire
them on intuition. It named the instrument — `usageEvents` stamped with a
`platform`, read by `node scripts/usage-report.mjs --days 30` — and the
thresholds: web under 5% of active days is "a rounding error"; over 20% is
material.

**The measurement, taken 2026-08-30 (2026-08-01 → 2026-08-30):**

```
users seen          21
day-documents       104
platforms           {"ios":50,"android":51,"web":3}
```

Web is **3 of 104 active day-documents — 2.9%**, under the line 0022 set for
"stop building them." Re-run the command before trusting this paragraph; it
is the only read that counts.

**One condition of 0022 is not met, and this ADR says so rather than
pretending.** 0022 wrote that "the earliest honest date is 30 days after
Android is publicly live." Android production was submitted on 2026-08-29 and
is still in review — the public store URL returned 404 on 08-30. The owner
chose to proceed anyway, and the reasoning is sound in one direction only:
Android production installs can only move `android` up. Nothing about them
sends a user to the browser. The 2.9% is an upper bound on what the web
logging app is worth, not a lower one.

**The owner's words:** *"completely decommission and destroy the web version
and focus on admin page just for me. I will be the only admin."*

**What "the web version" cannot mean.** The same Angular build serves things
two app stores and the mobile app depend on. Every row below was read from
code on 2026-08-30 (`grep https://ignia.fit` across `apps/mobile/src` and
`functions/src`, plus the `firebase.json` rewrites), and every one survives:

| Surface | Why it survives | Depended on by |
|---|---|---|
| `/privacy`, `/terms`, `/support` | Apple requires a live privacy URL, Play a live delete-account URL | store metadata, mobile Settings |
| Delete-account + export on `/privacy` | Play data-safety; GDPR Art. 20 | — |
| `/app-version.json` | tells an installed app a newer binary exists; `npm run doctor` checks drift | `apps/mobile/src/lib/app-update.ts` |
| `/oura/callback` → `ouraCallback` | registered Oura redirect URI, byte-compared | `firebase.json`, `oura.ts` |
| `/u/**`, `/og/u/**` | public profile pages + OG images for mobile shares | `og-image.ts`, mobile share |
| `/unsubscribe` | one-click unsubscribe in every sent digest | `firebase.json` |
| `/__/auth/action` | Firebase Auth email actions (verify, reset) | Firebase Hosting |
| `/tip` → `/support`, `/open` | linked from mobile Settings and from every recap email | mobile, `email-templates.ts` |
| `/admin` | **the thing being kept** | `feedback-notify.ts` links to it |
| `/status` + `statusPulse` | public heartbeat; one of the 3 free scheduler jobs | Cloud Monitoring alert |
| Landing, `/calculator`, `/vs`, `/faq`, `/macros/**`, the prerendered SEO pages | acquisition for the mobile app; the GSC property also verifies the Play org website | `docs/seo-status.md` |
| The domain | hosting site `macrolog`; Google Sign-In authorized domain; Oura redirect; store URLs | everything |

So "the web version" that can be destroyed is exactly the **logging app**:
Today / History / Trends / Body / Train, onboarding, the entry sheet, the
settings sheet, the `LEDGER_PORT` data layer and `FitnessStore`, the PWA
install path and its service worker, web push, the photo-scan and barcode
web clients, the AI-coach web client, the web What's-new banner, and the web
`PRO_ENABLED` / `FEATURES` flags.

## Decision

**1. Delete the logging app from the tree; do not hide it behind a flag.**
A gated-off surface is still compiled, still typechecked, still upgraded
with every Angular release, and still reads as product to the next person.
Git keeps it. The list above is what goes.

**2. `ignia.fit` is a marketing/compliance shell plus `/admin`.** The Angular
app keeps: the landing page and every public content route, the legal pages,
`/status`, `/changelog`, the public profile page and `/transformations`,
`/admin`, and a sign-in card that exists only so the admin can reach
`/admin`. Nothing else renders behind a signed-in session.

**3. There is one admin, and the web does not create accounts any more.**
`SEED_ADMINS` in `functions/src/admin-claims.ts` holds the owner's Gmail and
gains no second entry. The sign-in card drops its *Sign up* tab: an account
created on the web would have nothing to open. Sign-in, password reset and
the three OAuth providers stay, because the admin uses them.

**4. Retired routes land on a "moved to the apps" page, not a 404.** `/app`
is the installed PWA's `start_url` and the target of every "Open your log"
button in every recap email ever sent. `/app`, `/app/**`, `/history/**`,
`/trends`, `/body`, `/train` and `/onboarding` render a page that says the
browser version is gone, links both stores, and points signed-in users at
`/privacy` for export and deletion. Their data is untouched — it is the same
Firestore the apps read.

**5. The service worker goes, and takes its installs with it.** Angular's
`safety-worker.js` ships at `/ngsw-worker.js` so every existing installation
unregisters itself and clears its caches on next load, instead of serving a
cached copy of an app that no longer exists. `ngsw-config.json`,
`manifest.webmanifest`'s install metadata, `firebase-messaging-sw.js` and the
web push service are deleted. The hosting-deploy guard, which verified
`ngsw.json`, now verifies a build stamp the prod build writes last — a guard
that checks for a file the build no longer produces would block every deploy.

**6. The web stops writing `usageEvents`.** A visit to the landing page is
not an app open, and the admin's own visits must not count as users. From
this ADR on, `platforms.web` reads 0 and that is the correct reading, not a
bug in the instrument.

**7. Two decisions are the owner's and are recorded as OPEN, with the
reversible default taken.** The marketing pages (landing, `/vs`,
`/calculator`, `/faq`, the prerendered set) and the public profile pages are
**kept**. Deleting either is cheap later and expensive to undo — de-indexing
is not reversed by a redeploy — so the default is the one that does not
close a door. If the owner wants them gone, that is a route removal plus a
`prerender-seo.mjs` edit, and `docs/seo-status.md` is deleted with them.

**8. Cloud Functions that only served the web are a follow-up, not part of
this change.** The candidates — `runDailyReminders` / `runDayThreeCoachPush`
in `hourly-tasks.ts` (web-push only, by their own header comment) — keep
running against a set of `fcmToken`s that will now only shrink. Removing them
is a saving and a separate deploy; unbinding a function has its own ordering
rules (`CLAUDE.md`, cost bullet). The two defaults that pointed at `/app`
(`password-reset.ts`, `verify-email.ts`) move to `/`.

## Consequences

- **`CLAUDE.md` stops saying the web app is frozen and stops saying "do not
  propose deleting the website."** The first is superseded; the second stays
  true in substance (the shell is required) and is reworded to say what the
  shell is for. `STATUS.md` §1 loses its *Web PWA* row's "logging" claim and
  §3 loses the *Web retirement question* row; §4 gains this ADR.
- **The ledger port/adapter seam (ADR-0009) is gone with the app it served.**
  `npm run test:ledger` and `vitest.ledger.config.ts` are removed. Mobile's
  `lib/ledger.ts` was always its own implementation and is unaffected; the
  doc shapes it mirrors are now documented by `firestore.rules` and
  `CONTEXT.md` alone.
- **`ADMIN_EMAILS` is duplicated in two places, not three.** The web
  `subscription.service.ts` copy is deleted; `admin-claims.ts` and
  `caller-access.ts` keep theirs and their comments are corrected.
- **The `prod-errors` skill's Sentry `ignia-web` surface remains** — the
  shell and the admin page still report there — but its "web data bugs are in
  the ledger" guidance is obsolete and is rewritten. `test-web-ui` becomes a
  recipe for the shell and `/admin`, not for logging flows.
- **Three people lose the browser version.** That is the whole cost, and it
  is the number the decision was made on. They are told where the apps are
  and where their data can be exported.
- **The web build gets smaller and the Angular upgrade tax drops** to what a
  static-ish shell plus one admin table costs. That was the point.
- **This ADR may be re-opened on exactly one thing:** the two OPEN items in
  decision 7. Everything else is decided.
