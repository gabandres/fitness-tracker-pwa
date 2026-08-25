# ADR-0026: Oura reaches Ignia through the OS health store, and its energy stops at the seed

- **Status:** accepted, then **partly superseded by its own Amendment 2**, and widened by **Amendment 3** (2026-08-24) — the Cloud API this ADR refused is being built. Decisions 1–5 survive as the fallback path for every non-Oura wearable, and Decision 5 (imported energy never reaches a target) is unamended and matters more, not less. Amendment 1 records the fingerprint measurement that phases the health-store rollout
- **Date:** 2026-08-24

## Context

The owner wears an Oura ring on an active subscription and asked for an Oura
integration. There are two ways to build one, and they are not close in cost.

**The Oura Cloud API (api.ouraring.com/v2).** Rich: `daily_readiness`,
`daily_sleep`, `daily_activity`, `sleep`, `workout`, `session`, `heartrate`,
`vO2_max`, `daily_cardiovascular_age`, plus webhook subscriptions. It is also,
as of the December 2025 deprecation of Personal Access Tokens, **OAuth2-only**.
That has four consequences for a project with this repo's constraints:

1. A `client_secret` must live server-side → a Cloud Function to hold the
   authorization-code exchange, and at least one new Secret Manager version.
   `CLAUDE.md` records the audited floor as **7 active versions with no
   headroom** and every version past six billing at ~$0.06/mo — Secret Manager
   is already the single largest line on this billing account at $5.91
   lifetime, ahead of the Gemini API's $0.08.
2. Per-user **refresh tokens** must be stored. They are bearer credentials for
   a user's health data, they would sit in Firestore, and `firestore.rules`
   would have to make them unreadable by the very user they belong to — a new
   class of secret this codebase has never held.
3. Webhooks need a public HTTPS endpoint with HMAC verification and a
   sub-10-second response, i.e. a second Cloud Function; polling instead would
   need a schedule, and **all three Cloud Scheduler free-tier jobs are already
   spent** (`hourlyTasks`, `statusPulse`, `weeklyFirestoreBackup`).
4. A freshly registered Oura application is **capped at ten connected users**
   until Oura reviews and approves it. That is a launch gate discovered in
   production if it is not planned for.

**The OS health store.** The Oura app writes sleep, heart rate, steps, active
energy and **workouts** into Apple Health, and the equivalent records into
Health Connect on Android. Ignia already reads five daily scalars out of that
store through a shipped port — `apps/mobile/src/lib/health.ts` (`HealthPort`,
HealthKit / Health Connect behind one interface) reduced through the pure
`packages/core/src/health-mapping.ts` brain, orchestrated by
`health-sync.ts`. Workouts cross that boundary today and are thrown away: the
port declares `writeWorkout` but no read.

So one path buys Readiness and HRV for two Cloud Functions, two secrets, a
credential store and an approval gate; the other buys cardio sessions, and the
seam it needs is already built and shipped.

## Decision

**1. Oura is a *source*, not an integration.** Ignia reads Oura data through
the existing `HealthPort`. No OAuth, no Cloud Function, no secret, no user cap,
and the same code path serves Apple Watch, Garmin, Whoop and Health Connect
users at zero marginal cost. The Oura Cloud API is **deferred, not rejected** —
see "When to revisit" below.

**2. `HealthPort` gains a workout READ, and it is not a `HealthKind`.**

```ts
readWorkouts(sinceDays: number): Promise<HealthWorkout[]>;
```

`health-mapping.ts` already draws this line in prose — "per-event exports
(nutrition, workouts) don't fit the daily-scalar shape and are handled directly
by the adapter". A workout is an *event* with a start, an end and a modality;
folding it into `reduceImportedSamples`' one-value-per-day model would destroy
exactly the information that makes it a cardio session. The daily-scalar
pipeline (`HealthKind`, `DAILY_FOLD`, `valuesToApply`) is untouched. The pure
mapper for the event stream is a new `packages/core/src/health-workouts.ts`:
native workout type → `CardioModality`, native units → meters/seconds, plus the
dedup key. Zero devices needed to test it, same as its daily-scalar sibling.

