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
**Status:** **BUILT 2026-07-23** (iOS + Android), unverified on device.
Decisions locked, core snapshot contract unit-tested, both widget UIs written.

**App Groups is NOT an owner gate** (corrected 2026-07-23): EAS Build's auto
capability signing enables it from the local entitlements, and App Groups is on
its supported list. Watch only for a failure on the *extension* target's
provisioning (`fit.ignia.app.Today`) — if that happens, create the group in the
portal and re-run. Device QA checklist is in `WIDGET_PLAN.md`.
**Why first (was #2):** promoted now that Health sync is off the list. The best
awareness-adjacent feature available — passive daily brand exposure on the home
screen, a real DAU lift, and a strong screenshot. $0 runtime. Longest build,
which is exactly why it should absorb the waiting window.
**Watch:** the plan's core constraint — widgets can't run the app's data layer,
so the shared-storage seam (App Group) has to be right before any UI work.
There are **open decisions to lock before coding** (`WIDGET_PLAN.md` §"Open
decisions") — settle those first, they're cheap now and expensive later.
**Spec:** `apps/mobile/WIDGET_PLAN.md`

### 2. Smart on-device nudges — ~~not built~~ **ALREADY SHIPPED**
**CORRECTION (2026-07-23):** this shipped in the live 1.0 build. Commit
`89523f6d` ("wire reminders to the core smart planner", 2026-07-11) is an
ancestor of the same submitted build as the Health-sync commit. `planReminders`
covers meal windows + streak-at-risk (a one-shot that's omitted once you've
logged) + an overdue-weigh-in nudge, with 12 core tests, a Settings toggle and
both locales. **The ~1wk estimate was for zero work.**

**Third time this trap has fired** — barcode scan, Health sync, now nudges. The
roadmap was written from intent, not from the binary. Assume any remaining
roadmap item is built until a grep says otherwise.

**What was actually missing** (found by checking, and now fixed): the Settings
UI exposed a single on/off plus one hour, which the adapter pinned to dinner
while silently running `DEFAULT_MEAL_REMINDERS` for breakfast and lunch. So
every user with reminders on was getting a **1:30pm lunch notification with no
off switch anywhere in the app** — the only way to stop it was to disable all
reminders. Settings now has a per-meal row (toggle + time) for each window the
planner can schedule, and the upgrade reconstructs each device's existing
schedule rather than resetting it, so nobody's notifications move.

### 3. Health activity import (steps / active energy)
**Status:** **BUILT 2026-07-23.** Precondition cleared — the owner confirmed
Health sync works in the live prod app, so the entitlement did ship.

Steps + active energy now import from HealthKit / Health Connect into a new
`users/{uid}/dailyActivity/{dateKey}` doc (`{ steps?, activeKcal? }`) and show
as a read-only row on Today. Import-only by construction: `WritableKind` vs
`ImportOnlyKind` in core makes `writeDaily('steps', …)` a **type error**, since
the watch measures these and the app has nothing to export.

**⚠️ The stated rationale for this feature was wrong — activity must NOT feed
measured-mode TDEE.** `calculateTdee` computes
`trueTdee = avgDailyIntake + (−weightSlope × 3500)`. That's a pure
energy-balance derivation from intake and the weight trend, so it **already
contains every calorie burned**, training included. Adding imported active
energy on top would double-count it and inflate the target — the opposite of
the intended fix.

Where activity legitimately *could* improve a number is **formula mode**
(<14 logged days), which currently guesses via Mifflin-St Jeor × a static
activity multiplier. Measured active energy would beat that guess and isn't
double-counted there, because formula mode never looks at the weight trend.
That's a real follow-up, and a separate decision — not this change.

So this ships as **import + display**. Its value is awareness and the data
being there, not a TDEE change.

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
 ├─ ✅ DONE 2026-07-23: Health sync CONFIRMED working in the live prod app by
 │     the owner. The entitlement shipped; nothing to fix.
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

**DECIDED 2026-07-23: no.** Out of this batch, for the reason above. Revisit
once the widget has round-tripped on a device.

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

- [x] Widget open decisions locked (`WIDGET_PLAN.md` §"Locked decisions")
- [x] Widget implemented, shared-storage seam unit-tested
- [x] ~~**Owner:** App Groups capability on the App id~~ — not required; EAS
      auto capability signing handles it from the entitlements. Fallback only
      if the widget *extension* target fails provisioning.
- [x] Health sync verified working in the LIVE app (owner confirmed 2026-07-23)
- [x] Health activity import (steps / active energy) built
- [x] **Deploy `firestore:rules`** for the new `dailyActivity` collection —
      deployed 2026-07-23, released to `cloud.firestore`. Safe ahead of the
      binary: no live client writes the collection yet.
- [x] `/privacy` health-data clause — **already existed** (added for Apple
      5.1.3); on 2026-07-23 it was found *inaccurate* and corrected: it omitted
      the body-fat/workout exports and predated the steps/active-energy import.
      Both locales updated, `lastUpdated` bumped. **Deployed + verified live
      2026-07-23** on `ignia.fit/privacy` and the `macrolog.web.app` origin.

      Verification gotcha for next time: the Angular service worker serves its
      cached copy, so a browser that visited before the deploy shows the OLD
      page and looks like a failed deploy. Confirm against `/ngsw.json`'s
      `timestamp` + `hashTable` rather than the rendered page, or clear
      `caches` + unregister the SW first. Cloudflare was NOT involved
      (`cf-cache-status: DYNAMIC`).
- [ ] App Intents: yes or no, decided
- [x] ~~Smart nudges implemented~~ — already shipped in 1.0; the per-meal
      Settings gap found in its place is fixed (no build needed, local
      notifications work in Expo Go)
- [ ] App Store metadata + screenshots done (`docs/app-store-metadata.md`) —
      independent of this batch, ships without a binary
