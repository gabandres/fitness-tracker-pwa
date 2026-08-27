import { describe, expect, it } from 'vitest';
import type { PlannedSet, TemplateExercise } from './workout';
import { MOBILITY_PRE_DOSE_CEILING_SEC, mobilityDoseWarnings } from './mobility';

const ex = (name: string, plannedSets: PlannedSet[]): TemplateExercise =>
  ({ exerciseId: name, name, plannedSets });

const hold = (durationSec: number): PlannedSet => ({ kind: 'mobility', durationSec });
const working = (): PlannedSet => ({ kind: 'working' });

describe('mobilityDoseWarnings', () => {
  it('flags a pre-lift hold longer than the dose ceiling', () => {
    const w = mobilityDoseWarnings([
      ex('Couch stretch', [hold(90)]),
      ex('Back Squat', [working(), working()]),
    ]);
    expect(w).toEqual([{ exerciseIndex: 0, name: 'Couch stretch', longestSec: 90 }]);
  });

  it('is silent AT the ceiling — 60 s maintains strength and still improves ROM', () => {
    expect(mobilityDoseWarnings([
      ex('Couch stretch', [hold(MOBILITY_PRE_DOSE_CEILING_SEC)]),
      ex('Back Squat', [working()]),
    ])).toEqual([]);
  });

  it('reports the LONGEST hold on the exercise, not the first', () => {
    expect(mobilityDoseWarnings([
      ex('Hip flow', [hold(30), hold(120), hold(45)]),
      ex('Deadlift', [working()]),
    ])[0].longestSec).toBe(120);
  });

  it('does not guard holds placed AFTER the working exercises', () => {
    // The strength-deficit finding is about what a stretch does to the lifting
    // that FOLLOWS it. Nothing follows a post-position hold.
    expect(mobilityDoseWarnings([
      ex('Back Squat', [working()]),
      ex('Couch stretch', [hold(300)]),
    ])).toEqual([]);
  });

  it('produces ZERO warnings for a mobility-only template, at any duration', () => {
    // ADR-0028 amendment 1B: with no working exercise there is no `pre`
    // position, so the answer is "not applicable" rather than "safe". A
    // mobility-only session is explicitly allowed (decision 8 — it marks the
    // day trained), so this case is reached, not hypothetical.
    expect(mobilityDoseWarnings([
      ex('Hip flow', [hold(600)]),
      ex('Couch stretch', [hold(900)]),
    ])).toEqual([]);
  });

  it('treats a leading warm-up ramp as not-yet-working, so mobility before it still counts', () => {
    // A load ramp is not the lifting the finding protects; the deficit applies
    // to the working sets that follow either way.
    expect(mobilityDoseWarnings([
      ex('Couch stretch', [hold(90)]),
      ex('Back Squat', [{ kind: 'warmup' }, working()]),
    ])).toHaveLength(1);
  });

  it('ignores a mobility set with no prescribed duration', () => {
    expect(mobilityDoseWarnings([
      ex('Hip flow', [{ kind: 'mobility' }]),
      ex('Bench', [working()]),
    ])).toEqual([]);
  });

  it('flags every offending pre exercise, in array order', () => {
    const w = mobilityDoseWarnings([
      ex('Hip flow', [hold(120)]),
      ex('Couch stretch', [hold(75)]),
      ex('Bench', [working()]),
    ]);
    expect(w.map((x) => x.exerciseIndex)).toEqual([0, 1]);
  });
});