**3. Provenance is read, stored, and shown.** Both platforms stamp the writing
app on every record: HealthKit exposes `sourceRevision.source.name` and
`.bundleIdentifier`, Health Connect exposes `metadata.dataOrigin.packageName`
(`com.ouraring.oura`). The existing importer already reads this field — it is
how `fromUs` drops our own exports so a re-sync stays idempotent. The cardio
block stores a normalized `provider` (`'oura' | 'apple-watch' | 'garmin' |
'whoop' | 'other'`) alongside ADR-0025's `source: 'health'`, so the UI can say
**"via Oura"** with a ring glyph rather than "via Apple Health". That is the
difference between a feature that reads as an Oura integration and one that
reads as a settings toggle, and it costs one string lookup.

**4. Duplicates are surfaced, never silently merged.** An imported block carries
`sourceId` — the OS record's stable uuid — so re-importing the same run
overwrites rather than duplicates. But a run the user *also* logged by hand is a
different problem: two records, two ids, one run. Policy follows the precedent
`findDuplicateExercise` set in `workout.ts` — **suggest, never merge**. Blocks
that overlap in time by more than half the shorter one's duration are flagged in
the UI with a one-tap "same session?" merge, and the user decides. A false merge
destroys a training record; a visible duplicate is an annoyance.

**5. Imported energy never reaches a target.** `CardioBlock.kcal` is display
provenance. It is not added to TDEE, not subtracted from intake, not folded into
the day's budget, and not summed into any weekly total that feeds the
estimator. This extends
[ADR-0024](0024-continuous-activity-multiplier-floored-at-fao-minimum.md)
decision 4 from the daily `activeKcal` scalar to the workout event stream, and
for the same reason: once there are ≥14 logged days the target comes from
energy balance, which already contains every training calorie. Pinned by
`packages/core/src/cardio-energy-independence.test.ts`, modelled on
`tdee-wearable-independence.test.ts` — with 120 logged days, moving a session's
cardio `kcal` across 0 / 400 / 1200 must leave `dailyTargets` byte-identical.
This is the seam a plausible optimisation ("we have the number, spend it") would
break with every existing test green.

**6. The connect flow re-prompts for the new scope.** Reading workouts is a new
HealthKit read type (`HKWorkoutType`) and a new Health Connect permission
(`ExerciseSessionRecord`). An already-connected user's stored grant does not
cover it, and neither platform errors — HealthKit returns an **empty array**
for an unauthorized read by design, so the failure mode is "cardio import
silently does nothing, forever". `connectHealth()` therefore re-requests
permissions when the app's requested-scope version is newer than the one
recorded in AsyncStorage, and Settings shows the state rather than assuming it.

## Consequences

- **$0.00/month.** No Cloud Function, no Secret Manager version, no scheduler
  job, no Oura app review, no ten-user cap, nothing new on the billing account
  shared with three other projects.
- **Every wearable comes for free.** The work is "read workouts from the OS
  store", not "integrate Oura". A Garmin user gets cardio import on the same
  day, with no extra code.
- **What is genuinely lost:** Readiness score, Sleep score, HRV balance,
  temperature deviation, VO2max, tags, and Oura's `intensity` /
  `source: autodetected|confirmed` workout metadata. None of these have a
  consumer today. Sleep and heart rate are not lost — Oura writes both into the
  health store and Ignia already imports sleep.
- **Data quality depends on the user's Oura export settings.** If they have
  workout export off in the Oura app, Ignia sees nothing and can neither detect
  nor fix that. The empty state must say so and link the Oura setting, rather
  than showing a spinner or an apologetic blank.
- **One more consumer of a permission users can revoke** in Settings without
  telling us. Same failure class the daily scalars already have.
- **`useHealthAutoImport` runs on every foreground.** Adding a workout read to
  that path must respect the existing `importing` guard and the locked-device
  `com.apple.healthkit Code=6` swallow — that one already reached Sentry from a
  real user's phone via an uncaught `void promise`.

## When to revisit the Cloud API

Not on intuition, and not because it is "the real integration". Revisit when
**both** are true:

1. A shipped or specced feature actually consumes a number the health store
   cannot carry — Readiness or HRV balance driving a training-load or
   recovery surface, not a stat printed for its own sake.
2. The Oura application has been submitted and approved past the ten-user cap,
   *before* any public release depends on it.

At that point it is a new ADR, and it is additive: the health path stays as the
zero-config default and the Cloud API becomes an opt-in enrichment behind a
`FEATURES` flag, mirroring how every other cost-bearing surface in this repo is
gated.

## Amendment — 2026-08-24: the workout read moves the Android fingerprint, and not the iOS one

