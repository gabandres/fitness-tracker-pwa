import type { SessionRemoval } from '@macrolog/core';
import type { CardioBlock } from '@macrolog/core/cardio';

/**
 * What a live-session Undo can put back: core's set / exercise removals
 * (`SessionRemoval`, restored by core's `undoRemoval`), plus a cardio block.
 *
 * The block's restore lives here rather than beside the other two in core
 * only because the change that added it (UX_AUDIT S20 — removing a cardio
 * block, an imported Health one included, had no Undo) was scoped to the app.
 * It is the same rule; move it into core's `undoRemoval` when core is next
 * touched.
 */
export type TrainRemoval = SessionRemoval | { kind: 'cardio'; index: number; block: CardioBlock };

/**
 * Put a removed cardio block back at its old index (clamped), purely.
 *
 * Removing an IMPORTED block also records its `sourceId` in
 * `dismissedSourceIds`, so the next import does not bring it back. Undo has to
 * take that back too — left behind, the restored block was the one the
 * importer refused to refresh, and a later remove-and-reimport could never
 * happen (2026-10-15 audit).
 */
export function undoCardioRemoval<S extends { cardio?: CardioBlock[]; dismissedSourceIds?: string[] }>(
  session: S,
  removal: { index: number; block: CardioBlock },
): S {
  const list = session.cardio ?? [];
  const at = Math.max(0, Math.min(removal.index, list.length));
  const restored = { ...session, cardio: [...list.slice(0, at), removal.block, ...list.slice(at)] };
  const sid = removal.block.sourceId;
  if (sid && session.dismissedSourceIds?.includes(sid)) {
    restored.dismissedSourceIds = session.dismissedSourceIds.filter((x) => x !== sid);
  }
  return restored;
}
