# ADR-0032: Fasting has no history — a completed fast has to be written down before it can be shown

- **Status:** **accepted** 2026-08-26 — decisions 1, 2, 5 and 6 shipped as #97
  (Android OTA 64 / iOS OTA 35). **Decisions 3 and 4 are NOT built**: editing a
  completed fast, setting a start time, overlap rejection, and the 36-hour
  stale-fast prompt are all still open, and the rules already admit the
  `manual` source they will write. Do not read this status as "all of it
  exists".
- **Date:** 2026-08-25
- **Touches:** `Profile.fastStartedAt`, a new `users/{uid}/fasts` collection, `firestore.rules`, `packages/core` (a new pure module + `DaySummary`), the mobile History tab and Today's `DailyMetrics`, `buildCsv`, and [ADR-0030](0030-configurable-day-boundary.md)'s `dayKeyAt` / `dayRange`

## Context

The request that started this was: *"we are tracking fasting but we don't know
how much each day in the history panel — only in the export."*

**Half of that is wrong, and the wrong half is the important one.** The export
does not have it either. There is nothing to surface.

### What is actually stored

Fasting is **one nullable field on the profile** and nothing else:

```ts
// packages/core/src/types.ts:246
fastStartedAt?: Date | null; // when fasting — ISO timestamp of fast start
```

Both frontends read it, both write it, and `breakFast` is this:

```ts
// apps/mobile/src/lib/ledger.ts:620
export async function breakFast(uid: string): Promise<void> {
  await updateDoc(userDoc(uid), { fastStartedAt: null, lastSeenAt: Timestamp.now() });
}
```

The web adapter does the same (`in-memory-ledger.adapter.ts:202`, and
`FirebaseService` behind `LEDGER_PORT`). So **the duration is destroyed at the
exact moment it becomes final.** Ending a 17-hour fast writes `null` over the
only evidence the fast ever happened. There is no completed-fast record, no
`fastEndedAt`, no history document and no audit trail — `auditLogs` is
server-only and fed exclusively by `admin-ops`, and the weekly Firestore backup
captures the field at one arbitrary instant a week, which is not a record of
anything.

[ADR-0021](0021-fasting-live-activity.md) already said this in as many words,
and nobody has had to act on it until now:

> Fasting state in this app is **one field** … `DailyMetrics` counts elapsed
> time from it, and there is no goal, no schedule, and no history. That is the
> whole domain.

### Confirming the rest of the premise, field by field

- **The CSV export emits no fasting column.** `packages/core/src/csv-export.ts`
  declares ~40 columns across eight `type` discriminators (`meal`, `weight`,
  `water`, `sleep`, `measurement`, `workout`, `workout_set`, `cardio`). None is
  fasting, and no caller passes fasting data into `buildCsv`. The memory of
  seeing it in the export is not borne out by the code.
- **`DaySummary` has no fasting field.** `packages/core/src/day-summary.ts`
  carries calories, three macros, `mealCount`, `exercised` and `weightLb`.
- **Neither History surface references fasting.** Mobile's
  `app/(app)/history/index.tsx` renders a month grid with two dots (logged,
  weighed) plus a "Recent" list of `mealCount · weight … kcal` rows; the web's
  `history.component.ts` has no fasting reference at all, and `useHistory`
  subscribes to nothing that could carry it.
- **`firestore.rules` validates the field's type and nothing else** — line 472,
  `fastStartedAt is timestamp || == null`. There is no upper bound, which is why
  a forgotten fast counts upward forever.
- **The widget / watch App Group snapshot does not carry fasting** either.
- **There is no goal.** `fastGoal`, `fastingGoal`, `targetFastHours` and
  friends return nothing across `packages/core`, `apps/mobile` and `src/app`.
  `CONTEXT.md`'s glossary nonetheless says *"FastWindow — Active fasting window,
  **target 16h**"*, and still lists a "fasting ring" on the web Body tab that
  was deleted in `fb166b5c`. **Both lines are stale and should be corrected
  regardless of what this ADR decides.**

### What `fb166b5c` retired, and what it did not

`fb166b5c fix(body,trends): retire the fasting code Body no longer renders`
removed ~90 lines backing a card whose markup had already gone: ring geometry,
the elapsed/dash-offset computeds, a 30-second `setInterval` running on every
visit to a screen that showed nothing, and **the start-time backdating editor
and its parser**. Twenty-seven orphaned `fasting.*` i18n keys went with it.

