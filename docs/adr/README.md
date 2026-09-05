# Architecture Decision Records

An ADR captures an architecturally significant decision: the context
that forced the call, what was decided, and what we now accept as a
consequence. The point is not to be exhaustive — it is to leave a
breadcrumb so a future reader (human or agent) knows *why* the code
looks the way it does.

## When to write one

Write an ADR when:

- A choice shapes more than one file and would be hard to reverse.
- A constraint (cost, tier-gating, single-user model, no-backend) drove
  a design that would otherwise look wrong.
- A name or convention is now load-bearing across the codebase.

Do **not** write an ADR for routine refactors, cosmetic changes, or
decisions that are local to a single component.

## Naming + structure

- Filename: `NNNN-kebab-case.md`, monotonically increasing. Never
  renumber.
- Required sections: **Status**, **Context**, **Decision**,
  **Consequences**.
- Allowed Status values: `proposed`, `accepted`, `superseded by ADR-NNNN`,
  `deprecated`.
- Cross-link freely — to other ADRs and to terms in
  [`CONTEXT.md`](../../CONTEXT.md).

## Index

| #    | Title                                                                                  | Status   |
| ---- | -------------------------------------------------------------------------------------- | -------- |
| 0001 | [v2 rebuild replaces v1](0001-v2-rebuild-replaces-v1.md)                               | accepted |
| 0002 | [Firestore-direct no-backend architecture](0002-firestore-no-backend-architecture.md)  | accepted |
| 0003 | [Day summary as a pure module](0003-day-summary-as-pure-module.md)                     | accepted |
| 0004 | [Typed last-N-days log-window queries](0004-log-window-typed-queries.md)               | accepted |
| 0005 | [Store facets split off FitnessStore](0005-store-facets-split.md)                      | accepted |
| 0006 | [Drop `-v2` suffix from component naming](0006-drop-v2-suffix-component-naming.md)     | accepted |
| 0007 | [Workout logging — the Train tab](0007-workout-train-tab.md)                            | accepted |
| 0008 | [CallerAccess + DailyQuota modules in Cloud Functions](0008-cf-caller-access-daily-quota.md) | accepted |
| 0009 | [LedgerPort phase 5 — id returns, not explicit-UID or Result<T>](0009-ledger-port-phase5-pragmatic.md) | accepted |
| 0010 | [Progress photos in Firebase Storage, fetched via getBlob](0010-progress-photos-firebase-storage.md) | reverted 2026-07-05 (feature removed pre-launch) |
| 0011 | [Native app store path: Capacitor shell + IAP](0011-capacitor-iap-migration.md) | superseded by ADR-0012 (framework) |
| 0012 | [Native iOS app via Expo (separate RN frontend, shared core)](0012-expo-native-app-shared-core.md) | accepted |
| 0013 | [AI food-resolution pipeline + My Foods library](0013-food-resolution-my-foods-library.md) | superseded by ADR-0015 (its text/label/barcode paths + My Foods library remain live) |
| 0014 | [Mobile dark-first identity + center-log navigation](0014-mobile-dark-first-identity-center-log-nav.md) | accepted |
| 0015 | [Macronaut photo-first freemium pivot](0015-macronaut-photo-first-freemium-pivot.md) | accepted; paid gate amended by ADR-0017 |
| 0016 | [Mobile per-hook Firestore subscriptions are intentional](0016-mobile-per-hook-subscriptions-intentional.md) | accepted |
| 0017 | [Photo-scan ships ON and free for everyone in v1](0017-photo-scan-free-for-all-v1.md) | accepted (amends 0015) |
| 0018 | [The USDA food DB ships bundled, replacing the live FDC API](0018-bundled-usda-food-db.md) | accepted |
| 0019 | [Photo-scan gets its macros from the bundled USDA database, not from the model](0019-photo-scan-resolves-macros-from-usda.md) | accepted |
| 0020 | [Logging from outside the app: Android reuses our JS write path, iOS gets a REST one](0020-quick-add-native-write-path.md) | accepted |
| 0021 | [The fasting Live Activity draws its own timer, and reconciles instead of reacting](0021-fasting-live-activity.md) | accepted |
| 0022 | [The web PWA is frozen, not retired (amends 0015)](0022-web-pwa-frozen-not-retired.md) | accepted; **decision 5 superseded by 0036** (2026-08-30) |
| 0023 | [A watch push parks instead of dropping, and the widget's intent runs in the app](0023-watch-push-parks-instead-of-dropping.md) | accepted (amends 0020), **amended 2026-08-14** — the push cannot wake a WidgetKit complication (Apple FB12926788), so decisions 1–3 stand and decision 4 is under review |
| 0024 | [A continuous activity multiplier from the device, floored at the FAO free-living minimum](0024-continuous-activity-multiplier-floored-at-fao-minimum.md) | accepted (decided 2026-08-19, written up 2026-08-23 — three files cited it before it existed) |
| 0025 | [Cardio is a block on the workout session, not a second collection](0025-cardio-is-a-block-on-the-workout-session.md) | accepted |
| 0026 | [Oura reaches Ignia through the OS health store, and its energy stops at the seed](0026-oura-through-the-os-health-store.md) | accepted, then **partly superseded by its own Amendment 2** (2026-08-24) — the workout read moves the Android fingerprint and not the iOS one (measured), and the owner has since chosen to build the Oura Cloud API the ADR refused. Decisions 1–5 survive as the fallback path and the energy seam |
| 0027 | [Where restaurant foods come from](0027-restaurant-foods-source.md) | **accepted** — all three measurements ran and option A stands, with three of its stated properties corrected in the ADR. Shipped 2026-08-24; the licence request to NYC DOHMH is still unanswered |
| 0028 | [Stretching is mobility, and mobility is a timed exercise](0028-stretching-mobility-model.md) | **accepted 2026-08-26** — option E: no new collection, no session field, no rules change. Every claim it makes about existing code was re-read before acceptance (verification table in the ADR), and Amendment 1 settles the two points decision 5 left under-specified. Vocabulary is in `CONTEXT.md`; implementation is a separate ticket |
| 0029 | [Multi-photo and description meal capture](0029-multi-photo-and-description-meal-capture.md) | proposed — the owner's own worked example does not resolve today, and the reason is not the model |
| 0030 | [When does a day start?](0030-configurable-day-boundary.md) | **accepted — complete 2026-08-25.** All four steps shipped, and **Q4 and Q5 are now answered** (Amendment 5); `npm run check:day-boundary` is at BASELINE 0. This row said both were still open until 2026-08-26 |
| 0031 | [The OTA restart cannot be instant, so stop pretending and cover it](0031-ota-restart-feels-slow.md) | accepted for A and B (shipped 2026-08-24); **C withdrawn** once the measurement existed. **A is disproven on Android** — `reloadScreenOptions` is inert there |
| 0032 | [Fasting has no history — a completed fast has to be written down before it can be shown](0032-per-day-fasting-history.md) | proposed — the premise was half wrong: fasting history does not exist as data, `breakFast` nulls the only field. Proposes an interval-shaped `users/{uid}/fasts` collection, not a per-day scalar |
| 0033 | [Sleep on Trends is one honest comparison, not a score](0033-sleep-analysis-on-trends.md) | **accepted 2026-08-25**, with two amendments; shipped the same day. The claim is sleep vs. **intake** (the only pairing where both halves are strong); **no sleep score and no correlation coefficient**, on survey evidence. Mockup: [`assets/0033-sleep-mockup.html`](assets/0033-sleep-mockup.html) |
| 0034 | [Trends cards earn their place by evidence, not by a settings screen](0034-trends-cards-earn-their-place.md) | proposed — **no "My View"**. Trends renders five elements today, four of which already self-suppress, so configuration would fix a problem that has not happened. Fasting on Trends is accepted and **blocked on [ADR-0032](0032-per-day-fasting-history.md)**: `breakFast` still deletes the only record of a fast, so a fasting chart has nothing to draw. Show/hide is deferred behind a stated trigger; reorder is rejected outright |
| 0035 | [Zero-Tap Sign-In rides Block Store, not the API Play names](0035-zero-tap-sign-in-via-block-store.md) | **accepted 2026-08-27**, implemented on `feat/zero-tap-block-store` and **not merged** — it moves the Android fingerprint. Play names the Restore Credentials API, which is WebAuthn and needs a relying-party server this project has no place for; Google accepts **Block Store** instead **only if in production by 30 Sept 2026**. Needs vc 40, Play production access, and the Health-apps deadlock cleared |
| 0036 | [The web logging app is retired; `ignia.fit` becomes a shell plus one admin page](0036-web-logging-app-retired-admin-only.md) | **accepted 2026-08-30** — the measurement 0022 asked for reads **web 3 of 104 active day-documents (2.9%)**, under its own 5% line, and the owner called it. Logging surfaces, `LEDGER_PORT`, the service worker and web push are deleted; the shell, the legal pages, `/u/**`, `app-version.json` and `/admin` survive. Two items are recorded OPEN with the reversible default taken: the SEO pages and the public profiles are kept |
| 0037 | [Maintenance mode is the `maintain` direction, entered by one tap when the goal is reached](0037-maintenance-mode-is-the-maintain-direction.md) | **accepted 2026-09-05** — retention lever 7. No new profile field: `isMaintaining` is `goalDirection === 'maintain'`. One-tap switch on Body after `goal-reached` is on record; `toMaintenanceSwitchPatch` mirrors a "maintain" wizard run plus `targetMode: 'auto'` and a seed rewrite; `planReminders` drops the streak-risk and day-3 lapsed nudges under `maintaining`. The streak needed no loosening — the 7-day freeze is already everyone's |
