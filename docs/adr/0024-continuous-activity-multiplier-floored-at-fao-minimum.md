# A continuous activity multiplier from the device, floored at the FAO free-living minimum

**Status:** accepted · **Decided:** 2026-08-19 · **Written up:** 2026-08-23

This ADR was cited by three files before it existed — `packages/core/src/tdee.ts`,
`apps/mobile/src/lib/ledger.ts` and `apps/mobile/src/app/(app)/refine-targets.tsx`
all point at "ADR-0024" for the reasoning behind `profile.activityMultiplier`.
The decision was made and shipped; only the record was missing. Nothing here is
new; it is written down so the next person does not have to reconstruct it from
comments.

## Context

The formula (pre-data) estimate is Mifflin-St Jeor × an activity multiplier,
where the multiplier came from a five-rung ladder the user picks from —
sedentary 1.2 through very_active 1.9. Two problems, both measured:

1. **A self-reported bucket is a guess, and the ladder is coarse.** Its rungs
   are 0.175 apart, which is ±285 kcal/day on a 1,632 kcal basal — larger than
   the error the bucket is being used to express.
2. **The device's own signal, used naively, is below the physiological floor.**
   `docs/research/activity-tdee-composition-survey.md` §8.3 predicted this in
   July as "the single most likely failure": implied ratios clustering at the
   bottom so that *everyone reads sedentary*. It landed. On the owner's account,
   28 of 28 usable days, mean `activeKcal` 246/day over a bare basal of 1,632
   implies PAL **1.279** — below FAO/WHO/UNU's free-living minimum — for someone
   walking 5,213 steps a day and lifting three times a week.

A wrist wearable measures *detected* movement, so its total is missing most
non-exercise activity thermogenesis. NEAT is not a rounding error: it varies by
up to ~2,000 kcal/day between people. A number that cannot be true of anyone who
is not bedbound is evidence about the instrument, not about the person.

## Decision

**1. Store a continuous multiplier, not a sixth bucket.**
`profile.activityMultiplier` is a number. `mifflinStJeor` prefers it when
present and finite and `> 0`, and falls back to `ACTIVITY_MULTIPLIERS[bucket]`
otherwise — so every account without a Health import is byte-for-byte
unchanged. `snapMultiplier` survives only for *naming* a level in copy; it must
not be used for arithmetic.

**2. Clamp it to `[1.40, 1.90]`.** The floor is the bottom of FAO/WHO/UNU 2001's
lowest free-living band, published rather than fitted. Flooring is additive in
effect — it supplies exactly the unrecorded NEAT needed to reach the lowest
defensible answer — while above the floor the device's signal is used
unmodified, so a genuinely more active user is still measured. The ceiling stays
at the ladder's own top rather than FAO's 2.40; raising it would change the
answer for very active users on no evidence gathered here.

Measured against that account's 97-day gap-free energy balance of 2,385:

| Multiplier | Estimate | Error |
|---|---|---|
| raw implied 1.279 | 2,087 | −12.5% |
| snapped to the ladder, 1.2 | 1,958 | −17.9% |
| the stored self-reported bucket, 1.55 | 2,530 | +6.1% |
| **floored at 1.40** | **2,285** | **−4.2%** |

The load-bearing comparison is the last two rows. The alternative to the device
value is not "nothing" — it is what the user typed, and the floored device value
beat it.

**3. The bucket is still what the card NAMES, and the user still confirms.**
`deriveActivityLevel` snaps the *clamped* value, not the raw one: naming the raw
1.279 made the card say "switch to sedentary" while the target it produced sat
between light and moderate. The deadband, by contrast, is scored on the *raw*
value — "is the measurement far enough from what the user said to be worth
raising?" is a different question from "what do we call the number we would
store?".

**4. It never reaches the measured estimate.** Once there are ≥14 logged days
the target comes from energy balance alone; `activeKcal` is not an input to it,
because energy balance already contains every training calorie and adding the
device's number there double-counts.

## Consequences

- The formula estimate improves for Health users and is unchanged for everyone
  else. The multiplier is a *prior*: it is alive only in the window before
  energy balance can speak.
- This puts Ignia in the same place as MacroFactor for the estimate that
  actually governs a target — they refuse wearable energy on validity grounds
  (survey §6), and in measured mode so do we. The difference is confined to the
  seed, where their answer is a self-reported activity factor and ours is a
  floored measurement of the same quantity.
- **Decision 4 is a seam that an optimisation would quietly break** — "we have
  the data, use it" is a natural-looking change and every unit test would have
  stayed green. It is now pinned by
  `packages/core/src/tdee-wearable-independence.test.ts`: with 120 logged days,
  moving the stored multiplier across 1.40 / 1.55 / 1.90 must leave the target
  byte-identical, while the same field must still move the seed.
- A corrupt stored value degrades to the bucket rather than to `NaN`, which is
  why the guard is on finiteness and `> 0` rather than on presence.

## Alternatives rejected

- **Add `activeKcal` on top of the formula TDEE.** The survey's central finding
  is that no comparable product does this; it double-counts the activity
  allowance already inside the multiplier (survey §1, §5, §7).
- **Drop the device input entirely, as MacroFactor does.** Defensible, and it is
  what we already do in measured mode. Rejected for the seed because the thing
  it would fall back to is a self-reported bucket that measured *worse* (+6.1%
  vs −4.2%) on the only account with a benchmark to check against.
- **A sixth ladder rung.** Cannot represent 1.279 at all, and the rung spacing is
  wider than the error being corrected.