Written the same day, because two facts arrived after the decision and one of
them weakens an argument above. The decision does not change; what it rests on
does, and that is worth writing down rather than quietly leaving.

### 1. The cost this ADR failed to price

Reading workouts needs `android.permission.health.READ_EXERCISE` in
`app.json`'s `android.permissions`. That is a manifest change, so it moves the
Android runtime fingerprint — and an OTA published against a moved fingerprint
**succeeds and reaches nobody**, which is indistinguishable from a working
update. Measured on the Windows workstation, which is the host that builds
Android:

| `apps/mobile` state | Android fingerprint |
|---|---|
| `main` as-is | `ae526937893adb7f7349321b05caf2732da9658b` |
| `+ READ_EXERCISE` | `b08493087dc6d304c07e3f0499e39cabcd601e78` |

The baseline is the same `ae526937…` that Play alpha vc 37 actually ships, so
this is a comparison against the shipping binary rather than against a local
artifact.

**iOS is the opposite, by construction.** HealthKit read *types* are requested
at runtime through `requestAuthorization`; there is no per-type Info.plist key,
`NSHealthShareUsageDescription` is already declared for the five daily scalars,
and the `@kingstinct/react-native-healthkit` plugin config takes only the usage
strings and `background`. No config file changes, and the fingerprint hashes
native surfaces and dependencies rather than app JS — which is the property that
makes any OTA possible. So the iOS runtime stays `7b347b0f…`.

### 2. Decision 7 — the read ships in two phases

**iOS gets cardio import by OTA. Android gets it with the next binary (vc 38),
and the JS is safe to ship to both in the meantime**, because Health Connect
denies an undeclared read rather than crashing: `readWorkouts` returns `[]` and
the feature is simply absent until the permission exists.

This is cheap precisely because of where Android stands — production is **not
launched** (`STATUS.md` §1: production/beta/internal empty, alpha vc 37), so the
people waiting on vc 38 are the twelve alpha testers, and Android builds run
here on Windows with no dependency on the Apple organisation migration that is
currently blocking `eas build -p ios`.

**Do not let the Android half ride along silently.** The empty state on Android
before vc 38 must read as "not on this build yet", not as "you have no
workouts" — the two are indistinguishable to a user and the second one is a lie.

### 3. The argument that got weaker

Decision context above lists the Oura Cloud API's **ten-connected-user cap**
among the reasons to refuse it. With exactly one known Oura user, that cap is
not load-bearing and should not be cited as though it were. Two further
corrections in the same direction, so the next reader is not misled about how
close this call was:

- The Cloud API moves **neither** fingerprint — it is a callable Cloud Function
  plus client JS plus the `ignia://` scheme that already exists for widget taps,
  and sync can be client-triggered on foreground rather than scheduled or
  webhooked. That is a genuine advantage this ADR did not price, and on the
  "don't move the fingerprint" axis it beats the chosen path outright.
- What the decision still rests on, and what it does not:
  - **Still standing:** the Health path serves *every* wearable — Garmin, Apple
    Watch, Whoop, Fitbit — for the same code, while the Cloud API serves Oura
    alone. It needs no per-user OAuth, no refresh tokens at rest, and no new
    Secret Manager version against a floor of 7 that `npm run doctor` enforces
    and fails on growth past.
  - **No longer standing:** the user cap.

If a feature ever needs Readiness or HRV balance, the revisit conditions above
are unchanged except that condition 2 (approval past the cap) is now trivially
satisfiable and should not be treated as an obstacle.

## Amendment 2 — 2026-08-24: the Cloud API is being built after all

**This ADR's central decision has been overruled by the owner, the same day it
was written.** Recording it here rather than leaving the ADR to quietly
disagree with the repository, which is the failure `CLAUDE.md` opens by warning
about.

### What changed

The decision above rests on a comparison: the health path is free and already
built, so it beats an API that costs a secret and an approval. Half of that
turned out not to be true yet. The health path shipped, and **it has still never
imported a single real Oura record** — `normalizeProvider` is tested against
fixtures, Android returns an empty list until `READ_EXERCISE` reaches a binary,
and no one has connected the one available ring. "It already works for free" was
a prediction, not a measurement, and the ADR presented it as the latter.

The other pillar was the **ten-connected-user cap**. Amendment 1 already
withdrew that as load-bearing: with one known Oura user it constrains nothing.

