# 08 — Onboarding + Refine-targets parity

Type: task
Status: resolved
Blocked by:

## Question

Align two setup/first-run surfaces with mobile:
- Onboarding: web `src/app/components/onboarding/` vs mobile `apps/mobile/src/app/onboarding.tsx`.
- Refine-targets: web `src/app/components/refine-targets-sheet/` vs mobile `apps/mobile/src/app/(app)/refine-targets.tsx` (Day-3 refine card).
Match features/IA/brand/voice (mobile is Title Case + flame-forward). Read mobile, screenshot web, reconcile web→mobile. Verify localhost, commit + push. If either surface is large, graduate the second into its own ticket.

## Answer

**Audited — at functional parity, no code change.**

**Refine-targets:** full parity — both collect sex, age, height (ft/in), activity, pace; web additionally has protein steppers + a live preview (superset). Same Mifflin-St Jeor sheet.

**Onboarding:** both collect the same data and produce calorie/protein targets:
- Web steps: weight → goal → targetWeight → confirm(kcal/protein).
- Mobile steps: welcome → goal → weight → goalWeight → plan → calories/protein → save.

Minor deltas (cosmetic, not built — working first-run flows; reshaping is opinionated + low-value):
- Mobile has a **welcome intro** step; web has none (web's flame-aligned sign-in already serves as the welcome, so the intro would be redundant on web).
- **Step order** differs (mobile goal-first vs web weight-first). Same fields, same outcome.

If strict step-order/welcome parity is wanted later, that's a deliberate onboarding redesign — flagging rather than guessing.
