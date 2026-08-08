# Changelog

Significant ships to [ignia.fit](https://ignia.fit) and the Ignia iOS app, newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

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
