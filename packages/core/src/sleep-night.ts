import { addDays, calendarDateKey, parseYmd, type DateKey } from './date';
import { boundaryHourOn, dayKeyAt, MIDNIGHT, type DayBoundary } from './day-boundary';

/**
 * Which documents could already hold a MANUAL row for the night an importer is
 * about to file? (issue #80)
 *
 * ## The bug this exists to close
 *
 * `importDailySleep` refuses to overwrite a night the user typed. It asks that
 * question of **one document id** — the key it is about to write — and that is
 * only the same question if the manual writer and the importer agree on the
 * key. Since [ADR-0030](../../../docs/adr/0030-configurable-day-boundary.md)
 * they can disagree:
 *
 * - **Manual** — the sleep sheet writes under the *user's* day,
 *   `dayKeyAt(now, boundary)`.
 * - **Importers** — Apple Health and Health Connect bucket a night by the
 *   CALENDAR date it ended on; Oura ships its own `day` and ADR-0030 Q5 says to
 *   keep it. All three are the wake day, unshifted.
 *
 * On `dayStartHour: 3`, a night typed at 01:00 lands on key *D−1* while the
 * importer files the same night on *D*. Two documents, one night. The guard
 * reads the wrong one, finds nothing, writes — and the protection silently does
 * not apply in exactly the window it was written for.
 *
 * ## What this function does instead
 *
 * It answers "which keys could hold the manual twin of this night", given the
 * instant the sleeper **woke** — which the importers do know, even though the
 * key they store under has already discarded it (`endMs` on a health sample,
 * `bedtime_end` on an Oura sleep period).
 *
 * The storage key is never changed. That is deliberate and it is ADR-0030 Q5:
 * a ring knows when your night ended and Ignia does not, so the *stored* day
 * stays the source's. Only the PROTECTION CHECK becomes boundary-aware.
 *
 * ## Why not simply check the neighbouring key whenever the boundary is set
 *
 * That was sketch 1 in the issue and it is wrong, for a reason worth recording
 * so it is not re-proposed. A user on a non-zero boundary who types *some*
 * nights would have a manual row at D−1 for a **different** night; a blanket
 * neighbour check reads that as "hands off" and declines every import on the
 * day after any typed night. The failure is silent, permanent, and looks
 * exactly like a broken integration. Keying the extra check on the wake instant
 * narrows it to the only window where the two writers can actually collide.
 *
 * ## The bounds this is deliberately total on
 *
 * - **Midnight is inert.** When the boundary in force on the storage day is 0
 *   this returns `[storageKey]` — byte-for-byte the old behaviour, for every
 *   account that has never touched the setting, which today is nearly all of
 *   them.
 * - **An unknown wake instant is inert.** A transport that cannot say when the
 *   night ended gets the old behaviour rather than a guess.
 * - **At most one extra key, and it must be adjacent.** `dayKeyAt` shifts back
 *   by at most `MAX_DAY_START_HOUR` hours, so a manual twin can only be
 *   the day before. The day *after* is admitted too, because Oura's `day` is a
 *   value the ring chose and this module does not assert which end of the night
 *   it names. Anything further away is a disagreeing timezone rather than a
 *   boundary, and is not this function's business.
 */
export function manualNightKeys(
  storageKey: DateKey,
  wakeAt: Date | number | null | undefined,
  boundary: DayBoundary = MIDNIGHT,
): readonly DateKey[] {
  const only: readonly DateKey[] = [storageKey];
  if (!DATE_KEY.test(storageKey)) return only;
  if (boundaryHourOn(storageKey, boundary) === 0) return only;

  const at = wakeAt instanceof Date ? wakeAt : typeof wakeAt === 'number' ? new Date(wakeAt) : null;
  if (!at || !Number.isFinite(at.getTime())) return only;

  const manual = dayKeyAt(at, boundary);
  if (manual === storageKey || !isAdjacent(storageKey, manual)) return only;
  return [storageKey, manual];
}

/** `YYYY-MM-DD` — the shape `parseYmd` and the string compares below are total on. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Exactly one calendar day apart, in either direction. */
function isAdjacent(a: DateKey, b: DateKey): boolean {
  const day = parseYmd(a);
  return calendarDateKey(addDays(day, -1)) === b || calendarDateKey(addDays(day, 1)) === b;
}
