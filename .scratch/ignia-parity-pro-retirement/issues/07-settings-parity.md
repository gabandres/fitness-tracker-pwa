# 07 — Settings page parity

Type: task
Status: open
Blocked by: 01

## Question

Align web Settings (`src/app/components/settings-sheet/`) with mobile Settings (`apps/mobile/src/app/(app)/settings.tsx`) — same sections/IA/brand (account/avatar, targets, units, theme, data export, "Leave a tip" Ko-fi, sign-out). **Blocked by 01** because the Pro/membership/referral cards are removed there; this ticket handles the remaining structural parity. Mobile dropped invite from settings (`118a5c6a`) — ensure web matches. Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

**From 01:** the public-profile card was bundled in the deleted membership-section (already orphaned since `8d70a83f`, no new regression). `components/public-profile/` still exists. Decide vs mobile whether to re-surface it in settings or drop it.
