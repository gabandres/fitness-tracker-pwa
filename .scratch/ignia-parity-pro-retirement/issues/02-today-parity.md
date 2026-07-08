# 02 — Today page parity

Type: task
Status: resolved
Blocked by:

## Question

Align web Today (`src/app/components/today/`) with mobile Today (`apps/mobile/src/app/(app)/index.tsx`) — same features, IA, brand/voice. Read the mobile screen for behavior (rings/CRUD, nudge gate, meal slots, add-entry flow), screenshot web Today on `localhost:4200` at ~402px, reconcile deltas web→mobile. Verify on localhost, commit + push. If a delta is big enough to be its own ticket, graduate it (note in map's Not-yet-specified).

## Answer

**Audited — already at parity, no code change needed.** Mobile Today (`index.tsx` + `DailyMetrics.tsx` + `HeroRings`) vs web (`today.component.ts` + `ui-day-summary`):
- Header matches: streak chip (🔥+count; web adds a streak-freeze shield, a feature not a regression) → history (calendar) → share → avatar.
- WhatsNewBanner ✓; HeroRings kcal+protein with carbs/fat sublabels ✓.
- Daily metrics order identical: **Fasting → Water → Sleep**, same water quick-adds (−8 when >0, +8/+16/+24), sleep log/edit ✓ (confirmed against the live localhost screenshot).
- Empty/day-0 state with "Repeat yesterday" ✓.
- Web has extra **web-only** nudges (iOS add-to-home-screen hint, post-first-entry push prompt, Day-3 refine card, undo-delete toast) — legitimately absent on native mobile, so not parity deltas.

No commit (no changes).
