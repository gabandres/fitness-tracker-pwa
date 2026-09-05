# ADR-0037: Maintenance mode is the `maintain` direction, entered by one tap when the goal is reached

- **Status:** accepted 2026-09-05
- **Date:** 2026-09-05
- **Touches:** `packages/core/src/maintenance-mode.ts` (new),
  `packages/core/src/reminder-plan.ts` (`maintaining` input),
  `apps/mobile/src/components/MaintenanceSwitchCard.tsx` (new),
  `apps/mobile/src/app/(app)/body.tsx`, `apps/mobile/src/lib/ledger.ts`,
  `apps/mobile/src/lib/reminders.ts`, `apps/mobile/src/hooks/useReminderSync.ts`,
  three locale files. **No `firestore.rules` change, no new profile field, no
  scheduled job, no AI call.**

## Context

Retention lever 7 (`STATUS.md` §3, owner's call 2026-09-02): *"Maintenance mode
after goal reached — looser logging, keeps the account alive through the week
8–12 fatigue."* It sat unscoped.

What the code did when a user reached their goal, before this ADR:

- The Body tab's trend crossed the target and `GoalMilestonePrompt` asked
  whether to put `goal-reached` on record (#110). That was the whole of it.
- The daily target kept prescribing the deficit, indefinitely. `goalDirection`
  and `targetPaceLbsPerWeek` are written by exactly one thing — the onboarding
  wizard — and Settings → Edit goals reruns the wizard in full. A person who has
  arrived was being asked to sit through the plan they just finished in order
  to say "and now hold it".
- The reminders kept the streak-at-risk nudge and the day-3 lapsed nudge, both
  of which are deficit-era pressure aimed at someone who no longer has a
  deficit to protect.

Two facts bounded the design:

1. **The streak already tolerates a week.** `STREAK_FREEZE_MAX_GAP_PRO` is 7
   and `isPro()` is forced true while `PRO_ENABLED` is false, so "looser
   streak" had nothing left to loosen. The lever's "looser logging" is
   therefore reminders and the target, not the counter.
2. **`goalDirection: 'maintain'` with pace 0 is already a fully-supported
   state** — the wizard writes it, the rules accept it, `paceOffsetKcal` is
   zero for it, and `toOnboardingV2Patch` clears both goal-weight fields for
   it. There was no missing state, only a missing way to get there.

## Decision

1. **Maintenance mode IS `goalDirection === 'maintain'`.** No `maintenanceMode`
   flag, no `maintenanceSince` stamp. `isMaintaining(profile)` in core is the
   one predicate every consumer reads. A user who onboarded as "maintain" and a
   user who reached a cut goal and switched are in the same state because the
   product asks the same thing of both. A second field would need a rules
   change and would then have to be kept in step with the direction it
   duplicates — the "two fields for one goal weight" bug this codebase has
   already paid for once.

2. **Entry is one tap on the Body tab, only after `goal-reached` is on
   record.** `MaintenanceSwitchCard` renders in the slot the milestone prompt
   just vacated, in the same visual language, and only when the trend has
   crossed, the milestone is recorded, and the profile is not already
   maintaining. Rendering after the record — not alongside the prompt — means a
   passive Health import cannot walk a user onto maintenance by itself; the
   person has already said the crossing is theirs. Declining is remembered per
   device the way the milestone prompt's decline is (`useDismissedStub`).

3. **The switch is `toMaintenanceSwitchPatch` in core, one profile update.** It
   writes what a "maintain" wizard run would: `goalDirection: 'maintain'`,
   `targetPaceLbsPerWeek: 0`, both goal-weight fields cleared. Two things the
   wizard does *not* do, and this must:
   - `targetMode: 'auto'` — a custom number typed for the cut would otherwise
     outrank the maintenance estimate the user just asked for. The stored
     custom values are left in place, per `targetMode`'s own contract, so
     switching back restores them.
   - **The onboarding seed is rewritten for maintenance at the current weight,
     but only when the profile carries one.** In `'auto'` mode a stored seed
     outranks formula mode (`dailyTargets`, third branch), so a 2-question-
     onboarded user left with the cut seed would keep eating at the deficit with
     "Maintain" showing in Settings. A profile with no seed gets none — writing
     one would hand a formula-mode user a heuristic they never had.

4. **Reminders get quieter, never silent.** `planReminders` takes
   `maintaining`: the streak-at-risk nudge is dropped and the lapsed nudges
   reduce to the day-7 one. Meal windows are the user's own setting and are
   untouched; the weigh-in nudge stays, because the trend is the one number
   that still matters in maintenance. Omitting the flag is the full plan, so
   every existing caller is byte-identical.

5. **Exit is the wizard, as before.** Settings → Edit goals; nothing new.

## Consequences

- **Nothing is celebrated, counted down, or graded.** The card is a question
  with two answers and names no number. `UX_AUDIT.md` §S12 and the
  `milestones.ts` export-surface test are unchanged and still enforce this.
- **The seed rewrite is the one behaviour that moves a number the day it
  runs**, and it moves it *up* (deficit → maintenance). It is tested for both
  bases: heuristic (weight × 14) and formula (Mifflin at pace 0, which is the
  same figure formula mode will produce once the seed is superseded, so the
  later handover moves nothing).
- **This ships by OTA.** Pure JS on both platforms; no native module, no
  fingerprint change.
- **Not taken:** a "maintaining" line on Today's hero. Settings already labels
  the goal, and the target itself is the visible change. Revisit if the
  switch's first real users report not noticing it took.
- **Not taken:** bounding the meal-window dailies for a lapsed maintaining
  user. That is the separate call `STATUS.md` records under lever 2, and it
  changes existing schedules.
