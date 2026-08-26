import type { SessionExercise, WorkoutSet } from './workout';

/**
 * Sanity rules for the load on a lifted set — the one place, shared by both
 * frontends, that answers "is this a plausible weight to have lifted".
 *
 * ## Why this exists (#85)
 *
 * A live account stored `weight: 1275` on a set of **bodyweight glute
 * bridges**. Nothing rejected it, and nothing could have: `firestore.rules`
 * validates `exercises is list && size() <= 40` and nothing inside, because
 * rules have no way to iterate a list. That is the same reason {@link
 * clampRir} had to exist after a set was found stored with `rir: 8`. There is
 * no server-side fallback for this class; it has to be caught on the client.
 *
 * Modelled on `./weight-bounds`, including the deliberate split between a soft
 * range enforced at the input and a wider absolute backstop enforced on write,
 * so a genuine edge-case load still saves while obvious garbage cannot persist
 * down any path — logger, template, or import.
 *
 * ## The bound follows the MOVEMENT, and that is the whole idea
 *
 * A single ceiling cannot catch the reported defect. 1,275 lb is absurd for a
 * glute bridge and unremarkable for a loaded leg press, and no one threshold
 * separates them — so there are two. A `weight-reps` exercise gets
 * {@link SET_LOAD_ABS_MAX_LB}, which only has to catch an extra digit. A
 * `bodyweight` exercise gets {@link ADDED_LOAD_ABS_MAX_LB}, because a load
 * there is a held dumbbell, a belt or a vest rather than a barbell, and that
 * is bounded an order of magnitude lower.
 *
 * That split is what makes 1,275 lb on a glute bridge rejectable while the
 * same account's plausible 12 lb on the same exercise survives — and it is
 * why the numeric bounds alone were not enough.
 */

/**
 * Soft ceiling, enforced at the input: a hard reject above this.
 *
 * Sized against this app's population rather than against powerlifting
 * records. Ignia's users log 5 lb dumbbells and 40 lb pin stacks; the heaviest
 * plausible entry is a loaded leg press or hack squat, which reaches a few
 * hundred pounds well short of this. A four-digit entry is far more often a
 * typo than a lift.
 */
export const SET_LOAD_MAX_LB = 1000;

/**
 * Absolute backstop enforced on write, wider than the input range for the same
 * reason `WEIGHT_ABS_MAX_LB` is: a genuine load near the soft ceiling must
 * still save, while a value that could only be corrupt must not persist
 * whatever wrote it.
 */
export const SET_LOAD_ABS_MAX_LB = 1500;

/**
 * Ceiling for ADDED load on a `bodyweight`-logged exercise.
 *
 * A load here is real — a dumbbell held during a glute bridge, a belt on a
 * pull-up, a weighted vest — so it is kept rather than stripped: deleting real
 * logged work to fix a different bug is the one outcome worth being
 * conservative about, and the reported account's own 12 lb entries are exactly
 * that case.
 *
 * But it is bounded far lower than a barbell lift, because nobody hangs 1,275
 * lb off a belt. This is the bound that actually catches #85.
 */
export const ADDED_LOAD_ABS_MAX_LB = 200;

/**
 * Coerce user input to a storable set load, or `undefined` to leave it unset.
 *
 * Deliberately the same shape and the same guards as {@link clampRir} in
 * `./workout`: emptiness is checked BEFORE coercion, because `Number('')` and
 * `Number(null)` are both `0` and a 0 lb set is meaningful (an unloaded bar,
 * an empty machine). Values above the ceiling become `undefined` rather than
 * clamping down to it — unlike RIR, where "very easy" made a clamp the
 * unambiguous intent, nobody who typed 12750 meant 1000.
 */
export function clampSetLoad(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > SET_LOAD_MAX_LB) return undefined;
  return n;
}

/** True when a load is within the absolute range the store will persist. */
export function isStorableSetLoad(weight: number): boolean {
  return Number.isFinite(weight) && weight >= 0 && weight <= SET_LOAD_ABS_MAX_LB;
}

/** The store-seam ceiling for a set, which depends on how it is logged. */
export function maxStorableLoadFor(logStyle: SessionExercise['logStyle']): number {
  return logStyle === 'bodyweight' ? ADDED_LOAD_ABS_MAX_LB : SET_LOAD_ABS_MAX_LB;
}

function sanitizeSet(set: WorkoutSet, logStyle: SessionExercise['logStyle']): WorkoutSet {
  if (set.weight === undefined) return set;
  const ok =
    Number.isFinite(set.weight) && set.weight >= 0 && set.weight <= maxStorableLoadFor(logStyle);
  if (!ok) {
    // Drop the field rather than zero it: 0 is a real load (an empty bar), so
    // writing 0 would replace "corrupt" with "lifted nothing", which reads as
    // data rather than as absence.
    const { weight: _dropped, ...rest } = set;
    return rest;
  }
  return set;
}

/**
 * Drop any set load that could only be corrupt, on every write path.
 *
 * Applied in `toSessionDoc`/`toSessionPatch`, which both write `exercises`
 * wholesale and are the single seam every session write on both frontends
 * passes through — the analogue of the store-seam clamp `./weight-bounds`
 * describes for bodyweight.
 *
 * Returns the input array unchanged (by identity) when nothing needed
 * sanitizing, so the common path allocates nothing and a session doc does not
 * rewrite itself on every save.
 */
export function sanitizeSessionExercises(exercises: SessionExercise[]): SessionExercise[] {
  let anyChanged = false;
  const next = exercises.map((ex) => {
    // Tracked PER EXERCISE: a shared flag would copy every exercise after the
    // first dirty one, so a single bad set would rewrite the whole array.
    let exChanged = false;
    const sets = ex.sets.map((s) => {
      const clean = sanitizeSet(s, ex.logStyle);
      if (clean !== s) exChanged = true;
      return clean;
    });
    if (!exChanged) return ex;
    anyChanged = true;
    return { ...ex, sets };
  });
  return anyChanged ? next : exercises;
}
