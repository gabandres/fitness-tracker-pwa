// The one place ADR-0028's research has a direct implementable consequence.
// Pure, framework-free, no I/O — the day-summary convention (ADR-0003).

import type { PlannedSet, TemplateExercise } from './workout';

/**
 * The dose ceiling, in seconds, above which a pre-lift hold is flagged.
 *
 * Simic et al.'s meta-analytical review of 104 studies: pre-exercise static
 * stretching reduces maximal strength by about 5.4% and power by about 1.9%,
 * dose-dependently — smallest at <=45 s per muscle group, strength maintained
 * and range of motion still improving at <=60 s, deficit climbing beyond.
 */
export const MOBILITY_PRE_DOSE_CEILING_SEC = 60;

/** True when this planned set is a mobility hold. */
const isMobility = (s: PlannedSet): boolean => s.kind === 'mobility';

/**
 * The index of the first exercise carrying a working set, or -1 when the
 * template prescribes none.
 *
 * "Pre" is *derived* from array position rather than stored as a `phase`
 * field: the array is already ordered and already renders in order, so a
 * stored position is an assertion that can drift out of sync with the one the
 * user actually sees (ADR-0028 decision 3).
 *
 * Note this asks about the SET kinds, not about `logStyle`: an exercise made
 * entirely of mobility sets is mobility work whatever its log style says.
 */
function firstWorkingIndex(exercises: readonly TemplateExercise[]): number {
  return exercises.findIndex((ex) =>
    ex.plannedSets.some((s) => !isMobility(s) && s.kind !== 'warmup'));
}

/** One flagged prescription: which exercise, and the longest hold on it. */
export interface MobilityDoseWarning {
  /** Index into the template's `exercises` array. */
  exerciseIndex: number;
  /** Snapshot name, for copy that names the movement. */
  name: string;
  /** The longest prescribed hold on that exercise, in seconds. */
  longestSec: number;
}

/**
 * Mobility prescribed at more than {@link MOBILITY_PRE_DOSE_CEILING_SEC}
 * BEFORE the first working exercise.
 *
 * ## What this deliberately does not look at
 *
 * **Static vs dynamic.** There is no such distinction in the model and adding
 * one is not free — it is either a new `Exercise` field every user-created
 * movement would leave blank, or a hardcoded list keyed on seed identity that
 * classifies nothing a user writes. Either way the guardrail would go quiet on
 * exactly the movements the app knows least about. So it keys on position and
 * duration alone and accepts that it will sometimes flag a dynamic flow: a
 * warning that occasionally over-applies costs far less than one that stays
 * silent on a five-minute pre-lift hamstring hold (ADR-0028 amendment 1A).
 *
 * That is also why the copy must CITE rather than assert — the dose figures
 * are about static stretching, so the note says what the evidence found and
 * leaves the user's number alone. It warns; it never caps. This app does not
 * silently overrule a person who typed a number.
 *
 * ## The mobility-only session returns nothing, and that is not "safe"
 *
 * With no working exercise there is no `pre` position at all, so the answer is
 * "not applicable" rather than "fine" (ADR-0028 amendment 1B). The
 * strength-deficit finding is entirely about what a stretch does to the
 * lifting that follows it; with no lifting to follow, a warning would be
 * telling the user a mobility session is bad for a workout they are not doing.
 * A mobility-only template produces ZERO warnings at any duration.
 *
 * Post-position holds are unguarded for the same reason.
 */
export function mobilityDoseWarnings(
  exercises: readonly TemplateExercise[],
): MobilityDoseWarning[] {
  const firstWorking = firstWorkingIndex(exercises);
  if (firstWorking < 0) return [];

  const out: MobilityDoseWarning[] = [];
  for (let i = 0; i < firstWorking; i += 1) {
    const ex = exercises[i];
    let longest = 0;
    for (const s of ex.plannedSets) {
      if (isMobility(s) && (s.durationSec ?? 0) > longest) longest = s.durationSec ?? 0;
    }
    if (longest > MOBILITY_PRE_DOSE_CEILING_SEC) {
      out.push({ exerciseIndex: i, name: ex.name, longestSec: longest });
    }
  }
  return out;
}
