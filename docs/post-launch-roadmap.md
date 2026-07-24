# Ignia — post-launch roadmap (v1.1 / v2)

**Status:** decided & sequenced — hand-off ready. Nothing here is left to *decide*; only building remains.
**Scope:** the **free** post-launch track. v1.1 ships FREE (no IAP). Monetization timing and the paid photo-scan flagship are a separate downstream effort (see [PARKED](#parked)).
**How this was decided:** [Wayfinder map — Ignia post-launch feature roadmap (#13)](https://github.com/gabandres/fitness-tracker-pwa/issues/13), applying a locked **gated-sort rubric** (no weighted math). Provenance per row links the issue that settled it.

## The rubric in one paragraph

Every go/no-go applied the same yardstick ([#14](https://github.com/gabandres/fitness-tracker-pwa/issues/14)): **gates → sort → bucket.** Three hard gates first — **runtime-cost** (recurring per-user $ with no offsetting revenue → PARKED), **focus** (off the kcal+protein core → demote), **effort** (>~2wk solo → can't be v1.1). Survivors are ranked **lexicographically**: adoption-blocker → native-only leverage → retention → effort. Native-only ranks *above* retention on purpose — mobile is the endgame ([ADR-0015](adr/0015-macronaut-photo-first-freemium-pivot.md)), so an un-copyable native moat beats raw retention value. Four buckets: **v1.1 / v2 / BACKLOG / PARKED**. The v1.1 boundary is **effort-capped**, and the **EAS dev build is v1.1's one-time enabling prerequisite — not a v2-demoting gate.**

## Shared execution gate (blocks the native half of v1.1)

An owner-gated **EAS dev build** unlocks every native-module feature (Health, Widget, Nudges). It is a *prerequisite step*, not a feature. Independent launch gates from prior work (do not re-derive):

- **Apple:** Org enrollment D-U-N-S is the long pole and sets the launch date.
- **Android:** Individual account requires **12 opted-in testers × 14 consecutive days** of closed testing before production (sideload/emulator don't count).

Two v1.1 features (**Adaptive-TDEE**, **Recipe-URL import**) need **no native capability** and can land *before* the dev build exists.

---

## v1.1 — first post-launch batch (5, all FREE, all $0 runtime)

> **STATUS 2026-07-23: all 5 rows are DONE.** Four shipped inside the 1.0
> binary before this list was even written; the widget was built 2026-07-23.
> Nothing in this section is remaining work — it is kept as the record of how
> the batch was ranked. **This table was written from intent, not from the
> binary, and it mis-scoped three features as unbuilt (Health sync, nudges,
> barcode). Before scoping anything here, grep the code.**

Ranked by the rubric's Step-2 sort. Slot rationale + spec pointer per row.

| Rank | Feature | Cost | Native-only | Effort | Why this slot | Spec |
|---|---|---|---|---|---|---|
| 1 | ~~**Health sync — Phase 1 (weight two-way)**~~ **SHIPPED IN 1.0** | $0 | yes | — | Landed early in `0a355deb` (2026-07-11), before 1.0 was submitted, and covers more than Phase 1: import of weight/sleep/water plus export of weight/water/body-fat/nutrition/workouts. Verified 2026-07-23. **Not remaining work.** The only Health gap left is activity import (steps / active energy) — see `docs/aug-2026-build-batch.md`. | [`apps/mobile/HEALTH_PHASE1_PLAN.md`](../apps/mobile/HEALTH_PHASE1_PLAN.md) |
| 2 | ~~**Smart on-device nudges**~~ **SHIPPED IN 1.0** | $0 | yes | — | Landed in `89523f6d` (2026-07-11), before 1.0 was submitted: meal windows + streak-at-risk + overdue-weigh-in, via core `planReminders`. The `~1wk` estimate was for zero work. A per-meal Settings gap found on 2026-07-23 is also fixed. **Not remaining work.** | `packages/core/src/reminder-plan.ts` |
| 3 | **Home-screen widget** — **BUILT, awaiting device QA** | $0 | yes | done | Built 2026-07-23 for iOS (SwiftUI/WidgetKit) + Android (TSX). Shows kcal + protein remaining, taps to the add sheet. Blocked only on the Aug EAS build and the App Groups capability. | [`apps/mobile/WIDGET_PLAN.md`](../apps/mobile/WIDGET_PLAN.md) — **BUILT** |
| 4 | ~~**Adaptive-TDEE recalibration**~~ **SHIPPED** | $0 | no | — | Built as `packages/core/src/tdee-recalibration.ts`; `RecalibrationCard` is mounted on the mobile Today screen. **Not remaining work.** | `packages/core/src/tdee-recalibration.ts` |
| 5 | ~~**Recipe-URL import (JSON-LD)**~~ **SHIPPED** | $0 | no | — | `packages/core/src/recipe-import.ts` + the deployed `importRecipe` Cloud Function; mobile UI ships with the next binary. **Not remaining work.** | `packages/core/src/recipe-import.ts` |

Provenance: buckets + intra-batch rank locked in [Go/no-go sweep (#17)](https://github.com/gabandres/fitness-tracker-pwa/issues/17).

### v1.1 build sequence

```
Track A — no native capability:
  ┌─ 4. Adaptive-TDEE      ✅ SHIPPED
  └─ 5. Recipe-URL import  ✅ SHIPPED (core + CF live; mobile UI next binary)

Track B — native:
  0. ▶ EAS dev build       ⛔ STILL PENDING — quota resets Aug 2026
  ├─ 1. Health sync        ✅ SHIPPED IN 1.0 + device-confirmed in prod
  ├─ 2. Smart nudges       ✅ SHIPPED IN 1.0
  └─ 3. Home widget        ✅ BUILT — awaiting device QA on the Aug build
```

The sequence above is historical. The one item that never happened is the EAS dev build itself: Health sync and nudges shipped *without* it by landing inside the 1.0 release build, which is why the "behind the dev build" framing turned out to be wrong for Track B. Live work now tracks in [`docs/aug-2026-build-batch.md`](aug-2026-build-batch.md).

---

## v2 — committed, later (3, FREE, $0)

Deferred by the rubric: each needs a **distinct new capability beyond the shared dev build**, or is lower-ranked polish. Committed (will be spec'd + sequenced when v2 opens), not backlog.

| Feature | Cost | Why v2 (not v1.1) | Provenance |
|---|---|---|---|
| **Apple Watch app** | $0 | Separate watchOS target = the rubric's canonical "distinct new capability". | [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17) |
| **Fasting Live Activity / Dynamic Island** | $0 | Distinct ActivityKit extension + iOS-only / narrow surface. | [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17) |
| **Curated / verified food DB (USDA CC0)** | $0 | Foundation for future micros + cuts OpenFoodFacts junk; larger build, no adoption-blocker urgency. | [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17) |

---

## BACKLOG — survived the gates, too low-ranked to commit now (2 + 1)

"Not now" is a real decision, not an omission — it keeps v2 from becoming a dumping ground. Revisit only if the noted trigger fires.

| Item | Why backlog / revisit trigger | Provenance |
|---|---|---|
| **Restaurant / chain-menu data** | Passes gates, but sourcing/maintenance is a treadmill and OpenFoodFacts covers most cases. | [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17) |
| **Full micronutrient panel** | Focus-gate demote (off kcal+protein) + niche; depends on the curated food DB landing first. | [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17) |
| **On-device nutrition-label OCR** ($0 reshape of photo-scan) | Passes all gates but redundant with the shipped barcode scan; panel-parsing is fiddly for a narrow gain (packaged food with a label but no barcode). Revisit **only if** barcode-miss complaints surface. | [#16](https://github.com/gabandres/fitness-tracker-pwa/issues/16) |

---

## PARKED — off the free roadmap, pending monetization (2)

Failed the **runtime-cost gate**. Not killed — these return as a **separate paid effort** when Pro turns on. Monetization *timing* is explicitly out of scope here.

| Item | Why parked |
|---|---|
| **AI photo-scan (flagship, ADR-0015)** | Carries recurring Gemini/Vertex vision cost. Its own offsetting revenue *is* the Pro paywall this free roadmap ruled out of scope → cost-with-no-revenue here. Ships **when Pro turns on**; [ADR-0015](adr/0015-macronaut-photo-first-freemium-pivot.md) remains the accepted paid-flagship direction. See [#16](https://github.com/gabandres/fitness-tracker-pwa/issues/16). |
| **Social challenges / community** | Recurring server + moderation cost, no offsetting revenue on a free track. See [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17). |

## Explicitly out of scope for this map

- **Monetization timing** — when Pro/paid + the photo-scan paywall turn on. A separate downstream effort; "v1.1 ships free" is fixed.
- **Bluetooth-scale BLE integration** — forgone (no iOS Web Bluetooth; per-brand proprietary parsing = maintenance treadmill). OS Health sync (Phase 1) covers the smart-scale use case instead.

---
*Generated from Wayfinder map [#13](https://github.com/gabandres/fitness-tracker-pwa/issues/13). Source decisions: [#14](https://github.com/gabandres/fitness-tracker-pwa/issues/14) rubric · [#15](https://github.com/gabandres/fitness-tracker-pwa/issues/15) competitive scan · [#16](https://github.com/gabandres/fitness-tracker-pwa/issues/16) photo-scan · [#17](https://github.com/gabandres/fitness-tracker-pwa/issues/17) go/no-go sweep.*