The commit was correct — it deleted code for a UI that did not exist — but it is
easy to misread as "fasting was dismantled". The *timer* was never dismantled
and still ships on Today on both platforms, plus the iOS Live Activity. What was
lost is the one affordance a fasting user needs most: **correcting the start
time when you forget to press the button.** `startFast(uid)` takes no argument
on mobile and stamps `Timestamp.now()`. There is now no way, on either platform,
to say "I actually stopped eating at 8pm."

### So this ADR is not about surfacing a number

It is about **creating the data**, which is materially larger than the request
implied. And because nothing has ever recorded a completed fast, there is **no
backfill**: the day this ships, history starts at zero and every fast before it
is gone. That has to be said to the user, not discovered by them.

### Who this is for

The heavy user of fasting here is **one real person — Stephanie** — not a
modelled cohort. That cuts both ways. It argues *against* an elaborate
statistics surface nobody asked for, and *for* getting the daily read exactly
right, because a wrong number will be seen every day by someone who knows what
the right one was. The success criterion is legible: she opens History, sees
what she did, and can fix it when the app got it wrong.

## The hard part: which day does a fast belong to?

A 16:8 fast starts around 8pm and ends around noon the next day. **It straddles
midnight by construction — that is the normal case, not an edge case** — and it
is the same question [ADR-0030](0030-configurable-day-boundary.md) exists to
answer. ADR-0030 named it in its own list of what breaks:

> 4. **Fasting.** A fast that spans midnight is already handled by timestamps,
>    but any per-day *summary* of fasting inherits the same split.

ADR-0030 shipped on 2026-08-25 and gives us the vocabulary rather than making us
re-derive it: `dayKeyAt(at, boundary)` maps an instant to the user's day,
`dayRange(key, boundary)` returns that day's `{ start, end }`, and `MIDNIGHT` is
the empty boundary under which both are byte-for-byte the old calendar
behaviour. `useHistory` already reads `boundary` off the auth-context profile
and hands it to `summarizeDays`, so a fasting rollup can use the same value with
**no new profile listener** — which is what keeps
[ADR-0016](0016-mobile-per-hook-subscriptions-intentional.md) intact.

The candidate rules, against an 8pm→12pm 16-hour fast:

| Rule | Mon (start) | Tue (end) | Failure |
|---|---|---|---|
| Credit the **start** day | 16h | 0h | Tuesday reads as a day with no fasting, on the morning she was actually fasting. |
| Credit the **end** day | 0h | 16h | The day the work started shows nothing, and today's row stays empty while a 20-hour fast is running. |
| **Split** by overlap | 4h | 12h | Every day gets a number and no day ever shows the number she is proud of. "I did a 16-hour fast" becomes "12h" and "4h". |
| Both days get the **full** 16h | 16h | 16h | Double-counts. Every total, average and weekly figure is nonsense. |

No rule is right for both readings, because these are **two different
questions** — *how long was that fast* (a property of the fast) and *how much of
this day was I fasting* (a property of the day). The central claim of this ADR
is that answering both with one number is the mistake.

## How other apps handle it

Researched 2026-08-25 across vendor help centres, Apple customer-review RSS
feeds, Google Play listings, the Cronometer community forum and one third-party
analysis of a real Zero data export. Claims are marked **documented** when they
come from a vendor support article, **INFERRED** otherwise. Two caveats on
method: **Reddit was unreachable** from this environment, so r/intermittentfasting
and r/fasting contributed nothing; and **no app was run**, so every visual
description is second-hand.

### The headline finding

