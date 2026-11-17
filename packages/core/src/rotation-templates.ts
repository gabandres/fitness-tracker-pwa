import type { OneOff, WorkoutSession } from './workout';

/** How recently a template must have been performed to count as part of the
 *  rotation when no Program v2 names one: four weeks, the longest gap a
 *  weekly rotation can hold and still be the one the lifter is running. */
export const ROTATION_ACTIVE_DAYS = 28;

/**
 * The templates the plan — and the rotation Train's volume sheet reads — is
 * made of. Moved here from `WeeklyVolumeSheet` (2026-10-20) so the CSV
 * export's `rotationVolume` rows pick the SAME templates the sheet does.
 *
 * A Program v2 names its templates, and those are it. Without one, "every
 * template" counted the Upper/Lower split abandoned in spring as part of this
 * week's rotation (its last session, months old, sat in the "rotation" and
 * its sets in "planned"; 2026-10-15 audit). So only templates with a COMPLETED
 * session in the last {@link ROTATION_ACTIVE_DAYS} count; a user who has
 * performed none of them yet (new, or back from a long break) gets every
 * template, which is the only plan there is to show.
 *
 * An ARCHIVED template (`archivedAt`, 2026-10-24) is never part of the
 * rotation, whichever branch picks it: archiving is how a lifter says "I am
 * not running this any more" without deleting the history behind it. Pure.
 */
export function rotationTemplates<T extends { id?: string; archivedAt?: Date | null; oneOff?: OneOff }>(
  all: readonly T[],
  programTemplateIds: ReadonlySet<string>,
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'templateId'>[],
  nowMs: number,
): T[] {
  // A one-off (`oneOff`, 2026-11-16) is not part of any rotation either.
  const templates = all.filter((tp) => !isArchivedTemplate(tp) && !isOneOffTemplate(tp));
  if (programTemplateIds.size) return templates.filter((tp) => tp.id && programTemplateIds.has(tp.id));
  const since = nowMs - ROTATION_ACTIVE_DAYS * 86_400_000;
  const used = new Set(
    sessions
      .filter((s) => s.status === 'completed' && s.templateId && s.date.getTime() >= since)
      .map((s) => s.templateId as string),
  );
  const live = templates.filter((tp) => tp.id && used.has(tp.id));
  return live.length ? live : [...templates];
}

/** True when a template has been archived (`archivedAt` set). Archived
 *  templates are hidden from Start's list and the rotation, never deleted:
 *  sessions keep their `templateId`. Pure. */
export function isArchivedTemplate(t: { archivedAt?: Date | null }): boolean {
  return t.archivedAt != null;
}

// ─── One-off templates (owner, 2026-11-16) ──────────────────────

/** True for a ONE-OFF template (`WorkoutTemplate.oneOff`): a throwaway for one
 *  day — never in a rotation, never "next up" unless a trip plan names it. */
export function isOneOffTemplate(t: { oneOff?: OneOff | null }): boolean {
  return t.oneOff != null;
}

/** A well-formed {@link OneOff}, else undefined — a malformed one is dropped on
 *  read, never repaired (a guessed date would archive the wrong day). */
export function oneOffOf(raw: unknown): OneOff | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const on = (raw as Record<string, unknown>)['archiveOn'];
  return typeof on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(on) ? { archiveOn: on } : undefined;
}

/**
 * The one-off templates due to be archived now: not archived yet, and either a
 * session of it is COMPLETED (an active or paused one is not "logged"), or
 * `today` (YYYY-MM-DD, the lifter's day) has reached `archiveOn` — whichever
 * comes first. Archived = hidden from pickers; its sessions keep their
 * `templateId`, so history is untouched. Pure; the app writes `archivedAt`.
 */
export function oneOffsToArchive<T extends { id?: string; archivedAt?: Date | null; oneOff?: OneOff }>(
  templates: readonly T[],
  sessions: readonly Pick<WorkoutSession, 'status' | 'templateId'>[],
  today: string,
): T[] {
  const logged = new Set(sessions.filter((s) => s.status === 'completed' && s.templateId).map((s) => s.templateId as string));
  return templates.filter((t) => t.id && t.oneOff && !isArchivedTemplate(t) && (logged.has(t.id) || today >= t.oneOff.archiveOn));
}

/** Whether a one-off is past its day and should already be out of the pickers,
 *  before the archive write lands. */
export function isExpiredOneOff(t: { oneOff?: OneOff }, today: string): boolean {
  return t.oneOff != null && today >= t.oneOff.archiveOn;
}
