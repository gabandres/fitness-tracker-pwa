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
| **1** | `development` | Device QA. The widget target has never existed on a device, and the shipped Health sync has never been round-tripped on hardware. |
| **2** | `production` | The release, after QA passes. |

Shipping never-executed native code straight to the App Store is the one thing
worth spending a second build to avoid. A rejection or a crashing release
costs far more than a build credit — and the previous two rejections
(`5ba1c7f5`, `fe0a9963`) each cost a build anyway.

---

## CORRECTION — Health sync already shipped

**Health sync is in the live 1.0 App Store build.** Verified 2026-07-23:
commit `0a355deb` ("Apple Health / Health Connect two-way sync (all phases)",
2026-07-11) is an ancestor of the submitted build, `@kingstinct/react-native-healthkit`
is in `app.json`, and Settings has live connect / disconnect / *Sync now*
controls behind a `healthSync.available` gate.

It also covers more than the planned "Phase 1 weight two-way":

| Direction | Covered |
|---|---|
| Import (Health → Ignia) | weight, sleep, water |
| Export (Ignia → Health) | weight, water, body fat, nutrition (kcal/protein/carbs/fat), workouts |

This repeats the barcode-scan lesson: **check what's already in the binary
before scheduling it as new work.** The roadmap's #1 v1.1 item was done before
1.0 shipped.

**What is genuinely unverified:** none of it has been round-tripped on a
device, and if the HealthKit entitlement didn't make it into the build,
`available` is false and the feature is silently dead in prod. That check costs
**zero builds** — the App Store app is already on the owner's phone. Do it
before planning anything else Health-related.

**What is genuinely missing:** activity import. `ReadableKind` is
`'weight' | 'sleep' | 'water'` — no steps and no active energy. That's the real
Health continuation, and it has product value rather than being plumbing:
active-energy import is the input that would let adaptive TDEE respond to
training load instead of inferring everything from the weight trend.

---

## Ship order (what goes in the binary, ranked)

### 1. Home-screen widget (Today's rings)
**Status:** specced, not built. ~1.5wk.
**Why first (was #2):** promoted now that Health sync is off the list. The best
awareness-adjacent feature available — passive daily brand exposure on the home
screen, a real DAU lift, and a strong screenshot. $0 runtime. Longest build,
which is exactly why it should absorb the waiting window.
**Watch:** the plan's core constraint — widgets can't run the app's data layer,
so the shared-storage seam (App Group) has to be right before any UI work.
There are **open decisions to lock before coding** (`WIDGET_PLAN.md` §"Open
decisions") — settle those first, they're cheap now and expensive later.
**Spec:** `apps/mobile/WIDGET_PLAN.md`

### 2. Smart on-device nudges
**Status:** not built. ~1wk. Extends the existing reminder infrastructure; no
new AI, no server cost.
**Why second:** retention, but neither an adoption-blocker nor a discovery
surface. Partially testable in Expo Go (local notifications), so it's the
least build-gated item here.

### 3. Health activity import (steps / active energy)
**Status:** not built. Small — the adapter seam already exists; this adds
`ReadableKind` entries plus HealthKit read permissions.
**Why third:** the only Health work actually left, and unlike the rest it
changes a number the user cares about (adaptive TDEE reacting to training
load). Slots here because it should be verified alongside the existing sync
once that's confirmed working.

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
 ├─ TODAY, zero builds: does Health sync actually work in the live app?
 │     └─ Settings → Health on the owner's phone. If the toggle is missing,
 │        the entitlement never shipped and that's a 1.1.0 fix, not a feature.
 │
 ├─ Widget (~1.5wk)  ← longest; lock the open decisions, then build
 │     └─ App Group / shared-storage seam first, UI after
 │
 ├─ Smart nudges (~1wk)  ← partly verifiable in Expo Go
 │
 ├─ Health activity import (small, once the sync above is confirmed)
 │
 └─ Owner-gated, do before the reset (no build needed):
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
- [ ] Health sync verified working in the LIVE app (zero builds)
- [ ] Health activity import (steps / active energy) built
- [ ] `/privacy` health-data clause published
- [ ] App Intents: yes or no, decided
- [ ] Smart nudges implemented (if not displaced)
- [ ] App Store metadata + screenshots done (`docs/app-store-metadata.md`) —
      independent of this batch, ships without a binary
