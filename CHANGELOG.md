# Changelog

Significant ships to [ignia.fit](https://ignia.fit) and the Ignia iOS app, newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

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
