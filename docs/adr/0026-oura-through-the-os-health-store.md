# ADR-0026: Oura reaches Ignia through the OS health store, and its energy stops at the seed

- **Status:** accepted · **amended 2026-08-24** (see [Amendment](#amendment--2026-08-24-the-workout-read-moves-the-android-fingerprint-and-not-the-ios-one) — the decision stands, one of its arguments does not)
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
