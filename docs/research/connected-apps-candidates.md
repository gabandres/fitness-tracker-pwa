> **VERDICT** — **Strava is out, and there is a named precedent: its June 2026 API Agreement is why Cronometer, a nutrition tracker, dropped its Strava integration.** The same terms forbid using Strava data for AI/ML, which Ignia's coach and photo-scan make unavoidable. Of the rest, only **Withings** adds something Ignia cannot already get — body weight, the input its whole TDEE estimate rides on — and even that is largely redundant on iOS, where Apple Health already aggregates Withings, Fitbit, Whoop and Garmin. **The honest conclusion is that the next connected app is worth less than making the Apple Health path work well on Android**, where Health Connect costs a runtime permission and a new binary per data type.
> **Status:** SETTLED as a survey; no provider is scheduled · **Researched:** 2026-08-24
> **Read this only if:** you are about to add a second provider to the Connected apps screen, or someone has asked for Strava.
> **Do not** re-derive the Strava conclusion. It is a licence finding, not a preference.

# Which connected apps are worth adding after Oura

Ignia shipped its first third-party integration (Oura, ADR-0026) and a
Connected apps screen built to hold more. This surveys what could come next and
finds that the obvious candidates are mostly redundant, one is legally closed,
and the highest-value one is not a workout source at all.

## The lens that decides this

Ignia has three inputs that matter: **body weight** (which drives the measured
TDEE, and is the app's actual differentiator), **food**, and **workouts**.
Imported energy never reaches the calorie target — ADR-0024, verified: nothing
in `packages/core` reads `activeKcal` for TDEE. So a new provider is worth
adding only if it supplies weight, workouts, or sleep *that Ignia cannot
already get*.

**And on iOS it almost always can already get it.** Withings, Fitbit, Whoop,
Garmin and Strava all write to Apple Health, which Ignia already imports
(weight, sleep, water, steps, active energy). A direct OAuth integration on iOS
duplicates a path that already works, costs a consent screen, and adds a
credential to manage.

**Android is where the asymmetry lives.** Health Connect needs a runtime
permission per data type, and each one moves the Expo fingerprint — which is
why the Oura workout read is still waiting on vc 38 while the Cloud API reached
testers a binary early. On Android, a direct API is the cheap path; on iOS it is
the expensive one.

## The candidates

| Provider | What it would add | Access | Verdict |
|---|---|---|---|
| **Strava** | Runs and rides, and the brand users ask for by name | OAuth, free, 200 req/15 min · 2,000/day | **REJECTED — licence.** See below. |
| **Withings** | **Body weight from a smart scale** — the input TDEE rides on | Public developer portal, OAuth, relatively open registration | **The only one with real marginal value**, and mostly on Android |
| **Fitbit** | Steps, sleep, workouts, weight | Public portal, OAuth, open registration | Redundant with Health on iOS; a fallback if Withings is refused |
| **Whoop** | Workouts, recovery, sleep | Public developer platform, OAuth 2.0 | Small install base relative to effort; nothing it gives is unique |
| **Garmin** | Workouts, sleep, activity | **Manual review and approval**, longer process | Real coverage, real gate. Not worth it until someone asks |
| **Samsung Health** | Android steps/sleep/workouts | Reached through Health Connect | **Already covered** by the Health Connect path |
| **Renpho / Eufy / most scales** | Body weight | Write to Apple Health / Health Connect | **Already covered** — no direct integration needed |

## Why Strava is closed, and it is not a preference

Strava's **API Agreement, updated 1 June 2026**, restricts what a third-party
app may do with the data:

- **Strava data for a user may only be shown to that user.** Data about other
  users may not be displayed at all, even where it is public on Strava.
- **It forbids using data obtained via the API for artificial intelligence,
  machine learning, or similar applications.**

The second clause is the one that ends it here. Ignia ships an **AI coach** and
**photo scan**, both of which run over a user's logged data. Building an
integration whose terms forbid the app's other features from touching its data
is a compliance surface with no upside.

**And this is not a hypothetical reading.** After the same update, **Cronometer
— a nutrition tracking platform in Ignia's exact category — announced it would
not be able to support Strava integrations.** A peer with more engineering
resource read the same terms and withdrew.

If Strava is ever requested, the answer is that Strava closed the door, not
that Ignia declined to walk through it.

## What to do instead, in order

1. **Make the Apple Health path visible and trustworthy.** It already imports
   weight, sleep, water, steps and active energy, and until 2026-08-24 an
   import could silently overwrite a hand-typed night (fixed: `dailySleep`
   now carries a rules-enforced `source`). It has no evidence surface — no
   last-synced, no counts — which is the same complaint that produced the
   Connected apps screen for Oura. **This is the cheapest large win and it adds
   no provider at all.**
2. **Close the Android gap.** `READ_EXERCISE` and friends need vc 38. Until
   that binary ships, Android users get less from Health than iOS users do, and
   no new OAuth provider changes that for the data Health already carries.
3. **Then Withings**, if body weight from a scale is still missing on Android
   after (2). It is the only candidate that feeds the number Ignia is actually
   built around.

## Sources

- [Strava API Agreement](https://www.strava.com/legal/api) (updated 2026-06-01) and [API Policy](https://www.strava.com/legal/api_policy).
- [Strava: API Agreement Update & How Data Appears on 3rd Party Apps](https://support.strava.com/en-us/articles/15401608-api-agreement-update-how-data-appears-on-3rd-party-apps).
- [Strava rate limits](https://developers.strava.com/docs/rate-limits/) — 200 req/15 min, 2,000/day.
- Cronometer forum: the Strava integration withdrawal after the agreement change.
- [Withings Developer](https://developer.withings.com/) · [WHOOP for Developers](https://developer.whoop.com/).
- Comparative access notes: [Which Wearables Are Developers Using in Health Apps](https://www.themomentum.ai/blog/which-wearables-are-developers-using-in-health-apps-and-why) — Fitbit and Withings open registration; Garmin and Suunto manual review.
- This repo: `apps/mobile/src/lib/health-sync.ts` (`IMPORT_KINDS`), `packages/core/src/oura-scopes.ts`, ADR-0024, ADR-0026.