### What now exists

An Oura application is registered at `developer.ouraring.com/applications`.

- **Client ID** is not secret and is recorded in `CLAUDE.local.md`.
- **Client secret** lives in Secret Manager as `OURA_CLIENT_SECRET` (version 1).
  It cannot live in the mobile bundle — anyone can unzip the app — so the
  token exchange must happen server-side, which is what forces the Cloud
  Function this ADR was trying to avoid.
- **Redirect URI** is `https://ignia.fit/oura/callback`, which still needs a
  `firebase.json` rewrite and a `ouraCallback` function; today it falls through
  to the SPA catch-all.
- **`npm run doctor`'s secret floor moved 7 → 8.** That check fails on growth by
  design, so the raise carries its argument in `scripts/doctor.mjs`.

### What is still true from the original decision

Everything in Decision 5 stands and matters more now, not less: **an imported
`kcal` is display provenance and never reaches a target.** A richer API returns
more energy numbers, and the temptation to spend them grows with the fidelity
of the data. `cardio-energy-independence.test.ts` is unchanged and still the
thing standing between that number and a user's calorie budget.

Decisions 1–4 also survive as the *fallback* path: `HealthPort.readWorkouts`,
the provider normalization and the suggest-never-merge dedup are all shipped and
serve every non-Oura wearable, which the Cloud API never will. The two paths are
complementary.

