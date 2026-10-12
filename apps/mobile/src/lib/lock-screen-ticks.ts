/**
 * What a Lock Screen "Done set" (S23-8) put into EMPTY fields — so an untick in
 * the app takes it back out exactly as it does for an in-app tick (review
 * JS-P2-3).
 *
 * An in-app tick keeps that note in the row's own ref (`SetRow` `accepted`):
 * "logged" means a stored count, so a tick-then-untick that left the accepted
 * reps behind left a phantom set (L2, ADR-0041). A Lock Screen tick happens
 * with no row mounted, so its note lives here, keyed by the row's position and
 * checked against the set's kind and cluster group; `SetRow.untick` reads it
 * when its own ref is empty and, like the ref, only reverts a value that is
 * still unchanged. Typing into the row clears it. In memory only — a reload
 * forgets it, which errs toward keeping the set, as a collapsed row does.
 */

export interface AcceptedValues {
  count?: number;
  weight?: number;
}

interface Note extends AcceptedValues {
  kind: string;
  group: number | null;
}

const notes = new Map<string, Note>();
const key = (exerciseIndex: number, setIndex: number) => `${exerciseIndex}:${setIndex}`;

/** Record what a Lock Screen tick of this row accepted. */
export function noteLockScreenAccepted(
  exerciseIndex: number,
  setIndex: number,
  set: { kind?: string; group?: number },
  accepted: AcceptedValues | null,
): void {
  if (!accepted) {
    notes.delete(key(exerciseIndex, setIndex));
    return;
  }
  notes.set(key(exerciseIndex, setIndex), { ...accepted, kind: set.kind ?? 'working', group: set.group ?? null });
}

/** Take (and forget) the note for this row, if it still describes this set. */
export function takeLockScreenAccepted(
  exerciseIndex: number,
  setIndex: number,
  set: { kind?: string; group?: number },
): AcceptedValues | null {
  const k = key(exerciseIndex, setIndex);
  const note = notes.get(k);
  notes.delete(k);
  if (!note || note.kind !== (set.kind ?? 'working') || note.group !== (set.group ?? null)) return null;
  return { ...(note.count != null ? { count: note.count } : {}), ...(note.weight != null ? { weight: note.weight } : {}) };
}

/** Forget every note — the workout closed. */
export function clearLockScreenAccepted(): void {
  notes.clear();
}
