/**
 * Program v2's switch, as the writes it takes — one pure step shared by the
 * Train tab (`useTrain`, which also runs the one automatic switch after a
 * finish) and Settings → Program version (`useProgram`), so the two can never
 * switch differently. The writes go to `commitDraftSwaps` in one batch.
 */
import {
  planSwaps,
  programDrafts,
  type ProgramVersion,
  type TemplateDraftDoc,
} from '@macrolog/core';
import type { DraftSwapWrite } from '@/lib/ledger';
import type { Exercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';

export interface ProgramSwitchContext {
  templates: readonly WorkoutTemplate[];
  catalog: readonly Exercise[];
  sessions: readonly WorkoutSession[];
  drafts: readonly TemplateDraftDoc[];
  now: Date;
}

export interface ProgramSwitchWrites {
  writes: DraftSwapWrite[];
  patches: { draftId: string; set?: Record<string, string>; remove?: string[] }[];
}

/**
 * Every v2 draft to `version`, together. Drafts already there are skipped;
 * any switch removes `autoActivate` (the lifter chose), and the automatic one
 * stamps `autoActivatedAt` so it never runs again. Null when there is nothing
 * to write.
 */
export function programSwitchWrites(
  version: ProgramVersion,
  ctx: ProgramSwitchContext,
  opts: { auto?: boolean } = {},
): ProgramSwitchWrites | null {
  const program = programDrafts(ctx.drafts);
  if (program.length === 0) return null;
  const mode = version === 'v2' ? 'activate' : 'revert';
  const target = version === 'v2' ? 'active' : 'draft';
  const todo = program.filter((d) => d.id
    && d.status !== target
    && (mode === 'activate' || d.previous)
    && ctx.templates.some((t) => t.id === d.draftOf));
  const patches = program.filter((d) => d.id && (d.autoActivate || opts.auto)).map((d) => ({
    draftId: d.id!,
    ...(opts.auto ? { set: { autoActivatedAt: ctx.now.toISOString() } } : {}),
    ...(d.autoActivate ? { remove: ['autoActivate'] } : {}),
  }));
  if (todo.length === 0 && patches.length === 0) return null;
  const ids = todo.map((d) => d.draftOf);
  const plans = todo.length
    ? planSwaps(
      todo.map((draft) => (mode === 'activate'
        ? { mode: 'activate' as const, draft }
        : { mode: 'revert' as const, draft: {
          draftOf: draft.draftOf, previous: draft.previous, activatedAt: draft.activatedAt,
          program: draft.program, reason: draft.reason, keepBaselines: draft.keepBaselines,
        } })),
      {
        live: ctx.templates,
        catalog: (id: string) => ctx.catalog.find((e) => e.id === id) ?? null,
        sessions: ctx.sessions,
        now: ctx.now,
        // Superset drafts OUTSIDE the program that are switched on: where a
        // lift they moved last lived (`planSwaps`).
        retired: ctx.drafts
          .filter((d) => d.status === 'active' && d.previous && !ids.includes(d.draftOf))
          .map((d) => ({ id: d.draftOf, ...d.previous! })),
      },
    )
    : [];
  return {
    writes: todo.map((d, k) => ({ mode, draftId: d.id!, templateId: d.draftOf, body: plans[k].body, kept: plans[k].replaced })),
    patches,
  };
}
