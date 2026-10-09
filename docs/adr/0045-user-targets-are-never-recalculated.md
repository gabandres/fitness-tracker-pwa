# ADR-0045: A user-set target is never recalculated; every automatic change is recorded per day and announced

- **Status:** accepted 2026-10-08 — implemented in `64b127b8`, OTA on iOS
  68/70 and Android vc 47/48/50 the same night.
- **Date:** 2026-10-08
- **Touches:** `packages/core/src/targets.ts` (source + suggestion),
  `target-history.ts` (new), `csv-export.ts` (`target` rows),
  `firestore.rules` (`dailyTargets`), `functions/src/gdpr.ts`,
  `apps/mobile` Today (`useTargetHistory`, `TargetChangeNotice`), a past day,
  Daily targets.

## Context

On 2026-10-08 the owner's protein target read 130 g instead of 135 with
nothing changed by hand. `proteinPerKg: 1.9` makes the target follow the
newest weigh-in, rounded to 5 g; 153.8 → 153.6 lb crossed the edge at
153.74 lb. The arithmetic was right. What was wrong: the number moved with
nothing on screen saying so, every past day showed today's target (nothing
was stored), and there was no way to say "this number is mine" for protein
that recalculation would respect.

## Decision

1. **Per-field source.** `dailyTargets` reports `user | auto` for calories and
   protein. `user` = `targetMode: 'custom'` + a manual value, and it is never
   moved. The automatic value is still computed and shown as a suggestion.
2. **A record per day** (`dailyTargets/{day}`): values, sources, `basis`, and on
   a day they moved, `change` = old → new + reasons (weight, g/kg basis,
   maintenance estimate, pace, floor; `recalculated` when nothing recorded
   names why). Written from Today only when logs, weights, profile and the
   records have all answered from the server — a cache-only input would record
   a change that never happened.
3. **Every automatic change is announced** on Today until dismissed. A user's
   own change is recorded with its reason, not announced back.
4. **No reconstruction.** A day with no record is unknown; screens fall back
   to today's computed target and the export leaves the columns blank.

## Consequences

- The live g/kg basis stays automatic by design; it now moves visibly.
- History before 2026-10-08 has no target records. The owner's 10/8 record
  was captured that evening from the live value (130 g auto); 10/9 carries the
  140 g user override with its reason.
- Considered and declined: freezing the g/kg target at the weight it was set
  at (still silent when re-frozen), and hysteresis on the 5 g rounding (hides
  the drift instead of explaining it).
