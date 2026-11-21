# ADR-0049: Pre-permission screens keep "Not now", and Today keeps its two rings

- **Status:** accepted 2026-11-21. The owner handed over the two open calls in
  `UX_AUDIT.md` S24-28 ("do all except those that require a new binary");
  both are decided as **keep**, and the owner can reverse either by OTA.
- **Date:** 2026-11-21
- **Relates to:** ADR-0014 (theming), ADR-0015 (mobile is the product).
- **Touches:** nothing. This records why two things the rubric flagged were
  left as they are. The third S24-28 call, the portrait lock against WCAG
  1.3.4, is an `app.json` value and waits for the next binary.

## Context

The 2026-11-19 rubric pass raised two items that are choices, not defects:

1. **"Not now" beside the action on pre-permission screens** (the Health
   connect sheet, the reminder card on Today, the rest-notification sheet).
   Apple's HIG asks a pre-alert screen for one button that leads to the
   system prompt.
2. **The hero on Today draws two concentric rings with round caps** (calories
   outside, protein inside, on the dark panel). Rule A77 notes the family
   resemblance to Apple's Activity rings, which Apple reserves for Move,
   Exercise and Stand.

## Decision

**1. "Not now" stays.** iOS shows its permission prompt once per permission.
A pre-permission screen with a single "Continue" button sends everyone who is
not ready into that prompt, where "Don't Allow" is permanent: the only way
back is the Settings app. "Not now" lets that person leave without spending
the prompt, and the app asks again later at a better moment. The measured
case behind the reminder card is 0 of 43 accounts saying yes when asked
before the app had done anything.

**2. The two rings stay.** They are not Apple's element and do not show
Apple's data: two rings, not three; coral and green, not red, green and blue;
different stroke widths; a number in the centre; no Move, Exercise or Stand
anywhere. The hero has been in every App Store and Play binary since launch
and through every review. Replacing the home screen's main graphic is a
redesign that would have to be judged on an iPhone, and no iPhone build is
possible while no Mac exists (`STATUS.md`).

## Consequences

- The rubric keeps scoring both as deviations. That is accepted.
- **Reverse 1** by removing the secondary button in `ReminderAskCard.tsx`,
  `RestNotifySheet.tsx` and the Health prime in `connected-apps.tsx`.
- **Reverse 2** if App Review ever cites guideline 5.2.5 or the Activity-ring
  rule: the smallest change that breaks the resemblance is a single ring for
  calories with protein as a bar under it (`HeroRings.tsx`).
