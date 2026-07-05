# Product Hunt Launch Kit — Macronaut

Launch day materials. Reuse on other launch platforms (BetaList, r/SideProject
in show-not-promo mode, IndieHackers) with minor edits.

## Tagline (60 chars max — hard limit on PH)

**Primary:** "A quiet, private calorie log with AI coaching."

Alternates (A/B if you do a soft pre-launch via coming-soon):
- "Calorie log that learns your real TDEE."
- "Answer 'how many calories do I have left today?' — fast."
- "Calorie logging without ads, accounts, or data selling."

## Description (260 chars max)

Macronaut is a calorie + protein log for people who'd rather track than fight
an app. Measured TDEE from your real data, a weekly AI report grounded in
your logs, photo→macros via Gemini, full offline PWA. No ads. No data selling.
$3/mo Pro; core loop is free forever.

## Gallery (PH allows up to ~8 images, first 3 show in grid)

Order matters — first three are the conversion hero trio.

1. `screenshots/landing-hero.png` — caption: "how many calories do I have left today?"
2. `screenshots/dashboard.png` — caption: "the one number that matters, every day"
3. `screenshots/photo-capture.png` — caption: "photo → macros via Gemini"
4. `screenshots/weekly-report.png` — caption: "weekly AI report, grounded in your own data"
5. `screenshots/weight-trend.png` — caption: "weight trend with 7-day EMA"
6. `screenshots/onboarding.png` — caption: "3-step intake — no BS, no upsell"
7. `screenshots/pricing.png` — caption: "$3/mo. 7-day free trial. Core loop free forever."
8. `screenshots/og-product.png` — caption: "calibration log · personal use · confidential"

## First comment (post at 00:01 PST on launch day)

Hey hunters 👋

I'm Gabriel, solo maker. Macronaut is the app I wanted for myself and couldn't
find: a calorie + protein log that doesn't sell my data, doesn't run ads, and
actually learns what my real TDEE is from my own numbers instead of a
one-size-fits-all calculator.

A few things that might be different from other trackers:

- **Measured TDEE, not estimated.** After 14 days of logging, your TDEE is
  derived from your own weight change + intake, not from a formula that
  assumed you're average. For me the difference was ~280 kcal/day.
- **Weekly AI report** grounded in your actual logs — no generic "drink more
  water" nonsense. It calls out patterns I'd miss (weekend drift, protein
  dips on travel days).
- **Photo → macros** in one tap via Gemini. Client-side compressed so images
  never leave your phone at full size.
- **PWA-first.** One codebase, works on iOS, Android, desktop, offline. No
  app store friction.
- **Free tier is usable forever.** Unlimited manual logging, weight, fasting,
  measurements. The paywall is AI + higher quotas + full history.

Pricing is $3/mo or $24/year with a 7-day free trial. No ads. No selling
data. No tracking you across sites.

I'd love feedback — especially from anyone who's tried to track macros and
bounced off the UX. What's the one thing another app got wrong that made you
quit? I'm listening.

Thanks for taking a look. 🫶

— G

## Maker profile bio (if editing)

Solo indie dev. Building quiet software: no ads, no dark patterns, no data
selling. Previously [past project]. Based in Puerto Rico.

## Cross-post prep

Don't post these same-day — space them 24–72h apart so the signals compound
rather than overlap.

- **HackerNews (Show HN):** rewrite first comment as a technical post. Lead
  with architecture (Angular PWA, Firebase, Gemini, adaptive TDEE math), not
  marketing.
- **r/SideProject, r/InternetIsBeautiful:** link the PH page, brief "built
  this over X months, here's what I learned" framing.
- **IndieHackers milestone:** "Launched on PH today — here's the stack + cost
  structure." Share numbers if comfortable.
- **BetaList:** already-ranked launch; submit after PH hype.
- **Fitness subs (r/loseit, r/intermittentfasting, r/fitness):** DO NOT post
  as a launch. Wait 2–4 weeks, contribute genuinely, then only mention the
  app if directly relevant to a question someone asks.

## Checklist for launch day

- [ ] Maker profile is complete (photo, bio, links)
- [ ] All 8 gallery images uploaded, captions reviewed
- [ ] Tagline final (measured chars ≤ 60)
- [ ] Description final (measured chars ≤ 260)
- [ ] First comment drafted + ready to paste
- [ ] Email verification tested end-to-end in incognito
- [ ] Google + Microsoft + email/password all live-tested
- [ ] Stripe checkout tested with a real card (refund after)
- [ ] /status page healthy
- [ ] CHANGELOG.md has a "launched on PH" entry
- [ ] Screenshots have no PII, no test-user emails, no local-dev URLs
- [ ] Loom/demo recording uploaded and linked in description
- [ ] Backup plan if Firestore rules, auth, or Stripe break mid-launch
      (have the CLI open, know the rollback commit)

## Post-launch actions (24h window)

- Respond to every comment within 2h during waking hours.
- Don't argue with critics; thank them and offer to chat in DMs.
- If ranked top 5: add a "thanks" edit to the first comment.
- Signups spike → watch Sentry for 500s and Firestore rule denials.
- Day 2 writeup: "what happened when I launched on PH" IndieHackers post.
