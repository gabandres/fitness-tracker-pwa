/**
 * Program versions (Program v2, 2026-10-11).
 *
 * A program version is a set of template drafts (`TemplateDraftDoc` with
 * `program: 'v2'`), one per template it changes, switched on and off
 * TOGETHER. v1 is the live templates as they are; switching to v2 swaps each
 * draft's body in (`planSwaps`) and keeps the v1 body on the draft for the
 * way back, so v1 stays intact.
 *
 * Two ways to switch:
 *
 * - **Automatically, once.** A draft can carry `autoActivate`: after a
 *   COMPLETED session of `afterTemplateId` that started after `after`, every
 *   v2 draft switches on together ({@link programAutoActivation}). The owner's
 *   case: v1 runs the next Push session (the flat-press load test, straight
 *   sets, a clean baseline), and v2 starts as soon as it is logged. The switch
 *   stamps `autoActivatedAt`, and it never runs a second time — not after a
 *   manual switch back, not on a replay.
 * - **By hand**, from Settings → Program version. The manual switch wins: it
 *   disarms the automatic one.
 *
 * Each switch is logged on the template's notes with the draft's `reason`
 * (`plan` in `superset-context.ts`), and every session started afterwards
 * carries the version it ran as (`WorkoutSession.templateVersion`).
 *
 * Pure.
 */
import type { TemplateDraftDoc } from './superset-context';
import type { WorkoutSession } from './workout';

/** The reason every Program v2 switch is logged with. */
export const PROGRAM_V2_REASON = 'Program v2: Push supersets, Lateral ×2';

export type ProgramVersion = 'v1' | 'v2';

type ProgramDraft = Pick<TemplateDraftDoc, 'draftOf' | 'status' | 'program' | 'autoActivate' | 'autoActivatedAt'>;

/** The drafts that make up Program v2. */
export function programDrafts<D extends Pick<TemplateDraftDoc, 'program'>>(drafts: readonly D[]): D[] {
  return drafts.filter((d) => d.program === 'v2');
}

/**
 * Which version is live: `v2` when every v2 draft is switched on, `v1` when
 * none is, `mixed` when only some are (a hand-made state the toggle offers to
 * settle), and undefined when there is no program at all.
 */
export function programVersion(drafts: readonly ProgramDraft[]): ProgramVersion | 'mixed' | undefined {
  const program = programDrafts(drafts);
  if (program.length === 0) return undefined;
  const on = program.filter((d) => d.status === 'active').length;
  return on === 0 ? 'v1' : on === program.length ? 'v2' : 'mixed';
}

/** The version a session of `templateId` runs as, to snapshot at its start —
 *  undefined for a template no program version touches. */
export function templateVersionFor(templateId: string | undefined, drafts: readonly ProgramDraft[]): ProgramVersion | undefined {
  if (!templateId) return undefined;
  const d = programDrafts(drafts).find((x) => x.draftOf === templateId);
  if (!d) return undefined;
  return d.status === 'active' ? 'v2' : 'v1';
}

/**
 * The drafts the automatic switch turns on now that `session` is saved, or
 * an empty list. All of these must hold:
 * - the session is COMPLETED, of the armed template, and started after the
 *   arming time (a session already in progress when the switch was armed
 *   still counts if it started after; an older one never does);
 * - no v2 draft is already on, and none has `autoActivatedAt` (it ran once);
 * - the switch is still armed (`autoActivate` present; the manual toggle
 *   removes it).
 */
export function programAutoActivation<D extends ProgramDraft>(
  drafts: readonly D[],
  session: Pick<WorkoutSession, 'status' | 'templateId' | 'date'>,
): D[] {
  const program = programDrafts(drafts);
  if (program.length === 0 || session.status !== 'completed') return [];
  if (program.some((d) => d.status === 'active' || d.autoActivatedAt)) return [];
  const armed = program.find((d) => d.autoActivate);
  if (!armed?.autoActivate || armed.autoActivate.afterTemplateId !== session.templateId) return [];
  const after = Date.parse(armed.autoActivate.after);
  if (Number.isNaN(after) || session.date.getTime() < after) return [];
  return program;
}
