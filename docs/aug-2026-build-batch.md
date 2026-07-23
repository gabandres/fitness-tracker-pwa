# August 2026 build batch — what ships in the next binary

**Constraint:** EAS build quota is exhausted; it resets **August 2026**. No new
iOS binary until then. Everything below is sequenced around that single fact.

**The useful consequence:** build-gated *work* and build-gated *shipping* are
different things. All the code can be written, reviewed and unit-tested now —
only device QA and release wait for the reset. So the waiting window is not
dead time; it's the whole implementation window.

---

## Budget two builds, not one

| Build | Profile | Purpose |
|---|---|---|
| **1** | `development` | Device QA. Health sync has **never been round-tripped on hardware**, and the widget target has never existed on a device. |
| **2** | `production` | The release, after QA passes. |

Shipping never-executed native code straight to the App Store is the one thing
worth spending a second build to avoid. A rejection or a crashing release
costs far more than a build credit — and the previous two rejections
(`5ba1c7f5`, `fe0a9963`) each cost a build anyway.

---

## Ship order (what goes in the binary, ranked)

### 1. Health sync — Phase 1 (weight two-way)
**Status:** code-complete since `43add18a`. `@kingstinct/react-native-healthkit`
is already in `app.json`. Never device-tested.
**Why first:** the only true **adoption-blocker** on the roadmap — every rival
ships OS Health sync and its absence is visible in any comparison. Ranked #1 by
the roadmap rubric.
**Remaining work:** device QA, plus the owner-gated HealthKit capability and
the `/privacy` clause.
**Spec:** `apps/mobile/HEALTH_PHASE1_PLAN.md`

### 2. Home-screen widget (Today's rings)
**Status:** specced, not built. ~1.5wk.
**Why second:** the best awareness-adjacent feature available — passive daily
brand exposure on the home screen, a real DAU lift, and a strong screenshot.
$0 runtime. Longest build, which is exactly why it should absorb the waiting
window.
**Watch:** the plan's core constraint — widgets can't run the app's data layer,
so the shared-storage seam (App Group) has to be right before any UI work.
There are **open decisions to lock before coding** (`WIDGET_PLAN.md` §"Open
decisions") — settle those first, they're cheap now and expensive later.
**Spec:** `apps/mobile/WIDGET_PLAN.md`

### 3. Smart on-device nudges
**Status:** not built. ~1wk. Extends the existing reminder infrastructure; no
new AI, no server cost.
**Why third:** retention, but neither an adoption-blocker nor a discovery
surface. Partially testable in Expo Go (local notifications), so it's the
least build-gated of the three.

### Rides along free
- **In-app rating prompt** — committed `84898243`, already on `main`. It needs
  this build to reach anyone. Verify on device with
  `resetReviewPromptState()` to re-arm (this does **not** reset Apple's own
  3-per-year throttle, so plan device QA around that).
- **Recipe-URL import** — the `importRecipe` Cloud Function is deployed and
  live; the mobile UI ships with this binary.

---

## Work order (what to build first, starting today)

Deliberately **not** the ship order. Sequence by longest-pole and by what
unblocks QA on day one of the reset.

```
Now ──────────────────────────────────────────────────────────► Aug reset
 │
 ├─ Widget (~1.5wk)  ← longest; lock the open decisions, then build
 │     └─ App Group / shared-storage seam first, UI after
 │
 ├─ Health sync device-QA script (~½ day)
 │     └─ write the exact step list NOW so Aug QA is an hour, not a day
 │
 ├─ Smart nudges (~1wk)  ← partly verifiable in Expo Go
 │
 └─ Owner-gated, do before the reset (no build needed):
       ├─ HealthKit capability enabled in the Apple developer portal
       └─ /privacy health-data clause published (hosting deploy, unlimited)
```

**Start with the widget.** It is the longest task, it is 100% build-gated no
matter what, and its open design decisions are cheapest to settle before any
code exists.

---

## Open decision: App Intents / Siri Shortcuts

Not on the existing roadmap — a genuine scope addition, so it needs a yes/no
rather than quiet inclusion.

**The case for:** on current iOS, App Intents surface the app in **Spotlight
search**. That makes it a *discoverability* feature, not just a convenience
one — rare for something with no runtime cost. "Log 200 calories" from Siri
also fits the app's fast-logging story better than anything else on the list.

**The case against:** moderate effort, another native surface to QA in a build
window that already has two untested native features in it, and it competes
directly with the widget for the same weeks.

**Recommendation:** decide before widget work starts. If yes, it displaces
smart nudges (#3) rather than adding to the batch — three untested native
surfaces in one binary is how rejections happen.

---

## Not in this batch

| Item | Why |
|---|---|
| Android / Play | No Android device yet; closed testing needs 12 testers × 14 consecutive days |
| AI photo-scan | Runtime-cost gate — returns only when Pro turns on (ADR-0015) |
| Apple Watch, Live Activity | v2 — each needs a distinct new target beyond this build |
| Curated USDA food DB | v2 — ingest script built, not integrated |

---

## Pre-reset checklist (all doable now, zero builds)

- [ ] Widget open decisions locked (`WIDGET_PLAN.md` §"Open decisions")
- [ ] Widget implemented, shared-storage seam unit-tested
- [ ] Health-sync device-QA script written
- [ ] HealthKit capability enabled in the Apple developer portal
- [ ] `/privacy` health-data clause published
- [ ] App Intents: yes or no, decided
- [ ] Smart nudges implemented (if not displaced)
- [ ] App Store metadata + screenshots done (`docs/app-store-metadata.md`) —
      independent of this batch, ships without a binary
