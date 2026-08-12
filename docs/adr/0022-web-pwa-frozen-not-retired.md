# The web PWA is frozen, not retired (amends 0015)

## Status

accepted (2026-08-12) — amends
[ADR-0015](0015-macronaut-photo-first-freemium-pivot.md), which made the Expo
app the long-term product and left the PWA's lifespan an open question. This
answers that question, and it is deliberately not the answer it looks like.

## Context

The owner proposed retiring the web app: "it's kind of double maintenance in my
opinion." That reading is correct about the cost and wrong about the object —
"the web app" is two products sharing a build, and only one of them is
expensive.

**What is genuinely expensive.** The logging surfaces — Today, Trends, Body,
Train — are a second implementation of every feature. `CLAUDE.md` requires
bidirectional parity, so each feature is designed once and built twice, in
Angular/Tailwind and again in RN StyleSheet, with two i18n key shapes
(`{{var}}` nested vs `{var}` flat) that have to be converted by hand at every
port. That is the double maintenance, and it is real.

**What is nearly free, and load-bearing.** The rest of the same app is the
marketing and compliance shell: the landing page, `/vs`, `/calculator`, `/faq`,
`/privacy`, `/terms`, `/support`, `/status`, plus **105 prerendered SEO pages
and a 114-URL sitemap** (`scripts/prerender-seo.mjs`, tracked in
`docs/seo-status.md`). It changes rarely and it is wired into things outside
this repo:

- **Apple requires a live privacy-policy URL** on the App Store listing.
- **Play requires a working delete-account URL**, and this one has already
  failed once: verified 2026-08-01 signed-out and the page said only "sign in
  first to delete your account." `fb7d24d1` added the unconditional section.
  That URL is `ignia.fit/privacy`.
- Both store listings point their feedback channel at `ignia.fit/support`; the
  Play closed-track feedback URL is that page.

So deleting the site does not just end some marketing — it breaks store
compliance for the app that is supposed to be the survivor.

**The decision was about to be made on no data.** Nobody knows how many people
actually use the PWA. Until 2026-08-12 nothing counted it: the only evidence
available was hand-counting Firestore subcollections, which sees writes and
cannot see an open. Every expensive mistake in this repo has been the same
shape — acting on a belief about current state that turned out to be stale —
and "delete the product I assume nobody uses" is that shape exactly.

That gap closed the same day. `usageEvents` stamps every day-document with a
`platform` field (`web` / `ios` / `android`) and `scripts/usage-report.mjs`
prints the split. The instrument now exists; it needs a few weeks of data.

**One timing constraint outranks all of the above.** Android is not publicly
launched. Play production access is gated on 12 testers × 14 continuous days
(`STATUS.md` §4). Until that clears, **the web PWA is the only way an Android
user can use Ignia at all.** Retiring it first closes the only door for half
the addressable market, weeks before the other door opens.

## Decision

**Freeze the web logging app. Keep shipping the web shell. Decide the endgame
on the platform numbers, not before.**

1. **New features are mobile-first and may be mobile-only.** The standing rule
   in `CLAUDE.md` — "a web feature should be followed by a committed mobile
   port" — keeps its direction and loses its converse. A mobile feature does
   **not** oblige a web port any more.

2. **The web logging surfaces stay working and stay maintained for
   correctness.** Bugs, security, rules changes, dependency and framework
   upgrades, anything that would otherwise rot the build: still fixed. This is
   a feature freeze, not a maintenance freeze. A signed-in web user must never
   find their data unreachable or their app broken.

3. **The shell keeps shipping normally** — landing, legal, support, status, and
   the prerendered SEO surface. It is cheap, it is the only free acquisition
   channel, and two app stores depend on it.

4. **Cross-frontend logic still goes in `packages/core`.** Unchanged, and more
   important under a freeze rather than less: the pure math is what keeps a
   frozen frontend correct without anyone porting anything to it.

5. **The endgame is measured, and the measurement is named.** After ≥30 days of
   `usageEvents` data covering a released build on each platform, run
   `node scripts/usage-report.mjs --days 30` and read `platforms` plus
   `activeDays`:
   - **Web is a rounding error** (<5% of active days) → add a "get the app"
     banner to the web logging surfaces and stop building them. The shell
     stays.
   - **Web is material** (≥20%) → the parity work was buying something real,
     and the freeze converts into a deliberate, smaller web scope rather than
     an exit.
   - **In between** → re-read with the funnel: if web is where people *arrive*
     and mobile is where they *stay*, the PWA is an acquisition surface and
     should be kept as one.

   **This decision may not be revisited on intuition before that data exists,
   and the earliest honest date is 30 days after Android is publicly live.**

## Consequences

**The saving is most of what was wanted.** Feature parity was the expensive
half, and it stops immediately. What continues — the shell, correctness fixes,
`packages/core` — is close to the floor of "we still have a website."

**Parity stops being bidirectional, and `CLAUDE.md` now says so.** That rule
has been load-bearing for months; anyone reading it as still symmetric will do
work this ADR exists to stop. Reviewers should treat "the web version of this
is missing" as expected, not as a gap.

**The two apps will visibly diverge, and that is the accepted cost.** Web users
will see a smaller product over time. The mitigation is honesty in the shell's
copy, not a promise to catch up — a "coming to web" line nobody intends to
deliver is the thing that turns a freeze into a broken promise.

**Frozen code still rots.** Angular 21, Firebase 12 and the rest continue to
move, and this repo tracks bleeding-edge on purpose. Budget for upgrade work on
a product receiving no features; the alternative is discovering at retirement
time that the "just keep it running" surface cannot be built any more.

**The retirement path stays open and cheap.** Nothing here is hard to reverse:
un-freezing is a decision, not a migration. Retiring later is a banner plus a
route removal, with the shell untouched — which is precisely why the expensive,
irreversible version (delete it now) is not worth doing today.

**A dated review is owed.** If this ADR is still `accepted` with no follow-up
30 days after Android goes live, it has become the thing it was written against
— a belief about state that nobody re-checked. The report command is in
decision 5; running it costs one command.
