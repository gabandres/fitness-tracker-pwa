# Changelog

Significant ships to [ignia.fit](https://ignia.fit) and the Ignia iOS app, newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

## 2026-08-24 — 1.2.1 is on the App Store, and with it a fortnight of work

Public iOS had been sitting on **build 55** since 2026-08-19 while every OTA
published since targeted **build 60's** runtime, which is TestFlight-only. So a
large body of finished work — the per-run TDEE fix, custom calorie and protein
targets, the in-app feedback box, the bottom-sheet sweep, kilograms, the
glossaries, and the *Help and support* link that had been silently doing
nothing for ten days — was real, shipped, and reaching nobody who had installed
Ignia from the store.

**1.2.1 / build 60 is now `READY_FOR_SALE`.** It released itself: the version's
`releaseType` was switched from `MANUAL` to `AFTER_APPROVAL` the night before,
so Apple's approval published it without anyone watching for it. Under MANUAL
an approved build waits for a human, which is a quiet way to lose days.

`app-version.json` drifted the moment it landed — it still advertised iOS build
55, so anyone on 55 was being told they were current. `npm run doctor` caught
it; the number is re-derived from the `READY_FOR_SALE` version and deployed.

## 2026-08-23 — the pages say what they are, to a crawler that runs no JavaScript

Measured on 2026-08-17: 110 of 114 sitemap URLs were *unknown to Google*, and
what a first-pass crawler received on every page was `<app-root></app-root>` —
a title, a one-line description, and nothing else. The footer work that day
gave the site a link graph. This gives it words.

Every content route now ships its real copy in the served HTML, read from the
same i18n bundles and `vs-data.ts` the components render from — so a copy edit
or a translation lands in both surfaces or in neither. Live and verified on
`ignia.fit`:

| Page | Before | Now |
|---|---|---|
| `/privacy` — the URL App Review requires | title + 1 line | 6,571 chars, 10 sections |
| `/es/privacy` | title + 1 line | 7,035 chars, 10 sections |
| `/terms` — the URL the listing points at | title + 1 line | 10 sections |
| `/faq` | title + 1 line | 12 questions and answers |
| `/vs/<competitor>` | title + 1 line | the comparison table, as a real table |
| 36 macro brackets · 8 calculator variants | title + 1 line | their figures and their copy |

`/changelog`, `/status` and `/transformations` are deliberately unchanged —
they are generated at runtime and have no static copy to lift.

It goes inside `<noscript>`, alongside the heading fallback from 08-17: anyone
with JavaScript gets the app byte for byte as before, there is no flash of
static copy under the SPA, and there is no second visible body to drift. It is
the same text the page renders, so it is a fallback and not a cloak.

The legal pages fail the BUILD if a section is added to i18n and not carried
over — a compliance page that is complete in the app and truncated to a crawler
is exactly the drift nothing else here would report.

**This changes what Google finds; it cannot make Google come.** Re-measure with
`node scripts/gsc.mjs inspect` before claiming any of it worked.

## 2026-08-23 — the watch reads correctly on both sizes, in both languages

**#46 is closed, and it was the last open item of the 16-ticket Apple
glanceable-surfaces map.** The watch app was built for the simulator on
`ignia-mac` and captured at **40mm (324x394)** and **46mm (416x496)**, each in
English and es-PR — four renders, from a seeded App Group snapshot rather than
an empty screen, so the numbers, the progress bar and the timestamp all had
real content to lay out.

Nothing is clipped, nothing overflows, and nothing truncates. Spanish runs
longer than English at every line — *kcal restantes* against *kcal left*,
*proteína 92/145* against *protein 92/145* — and still fits on the 40mm face,
which is the case that would have broken first. The timestamp localises
properly too: *as of 10:15 PM* becomes *a las 10:15 p. m.*

The one difference between the sizes is the diagnostics footer, which is below
the fold at 40mm and on screen at 46mm. That is not clipping: the view is a
`ScrollView`, chosen deliberately and commented as such at
`targets/watch/index.swift:281` because the screen has more content than the
smallest face shows at once.

Worth knowing for the next person: the watch is **not** localised through
`.lproj`. Both string sets are compiled into `Glance.swift` and selected by a
`locale` field on the snapshot the phone pushes — so a watch with no paired
phone shows the empty state in one language, and the way to exercise the other
is to seed `group.fit.ignia.app` / `ignia.widget.snapshot.v1` directly
(`defaults write … -string`, and the `-string` matters: without it `defaults`
parses the JSON as a plist and silently writes nothing).

## 2026-08-23 — email in Portuguese, a site that finishes what it starts

**Email speaks all three languages now.** Ignia has shipped Portuguese in the
app for a day; the mail it sends still arrived in English, because five
separate places in the server decided the language by hand and every one of
them could only choose between English and Spanish. One of them stored it as a
yes-or-no. They all go through one list now, so the next language is a row
rather than a hunt.

Two things were wrong in English and Spanish too, and had been for a while.
The weekly recap printed your weight change in **pounds no matter what**, even
after the app itself learned kilograms — so the same week read −1.4 lb in your
inbox and −0.6 kg on your phone, with nothing to say which was real. And the
line telling you how to turn the recap off named a setting that does not
exist: it said *Weekly digest*, the app says **Weekly recap email**. Anyone who
went looking found nothing. Numbers in the recap are also written the way your
language writes them now — in Brazil, 2.100 rather than 2,100.

**Ignia has a real support address.** Writing to `support@ignia.fit` now
reaches a person. It also replaces a personal Gmail that was published in
thirty-two places across the terms, the privacy policy, the support and
download pages and the app's About sheet — including as the address for
data-deletion and GDPR requests.

**The landing page finishes the thought it starts.** ignia.fit opened in one
voice and, past the first screen, quietly became a different website — generic
headings, a different typeface, the same three sentences said four times over.
It reads as one page now, it is shorter, and the three grey circles pretending
to be other people's faces are gone. They stood for nobody.

**Ignia is operated by Bermudez Systems LLC.** The terms and the privacy policy
name the company; until today they said Ignia was run by an individual and not
a company, which stopped being true some time ago.

---

## 2026-08-23 — the Android app got a quarter smaller

Nothing on screen changed. The download did: the Android bundle went from
**19.0 MB to 14.4 MB, −24.2%**, and that is paid back on every update download
and every cold start.

Almost all of it was weight nobody had asked for. The app draws its icons from
one family, Ionicons — but it imported them through a package barrel that
re-exports **twenty** icon families, and the bundler dutifully shipped all
twenty fonts. The same trap applied to the typeface: two Manrope weights are
used, the barrel re-exports seven plus a variable face, and all of them were
being shipped. Naming the two weights directly took the app's font assets from
**5.7 MB to 1.6 MB**.

The fix is nothing but import paths, so it reached existing testers over the
air rather than needing a new build. A budget file now records these numbers
and fails the build if they creep back — the previous 2 MB of growth went
unnoticed for a day precisely because nothing was watching.

---

## 2026-08-22 — kilograms, a name for the food search, and what the numbers mean

Four things people kept running into, cleared out together.

**Kilograms.** Body weight was pounds-only everywhere — onboarding, the Body
tab, your weigh-in history, the workout finish sheet — with no way to change
it. There was a units setting, but it was called *Portion display* and the
name was honest: it reached food serving sizes and nothing else. So if you
think in kilograms, typing **68** at setup got you a plan built for a 68 lb
person, and nothing anywhere said so. It's fixed: Settings → **Units** now
governs weight everywhere — your body weight *and* what's on the bar.

The barbell half is the fussier one and worth saying out loud. A metric gym is
not an imperial gym with the numbers translated: the bar is 20 kg, not 45 lb
converted; the plates are 25/20/15/10/5/2.5/1.25, and there is no such thing as
a 20.4 kg plate. So the plate helper solves in kilograms with kilogram plates
rather than working it out in pounds and converting the answer — which is how
you end up telling someone to load a plate that does not exist. Your weight
step defaults to 2.5 kg instead of 5 lb for the same reason: it is the smallest
pair on the rack.

Everything is still stored one way underneath, so switching units does not
strand your history — this month still compares to last.

**The food search had the wrong name.** The + button offered *Scan meal* and
*Manual entry*. But "Manual entry" opens a food search — a database of tens of
thousands of foods — so the easiest path in the app was labelled as the
tedious one. It's called **Search foods** now. Typing the macros in yourself
is still there, one tap further in, where it belongs. The sheet has a title
now too.

**The + button stopped covering the button underneath it.** On a smaller
phone, an empty Today drew the orange **+** straight over *Repeat yesterday* —
the one thing to tap on the first screen a new user sees.

**And the numbers explain themselves.** Today leads with `0 / 2,323 kcal` and
`maintenance 2,723`; Trends leads with a **MEASURED** badge and *73% logging
completeness*. None of that was defined anywhere. There's a **?** on both
screens now — the same one the Train tab has had — with plain-language
definitions: what kcal actually is, what maintenance means, what the MEASURED
badge is claiming, and whether 73% is good. (It is. Nobody hits 100%.)

One quieter fix underneath: if your goal is to **gain**, the app was doing the
arithmetic backwards. Your weekly pace was applied as a deficit no matter
which direction you'd picked, so a few weeks in, someone trying to put weight
on would have been handed a target *below* what they burn. It now points the
way you asked for.

---


## 2026-08-22 — the app stopped guessing your calories from your weight alone

The first number Ignia ever gave you was your body weight times a constant:
**11 to lose, 14 to maintain, 17 to gain**. No height, no age, no sex, no
activity level.

That is wrong in a specific and unfair direction, and the app already knew it
— the correct formula (Mifflin-St Jeor) has been in here the whole time, along
with the four questions it needs. They just lived in **Settings → Refine
targets**, behind a subtitle reading *"Sharpen your calorie target"*, which
reads like an optional extra for people who enjoy settings screens.

Here is what that cost. Take a 180 lb 45-year-old woman, lightly active. Her
estimated maintenance is about **1,978 kcal**. Ignia's "lose fat" target for
her was **1,980** — two calories *above* the amount she burns. She could have
followed it perfectly, forever, and lost nothing. A man of the same weight,
same age, same goal was given the identical number, and for him it was a real
deficit: 0.69 lb a week. Same app, same inputs, one of them losing weight at
2.4× the other's rate, for no reason either of them could see.

So onboarding asks now. Two short steps after your goal weight — sex, height
and age on one screen, how active you are on the next — and the target is built
with the app's own arithmetic from the start instead of weeks later. That
woman's target is now **1,500**, and the screen says why: it is the lowest
daily target we'll recommend, and her full 1 lb/week deficit would have gone
under it.

Both steps are **skippable**. Nobody is locked out of the app for declining to
state a sex, and if you skip, you get the old weight-only estimate — but the
plan screen tells you that is what you're looking at, rather than presenting a
rougher guess as though it were the same thing. Answering later in Settings →
Refine targets still works exactly as before.

Two smaller things came with it: the plan screen now shows what we estimate you
burn in a day, not just what to eat, and if the safety floor is holding your
target up, it says so instead of quietly handing you a number you didn't ask
for.

---

## 2026-08-22 — a tour, because someone asked to be shown around

The report reached us second-hand and as one sentence: the app is not intuitive
for women. Asked what that meant concretely, the answer was specific and
buildable — **she needs some kind of tutorial or something. Like a walkthrough
of the app.**

Fair. Ignia never explained itself. You finished setup, landed on Today, and met
`0 / 2,323 kcal`, `maintenance 2,723`, a fasting card and an orange **+**, with
nothing naming any of it. That works if you learn software by tapping at it
until it makes sense. Plenty of people don't, and the app had nothing for them.

So there's a tour now. Six cards: the whole app first, so you can see its shape
before meeting any of it; what the numbers on Today actually mean; the three
ways to log a meal; weighing in, and why one heavy morning isn't a verdict; whose
numbers these are and how to change them; and a close that says the thing none of
the rest of the app says — **nothing here is permanent.** Every meal, weight and
goal can be edited or deleted, so there is no wrong way to start.

It opens itself once, it's skippable from any step, and it lives permanently at
**Settings → How Ignia works**. A tour you can't reopen punishes anyone who
dismissed it before they understood it.

One thing it deliberately is not: a different app for different people. The
research this drew on (GenderMag, Burnett et al.) is clear that these are
statistical clusters in how people approach unfamiliar software, not rules about
individuals — so the tour is one path anyone can take, and there is no branch in
it anywhere.

Also fixed, from a screenshot sent the same afternoon: when you typed a water
amount, the sheet sat marooned above the keyboard with a band of empty space
between them. Two bugs cancelling each other out — the sheet was reserving room
for a navigation bar the keyboard was already covering, *and* the lift was
parking it below the keyboard's top edge. The sheet sits on the keyboard now.

---

## 2026-08-22 — water takes the amount you actually drank

The feedback box shipped this morning. Ten hours later it produced its first
real report, in Spanish, from someone who had never messaged us before:

> *"solo se pueden anotar las opciones q estan puestas ahy no hay un opcion
> customizada cmo poner 5oz"*

He was right. The +8 / +16 / +24 buttons cover the common glass and nothing
else. Tap the water number now and you get a field: type 5, see **0 → 5 fl oz**,
save. The buttons stay where they were for the common case, and a small *Set
total* link handles the rarer job of correcting a wrong total rather than adding
to it.

Fixed along the way: on phones with a software navigation bar, the bottom of
every sheet sat underneath it — the Save button was clipped and would miss taps
near its lower edge. That affected the sleep sheet too, and had since it was
written.

---

## 2026-08-22 — three things a user asked for, and one of them was two bugs

All three came from one person writing in over chat, in Spanish, against the
live Android build. None were found by a test, and one had already been
misdiagnosed by us.

**The + button stops covering the screen.** He reported the Scan meal / Manual
entry pills sitting on top of a finished photo scan, over "Add today".
Reproduced on an LG G6 before anything was changed, and it was **two** defects,
not one. The label pill was a plain view, so it became the touch target and no
ancestor was a responder — tapping the words "Scan meal" did nothing at all,
while the same tap 90 px right on the circle worked fine. And hardware back
navigated out from under the open dial, landing on Today with it still fanned
open. Pill and circle are one control now; back dismisses the dial; any route
change closes it.

The same state had been hit by the Maestro suite hours before he reported it,
and was written up in that flow as a test-harness artifact because the flow was
**green** — `assertVisible` passes on a screen mounted underneath an overlay.
It was his bug. The workaround is deleted.

**You can set your own calorie and protein goals.** There was no input control
anywhere, and — worse — the number onboarding computed was a *seed*: once the
estimator had enough data it silently replaced it, so someone who thought they
had chosen 2,000 found 2,410 a fortnight later with nothing saying why. Targets
now carry an explicit Automatic/Custom mode. Custom beats the measured
estimate; the estimator keeps running and its answer stays on screen beside
your number, so you can see both and pick. Per field, so owning your calories
does not freeze your protein at whatever it was that day.

Switching back to Automatic no longer destroys what you typed. It used to have
to: whether a manual number existed *was* the mode, so Refine targets deleted
the values to hand control back, and the only route to a custom number again
was re-running onboarding.

A typed number below your calorie floor is refused rather than accepted and
quietly clamped up on display — the floor is where it always was, but now it
says so instead of overriding you.

**In-app feedback.** A composer in Settings, second section from the top, and a
standing line on the What's-new card. The channel already existed and was filed
under **Legal**, between Terms of Use and the medical disclaimer, which is not
where anyone goes to say "this is confusing". His point was the social barrier,
not the channel: people who would not message the owner directly will leave a
note inside the app. It arrived by private chat, which is the evidence.

Optional category chips that can be un-chosen, text only, and create-only —
you cannot read back what you sent, because there is no inbox and a readable
copy would imply one.

---

## 2026-08-21 — food search stops touching the network, and scanning gets faster

**Search runs on the device.** The whole 13,272-food USDA dataset ships inside
the app as a compact index, so typing a food makes no network call at all — no
cold start, no rate limit, no signal required. This was only possible because
`searchFoods` had stopped consulting Open Food Facts for text two days earlier,
which left the server holding nothing the bundle lacks. Barcode still goes to
the server and must: an Open Food Facts product is a live lookup.

Cost, measured rather than estimated: 334 KB gzipped, and the Android bundle
grew 11.1 MB → 13.1 MB. The ranking now exists in two places (the server's and
the bundle's), so 24 queries have their exact result order pinned in a shared
fixture and both copies are asserted against it — `npm run doctor` fails on a
stale index or a drifted ranking.

Proven on an LG G6 **with the radios off**: aeroplane mode, a search still
returns the right rows.

**Scanning got faster.** A meal photo comes back in about half the time
(warm: 3.39 s → 2.24 s, consistent across samples; the cold figure is too noisy
to quote). The model moved to a faster one at the same price, food loading
overlaps the model call, and two SDKs that every function was paying for on
every cold start became lazy requires — module load 535 ms → 230 ms.

On the client: photos upload at 768 px instead of 1080 (the model billed the
same either way, so the extra pixels only travelled), the scan screen shows
your photo and the step it is on instead of a blank spinner, barcode lookups
download about a sixtieth of what they used to, and anything scanned before
comes back from an on-device cache. A barcode that is not in the database now
says so, instead of asking you to scan it again — that one was the most common
outcome telling users to retry something that had worked.

Verified end to end on device, cache included: Wi-Fi off, a previously scanned
product still resolved.

**A failed photo scan no longer costs you a scan.** Two separate wrongs, found
by running into the daily quota on a real phone: input validation ran *after*
the charge, so a request with no image consumed a slot without a token ever
being spent, and no failure path called the refund that had existed, unused,
since the module was written. A scan reserved at 23:59:59 and refunded at
00:00:01 now credits the day it charged rather than handing out a free scan
tomorrow.

The asymmetry is deliberate: a failed scan refunds the user's quota but never
un-records the spend. The quota is a fairness mechanism and charging for
nothing is unfair; the ceiling is a solvency mechanism and the money left the
building either way.

---

## 2026-08-20 — maintenance stops being decided by the days after a break

A live account read maintenance **2,509** while its own gap-free history said
**2,266**. The whole number came from a nine-day stretch after a trip: ten
weigh-ins, a residual spread of 0.8 lb, and a slope that was not statistically
distinguishable from zero — t = −2.00 at 8 degrees of freedom, with a 95%
interval on maintenance running **1,775 to 3,242**. One number was printed from
that and the daily target moved 178 kcal.

Two faults, and the first was a comment. The block above `lastTrendSegment`
argues carefully for weighting each fit by its own precision and states that
`MIN_SEGMENT_POINTS` and `MIN_SEGMENT_SPAN_DAYS` are "no longer consulted" —
while the code twenty lines below still switched on exactly those two constants,
keeping only the most recent run and discarding everything before the gap. A
21-day travel break threw away 28 of 38 weigh-ins and 33 of 42 logged days. The
fix had been written down and never applied, and the prose was good enough that
it read as solved.

The second was that `TDEE = intake + deficit` was evaluated with its two halves
covering different days: intake averaged over the days that were logged, deficit
derived from a slope fitted across the calendar, unlogged stretches included.

Measured mode now splits the window into runs of continuous logging, works out
each run against its **own** intake, and pools them by precision. Both faults go
together — no stretch where intake is unknown is ever crossed, and a tight
three-week line outweighs a ragged one-week line with no threshold deciding it.
Smoothing the scale first was tried and dropped on evidence: raw pooling came out
tighter on the real account.

Same data, window ending on three different days: **2,266 / 2,010 / 2,509**
became **2,265 / 2,184 / 2,320**. The swing across those dates fell from 499 kcal
to 136, and today's figure landed inside the range that account's own gap-free
energy balance gives independently.

The trigger was ordinary. Stop logging for four days — travel, illness, a busy
week — and the window split. Anyone was one gap away from it, and it failed in
the flattering direction: too high a maintenance raises the target, so you eat
more, stall, and conclude the app does not work.

Shipped over the air to both platforms the same day; no binary was needed.
`packages/core` is not a fingerprint source, so it reached Android vc 37 and iOS
build 60 on their existing runtimes.

---

## 2026-08-20 — the activity correction comes out from behind its flag

It was built and hidden the day before, because the advice it would have given
was worse than the setting it proposed to replace. Two things fixed that, and
only one of them was arithmetic.

The label now names the value that actually gets stored. The five-bucket ladder
snapped a raw 1.279 to "sedentary", while what the app would save was the
floored 1.40 — nearest rung "light". So the card said one word and produced a
target consistent with a different one. It also mattered for the fallback: the
bucket is where the estimate lands if the multiplier ever goes missing, and
reverting to sedentary would have been worse than never having asked.

A consequence worth stating plainly: "sedentary" can no longer be *derived* at
all. Its rung sits below the minimum published for an adult who is not
bedbound, so no measurement can conclude it. Anyone may still choose it — that
is their answer about themselves — but a near-silent wearable is a fact about
the wearable.

And the card leads with the burn rather than the bucket: "your last 4 weeks put
your daily burn nearer 2,284 kcal than your current setting." A number someone
can hold against their own sense of themselves, computed from the same function
that stores it, under a line showing the active energy, the steps and how many
days actually carried a reading. A recommendation you cannot argue with is one
you can only obey.

The flag was deleted rather than switched off. A flag that guards nothing still
reads like a safeguard.

---

## 2026-08-20 — the activity multiplier stops being a five-rung ladder

The formula estimate rested on one of five hardcoded numbers, 0.175 apart —
±285 kcal/day on a typical basal, which is larger than the error they were
being used to correct. A real account's own device data implied 1.279, a value
the ladder cannot represent at all; it snapped to 1.2 and landed 17.9% below
that account's measured burn, worse than the setting it would have replaced.

`activityMultiplier` is continuous now, stored on the profile, and floored at
**PAL 1.40 — the FAO/WHO/UNU 2001 minimum for a free-living adult.** That floor
is the correction for what a wrist wearable cannot see: it measures *detected*
movement and misses most non-exercise activity thermogenesis, which runs to
several hundred kcal a day even for desk work. The evidence is that the raw
signal fell below the floor — 1.279 for someone walking 5,200 steps a day and
lifting three times a week is not a fact about the person.

The number is published rather than tuned. Fitting a constant until one
account's figures came out right is what produced the problem being fixed.

Anchor 2,530 → 2,285 against a 2,385 benchmark, and the gap between estimate
and anchor closes from 263 kcal to 18. That last number is the point: the two
now agree, so whether better logging nudges the estimate up or down stops
being a question anyone has to care about.

The bucket survives as the user's stated answer and as the word shown in copy;
the multiplier is what the arithmetic uses. They are allowed to disagree.

Shipped inert — no account carries the field yet, and the correction card that
would write it is still dark, held back because it names a bucket while doing
something the buckets cannot express.

---

## 2026-08-19 — the daily target stops swinging on a single weigh-in

One morning reading was worth 287 kcal of daily target. A 156.0 lb weigh-in the
day after 158.0 — water, on any reading of it — moved measured maintenance 484
kcal, because it sat at the end of an 8-day post-break line where a
least-squares fit gives a point the most leverage it will ever have.

Three changes shipped over the air to both platforms, and one measurement
overturned the diagnosis on the way. The segment/whole-window switch was blamed
first; it turned out the segment was selected at every step, so nothing was
switching. Two continuous replacements for that switch were built and both made
the numbers measurably worse, so neither shipped.

What did: **endpoint corroboration** — fit with and without the newest weigh-in
and take the smaller rate, so a new reading is adopted at once when it flattens
a trend and must be seconded when it steepens one. Then **`reliable` finally
affects the number**, blending a patchy estimate toward the formula anchor
(complete-record accounts are byte-identical). Then **one clamp**: every path
now reads its target through `finalCalorieTarget`, closing three call sites —
two of them feeding an LLM — that could state a figure below the user's own
calorie floor.

Measured on a real account over 14 days: the estimator's swing fell from 719 to
191 kcal, and day-to-day movement from 63 to 23.

Separately, the measurement window went from 28 logged days to **42**, which
fixes a sign error rather than an accuracy one: the window read ~7% low and the
activity anchor read high, the two cancelled, and the cancellation depended on
the user logging *badly*. At 28, logging perfectly returned a lower TDEE than
logging half the time. At 42 both readings land in range.

The activity bucket that anchor rests on is now known to be wrong too, and the
card that would correct it ships **dark** — on the account measured, its
suggestion is further from the truth than the setting it would replace.

---

## 2026-08-19 — Android vc 37 reopens the iOS OTA channel against build 60

A build-speed tweak cost an over-the-air fix path on the *other* platform, and
this is the binary that buys it back.

The ABI cut earlier the same day put `reactNativeArchitectures` in
`plugins/withGradleJvmArgs.js`. A config plugin's **file contents** are a hashed
fingerprint source, so an Android-only change moved the **iOS** runtime from
`7b347b0f…` to `6670f678…` — off iOS build 60, which was sitting in App Store
review. 1.2.1 was heading for public release with no way to ship a JS hotfix to
it: any bug found after launch would have needed a whole new binary through
review.

The fix cost one Android build and nothing on the App Store side. The plugin is
restored byte-for-byte and the ABI set moved to the **gitignored**
`android/gradle.properties`, written by `patch-android-release.mjs` — the same
place the release signing config and the EAS Update channel already live,
because that file is not fingerprinted. Measured on the machine that builds each
platform: iOS returns to `7b347b0f…` (= build 60) and Android to `ae526937…`.
The ABI cut itself survives — vc 37's bundle carries exactly `arm64-v8a` and
`armeabi-v7a` at 66 MB, built in 8m 56s.

Both OTA channels are open. vc 36 becomes an orphan runtime, superseded on the
same alpha track and drained by the update banner.

Two traps recorded rather than re-learned: `eas submit` **failed and exited 0**
(Play's edit expired mid-upload — the androidpublisher API is what caught it,
a fourth distinct way that command lies), and the Gradle runner recipe in
`build-android/REFERENCE.md` had its own backslashes already eaten, so it handed
out a path that collapses to `Z:macro-appappsmobileandroid`. The recipe now
passes the directory as `cwd` instead.

---

## 2026-08-19 — iOS 1.2.0 is live on the App Store

Approved and self-released (`AFTER_APPROVAL`) after four days in review;
confirmed `READY_FOR_SALE` via the ASC API, `app-version.json` re-derived
(ios 24 → 55) and deployed the same hour so returning PWA users see the
update banner. 1.2.0 closes the gap open since 2026-08-08: dictation, the
redesigned Add screen, the fasting Live Activity, the wide widget, the TDEE
corrections, and the verification-email fix all reach the public store at
once. Same-day coincidence worth the line: the operator transition also
completed its money layer — Relay approved the LLC's bank account hours
earlier, so the first store version to ship under the transition plan went
out with donations dark and the corporate rails ready.

## 2026-08-19 — Donation intake paused everywhere: the app is transferring to Bermudez Systems LLC

The owner is moving stateside in ~2 months and wants the corporate veil in
place before any promotion. Until the app's operations — Apple developer
account, payouts, contracts — actually run through **Bermudez Systems LLC
(WY)**, no money may reach the owner personally, both to keep the veil
buildable and to keep Puerto Rico foreign-registration and tax questions moot
during the remaining residency window. So every donation surface is off:
`FEATURES.tips=false` on web and mobile hides the tip card/button (gated, not
deleted — the repo's standard for dormant features), `ignia.fit/tip` now 302s
to `/support` instead of Ko-fi, and the three `fit.ignia.tip.*` consumables
are being removed from sale in App Store Connect. The transfer checklist
(EIN → D-U-N-S → Apple org conversion → LLC bank → Play org transfer) lives in
`STATUS.md` §3, with the re-enable condition: payouts land in the LLC's bank
account, not before.

## 2026-08-17 — Android builds on Windows now, and the binary that proves it is live

For its whole life this app could only be built on one MacBook Air, and that Air
is someone else's laptop with 187 GB of their own data on it. It had already
been demoted to an iOS-only build host on disk grounds. **Android now builds on
the Windows workstation instead — permanently — and vc 31, built and signed
entirely here, is live on the Play alpha track.**

The received wisdom said this was impossible: `build-infrastructure.md` claimed
"AABs do not build on Windows at all", blaming the 260-character `MAX_PATH`
limit against React Native's New Architecture C++. That was wrong. Gradle
compiled the whole native graph in 10m12s across all four ABIs. CMake does still
warn that it cannot *guarantee* object placement for
`react-native-keyboard-controller` — almost certainly where the old conclusion
came from — but a warning is not a failure.

**What was genuinely broken was subtler, and silent.** `eas build --local`
refuses to run Android off Linux/macOS, so Windows has to use raw Gradle — and
`expo prebuild` never reads `eas.json`, so nothing wrote the EAS Update
**channel** into `AndroidManifest.xml`. The resulting binary compiles, signs,
passes Play, installs, runs, and can never receive an over-the-air update: it
calls `u.expo.dev` with no `expo-channel-name` header and is told nothing.
Nothing errors, at build time or at runtime. This exact defect shipped once
before as vc 10, and the first Windows AAB reproduced it perfectly.

`scripts/patch-android-release.mjs` now injects the channel alongside the release
signing and versionCode it already handled, which is precisely the gap that had
marked it obsolete. `verify-mobile-artifact.mjs` — the gate that catches this —
turned out to have never been runnable on Windows at all, because it shelled out
to `strings`; it no longer does.

Two beliefs were measured and discarded along the way. `dir:android` is listed
as a fingerprint source but contributes **nothing** to the hash, so the ritual of
deleting `android/` before a gate run was a no-op and was never a cause of the
Windows/Mac divergence. And a `versionCode` printed in a build log still means
nothing — the artifact and Play are the only authorities.

The cost is one OTA cohort split, paid once: vc 30 carries the Mac runtime and
vc 31 the Windows one, and Android updates now publish from Windows.
`.claude/hooks/guard_eas_update.py` routes by platform to enforce it, and blocks
bare `eas update` everywhere — it publishes both platforms, so under a split
build host it is correct on neither machine.

## 2026-08-16 — The weekly recap opens the app, counts the week correctly, and can be unsubscribed in one click

Three things about the Sunday recap email, all visible in the one that went out
this morning.

**"Days logged: 8 / 7."** The week was measured as the last 168 hours rather
than the last seven days, and since the mail goes out mid-morning, those hours
straddle eight dates. The same window silently capped the streak: every date
the email knew about came from that one query, so a streak of any length was
reported as at most 8. Both now count the seven *local* days ending today —
your days, in your timezone, not UTC's — and the streak walks back past the
window until it finds a real gap. If you have logged for forty-one days, the
email says forty-one.

Weight change used to read "—" for anyone who weighs in once a week, because it
needed two readings inside the window. It now uses your last weigh-in before the
week started as the baseline, provided it is recent enough to still mean
something.

**The button opened the website.** Ignia's phone app is the product, so "Open
your log" now opens the app on your phone if you have it, and offers the App
Store, Google Play, or the browser if you don't.

**Unsubscribing now works by itself.** The recap advertised one-click
unsubscribe, but the only address behind it was a human's inbox — someone had
to read the request and switch the setting by hand. There is a real one-click
link in the footer now, and the in-app toggle (*Settings → Weekly digest*) still
does the same job.

One more, for anyone who only uses the phone app: the recap was scheduled for
10am — but the app never told the server which timezone you are in, so it
arrived at 10am UTC, which is 6am in Puerto Rico. Opting in now records your
timezone, so it lands on your Sunday morning.

---

## 2026-08-15 — The email that lets you into your account stops landing in spam

If you signed up and never got the confirmation email, it was probably sitting
in your junk folder. Two separate reasons, both fixed.

Every email Ignia sends — the welcome note, password resets, the weekly digest
— was going out from a shared address belonging to the company that delivers
our mail, not from `ignia.fit`. Mail filters weigh who actually sent a message,
and a shared address carries whatever reputation every other sender on it has
earned. Ignia's own sending domain had been set up and verified three weeks
earlier; the switch to it was simply never thrown. It is thrown now.

The confirmation email itself was worse, because it was not going through that
system at all — it came from an address ending in `firebaseapp.com`, which no
amount of configuration on our side could vouch for. It is now sent the same
way as everything else, from `ignia.fit`, with the same design as the rest of
our mail and a plain-text version for clients that want one. The link inside it
is on `ignia.fit` too, instead of a domain you have never heard of — which is
also just less alarming to click.

Live on the web now. The phone app has the same change, and it ships with the
next release.

## 2026-08-14 — Your maintenance estimate no longer jumps after a break in weigh-ins

Come back to the scale after a week or two away and Ignia would start a fresh
trend from your first readings back. Once that fresh run reached four weigh-ins,
it took over the estimate outright — and four *consecutive daily* readings cover
only three days, which is long enough to see water move and nowhere near long
enough to see fat move.

On a real account it worked out like this. Maintenance sat at **1,889**. One
more logged meal pulled one more weigh-in into the run, it reached exactly four,
and a single 1.4 lb overnight drop was read as **half a pound of fat per day** —
maintenance **3,596**, and a recommended target of **3,146** for someone whose
floor is 1,850. Nothing caught it, because the safety floor only stops a target
going too low.

Two changes:

- **A run has to cover a full week** before it carries your trend on its own.
  Until then the longer history stays in charge, which is the conservative
  answer rather than the exciting one.
- **No weight change faster than 2 lb a week is treated as evidence about your
  burn.** That is far above what anyone sustains as fat, so it never touches a
  real trend — it just means no reading of the scale, however odd, can produce a
  deficit a person cannot actually run.

**If your target looked wrong this week, check it again.** Nothing about your
data changed; only what the estimate was willing to conclude from it.

Live on the web and shipped over the air to both mobile apps.

---

## 2026-08-12 — Your streak and your weekly averages now count the days they claim

Three numbers on the web app were computed from the same rolling cache of the
last **14 rows** of your diary — not 14 days. For anyone logging four or five
meals a day that cache spans about two days, and everything derived from it
quietly shrank to fit.

- **Your streak** counted only the days inside that cache. A twelve-day streak
  could show as three, and the same account on the phone showed the real
  number — the two apps disagreed about a number in your face.
- **Trends' weekly averages and adherence** averaged whatever days fit, on a
  card labelled "this week", next to a deficit figure computed over the correct
  seven days. Two windows, one card.
- **Day totals in the 7-day chart and every History day card** could be short by
  a meal or two. The cache boundary lands mid-day, and a half-cached day looked
  complete to the code that read it.

Expect these numbers to change — upward, mostly. Nothing about your data
changed; only what the app was looking at when it did the arithmetic.

Also: the weight chart on Body now says what its dashed line is — a 4-week
trend, drawn past a 14-day line — so a flat-looking fortnight that sprouts a
falling dash explains itself. The fasting chip now goes to Today, where fasting
is actually controlled, instead of to Body, where it has not lived for months.
And the Coach's daily allowance now counts every account, including the owner's;
it was the one account that could never watch the counter move.


## 2026-08-12 — The coach can finally see the two weeks it says it can

The Coach screen has always promised answers "grounded in your last 14 days of
data". On the web app that sentence was not true: it was handed the *last 14
rows* of your diary, which for anyone logging four or five meals a day is about
two or three days. It was then told that pile was a fortnight, so it answered
confidently about trends it could not see.

- **Both apps now send a real 14-day window**, counted in calendar days.
- **The coach is told how much history it actually has** — "9 of the last 14
  days (37 logged entries)" — instead of a count of meals labelled as days.
- **If you stopped logging for a while**, the window follows your most recent
  fortnight of entries rather than handing the coach an empty table.

The mobile app had the opposite problem: it was sending roughly three months of
entries and calling them 400 days. Both apps now build the identical prompt.

## 2026-08-12 — Train says what it means

Someone asked what RIR was. It was one of ten pieces of lifting jargon on the
same screen with nothing anywhere explaining any of them.

- **The RIR box is now a scale that reads in words** — "0 · to failure",
  "2 left", "5+ · easy" — so you never have to know the acronym, or guess which
  end of 0–5 is the hard one.
- **Set types explain themselves.** Warm-up, Working, Activation, Mini and Drop
  each carry a one-line description where you pick them.
- **Auto-progression reads as a sentence**, in your own numbers: "Hit 12 reps
  for 2 workouts in a row → Ignia suggests adding 5 lb." The three boxes that
  encode that rule are relabelled to match.
- **A "?" on Train opens a glossary** defining every term the tab uses —
  clusters, est. 1RM, volume, top set, plate math, warm-up percentages.

## 2026-08-11 — A week off no longer rewrites what Ignia thinks you burn

Ignia works out your maintenance calories from your own weight trend and your
own logging. Take a fortnight off and come back four pounds up, and it used to
try to draw a single line through the hole — which made every reading after the
break look like a mistake. It threw all seven of them away, told you the
estimate was reliable, and gave you a number that had no idea you had been
anywhere.

- **The estimate now picks up where you came back**, instead of fitting across
  the gap. In testing against a known answer of 2,500 kcal, that scenario read
  2,038 before and reads 2,500 now.
- **Travel weight gets a week to leave before it counts.** Most of what you gain
  on a trip is water, and when it drops off over the following week it is not fat
  loss — reading it as fat loss would have pushed the estimate the other way just
  as hard.
- **Today tells you when a weigh-in was ignored.** The app has always discarded
  readings it judged implausible; it has never said so. A surprising maintenance
  number now comes with the reason attached.

**Still true, and worth knowing:** logging *some* of a heavy day is worse than
logging none of it. A day recorded at 1,500 that was really 3,000 drags the
estimate down for as long as it stays in the window, and Ignia cannot yet tell
that from a genuinely light day. If you cannot reconstruct a day, deleting it
beats guessing low.

## 2026-08-11 — Your goal pace now tells you when it can't be delivered

Ignia lets you set a weekly pace and a calorie floor, and the floor quietly
wins. If your floor sits near what you burn, the pace you picked is not the pace
you get — and until today nothing said so. On a real account: 0.9 lb/wk against
a 1,850 floor and a measured 1,870 burn leaves a 20 kcal deficit, which is
**0.04 lb/wk**. The number on the slider was off by a factor of twenty.

- **Refine targets now names the pace your floor actually leaves**, on the
  phone and on the web, in English and Spanish — and points at the setting that
  is doing it. It only appears when the floor is genuinely costing you
  something; if it takes 0.9 to 0.89, you will never see it.
- **A floor at or above your burn gets said out loud.** That is not a slow cut,
  it is not a cut, and rounding it to "0.00 lb/wk" would have hidden the more
  useful half of the problem.
- **The website's "new daily kcal" preview was wrong and is now right.** It was
  estimating from a formula and ignoring your calorie floor, so it could promise
  a target hundreds of calories below the one you would actually be held to.

**Nothing about your targets changed.** No maintenance estimate, no target, no
floor moved — this reports the arithmetic the app was already doing. If the
sentence tells you your pace is capped, it was capped yesterday too.

## 2026-08-09 — Meals file themselves everywhere, not just on Today

"Meals file themselves" shipped four days ago, and it was only ever true on one
screen. Three fixes, all from the same cause: the same rule was written in more
than one place, and the copies drifted.

- **Add a meal to a past day and it lands in the right meal.** The day-detail
  screen in History had its own copy of "save this entry" that never learned the
  slot rule, so anything logged there fell into **Other** — the exact behaviour
  the Today screen stopped doing. It now files by the time you logged it *for*,
  not the time you typed it.
- **Those back-dated meals reach Apple Health too.** Same copy, same gap: the
  History add path never mirrored its macros across. It does now, on the day the
  meal belongs to.
- **"Top set" on the web now means a real top set.** It was counting your
  heaviest warm-up. The phone app was already right; the two numbers no longer
  disagree.

Nothing already logged changed. Existing **Other** entries stay where they are —
they are not silently reassigned.

**Correction, same day.** An earlier version of this entry claimed the website
had no meal-slot rule at all. That was wrong — the web has defaulted the slot in
the entry form since long before this change, and the claim came from grepping
for the phone app's function name and finding nothing. Worse, the fix built on
that wrong reading briefly **broke** the web: deselecting the meal chip is how
you ask for **Other**, and for a few hours the app overrode that and filed the
entry by the clock anyway. Caught in a browser, fixed, and re-deployed the same
day; the web now leaves a deselected slot alone, exactly as it did before. No
entry needs correcting — a wrongly-slotted row can be re-tapped to any slot,
including Other.

## 2026-08-09 — Say what you ate, and a much calmer Add screen (1.2.0 — build 40 / vc 27)

Adding a log was the most-used flow in the app and the most cluttered screen in it: five unlabelled icons, four competing lists, and a meal field that quietly filed things under "Other" if you didn't touch it. All of that changed, in two layers.

- **Tap the mic and talk.** "A cup of oats and 100 grams of chicken" becomes an editable draft — every number from the food database, nothing invented, nothing sent to an AI. Your phone's own recognizer does the listening, on-device where it supports it, so what you ate stays on the phone. Spanish works: "una taza de arroz y 100 gramos de pollo".
- **One list, ranked by what you actually eat.** The add screen now opens on your recent foods and saved foods together, newest first, with search on top. Quick add keeps its own strip — those are one-tap. Everything else — describe a meal, barcode, recipe builder, recipe import — lives under one labelled "More ways" button, with words instead of mystery icons.
- **Meals file themselves.** Log at 12:54 and it's Lunch; at 3 PM it's a snack; at 8 PM it's Dinner. You can always override — but "Other" stops being where entries land by accident.
- **Long-press any entry to make it a preset.** The food you log four times a week becomes a one-tap chip — and your widget button and Quick Settings tile can fire it.

One honest note: the first over-the-air version of the new screen shipped with the search field squeezed to nothing. It was caught on a real phone within minutes, fixed, and the corrected layout was verified on an emulator before re-publishing — and the app now has a screen-by-screen visual regression suite so a layout break like that gets caught before it ships, not after.

## 2026-08-08 — Widget quick-add: the button that did nothing (iOS, TestFlight 1.2.0 build 37)

Tapping a preset on the iPhone widget did **nothing at all** — no meal logged, no error, no change to the numbers — on every build since the feature shipped. Reported from a phone today and fixed.

- **The cause.** To log without opening the app, Ignia hands iOS a sealed credential. The widget's button turned out to run in a different process from the app, and that process was never given permission to open the envelope. So it asked, got nothing, and stopped — silently, because a widget button has no way to show you an error.
- **Siri was never affected**, which is exactly why this hid for so long: the spoken shortcuts run inside the app, where the credential is, and they were verified working on a real phone.
- **A refused tap can now say so.** If a widget or tile tap cannot be logged, Settings → Quick add tells you why the next time you open it. Before, a refusal and a success looked identical.
- **Nothing was lost.** No row was ever written, so nothing is missing or duplicated — the taps simply did not happen.

**Also in this build:** Siri now speaks Spanish. *"Registra un preset en Ignia"* works on a phone set to Spanish; the phrases had been English-only.

Please try the widget button again and say whether it logs.

## 2026-08-08 — Your fast, on the Lock Screen (iOS, TestFlight build 30)

Ignia has had a fasting timer since launch, free, in an app whose closest competitor charges $59.99/yr for one. But you had to open the app to see it, which is the wrong shape for something you check at 6 a.m. and again at 2 p.m.

**This is on TestFlight and has not been tested on a phone yet.** It is written down here because the build shipped; treat it as "please try this", not "this works".

- **Start a fast and it appears on your Lock Screen**, counting up, with the start time under it. On an iPhone with a Dynamic Island it lives there too — long-press to expand.
- **It keeps counting with Ignia closed.** Your phone draws the timer itself. Nothing is sent to it, nothing runs in the background, and it costs nothing to run — which is the only reason it could ship free.
- **It speaks your language, not your phone's** — if Ignia is set to Spanish, the Lock Screen is Spanish.
- **iOS removes it after 8 hours.** That is Apple's limit and there is no way around it without sending your phone updates all night. A 16-hour fast will lose the card partway through; opening Ignia brings it back **showing the real elapsed time**, not restarting at zero. If you ever see it restart from 0:00, that is a bug worth reporting.

Android has no equivalent surface and gets nothing here.

## 2026-08-08 — Android testers: install the new build (alpha vc 25)

Housekeeping with a real consequence. Ignia can ship small fixes over the air, without a store update — but only to devices running a build that matches the current code. Android's had drifted, so **every over-the-air fix published for Android since the last release reached nobody**, silently and with no way to tell from the outside.

- **Install vc 25 from Play and Android is back on the fast lane** for fixes.
- No new features in it; it exists to close that gap.

If you grabbed vc 21 or vc 24 earlier today, take vc 25 — each closed the gap and the next change reopened it. 25 is the one that holds, and it is the first Android build anything has ever launched and tested.

## 2026-08-08 — Siri actually works now (iOS)

The release below announced Siri support on 2026-08-07. **It did not work.** iOS never registered the shortcuts, so Ignia did not appear in the Shortcuts app and every phrase came back "I can't help with that" — for everyone, from the moment it shipped. The build was fine; the app was asking iOS for something iOS refuses, and iOS declines that silently, with no error anywhere. It is fixed, and the fix is confirmed on a real phone.

- **"Hey Siri, log a preset in Ignia" works.** Siri asks which preset, you pick, and the row is in your day — with the app never opening.
- **What broke it.** A Siri phrase you get for free may not demand information up front. Ours insisted on knowing *which* preset before it would register at all, and one bad shortcut invalidates every shortcut the app has. Both now ask conversationally instead, which is what the feature wanted in the first place.
- **Nothing was lost.** Calories are still never invented — Siri asks for the number rather than guessing one, exactly as promised below.

## 2026-08-07 — "Hey Siri, log my protein shake" (iOS)

The same idea as the Android release below, in the form iPhones actually use. **The Siri half of this release did not function on the build it shipped in — see the entry above.** The widget button was unaffected.

- **Ask Siri.** "Log a preset in Ignia" picks from your quick-add list; "log 300 calories in Ignia" writes a one-off. Siri answers with what happened — and if you were offline it says so instead of pretending.
- **A button on your widget.** Same one tap, straight from the home screen, without the app opening.
- **Calories are asked for, not invented.** "Log 40 grams of protein" needs a calorie count to be a real entry, so Siri asks rather than guessing a number and quietly putting it in your day.

## 2026-08-07 — Log a meal without opening the app (Android)

The fastest logging in Ignia used to be about six taps: unlock, find the app, wait, tap Log, pick the preset, confirm. For the meal you eat every single day, that is five taps too many — and logging friction is the thing that decides whether anyone is still using a tracker in March.

- **A button on your home-screen widget.** Pick a preset in Settings → Quick add, and the widget grows a `+ Protein shake` button. One tap writes it. The numbers on the widget move as the receipt — there is no confirmation step, because a quick-add that needs confirming is not quick.
- **A Quick Settings tile.** Swipe down, tap once, done — without leaving whatever app you were in. The tile is *labelled with your preset's name*, so you always know what a tap is about to log, and it never fires blind.
- **It works with no signal.** A tap in a basement is saved and lands next time the app opens, on the day you tapped it — not the day it synced. Tap the same thing twice on a flaky connection and you still get one meal, not two.
- **Pick up to three.** Slot 1 is what the tile logs; your widget button uses it too.

Android only for now — the iPhone version is Siri and App Intents, and it needs its own release. The picker is hidden on iOS rather than shown doing nothing.

## 2026-08-07 — Photo scan now reads the food database, not the model's guess

When you photographed a plate, an AI looked at it and typed four numbers. That is the design this app decided *against* two months ago and then shipped anyway: vision models are good at recognising food and sizing a portion, and measurably bad at the nutrition numbers — off by more than 60% on protein, which is the one number Ignia is built around. The food database that would fix it landed last week. It is now wired in.

- **The AI names the food and weighs it. The USDA database does the math.** "Grilled chicken breast, about 150 g" is a question the model can answer well; how many grams of protein that is, is a question the database answers exactly. Your macros are now looked up, not guessed.
- **You get the plate broken down, item by item.** Rice, beans and chicken arrive as three lines you can rename, re-weigh or delete — instead of one total you either accept or argue with. Fixing a portion recalculates that item and the total.
- **Cooked food is counted as cooked.** Uncooked rice has nearly three times the calories of cooked rice per gram, and nutrition databases file the raw version as the default. Reading the plate as raw would have overstated a bowl of rice threefold. The model is now asked what it actually sees.
- **When the database doesn't know a dish, it says so.** Mofongo, tostones, pernil and pan sobao aren't in the USDA set. Those keep the AI's estimate and are labelled "estimated", so you can tell at a glance which numbers are looked up and which are a guess.
- **Nothing to update on your phone.** The improved numbers arrive with a server release — every install gets them immediately. The itemized breakdown comes with the next app update.

## 2026-08-07 — Food search now ships with the food data inside it

Searching for a food used to call the USDA's public API from our server, wait for it, and hope it was up. It needed a key, it was capped at 1,000 requests an hour across every user, and when it was slow, search was slow. The data it returned is public domain — so it is now simply *in* the app's server, and the round trip is gone.

- **13,272 foods, searched instantly and offline of any third party.** Government-verified USDA data: generic and whole foods, the "as eaten" survey foods people actually type, and the lab-analyzed set on top. Branded and packaged goods still come from Open Food Facts, and barcode scanning is untouched.
- **Search results got noticeably better, which took the most work.** The old API ranked results for us; a bundled database does not. Typing "egg" used to be able to return dried egg yolk at 654 calories. It now returns a whole raw egg. "cheddar cheese" finds *Cheese, cheddar* even though USDA files it backwards, "tuna" finds the fish and not a tuna salad sandwich, "chicken breast" finds chicken breast and not deli slices, and "onion" no longer returns onion bread.
- **You can type the singular.** USDA stores "Carrots, raw" and "Blueberries, raw"; people type "carrot" and "blueberry". Both now work, and both give the same answer.
- **One less key, one less thing to be down.** No API key, no rate ceiling, no upstream outage that can take food search with it.
- **Nothing to update on your phone.** The wire format didn't change, so this is a server-side release — both apps got it without a new build.

## 2026-08-07 — Point your camera at dinner. It's free, and it was already built.

The meal-photo→macros loop has been finished, deployed and guarded on the server for months. Both apps shipped with it switched off — deferred to a paid tier that does not exist, on a cost fear that turned out to be wrong by two orders of magnitude. Lifetime Gemini spend across every AI feature in the app is **$0.08**; the largest line on the bill is forgotten Secret Manager versions, at $5.91. A scan costs about a seventh of a cent.

- **Photo scanning is on, for everyone, at no cost.** Snap the plate, get calories and protein back, correct anything the model got wrong, log it. It joins plain-language text, presets and barcode as the fourth way to log a meal — and it's the one every competitor charges for.
- **Ignia now gives away what the category paywalls.** Cal AI's entire pitch is photo logging at $29.99/yr. MyFitnessPal charges for photo *and* barcode *and* voice. Cronometer's coach and fasting timer are Gold-only. All of it is free here, and there is still nothing to buy.
- **Three scans a day, and the number is enforced on the server** where a client can't argue with it. Three covers three meals; it also means a runaway client or a bad actor can't run up a bill.
- **The estimate is a starting point you edit, not a verdict you accept.** The known failure mode of every photo tracker is a confident wrong number — the review screen exists so a bad guess is a figure you fix in two taps.
- **Nothing was written to make this work.** No new function, no new dependency, no new key, no new scheduled job. Two flags changed. The interesting part of this release is how much of it was already paid for.

## 2026-08-07 — The app tells you it's out of date, instead of someone texting you

A tester sat on an old build for days. Nothing was broken — he simply had no way to know a newer one existed, and the only mechanism that eventually told him was a person typing a message. Meanwhile `expo-updates` had been installed, configured and baked into every binary since Android vc 11 / iOS build 24, and **nothing in the app had ever read it**: updates downloaded in silence and applied on the next cold start, so anyone who keeps the app open never noticed one at all.

- **A banner on Today when a fix is ready, and one tap applies it.** For JavaScript-only changes the new code is already on the device; the banner just stops it from waiting for a cold start that may never come. It also re-checks whenever the app returns to the foreground, which is the case the launch-time check structurally cannot catch.
- **A banner when a whole new version is on the store**, with a link straight to the listing. This is the case that actually stranded the tester — a native change can't ship over the air, and Play updates a closed-testing tester whenever it gets around to it.
- **The store banner can be dismissed, and stays dismissed only until something newer ships.** Leaving for the store is the one action available and not every tester can take it; a prompt they can't satisfy and can't dismiss is just a broken app.
- Notably **not** push notifications. Remote push would have cost a build on both platforms, an APNs key and a Play data-safety amendment — the app currently declares that it collects no push token — to say something the app can say for itself, for free, to the binaries already installed.
- The iOS store prompt ships switched off on purpose: TestFlight runs ahead of the App Store, and pointing a store user at a build they can't install is worse than saying nothing.

## 2026-08-06 — Writing a food in yourself is no longer the hardest way to log one

Every other way to log — barcode, meal text, recipe calculator, recipe link — had a fixed icon at the top of the Add-food sheet. Typing a food in yourself, the one method that needs no network, no camera and no parsing, was a text link at the *bottom* of the browse list, under Recent, My Foods and Quick add. My Foods is uncapped, so the link sank a little further every time you saved a food with it.

- **A write-it-yourself icon now leads the header row.** One tap from the moment the sheet opens; it never moves and never disappears.
- **A search that finds nothing now offers to add it, with what you typed already in the name.** Previously "No matches. Try a simpler term." was a dead end: the only way forward was to clear the box, scroll to the bottom, tap the link, and retype the name you'd just typed. Which mattered most for exactly the foods a database will never have — *abuela's arroz con gandules*.
- **The message stopped blaming you.** A miss almost always means the food isn't in the database, not that you searched badly, so it says so plainly.
- The old bottom link is still there for anyone who learned it.

## 2026-08-06 — Editing a workout template on the phone stopped destroying it

The mobile template editor showed each exercise as a name, a target load and a **set count**. The web editor shows the actual planned sets, so it can express a cluster — an activation set plus two minis, numbered C1, C2, C3. Because a save rewrites the whole `exercises` array, the count was not a simplification; it was a shredder. Open a template written on the web, change nothing, tap Save, and every cluster came back as N flat working sets with the per-exercise coaching cues and auto-progression rules gone.

- **The editor edits real sets.** Add a set or a whole cluster, change any set's kind (warm-up / activation / working / mini / drop), remove one. Cluster numbers are derived from the activation/mini ordering after every change, never typed — the same rule the web editor has always used.
- **Cues, auto-progression and both rest timers are editable on the phone**, so nothing in a template is now web-only. A field the editor cannot see is a field the next save deletes, which is exactly how this bug worked.
- **A failed save says so.** It used to leave the sheet sitting open with no message, which is indistinguishable from a button that does nothing — and is why the data loss went unnoticed longer than the failure itself.

## 2026-08-03 — The mobile app can report its own errors

An Android tester on a Galaxy S26 could not sign in with Google — "Could not sign in. Please try again." — while another tester on the same Play build signed up fine. That was as much as anyone could ever learn, because the app had **no crash or error reporting at all** and the sign-in code discarded the native error code before showing that message. The web PWA has had Sentry since launch; the mobile app, the one that's actually on a store, had nothing.

- **Sentry on the Expo app.** Native crashes and unhandled JS errors, with device model, manufacturer, OS version, app version/build and install source on every event. The Firebase **uid** identifies the user — never the email. Tracing and replay are off; this is a diagnostic channel, not an APM install. No-ops without a DSN, exactly like the web app.
- **Google sign-in failures are reported with their real cause.** The catch-all used to collapse `DEVELOPER_ERROR` (signing cert / client ID mismatch), a missing Play Services, an absent device credential and a Firebase rejection into one identical sentence. Each is now classified, reported, and breadcrumbed by step so it's clear *which* stage failed.
- **The on-screen message names the code too**, and is selectable — a remote tester can copy it and paste it back, which is the fastest path when the reporter hasn't been reached.
- **"Wrong email or password" stopped appearing for Google and Apple failures.** An `invalid-credential` from a federated provider is a token or config problem; telling the user to check a password they never set sent them nowhere.

## 2026-07-28 — The site is bilingual now, not just the app

Spanish was one of the three stated wedges — a fully translated app in a market where almost nothing is localized — and the website shipped **60 English URLs and zero Spanish ones**. Every indexed page now exists in both languages.

- **`/es/…` for every SEO route.** The calculator, all five comparison pages, the FAQ, all 36 macro-bracket pages and a Spanish landing page, each with its own title, description and structured data drawn from the same `es-PR` bundle the app uses. 87 prerendered pages, up from 43.
- **The prefix is a real route, not just a meta tag.** `/es/calculator` renders the calculator *in Spanish* — the URL now wins over the stored language preference, so someone arriving from a Spanish search result gets the language the search result promised. It isn't saved over their choice; it applies to that visit.
- **Reciprocal `hreflang` on both halves**, plus `x-default` to English. A one-sided declaration is ignored outright by Google, so the English pages had to change too.
- **`sitemap.xml` is generated, not hand-written.** 120+ URLs across two locales maintained by hand drift from the routes they describe inside one release; it now comes out of the same table that emits the pages, with the language alternates included.

## 2026-07-24 — Rebuilt transactional email, and a password reset that's actually ours

Welcome and reset mail had been landing in junk. The reason wasn't the DNS records everyone reaches for first — it was the **From address**: everything shipped from Resend's shared sandbox domain, and password resets came from Firebase's. Neither is a domain we own, so DMARC alignment was impossible no matter what got published on `ignia.fit`.

- **Password reset is a first-class email now.** A server-generated link is delivered through our own sender instead of Firebase's unbrandable default — designed, bilingual, and stating both when the link expires and what to do if you didn't request it. The endpoint answers identically whether or not an account exists, so it can't be used to discover who has one, and it's rate-limited per address and per network.
- **Every email carries a real plain-text version.** Missing one is a spam signal in its own right. Both versions are now generated from the same source, so they can't drift apart.
- **Dark mode, and a subject-line preview.** Mail previewed as "Hi there," in the inbox list before, because there was nothing else to scrape.
- **Back in Ignia's colours.** The templates still wore the pre-pivot cream palette and a "macro log" byline.
- **The welcome email stopped over-promising.** It advertised photo scanning and "four ways to log a meal"; photo scanning isn't in v1, so a new user's first email broke a promise in their first session.

## 2026-07-23 — Steps and active energy import from Health (mobile)

Health sync already pushed weight, sleep, water, body fat, nutrition and workouts. It could not read **activity** — so the app knew what you ate but nothing about what you moved. Steps and active energy now import from Apple Health / Health Connect and show as a read-only row on Today.

- **Import-only, and the types enforce it.** Your watch measures these; the app has nothing to contribute, so there is no export path — writing them back to Health is a compile error, not a convention.
- **Summed per day, not sampled.** Health stores activity as dozens of short buckets; the day's figure is their sum. A zero-step rest day is kept as a real reading rather than treated as missing data.
- **No change to your calorie target.** Measured-mode TDEE derives your burn from intake and your weight trend, which already includes every training calorie — feeding imported activity in on top would double-count it. Activity is shown for awareness; it does not move your numbers.

## 2026-07-23 — Every meal reminder is now switchable (mobile)

Reminders shipped in 1.0 with a single on/off and one time. That time was applied to the *dinner* nudge, while breakfast and lunch quietly ran on built-in defaults — so anyone with reminders on was also getting a **1:30pm "Time to log lunch" notification with no off switch**, short of turning off reminders entirely.

- **Per-meal rows in Settings.** Breakfast, lunch and dinner each get their own toggle and time, matching what the scheduler could always do but never exposed.
- **Nobody's notifications move on upgrade.** The migration reconstructs the exact schedule each device was already running rather than resetting to defaults; the only change is that all three windows are now visible and editable.
- Streak-save and weigh-in nudges are unchanged — they stay automatic and time themselves off your day.

## 2026-07-23 — Home-screen widget (mobile, built — ships with the next binary)

A "Today" home-screen widget for iOS and Android showing **calories and protein left today**, tapping through to the add-entry sheet. Passive daily exposure on the home screen, $0 runtime cost — it reads local shared storage, never the network.

- **Snapshot, not subscribe.** A widget process can't hold the app's Firestore listeners; it wakes on an OS timeline and reads whatever is already on disk. So the app writes a tiny JSON blob to storage the widget can see (iOS App Group `UserDefaults`, Android `AsyncStorage`) on every log, target change and app foreground, then asks the OS to redraw. The contract — build, decode, staleness, remaining-vs-over — is pure and unit-tested in `@macrolog/core`.
- **It blanks rather than lying.** The blob carries the date it describes, so after midnight the widget shows "Open Ignia to start" instead of yesterday's numbers dressed as today's. Same for a first run, an unreadable blob, or a signed-out account — never a "0 left" that reads as a fully-eaten day.
- **Spanish follows the app, not the phone.** The active locale rides in the blob, because the widget can't reach `profile.preferredLocale` behind auth. Someone who set Ignia to es-PR on an English phone gets a Spanish widget.
- **Not verified on a device yet.** iOS widgets need an EAS build and the quota resets August 2026; this ships with that binary. The owner must also enable App Groups on the App id first.

## 2026-07-23 — App Store funnel + in-app ratings

The iOS app is live, so the site now points at it and the app can ask for the ratings that store ranking runs on.

- **The website funnels to the App Store.** ignia.fit previously had no link to the listing at all — every visitor to the indexed SEO pages (`/calculator` and its 8 keyword variants, `/macros/*`, `/vs/*`, `/faq`) landed in the PWA with no idea a native app existed. There's now a `/download` page (bilingual, with the browser fallback), App Store badges on the landing hero, the download band, the comparison pages and the calculator CTA, and an `apple-itunes-app` smart banner for iOS Safari. Store clicks are tracked separately from web-signup clicks so the two routes can be compared.
- **In-app rating prompt.** The native rating sheet now fires at genuine positive moments — finishing a workout, or extending a logging streak of 3+ days — after 4 distinct qualifying days, at most once per app version and never within 120 days of the last ask. iOS only shows the sheet 3 times a year per user, so requests are spent deliberately rather than on launch. Settings also gains a permanent **Rate Ignia** row for anyone who goes looking.
- **Listing copy rewritten against the shipped build.** The store/positioning drafts still sold "$3/mo Pro", a 7-day trial and AI photo→macros — all of which are flag-disabled in v1. `docs/go-to-market.md` and `docs/producthunt-launch.md` were rewritten around what actually ships (free, adaptive TDEE, the training log, barcode + USDA/OFF search, AI coach, es-PR), with an explicit not-claimable list. Adds a Spanish (es-PR) listing draft. The homepage's structured data was carrying the same stale Pro pricing and photo-scan claims; it's now accurate and points at the listing.

## 2026-07-05 — Progress photos removed

Progress photos (the Pro before/after body-photo gallery) are gone from both the web app and the Expo mobile app — a pre-launch scope cut to shrink the app's health-data / breach surface. No body-image bytes are stored anymore: Firebase Storage is locked down (deny-all rules) and account deletion still purges any previously uploaded `users/{uid}/photos/`.

## 2026-07-02 — Mobile parity: AI coach, weekly report, invites

The Expo app closes its biggest gaps against the web app. Shared logic (prompt builders, SSE parser) lives in `packages/core` so both frontends behave identically.

- **AI coach on Expo.** The conversational coach (ask anything about your last 14 days, streamed and grounded in your real log) is now on mobile, reachable from Trends → "Ask the Coach". Shares the exact prompt builder + SSE parser with web, streams token-by-token, honors the same free 3/day quota. No Gemini key on the device — it goes through the `consultationStream` Cloud Function. English + Puerto Rican Spanish.
- **Weekly report (Pro) on Expo.** The AI weekly review — 14-day progress, adherence, protein, training, and one thing to focus on next — is now generatable in-app on Trends (was web-only; mobile previously had only the digest-email opt-in). Pro-gated, rendered in-app, one generation per ~6 days (server-enforced), reusing the deployed `generateWeeklyReport` function.
- **Invite a friend.** Mobile Settings gains the referral share: send your link, and when a friend signs up through it you both get a month of Pro free.

## 2026-07-02 — AI coach moved behind a Cloud Function (security)

- **Gemini API key off the client.** The conversational coach used to call Gemini directly from the browser with a key shipped in the app bundle (referrer-locked, free-tier — quota-abuse risk only, no billing). It now streams through a new `consultationStream` Cloud Function that holds the key server-side, verifies the caller's Firebase ID token, enforces the per-uid rate limit + daily quota, and relays Gemini's tokens to the browser as Server-Sent Events — so the typewriter UX is preserved with no key in the bundle. The old `reserveConsultation` / `releaseConsultation` callables are gone (the stream endpoint reserves the slot and refunds server-side on failure). The exposed key still needs a one-time console rotation to kill the leaked value.


---

_Entries before 2026-06-13 are in [`CHANGELOG-archive.md`](CHANGELOG-archive.md)._
