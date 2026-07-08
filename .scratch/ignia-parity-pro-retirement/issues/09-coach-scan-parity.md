# 09 — Coach + Scan parity (match mobile's keep/defer treatment)

Type: task
Status: resolved
Blocked by:

## Question

Match web to mobile's treatment of the two AI/deferred surfaces:
- **Coach:** web `src/app/components/consultation/` vs mobile `apps/mobile/src/app/(app)/coach.tsx`. Align presence, IA, brand, and gating (Coach is AI/cost-sensitive; verify whether mobile exposes it and how — match that).
- **Scan:** web `src/app/components/photo-capture/` + `barcode-scanner/` vs mobile `apps/mobile/src/app/(app)/scan.tsx`. Photo-scan is **forced OFF in mobile prod** (v1.1/deferred per ADR-0015). Confirm mobile's exact treatment (hidden entry point? barcode-only?) and make web match — likely hide/defer photo-scan on web too. Do NOT delete code, mirror mobile's gate-off philosophy.
Read mobile first (the key output is *what mobile actually does* with these), reconcile web→mobile. Verify localhost, commit + push.

**From 01:** with `isPaid()=true`, the consultation (coach) over-limit upsell and the photo-capture "N left" quota captions are now hidden, BUT the server still enforces coach/photo daily quotas (`checkAccessStatus`) → a free user could hit a silent wall. Check mobile's behavior and reconcile (show remaining quota? or is the quota lifted in free v1?).

## Answer

**Changed — shipped `77f64453`.**

**Scan (photo-scan): gated OFF on web to match mobile prod.** Mobile ships photo-scan behind `FEATURES.photoScan` (`apps/mobile/src/lib/features.ts`), which its prod (eas) build turns off via `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` → the loop is deferred to v1.1 (ADR-0015). Web still exposed a "Photo" segment in the entry sheet. Added a web mirror `src/app/utils/features.ts` (`photoScan: false`) and filtered the `'photo'` segment out of the entry-sheet segmented control. Verified on localhost: add-entry tabs are now **Search / Meal / Barcode / Manual** (no Photo). Code kept in the bundle (gate, don't delete) — flip the flag to re-enable. Barcode scanning stays available on both (it's the shipping scan path).

**Coach: at parity, no change.** Mobile = dedicated `/coach` screen (button from Trends); web = consultation embedded inline in Trends — same feature, platform-appropriate nav (web SPA), consistent with the ticket-04 decision. Both show a **remaining-consultation counter** unconditionally, so the ticket-01 "silent quota wall" concern is unfounded. Web only hides the Pro-*upgrade* CTA on over-limit (correct for free v1); mobile shows an upgrade hint — minor, and web's is arguably more correct with no Pro.
