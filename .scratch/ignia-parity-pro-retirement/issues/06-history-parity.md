# 06 — History page parity

Type: task
Status: resolved
Blocked by:

## Question

Align web History (`src/app/components/history/` + `day-detail/`) with mobile History (`apps/mobile/src/app/(app)/history/index.tsx` + `[date].tsx`) — history grid/list + day-detail (weight, entries, edit). Match features/IA/brand. Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

## Answer

**Audited — already at parity, no code change needed.** Web (`history.component.ts` + `day-detail.component.ts`) vs mobile (`history/index.tsx` + `[date].tsx`):
- Both render the **same IA**: a month **calendar grid** (prev/next month nav, weekday header, day cells with logged/weighed dots + today highlight) followed by a **"Recent"** list of the last ~10 days (date · entry count · exercised · weight · kcal), each tapping through to the day detail. (Initially suspected web-only calendar because mobile builds the calendar chrome from a hardcoded `WEEKDAYS` array, not `t()` keys — but the grid is present on both.)
- Day detail: web reuses `ui-day-summary` (rings + entries + water + exercise, editable); mobile `[date].tsx` shows the day's macros + entries + weight. Same browse-day → view/edit flow.

No commit (no changes).
