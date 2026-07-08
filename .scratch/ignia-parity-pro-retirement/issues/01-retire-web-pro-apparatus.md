# 01 — Retire web Pro apparatus (client-side)

Type: task
Status: resolved
Blocked by:

## Question

Retire all client-side web Pro/subscription apparatus so the web mirrors mobile's free/ungated v1 (`apps/mobile/src/lib/subscription.ts` → `PRO_ENABLED=false`, everything unlocked). Approach (confirmed): **ungate at source + delete clearly-dead UI**.

Targets:
- **Ungate at source:** `src/app/services/subscription.service.ts` (`isPro` → always unlocked) and `src/app/services/upsell.service.ts` (found this session; not in handoff — audit + neutralize).
- **Strip `isPro` gates:** `src/app/app.ts` (shell gates), `src/app/components/trends/trends.component.ts` (Pro-gated weekly/coach panels — ungate; note: full Trends parity is ticket 04), `src/app/utils/theme.ts` (ungate all Pro themes).
- **Delete dead UI:** `src/app/components/subscribe/` (whole /subscribe upsell page + route), `src/app/components/upsell-card/` (+ remove all usages), `src/app/components/settings-sheet/settings-membership-section.component.ts` (orphaned since `8d70a83f` — delete, OR repurpose the public-profile card if worth keeping; `components/public-profile/` also exists — decide).
- **i18n:** remove dead `settings.subscription.*`, `settings.referral.*`, subscribe/upsell strings from BOTH `src/app/i18n/en.json` and `es-PR.json` (2-space, keep parity).
- **Do NOT touch** server-side (out of scope): Stripe extension, referral CFs, Profile fields. `admin/`+`admin.service.ts` are unrelated superuser console — leave.

Cross-check remaining hits after edits: `grep -rn "isPro\|subscribe\|upgrade\|stripeRole\|proOnly"` in `src/`. Verify prod-build/AOT passes (no orphaned template refs) + localhost smoke (no Pro UI, all themes selectable). Commit + push (no deploy — ticket 10).

## Answer

Shipped in commit `a7f79454` (pushed to main). Approach: **mirror mobile's two-flag model**, not "unlock everything."

**Key discovery:** mobile does NOT unlock everything. It uses two flags (`apps/mobile/src/lib/subscription.ts`): `isPro = PRO_ENABLED ? entitled : true` → **true** in v1 (unlocks non-cost perks), and `PRO_ENABLED = false` → **hides** purchase surfaces AND server-entitled AI cost features (the weekly report is gated on `PRO_ENABLED`, hidden — the cost-averse call). So the faithful web mirror is:

- **`subscription.service.ts`**: added `export const PRO_ENABLED = false`; `isPaid()` now returns `true` when `PRO_ENABLED` is false (unlocks themes, preset/template limits, streak-freeze for everyone), reverting to real entitlement if Pro is ever re-enabled. Single chokepoint — auto-ungates ~12 consumers.
- **Trends**: the Pro weekly **AI** report panel is now hidden behind `PRO_ENABLED` (not exposed to all — avoids per-user Gemini cost, matches mobile). Free "Ask the coach" consultation stays. Removed `UpsellService` + `openUpgrade` + the dead upsell branch.
- **Deleted**: `/subscribe` component, `upsell-card` (+ its entry-form presetLimit & photo-capture photoQuota usages), orphaned `settings-membership-section`, `upsell.service.ts`.
- **app.ts**: removed the upsell open-request effect + the `?intent=pro` deep-link effect.
- **landing.component.ts**: removed dead `SubscriptionService`/`UiCard`/`UiButton` (leftovers from the 2026-07-07 pricing removal; also silenced NG8113 warnings).
- **i18n**: dropped dead `settings.subscription.*` + `settings.referral.*` from en + es-PR. (`subscribe.*` keys kept — still referenced by dormant Stripe methods, server-side/out-of-scope.)

**Verified:** clean AOT build (ng serve, 0 errors/warnings). Playwright localhost smoke (mobile viewport, signed in as e2e@test.com): Today renders; Trends shows coach Ask with NO Pro weekly-report/upsell; Settings has NO membership/subscription/referral section; DOM has zero "pro"/"subscribe"/"upgrade"/"referral" text.

**Follow-ups handed to existing tickets (not new tickets):**
- **→ 09 (Coach+Scan):** with `isPaid()=true`, the consultation over-limit upsell + photo "N left" quota captions are now hidden, but the SERVER still enforces coach/photo daily quotas → possible silent wall. Reconcile against mobile's coach/scan treatment.
- **→ 07 (Settings):** the public-profile card was bundled in the deleted membership-section (already orphaned since `8d70a83f`, so no new regression). Decide vs mobile whether to re-surface it.
- **→ 04 (Trends):** dead `@if(subs.isPaid())` branches remain inside the now-hidden `@if(proEnabled)` weekly-report panel — clean up during full Trends parity.
