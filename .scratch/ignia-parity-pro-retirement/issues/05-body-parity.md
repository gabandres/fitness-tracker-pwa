# 05 — Body page parity

Type: task
Status: resolved
Blocked by:

## Question

Align web Body (`src/app/components/body/`) with mobile Body (`apps/mobile/src/app/(app)/body.tsx`) — weight + sparkline + goal progress, fasting ring, collapsible measurements, body-fat (Navy, `latestNavyBodyFat` from core), progress photos card. Match features/IA/brand. Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

## Answer

**Audited — already at parity, no code change needed.** Web Body (`body.component.ts`) vs mobile `body.tsx` (confirmed on localhost):
- Weight card: value + sparkline trend + "Holding steady" chip + goal progress bar (start → pct → goal, "N lb to go") — matches mobile's weight/trend/goalProgress.
- "Log weight" CTA ✓; Body fat **Navy estimate** ✓ (mobile `navyEstimate` / web `bodyFatEstimate`).
- Collapsible Measurements with add (web also has edit/delete — superset) ✓.
- **Neither** platform shows a progress-photos card on Body (matches the v1 photo-cut privacy decision). NB: per memory, lingering photo-upload code still exists elsewhere in the codebase — that's the LLC/privacy workstream, not a web↔mobile parity delta, so out of scope here.

No commit (no changes).