**Exactly one product in this category ever documented its midnight rule, and
that product is dead.** LIFE Fasting Tracker split a fast across the days it
touched. Everyone still shipping leaves the rule unstated — and the recurring
complaints (skipped days when travelling, unfair streak breaks, "it replaced my
last fast", editing a fast corrupting its date) are all downstream of that
silence.

The second finding is the one that decides this ADR: **storage is near-universally
one row per fast** — a start timestamp, an end timestamp, a duration. The per-day
calendar is a *projection* over interval records, and the projection rule is
where every one of those bugs lives.

### Zero — the market leader, and it mostly refuses to have days

**Documented.** A fast is an interval you can create after the fact: *"If you
weren't able to log a fast when it occurred, you can do so retroactively by
tapping 'Add fast'. If the fast overlaps with an existing one, you'll see an
error message"*
([Adding and Editing a Fast](https://zerofasting.zendesk.com/hc/en-us/articles/360006280674-Adding-and-Editing-a-Fast)).
The *Me* tab shows a **two-week strip of colour-coded pillars**, where the green
fasting pillar *"appears if you logged a 12+ hour fast"* — and, tellingly, the
bar graph beside it *"displays the last 7 **fasts completed**"*, not the last 7
days ([Me Tab](https://zerofasting.zendesk.com/hc/en-us/articles/360041323933-Me-Tab-Tracking-Your-Progress)).

Its streak is likewise **not** a per-day rule: a streak runs *"whenever you log a
fast and less than 24 hours passes between your next logged fast"*, and breaks
only when more than 24h separates two fasts
([Fasting Streaks](https://zerofasting.zendesk.com/hc/en-us/articles/360018083413-Fasting-Streaks)).
A fast that fell short is still stored, just demoted: a green *"Complete Fast"*
button and green check when the goal is met, grey when it is not
([Ending your fast](https://zerofasting.zendesk.com/hc/en-us/articles/360017133434-Ending-your-fast)).

**Attribution: the start day** — **INFERRED**, but from the strongest evidence
available anywhere in this research. Zero's own CSV export is one row per fast
with columns `Date, Start, End, Hours, Night Eating` (e.g. `1/17/21 | 19:15 |
12:00 | 16 | 1`), and the third-party parser keys each row by its **start**
datetime and derives the end forward from the duration
([jbpauly/fasting](https://github.com/jbpauly/fasting),
[quantify.py](https://raw.githubusercontent.com/jbpauly/fasting/main/fasting/quantify.py)).

That same analysis is worth citing on its own account: to get *any* per-day
number out of the export, it had to build a minute-level series and resample —
and it produced **two different per-day metrics that are not the same number**,
`daily_cumulative_hours` (minutes falling inside the calendar day) and
`daily_max_consecutive_hours` (longest unbroken run within it). An independent
party, working from real data, arrived at the same two-questions conclusion this
ADR reaches from first principles.

**Complaints** (App Store review RSS, id 1168348542): *"it has deleted fasts for
no apparent reason other than the fact that they went over 24 hours"* (1 star);
*"my data (2 years!) was gone"*; *"your latest update zeroed my fasts out"*;
*"Editing an incorrect fast maybe possible, but not obvious"* (2 stars). History
is also behind the paywall — *"can't see ANY HISTORY AT ALL now, even your
previous day's fast, without paying."*

### LIFE Fasting Tracker — the only documented rule, and it splits

**Documented, and now archaeology**: LifeOmic shut the app down around June 2024
([shutdown notice](https://www.facebook.com/groups/fastingforher/posts/872275304796427/)),
`support.lifeapps.io` no longer resolves, and apps using the name today are
different products.

Its month view was a **shaded heat-map** — blue for fasting, *"the darker the
color, the longer the duration"* — and a selected day showed *"all fasting hours
that you had that day as well as a depiction of the individual fasts (if
applicable) that **included hours on that specific day**"*, with the worked
example: *"Monday was selected. There were two fasts that took place in some part
on Monday, the fast that **ended** Monday morning… and the fast that **started
Monday evening and went through Tuesday**"*
([archived support article](http://web.archive.org/web/2023/https://support.lifeapps.io/hc/en-us/articles/360061290754-How-Do-I-Use-the-Fasting-History-)).

So an 8pm→12pm fast **coloured both days**, contributing 4h to Monday and 12h to
Tuesday, and a day cell was the sum of fasting hours falling inside it. Storage
was still one row per fast, editable, with an end-before-start guard. *(Caveat:
the Wayback URL was fetched by a delegated agent and could not be independently
re-read here.)*

### FastHabit — what happens when the day IS the key

This is the direct evidence against Option A below, and it is unusually clean.
FastHabit is built around *"log daily"* with a *"Calendar and weekly views"*
([App Store](https://apps.apple.com/us/app/fasthabit-intermittent-fasting/id974978016)),
and its reviews read like a bug report on the primary key (RSS, id 974978016):

- *"**Keeps replacing the last fast if you try to start one on the same day.**"*
- *"When I finish my fast and 4 hours later I want to start my fast **it replaces
  the last fast**."*
- *"**Start days need to coincide.** How can you fast more 20 hours and start days
  not be the same."*
- *"I frequently travel internationally… it's a jumbled mess and **looks like
  I've skipped days**."*
- *"I forgot to hit stop every time and then **it looks like I did 3 day fast**."*
- *"I started a fast yesterday and this morning it's asking me if I want to start
  a fast."*

One fast per day key means the second fast of a day overwrites the first, and a
fast longer than a day cannot exist. **INFERRED** that attribution is the start
day, from the wording of the third complaint.

### BodyFast — a schedule, not a log, and it never splits

The most divergent model: *"BodyFast does **not** offer a start/stop button for
fasting periods, as the app is based on a weekly fasting plan approach"*
([help](https://help.bodyfast.app/hc/en-001/articles/34652339210258-Is-there-any-start-stop-option-for-my-fasting-times)).
There are no fast records at all — the unit is a *period* in a week grid, and
the **eating window is first-class**: *"white represents your eating periods and
green… represents your fasting periods"*
([help](https://help.bodyfast.app/hc/en-001/articles/34652478669074-I-don-t-understand-my-fasting-times-What-should-I-do)).

A midnight-spanning period is **one continuous block labelled by its start day,
never split** — the official example is *"daily fasting periods from 8 pm to 12
pm the next day (a 16:8 schedule)"*
([help](https://help.bodyfast.app/hc/en-001/articles/34643250676242-What-does-a-typical-intermittent-fasting-week-look-like)).
The artifact of that choice is instructive: **BodyFast weeks sometimes have eight
days**, on purpose — *"On the last (eighth) day, you can plan and start your new
fasting week"*
([Why does a week have 8 days?](https://help.bodyfast.app/hc/en-001/articles/34645008669202-Why-does-a-week-have-8-days)).
A period that overruns the grid's right edge gets an extra column rather than
wrapping. There is a companion article for the mirror-image
[gap at the start of the week](https://help.bodyfast.app/hc/en-001/articles/34644968794258-My-fasting-plan-has-a-gap-at-the-beginning-of-the-week-What-can-I-do).
And a review at exactly that seam: *"The end of the week when I have to start my
schedule over **I lose the fast stats for that day**"* (2 stars, id 1189568780).

### MyFitnessPal — the hybrid, and a correction to a claim made earlier

**Documented:** *"Each bar represents one completed hour toward your daily
fasting goal"*, and **"A partially filled tracker still counts."** Fasting
History *"shows **a list of your logged fasts and a graph of your day-to-day
progress**"* — both shapes coexist. Manual logging asks for *"the date and time
your fast started and ended"*, and entries are individually editable
([support](https://support.myfitnesspal.com/hc/en-us/articles/10983207647117-Track-Intermittent-Fasting-with-MyFitnessPal-Premium)).
Forgetting to stop is acknowledged rather than guarded: *"the timer keeps running
until you end it."* Premium only, and phone-only.

**A trap worth recording, because it nearly landed in this ADR.** Secondary SEO
articles state that MyFitnessPal's time wheel cannot go back past midnight and
that the workaround is to start every fast at 12:00 AM and note the real time
elsewhere. That is a tidy story, it fits the thesis of this document, and **the
vendor documentation contradicts it** — MFP captures a *date and time on both
ends*, so a 10pm start is representable. It was believed here for about an hour
on the strength of one search result. MFP is a *hybrid*, not the pure per-day
model, and the honest per-day cautionary tale is FastHabit above.

### Simple, Fastic, Window, DoFasting, Fastient

- **Fastic** — one row per fast, both ends carrying a date: *"Choose the date and
  time for when you 'Started' and 'Ended' your fast"*
  ([add](https://fastic.freshdesk.com/support/solutions/articles/47001220440-how-do-i-add-a-fast-to-my-fasting-history-)),
  edited as *"the 'start time' and 'end time'"*, with occupied time greyed out
  rather than rejected on submit
  ([edit](https://fastic.freshdesk.com/support/solutions/articles/47001220443-how-do-i-edit-my-fasting-history-)).
  Streaks are gamified: a **Flame** per successful fast and **Frosties** as an
  explicit streak-freeze
  ([Fasticpedia](https://fastic.freshdesk.com/support/solutions/articles/47001203525-what-are-flames-stars-and-frosties-)).
  Midnight rule undocumented. Complaints include a graph that *"often incorrectly
  shows I've been fasting for 24 hrs"*
  ([Play](https://play.google.com/store/apps/details?id=de.fastic.app)) and a
  **midnight-boundary editing bug** — water cannot be edited *"after midnight has
  passed; only option is to delete."*
- **Simple** — a **week strip, not a month grid**, opening a vertical timeline
  for the day with fast, meals, hydration, steps and weight
  ([Help Center](https://help.simple.life/en/articles/9887852-navigating-the-app-overview-of-main-features)).
  Fasts are bounded by meals, and two hard rules are really data-loss rules: a
  fast **under 12 hours cannot be logged as complete**, and fasts over 24h
  *"might not appear in your stats"*
  ([logging/editing fasts](https://help.simple.life/en/articles/9887903-how-to-log-and-edit-fasts)).
  Complaint: *"after the fast time is up, it just stops. It should keep the time
  you're fasting past your allotted period."*
- **Window** — a **timeline view like a daily calendar** showing fasting *and*
  eating windows, plus a month view of *"the length of each day's eating window
  at a glance"* ([site](https://windowfasting.co/)). **INFERRED:** it keys the
  calendar to the **eating window**, which rarely crosses midnight — sidestepping
  the problem entirely. A 1-star review implies a per-day key: an eating window
  may be opened *"ONE TIME PER DAY"*. Also *"It constantly says I'm fasting when
  I've stopped the clock."*
- **DoFasting** — a time wheel with metabolic mile markers; history is stats and
  weight graphs. Undocumented attribution, but a **documented day-rollover bug**:
  when a fast *rolls over into the next day*, editing start/stop makes the app
  *"almost always"* unstable ([reviews](https://apps.apple.com/us/app/dofasting-intermittent-fasting/id1456288628?see-all=reviews)).
- **Fastient** — per-fast rows with journal, mood and weight, CSV import of
  historical fasts, and a cancel that means the fast *"will not add to your
  stats"*. **No calendar view at all** ([site](https://fastient.com/)).

### The bug class is real enough that a competitor ships fixes for it by name

*Fasted*'s release notes, verbatim
([Play](https://play.google.com/store/apps/details?id=app.fasted.fasting)):

> the target time now **shows the right day on fasts that run past midnight** …
> **Streaks now count correctly across midnight, travel, and time-zone changes**
> … Fixed calendar and date issues including **month boundaries and daylight
> saving**.

And Cronometer's forum is a catalogue of the same failures, with staff
confirmation: **editing a midnight-spanning fast corrupted its dates** — a fast
Oct 30 18:30 → Oct 31 15:20 saved as start `00:30`, end `00:20`, the date
component lost, moderator replying *"reported by some other users… our developers
are on it"*
([thread](https://forums.cronometer.com/discussion/comment/9858)); **history
hours off by one** because *"If the fasting duration minute is over 30, the hour
incorrectly gets rounded up"*
([thread](https://forums.cronometer.com/discussion/2983/fasting-times-bug)); and
a time picker with **no midnight at all** — *"the 24-hour clock rolling selection
only has 1-23 for the hour… There is no way for me to specify a midnight start at
00:00"*
([thread](https://forums.cronometer.com/discussion/2726/bug-fasting-clock-missing-00-00-midnight-time-option)).

### Adjacent precedent: Oura already solved this, and this repo already reads Oura

Sleep trackers hit the identical problem and, unlike fasting apps, they document
it. **Oura defines several domain-specific days rather than one** — *Calendar
Day* (12am–12am), **Sleep Day (6pm–6pm)** and **Activity Day (4am–4am)**, each
labelled with the first day's date, so dancing until 3am on New Year's Eve counts
toward **December 31st**
([Oura partner support](https://partnersupport.ouraring.com/hc/en-us/articles/29160913203219-Understanding-the-Different-Types-of-Oura-Days-in-Oura-API-Data)).
Health Connect documents nothing equivalent, and Samsung's guidance supplies the
practical workaround: *"Since a sleep session can start on the day before the
selected date, be sure the application also retrieves sleep sessions from the
previous day and later ignores the sessions that do not match the desired time
range"*
([Samsung](https://developer.samsung.com/health/blog/en-us/managing-sleep-data-with-samsung-health-and-health-connect)).

Two things follow for Ignia specifically. First, **multiple named day concepts is
the mature answer**, not a hedge — which is exactly the shape of the decision
below. Second, this is not abstract here: ADR-0030's **Q5 is still open** on
whether importers keep their source's day, and
[ADR-0026](0026-oura-through-the-os-health-store.md) already puts Oura data in
this app. Any fasting query that scans "the day's" records will need Samsung's
previous-day widening for the same reason a sleep query does.

### The observed design space

| Rule | Who | Consequence |
|---|---|---|
| **Start day** | Zero (INFERRED from its export), BodyFast (documented), FastHabit (INFERRED) | Simple; but if the day is also the *key*, a second fast overwrites the first and a >24h fast cannot exist (FastHabit) |
| **Split across both days** | **LIFE (the only documented rule)**; jbpauly's `daily_cumulative_hours` | No day is ever empty during a normal 16:8 run; but no day ever shows the number the user would say out loud |
| **End day** | Fitbit's sleep convention (INFERRED) | Nobody in fasting does this |
| **Key on the eating window** | Window (INFERRED) | The eating window rarely crosses midnight, so the problem mostly vanishes |
| **A custom day boundary** | Oura's 6pm–6pm Sleep Day (documented) | Makes the normal case fall inside one day by construction — and Ignia already has this machinery in ADR-0030 |
| **No day at all** | Zero's >24h-gap streak and its "last 7 **fasts**" graph | Sidesteps calendars entirely; most correct, least legible |

### What could not be determined

Midnight attribution for **Fastic, Simple, DoFasting, MyFitnessPal and Window** —
five of the eight primary apps — is undocumented and was not inferable. How a
fell-short fast renders is unknown for four of them. Whether **any** shipping app
besides the defunct LIFE splits a fast across two days could not be established.
And Reddit, the likeliest source of honest complaint detail, was unreachable.


## Options

### A. `dailyFasts/{dateKey} { hours }` — a per-day scalar, matching `dailySleep`

Cheapest, and it looks right: it mirrors `dailyWater`, `dailySleep` and
`dailyActivity` exactly, the rules block is a copy-paste, and `DaySummary` gains
one number. `breakFast` computes the hours and writes them to a date key.

**Rejected, and FastHabit is the reason.** Making the day the key is not a
storage detail; it is a product limit, and FastHabit's users have already
written the bug report for us — *"keeps replacing the last fast if you try to
start one on the same day"*, and *"how can you fast more 20 hours and start days
not be the same"*. One fast per date key means the second fast of a day silently
overwrites the first, and a fast longer than a day cannot be represented at all.
Stephanie fasting 20h on a Tuesday, then again on Tuesday evening, would lose
one of them with no error.

Beyond that, `breakFast` must pick a date key, which means picking one of the
four rules in the table above and being wrong in whichever direction. And it is
lossy at write time: once "16h" is on Tuesday,
the app can no longer answer *when* the fast ran, cannot render an eating
window, cannot detect overlaps, cannot let anyone edit a start time, and cannot
change its mind about attribution later without a migration it has no data to
perform. Every one of those is recoverable from intervals and none is
recoverable from a scalar. It also collides with ADR-0030 in the worst way:
moving the day boundary would re-bucket every other day type correctly and leave
fasting frozen at whatever key was baked in on the day it was written.

### B. Infer fasts from meal timestamps — no new writes at all

The app already knows when the last meal of one day and the first of the next
were logged. The gap between them *is* the fasting window, derivable from
`DailyLog.date` with zero new storage, zero new rules and full retroactive
history back through the whole log window.

**Rejected, and it is the most tempting option here.** A logged meal is not a
meal. Under-logging is the single most common user behaviour in this product,
and this design converts "I forgot to log dinner" into "you fasted for 20
hours". That is precisely the garbage-data complaint the Zero reviews describe,
except self-inflicted and unfixable, because there is no user action that
corrects an inference. It would also silently disagree with the timer she
actually pressed. Derived-from-absence is not a measurement.

### C. Store the fast as an interval, derive every per-day view from it

One document per completed fast, `{ startedAt, endedAt }`, and every per-day
number computed in `packages/core` from the intervals plus the ADR-0030
boundary. This is what Zero and Fastic do, and it is the only option under which
the two questions in the table can have two different answers.

**Chosen.** Details below.

## Decision

### 1. A fast is an interval, and it gets its own collection

```
users/{uid}/fasts/{fastId}
  startedAt: Timestamp      // required
  endedAt:   Timestamp      // required; a doc exists only for a COMPLETED fast
  source?:   'timer' | 'manual'   // 'manual' ⇒ entered or corrected by hand
```

Modelled on `workoutSessions/{sessionId}` (event-shaped, id-keyed), **not** on
`dailySleep/{dateKey}` (day-shaped) — and that choice is the whole ADR.
`fastId` is Firestore-generated; the date is never part of the key, because the
key would be an attribution decision baked into an identifier.

**`Profile.fastStartedAt` stays exactly as it is** and keeps its current
meaning: the *in-progress* fast, or null. Nothing about the Today timer, the
Live Activity's reconcile model (ADR-0021) or the cross-frontend write path
changes. The new collection is the archive; the profile field is the pointer.

`breakFast` becomes read-then-write and **must be a `writeBatch`** — create the
`fasts` document and null `fastStartedAt` in one atomic commit. Split into two
writes, a failure between them either loses the fast or leaves a phantom timer
running, and both are the exact bug class the Zero reviews describe.

### 2. Two questions, two named functions, neither called "fasting hours"

A new pure module in `packages/core` (`fasting-history.ts`), taking `DayBoundary`
explicitly like every other ADR-0030 consumer:

- **`completedFastHours(fasts, dateKey, boundary)`** — the total length of fasts
  whose **`endedAt` falls on `dateKey`** under `dayKeyAt`. This is the headline
  number and the one that appears in History rows and the CSV. One fast lands on
  exactly one day, so sums, averages and weekly figures are correct by
  construction, and an in-progress fast contributes nothing until it ends.
- **`fastingOverlapHours(fasts, dateKey, boundary)`** — how many of that day's
  hours were spent fasting, computed by intersecting each interval with
  `dayRange(dateKey, boundary)`. Bounded to `[0, 24]` by definition. Used for
  the calendar and for any future correlation work; **not** shown as "your
  fasting hours", because it is not the number she would say out loud.

**The end-day rule is the closest call in this ADR, and the research argues
against it.** Zero — the most mature product in the category — attributes to the
**start** day, and BodyFast does too. The reasons to diverge are that end-day
matches how a person narrates a fast (*"I broke a 16-hour fast this morning"*),
and that it puts the number on the screen on the day she is looking at it: she
ends the fast at noon Tuesday and Tuesday's row gains "16h" immediately, rather
than a row for a day already past quietly gaining a number she may never scroll
back to. Under start-day attribution *both* days still read 0h all through the
overnight fast, so end-day does not lose anything start-day had.

The **only documented rule in the entire category is LIFE's split**, and this
decision adopts it — for the calendar, where it is right, and not for the
headline, where it would mean no day ever shows the number she is proud of.

Because the storage is intervals, **this is the one decision here that is cheap
to reverse**: changing attribution later is a change to one pure function and
its tests, with no migration and no data loss. That is a large part of why
Option A was rejected — under a per-day scalar this paragraph could not be
written.

The known cost of end-day is that the start day's row carries no headline
number, and that is paid for in the calendar, not by fudging the headline:

- **The month grid gets a third dot when a fast *overlaps* the day** — so an
  8pm→12pm fast marks Monday *and* Tuesday. Different question, different rule,
  and both rules are written down here so the next reader does not "fix" one
  into the other.

`DaySummary` gains **`completedFastHours: number | null`** (null when no fast
ended that day) and nothing else. `fastingOverlapHours` stays a call, not a
field, so `DaySummary` does not grow a second fasting number that looks
interchangeable with the first — `CONTEXT.md` opens by forbidding exactly that.

### 3. Editing is the feature, not the polish

Restore what `fb166b5c` deleted, on mobile:

- **Set or correct the start time when starting a fast.** `startFast` already
  accepts an optional `startedAt` on both adapters; only the UI is missing.
- **Edit a completed fast's start and end from the History day detail**
  (`history/[date].tsx`), and delete it.
- **Reject overlap**, following Fastic: grey out time already covered by another
  fast rather than validating after the fact.

Every hand-corrected fast is written with `source: 'manual'`, so the record
carries whether it was measured or asserted — the same distinction
`dailySleep`'s `source` field already makes, and for the same reason.

### 4. A stale-fast guard, entirely on the device

If `fastStartedAt` is more than **36 hours** old, Today stops showing a growing
number and asks *"Still fasting?"* with **End now** / **Yes, still going**. No
auto-end — ending someone's fast for them invents data — but no silent 200-hour
counter either. `firestore.rules` also gains a ceiling on the stored interval
(**≤ 14 days**) so a corrupt write cannot become a permanent outlier in every
average.

This is a local check on data already in memory. **No Cloud Function, no
scheduler, no push.** Cloud Scheduler's three-job free tier is fully spent
(`hourlyTasks`, `statusPulse`, `weeklyFirestoreBackup`) and nothing here needs a
fourth. If a reminder is ever wanted at the end of a fast window, it belongs in
the existing **local** `expo-notifications` path (`apps/mobile/src/lib/reminders.ts`),
which costs nothing and requires no token infrastructure.

### 5. It goes in the export on day one

`buildCsv` gains a `fast` row type: `type=fast`, `date` = the end day key,
`timestamp` = `startedAt`, plus `fastEndedAt` and `fastHours`. This is the
sentence in the original request finally becoming true, and — per the LIFE
Fasting Tracker shutdown — it is what makes the history survivable if the user
ever leaves.

### 6. Mobile-first, and mobile-only for now

The web logging app is frozen for features
([ADR-0022](0022-web-pwa-frozen-not-retired.md)). The web keeps its Today timer
and keeps writing `fastStartedAt`; its History gains nothing. **But the web's
`breakFast` must still write the `fasts` document**, or a fast ended on the web
disappears exactly as it does today. That is a correctness fix under the freeze,
not a feature, and it is the one piece of web work this ADR requires.

`packages/core` holds all the math, per the standing rule that cross-frontend
domain logic is what keeps a frozen frontend correct with nobody porting to it.

## What this ADR deliberately does NOT do

- **No goal, no protocol picker, no streak — yet.** Every competitor leans on
  16:8 / 18:6 / OMAD, and a `fastGoalHours?: number` on the profile is the
  obvious follow-up. It is deferred on purpose: ADR-0030's own lesson is that
  shipping the visible half before the derivation is settled produces the worst
  available outcome, because it looks fixed. Phase 1 is the record and the
  read. If a streak is later wanted, **start from Zero's gap rule** (no more
  than 24h between logged fasts) rather than inventing a per-day attainment
  rule — it sidesteps the attribution question that the rest of this document
  is about.
- **No backfill, and no pretending.** Nothing recoverable exists. The first
  History screen after this ships must say so rather than showing an empty
  calendar that reads like data loss.
- **No fasting ring on Today, and no metabolic-stage timeline** ("ketosis at
  12h, autophagy at 16h"). The stage timeline is the single most common feature
  in this category and the claims behind it are not supportable at the
  confidence the UI would imply — the same call ADR-0028 made about stretching
  and soreness, and this product is positioned on measured honesty.
- **No minimum or maximum length that silently discards a fast.** Simple refuses
  to log a fast under 12 hours as complete and warns that fasts over 24h *"might
  not appear in your stats"*; Zero's reviewers report fasts *"deleted for no
  apparent reason other than the fact that they went over 24 hours"*. Every fast
  the user ends is stored and shown, however short or long. The 14-day rules
  ceiling in item 4 is a corruption guard, not a product opinion, and it is far
  outside any real fast.
- **No inference from meal gaps** (option B), in any form, including as a
  "suggested fast" the user confirms. A suggestion sourced from missing logs is
  still sourced from missing logs.
- **No AI anywhere near this.** Nothing here needs a model, and the owner is
  AI-cost-averse.
- **No new scheduled function, no push infrastructure, no `minInstances`.**
  The marginal cloud cost of this feature is one extra document write per
  completed fast and one bounded listener on History — that is, effectively
  zero, and it must stay that way.
- **No shared subscription cache.** History subscribes to `fasts` itself, in its
  own hook, bounded (`orderBy('endedAt', 'desc')`, limited). That is ADR-0016's
  model, not a violation of it; do not extract a shared fasting context.

## Consequences

- **A new top-level shape means rules ship first.** `firestore.rules` gains a
  `match /fasts/{fastId}` block — `startedAt`/`endedAt` are timestamps,
  `endedAt > startedAt`, duration ≤ 14 days, `source` in the enum — and it must
  be **deployed before any client writes**, because the dev app talks to
  production Firestore. Covered by `npm run test:rules`.
- **`breakFast` stops being a one-liner** on three adapters (mobile ledger,
  `FirebaseService`, `in-memory-ledger.adapter`) plus the `LEDGER_PORT`
  interface. Per the port/adapter rule, all of them change, not just Firebase.
- **Two fasting numbers now exist** and they can legitimately disagree for the
  same day. That is the point, and it is also the most likely thing for a future
  reader to "simplify" into one. The names are load-bearing.
- **History rows get a third piece of data** (`… · 16h 20m`) and the month grid
  a third dot. Both are small, and both are the surface the request actually
  asked for.
- **Once fasts are stored, bad fasts are stored too.** Item 4's guard and item
  3's editor are not optional extras attached to this decision; without them
  this ADR ships the Zero complaint.
- **Any query for "the fasts on this day" must widen by a day and filter.** A
  fast overlapping Tuesday can have both timestamps outside Tuesday's
  `dayRange`. This is the same correction Samsung documents for sleep sessions,
  and it is the single most likely implementation bug: a `where`-clause bounded
  to the day silently drops exactly the overnight fasts this ADR exists to show.
- **i18n:** new mobile keys in flat form with `{n}` interpolation, both locales,
  `en` and `es-PR` in parity or `npm run doctor` fails.

## Follow-ups outside this decision

`CONTEXT.md` needs two corrections regardless of whether this is built: the
**FastWindow** glossary entry claims a *"target 16h"* that does not exist in
code, and the **Body** tab entry still lists a *"fasting ring"* that
`fb166b5c` deleted.
