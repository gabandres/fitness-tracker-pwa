# 04 — Trends page parity

Type: task
Status: open
Blocked by: 01

## Question

Align web Trends (`src/app/components/trends/`) with mobile Trends (`apps/mobile/src/app/(app)/trends.tsx`) — same features/IA/brand. **Blocked by 01** because Trends has Pro-gated weekly/coach panels; do this AFTER the Pro ungate so this ticket only handles genuine parity, not Pro cruft. Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

**From 01:** the Pro weekly-report panel is now hidden behind `@if(proEnabled)` (PRO_ENABLED=false) — mobile hides the equivalent `WeeklyReportCard` too, so this is at parity. But dead `@if(subs.isPaid())` branches remain *inside* that hidden panel — clean them up here.
