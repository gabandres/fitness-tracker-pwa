# 03 — Train page parity

Type: task
Status: resolved
Blocked by:

## Question

Align web Train (`src/app/components/train/`) with mobile Train (`apps/mobile/src/app/(app)/train.tsx`) — mobile had a recent Train UX batch (`e9364232`). Match features/IA/brand: sessions, templates, per-exercise plates & warm-up, per-set RIR, log styles (bodyweight/time), edit/delete. Screenshot web vs. read mobile, reconcile web→mobile. Verify localhost, commit + push. Graduate any large delta.

## Answer

**Audited — already at parity, no code change needed.** Web Train (`train.component.ts` + session-sheet/template-editor/exercise-detail/exercises-manager) vs mobile `train.tsx`:
- IA identical (confirmed on localhost): header "Train" + avatar → "This week / N workouts" hero → "Start workout" CTA → Templates (Starters / New, list with Start) → History (tap-edit / hold-delete, per-session volume).
- Feature-key comparison shows web is a **superset** of mobile: both have templates, plates & warm-up, per-set RIR, log styles (bodyweight/time), PR + trend tracking (e1rm/reps/weight/hold), merge exercises, reorder (move up/down), rest timer, week volume; web additionally has cues, muscles, progression view, drop sets, exercise/set history.
- Mobile's recent Train UX batch (`e9364232`) was **native-only interaction polish** — drag reorder, floating haptic rest-timer bar, keyboard-avoidance, accordion timing — none of which has a web-applicable functional delta.

No commit (no changes). Parity direction is web→mobile; web being richer is not a regression (any mobile catch-up is out of this map's scope).
