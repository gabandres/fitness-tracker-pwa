# 04 — Trends page parity

Type: task
Status: resolved
Blocked by: 01

## Question

Align web Trends (`src/app/components/trends/`) with mobile Trends (`apps/mobile/src/app/(app)/trends.tsx`) — same features/IA/brand. **Blocked by 01** because Trends has Pro-gated weekly/coach panels; do this AFTER the Pro ungate so this ticket only handles genuine parity, not Pro cruft. Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

**From 01:** the Pro weekly-report panel is now hidden behind `@if(proEnabled)` (PRO_ENABLED=false) — mobile hides the equivalent `WeeklyReportCard` too, so this is at parity. But dead `@if(subs.isPaid())` branches remain *inside* that hidden panel — clean them up here.

## Answer

**Changed — shipped `aa19b833`.** Real deltas found (unlike the other pages):

1. **Maintenance/TDEE hero (ADDED).** Mobile Trends foregrounds the measured-maintenance number as its anchor; web didn't surface it at all. Ported the hero to the top of web Trends: badge (Measured/Estimate per `tdee().source`) + "Maintenance estimate" caption + `trueTdee` kcal + source hint + logging-completeness sub (measured only) + daily-target chip. Data from existing `store.tdee()` / `store.targetCalories()`; new i18n keys copied verbatim from mobile (en + es-PR, `{pct}`→`{{pct}}`). Verified on localhost: renders "ESTIMATE / Maintenance estimate / 2,774 kcal / Mifflin–St Jeor… / Daily target 1,990 kcal".
2. **Coach placement (KEPT as-is).** Mobile = button → dedicated `/coach` screen; web = consultation embedded inline in Trends. Same feature, platform-appropriate nav (web is a single-scroll SPA). Noted, not changed.
3. **Weekly-report dead branches (NOT removed — deliberate).** The `@if(subs.isPaid())` branches inside the `@if(proEnabled)` panel are *correct* Pro-gating that reactivates when `PRO_ENABLED` flips true (isPaid() reverts to real entitlement). Removing them would break the re-enable path, so they stay.

Web bar-chart + insights/budget toggle is web's richer weekly viz (superset of mobile's ThisWeek+Budget) — kept.
