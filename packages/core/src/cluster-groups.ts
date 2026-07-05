// Pure cluster-group numbering for the Train tab. The set sequence is the
// source of truth: an `activation` opens a new cluster; following `mini`
// sets join it; a `mini` with no open cluster opens its own; any other kind
// (working/warmup/drop) closes the cluster and is ungrouped. Stored `group`
// numbers are ignored (and thus healed). Shared by both apps (ADR-0003/0012).
import type { SetKind } from './workout';

/**
 * Re-derive cluster `group` numbers from the set-kind sequence so clusters
 * always number sequentially (1, 2, 3 …). A cluster begins at each
 * `activation` set; the `mini` sets that follow inherit its number. Plain
 * `working`/`warmup` sets and back-off `drop` sets are not part of a
 * cluster and carry no group.
 *
 * This is both the fix and the heal: the editable per-set group input used
 * to let a number be mis-entered (an append-typed `"12"`/`"10"` instead of
 * `"1"`), and those corrupt values round-tripped untouched. The
 * activation/mini ordering — not the stored number — is the source of
 * truth for cluster membership, so recomputing from it restores correct
 * sequential numbering on the next read/save without losing structure.
 *
 * Generic over the set shape so callers keep their exact element type
 * (session sets, template planned-sets, or bare `{ kind }` seeds). Returns a
 * new array; entries whose group is already correct are reused by reference
 * (no needless object churn).
 */
export function normalizeClusterGroups<T extends { kind: SetKind; group?: number }>(
  sets: readonly T[],
): T[] {
  let cluster = 0;
  let inCluster = false;
  return sets.map((s) => {
    if (s.kind === 'activation') {
      cluster += 1;
      inCluster = true;
      return s.group === cluster ? s : { ...s, group: cluster };
    }
    if (s.kind === 'mini') {
      // An orphan mini (no preceding activation) opens its own cluster so
      // it still gets a stable number rather than colliding with set 1.
      if (!inCluster) {
        cluster += 1;
        inCluster = true;
      }
      return s.group === cluster ? s : { ...s, group: cluster };
    }
    inCluster = false;
    return s.group === undefined ? s : { ...s, group: undefined };
  });
}
