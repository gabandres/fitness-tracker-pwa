# 07 — Settings page parity

Type: task
Status: resolved
Blocked by: 01

## Question

Align web Settings (`src/app/components/settings-sheet/`) with mobile Settings (`apps/mobile/src/app/(app)/settings.tsx`) — same sections/IA/brand (account/avatar, targets, units, theme, data export, "Leave a tip" Ko-fi, sign-out). **Blocked by 01** because the Pro/membership/referral cards are removed there; this ticket handles the remaining structural parity. Mobile dropped invite from settings (`118a5c6a`) — ensure web matches. Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

**From 01:** the public-profile card was bundled in the deleted membership-section (already orphaned since `8d70a83f`, no new regression). `components/public-profile/` still exists. Decide vs mobile whether to re-surface it in settings or drop it.

## Answer

**Changed — shipped `42f59d4b`.**
1. **"Support the app" (Ko-fi tip) card ADDED.** Mobile Settings has a Support card (`settings.support` → `ignia.fit/support`); web only had the link in the landing footer. Added the same card to the settings about-section (after delete-account, before feedback — matching mobile placement), i18n copied from mobile (en + es-PR). Verified on localhost.
2. **Public-profile: KEPT DROPPED** (matches mobile — mobile Settings has no public-profile). It went with the retired membership-section (`8d70a83f`); the `public-profile/` component remains in the codebase but unmounted.
3. **Rest at parity:** profile (signed-in, redo onboarding, sign out), targets (pace + protein + calorieFloor), units (metric/US), theme, language, reminders (push + hour + weekly digest), data (export/import + web-only webhook), delete account, about/legal. Pro section correctly hidden on both (mobile `PRO_ENABLED`; web has no Pro section at all).

**Minor delta noted (not built):** mobile has finer unit sub-toggles (`kcalUnit`/`proteinUnit`/`portionDisplay`) beyond the metric/US system switch; web exposes only the system toggle. Low-value; left for a future pass if desired.