> **CORRECTION, 2026-08-24 (issue #72).** This paragraph originally continued:
> *"the dedup written for one already covers the other — a run arriving from
> both the health store and the API is exactly the overlapping-blocks case
> `looksLikeSameEffort` was written for."* **That was wrong, and it was wrong
> in the direction that hides itself.**
>
> `looksLikeSameEffort` opened by returning `false` whenever *both* blocks
> carried a `sourceId`, on the reasoning that ids come from one store, so two
> different ids are two different efforts. That reasoning was correct when it
> was written and there was one importer. A second transport kills the premise:
> the same run arrives as a HealthKit UUID **and** an Oura document id, both
> blocks have ids, neither matches, and the overlap test — the thing this
> paragraph was relying on — never ran. `mergeImportedBlocks` added both and no
> prompt was offered.
>
> So the pair that most needed the merge question was the one pair guaranteed
> not to get it, and the ADR asserted the opposite. The short-circuit now
> applies only *within* a transport, which is where its original reasoning
> actually holds; across transports the overlap test decides, exactly as it
> already did for a hand-logged block against an imported one.
>
> The lesson is narrower than "test your assumptions": a dedup rule written
> when there is one source of ids encodes "one source of ids" as an invariant
> without saying so. Adding the second source is what makes the assumption
> visible, and by then it reads as a bug rather than a design that expired.

### Scope discipline

Request **`workout` only**. Oura's console offers eleven scopes and its own
guidance is to request the minimum; changing them later forces every connected
user to re-consent. `daily` is added the day a feature actually reads a
Readiness or Sleep score, not in anticipation. The authorize URL must also carry
a per-request `state` — Oura's example omits it, and without it the callback
cannot tell its own redirect from a forged one.

### The condition this does not clear

The ten-user cap is irrelevant *today* and is not gone. Oura reviews an
application before it may exceed ten connected users, and that review must be
cleared **before any public release depends on the integration**, not after
users start hitting it.

## Amendment 3 — 2026-08-24: the scope widens to `daily`, and imports stop overwriting people

Amendment 2 built the Cloud API on one scope, `workout`, and argued the others
down on the grounds that nothing consumed them. **That argument was checked
against the code and it was wrong.** Ignia has stored daily sleep hours, steps
and active kcal since the Health importer shipped — `setDailySleep`,
`setDailySteps` and `setDailyActiveEnergy` are real writers with real readers.
The consumers were built; only the supply was missing.

So the scope is now **`workout daily`**, and three things follow.

### Why `daily` earns its place and the rest still do not

- **Android gets it without a binary.** The Health Connect route needs a
  runtime permission per data type, and each one moves the fingerprint — the
  reason the workout read is still waiting on vc 38 while the Cloud API reached
  testers a binary early. Sleep through the store would need the same again.
- **The store route can fail silently.** With Oura's export switched off in
  Oura's own app, Ignia sees nothing and cannot distinguish that from a rest
  week. The Cloud API reads from Oura directly.
- Everything else Oura offers — `heartrate`, `spo2`, `stress`, `tag`,
  `session`, `ring_configuration`, `heart_health`, `personal`, `email` — is
  still refused, and for the unchanged reason: nothing reads them, and each one
  lengthens the consent screen protecting the things the user does want.

**Decision 5 is untouched and is what keeps this safe.** `active_calories` from
the ring is provenance, never a budget. It is verified not to reach the target:
nothing in `packages/core` reads `activeKcal` for TDEE, and ADR-0024 makes the
device's contribution seed-only by construction. More data does not mean a
different number, and that is deliberate.

### An import must not overwrite what a person typed

`dailySleep` gains an optional `source`, enforced by `firestore.rules` as
`'manual' | 'import'`. `importDailySleep` declines to write when the stored
value is anything other than `'import'`.

**A missing `source` counts as manual.** Documents written before this change
could be either, and the conservative reading is the one that cannot destroy a
real entry — imports fill empty days and refresh days they already own, and
leave everything else alone.

This is a **daily-total rule and not a workout rule**, and the difference is the
whole point. Two sources reporting one night are two measurements of the same
quantity, so the newer read normally wins; a hand-typed night is a statement of
intent, not a measurement. Two sources reporting one *run* are two records of a
distinct event, which is why Decision 4 still refuses to merge those and
surfaces them instead.

It also closes the same hole on the **existing Apple Health path**, which had
it too: the Train session-finish sleep and the Today sleep sheet were both
overwritable by an importer before this.

### Every connected user must reconnect, and is told so

Oura cannot widen a grant without fresh consent, so everyone who linked before
2026-08-24 holds `workout` alone. `packages/core/src/oura-scopes.ts` compares
the granted scope against the required set and the Connected apps screen shows
a reconnect notice. Without it the failure is silent: the link stays live, the
token refreshes, the callable succeeds, and the sleep row is simply empty.

### The consent handoff now closes itself

`WebBrowser.openAuthSessionAsync` dismisses when the browser reaches the
redirect URL the app gave it, and iOS `ASWebAuthenticationSession` can only
intercept a **custom scheme** — matching an `https://` URL needs Universal
Links, which this app does not configure. Passing Oura's registered
`https://ignia.fit/oura/callback` meant the session could never match its own
redirect, so the user landed on the success page and had to tap Done. The
callback now bounces to `ignia://oura/callback` after the exchange. Oura's
registered redirect URI is unchanged.

## Alternatives rejected

- **Oura Cloud API now.** Two Cloud Functions, refresh-token storage, ~$0.12/mo
  of Secret Manager past an audited floor with no headroom, and a ten-user cap
  that gates a public release — bought for numbers no feature currently
  consumes.
- **Cloud API only, no health path.** Would make cardio import depend on an
  Oura subscription, giving Apple Watch and Garmin users nothing, and would put
  the ten-user cap on the critical path of a feature that has no Oura-specific
  requirement.
- **Poll the Cloud API on a schedule instead of webhooks.** All three
  free-tier Cloud Scheduler jobs are spent; it would have to fold into
  `hourly-tasks.ts`, which means an hour of latency on a feature whose whole
  appeal is that the run is already there when you open the app.
- **Treat a workout as a daily scalar.** Collapses start time, modality,
  distance and heart rate into one number per day, which is the entire feature.

## Cross-reference — ADR-0030 Q5 now blocks this ADR's importers (2026-08-25)

ADR-0030 (the configurable day boundary) shipped, and it left exactly one
question open that lands on this ADR's code: **Q5 — do importers keep their
source's day, or the user's?**

`health.ts` and `health-sync.ts` are 9 of the 12 remaining call sites that still
bucket a wall-clock instant by the calendar date rather than by the user's day
(`npm run check:day-boundary --list`). They were **deliberately not converted**,
and the reason is specific to what this ADR built rather than a general reluctance:

`writeImportedBlocks` merges an imported cardio block into the user's own
`WorkoutSession` for that day by comparing the two days. Converting one side and
not the other makes those two keys disagree at any non-midnight boundary, so a
run auto-detected by the ring at 00:30 would stop merging into the session the
user logged by hand — which is decision 4's silent-merge refusal inverted into a
silent *failure* to merge. Converting half an importer is worse than converting
none.

So Q5 has to be answered before either half moves, and the answer is a decision
about provenance — a ring's record carries its own notion of when the workout
happened — not a refactor.
