# 0014 — Mobile dark-first dual-theme identity + center-log navigation

Date: 2026-07-04
Status: accepted

## Context

The Expo app is functionally v1-complete but visually utilitarian: a single
light "Frost" theme, five equally-weighted tabs, a Today screen of flat
same-weight cards, and a FAB that exists only on Today. The mobile app's
reason to exist is native *feel* (ADR-0012) and its growth job is converting
store-page visitors — store screenshots are static, so ambient motion alone
(commit 9057d3b2) cannot carry that job. The owner reviewed the motion pass
and asked for a substantially deeper revamp: visual identity + structural UX
+ bolder motion together.

## Decision

1. **Dual theme, dark leads.** The app supports light and dark themes
   (system-following with a manual override). The **dark theme is the
   brand**: it is designed first and is what store screenshots, sign-in,
   and marketing show. Light "Frost" becomes the derived daytime variant.
   Every component reads colors through a theme context — the one-file
   palette discipline continues, now with two palettes in that file.
2. **The Today hero is the app icon come to life:** one large concentric
   dual-ring element — calories outer, protein inner (the icon's exact
   geometry) — with the remaining-kcal count-up in the center. Carbs/fat
   demote to slim bars; the separate stats row dissolves into the hero zone.
   Calories + protein are the domain's two first-class targets
   (`TargetCalories`, `ProteinTarget`), so the hierarchy is honest.
3. **Navigation restructures to 4 tabs + a center-docked Log button
   ("+"):** Today, Train, [+], Trends, Body. Logging becomes reachable from
   every tab (it opens the same EntrySheet). **History leaves the tab bar**
   and moves behind the calendar affordance in Today's header — it is a
   lookup surface, not a daily destination. The `/history` routes remain.
4. **Motion level: choreographed + celebrations, no delight layer.** The
   hero opens with a designed sequence (concentric sweep → count-up →
   cascade); product events are rewarded (log save re-sweeps the ring with
   a haptic tick, protein-target hit flares the inner ring, streak
   extension animates the flame chip). No confetti/mascots/sound — they
   fight the premium-dark identity and the dependency-averse constraint.
5. **One custom display family** (geometric humanist with tabular
   numerals; candidate Manrope or Sora, OFL) for numerals + headings via
   `expo-font`; body text stays system. Tabular figures are required so
   animated count-ups don't jitter.
6. **Rollout is tiered.** Tier 1 (full structural + motion treatment):
   Today, tab bar, EntrySheet, sign-in, onboarding. Tier 2 (theme skin +
   type/elevation only, structure later): Train, Trends, Body, History,
   Coach, Settings. Tier 2 restructuring waits for owner approval of
   Tier 1.

## Alternatives considered

- **Light-led identity** (Frost stays the brand): safer continuity, but
  the coral/green rings physically cannot glow on warm paper, and the
  before/after in store screenshots is weak — the stated problem.
- **Dark-only rebrand:** maximum drama but a strange default for an app
  used in bright daylight contexts (meals), and it discards validated
  WCAG work on the light palette.
- **5 tabs + global floating FAB:** cheapest global-logging fix, but a
  FAB floating over five tabs is visually noisy and the bar stays generic.
- **Full-app structural redesign in one round:** most coherent, but an
  enormous unreviewable diff; the tiered rollout proves the language on
  the conversion surfaces first.

## Consequences

- Every mobile component converts from static `colors` imports to the
  theme context — a wide mechanical diff that lands with Tier 1.
- Store assets (screenshots, feature graphic) should be re-shot dark
  after Tier 1 ships.
- The icon, splash, and in-app BrandMark now share one geometry across
  one dark canvas — icon→app continuity is a deliberate brand feature.
- A future full dark mode for the PWA can derive from the mobile dark
  palette, not the other way around.
