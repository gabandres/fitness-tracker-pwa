/**
 * Resolving what an exercise is PROGRAMMED as (ADR-0040).
 *
 * ## Why absence is a rule, not a constant
 *
 * Every template and every logged session on disk predates `setStructure`.
 * The migration path ADR-0040 takes is to make absence mean "infer with the
 * pre-0040 rule" — the exact inference the app already ran:
 *
 * ```ts
 * expectsCluster: sessionEx?.sets.some((x) => x.kind === 'activation') ?? false
 * ```
 *
 * {@link inferStructure} IS that line, promoted to a named function. Because
 * the resolver reproduces the old behaviour rather than replacing it, no
 * document is rewritten and no backfill runs, and it is impossible for
 * ADR-0040 to retroactively reinterpret a session logged under ADR-0038/0039.
 * That was a hard constraint, and this is where it is enforced.
 *
 * ## Precedence
 *
 * template → catalog → inference. The template is the prescription for THIS
 * lift on THIS day and therefore wins; the catalog entry is a default for a
 * movement ("my cable row is normally straight sets"); inference is the
 * floor, and it only ever sees data written before the field existed.
 *
 * ## The prescription is not the log
 *
 * {@link structureOf} takes the planned sets, not the logged ones. Reading
 * structure off the log is what ADR-0040 exists to stop: a cluster logged as
 * straight sets is a DEVIATION the engine must be able to see, and it cannot
 * see it if the log defines the prescription. {@link inferStructure} is the
 * one place a set list is allowed to imply a structure, and only for data
 * that has no declaration to contradict.
 */
import type { SetStructure } from './workout';

/** Structures the progression engine can actually read. Everything else must
 *  be refused explicitly rather than routed to a reader built for something
 *  else — see `unsupported-structure` in `progression-engine.ts`. */
export const READABLE_STRUCTURES: readonly SetStructure[] = ['straight', 'myoreps', 'rest-pause', 'cluster'];

export function isReadableStructure(s: SetStructure): boolean {
  return READABLE_STRUCTURES.includes(s);
}

/**
 * The pre-ADR-0040 inference, verbatim: an `activation` set means the lift
 * was programmed as myo-reps, anything else means straight sets.
 *
 * Deliberately ignores `continuation`, `drop` and every other kind. It is not
 * a classifier and must not grow into one — it exists to keep undeclared
 * legacy data reading exactly as it did, and any cleverness added here
 * changes the meaning of history, which ADR-0040 forbids.
 */
export function inferStructure(sets: readonly { kind: string }[] | undefined): SetStructure {
  return sets?.some((s) => s.kind === 'activation') ? 'myoreps' : 'straight';
}

/**
 * What this exercise is programmed as.
 *
 * `planned` should be the TEMPLATE's `plannedSets`. Passing a session's
 * logged sets is only correct for a session that has no template behind it
 * (a freehand log), where the log is the only statement of intent there is.
 */
export function structureOf(
  template?: { setStructure?: SetStructure; plannedSets?: readonly { kind: string }[] },
  catalog?: { setStructure?: SetStructure },
  planned?: readonly { kind: string }[],
): SetStructure {
  return (
    template?.setStructure ??
    catalog?.setStructure ??
    inferStructure(planned ?? template?.plannedSets)
  );
}
