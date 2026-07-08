# 09 — Coach + Scan parity (match mobile's keep/defer treatment)

Type: task
Status: open
Blocked by:

## Question

Match web to mobile's treatment of the two AI/deferred surfaces:
- **Coach:** web `src/app/components/consultation/` vs mobile `apps/mobile/src/app/(app)/coach.tsx`. Align presence, IA, brand, and gating (Coach is AI/cost-sensitive; verify whether mobile exposes it and how — match that).
- **Scan:** web `src/app/components/photo-capture/` + `barcode-scanner/` vs mobile `apps/mobile/src/app/(app)/scan.tsx`. Photo-scan is **forced OFF in mobile prod** (v1.1/deferred per ADR-0015). Confirm mobile's exact treatment (hidden entry point? barcode-only?) and make web match — likely hide/defer photo-scan on web too. Do NOT delete code, mirror mobile's gate-off philosophy.
Read mobile first (the key output is *what mobile actually does* with these), reconcile web→mobile. Verify localhost, commit + push.

**From 01:** with `isPaid()=true`, the consultation (coach) over-limit upsell and the photo-capture "N left" quota captions are now hidden, BUT the server still enforces coach/photo daily quotas (`checkAccessStatus`) → a free user could hit a silent wall. Check mobile's behavior and reconcile (show remaining quota? or is the quota lifted in free v1?).
