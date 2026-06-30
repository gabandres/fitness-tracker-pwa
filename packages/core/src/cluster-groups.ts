// Pure cluster-group numbering for the Train tab. The set sequence is the
// source of truth: an `activation` opens a new cluster; following `mini`
// sets join it; a `mini` with no open cluster opens its own; any other kind
// (working/warmup/drop) closes the cluster and is ungrouped. Stored `group`
// numbers are ignored (and thus healed). Shared by both apps (ADR-0003/0012).
import type { WorkoutSet } from './workout';

export function normalizeClusterGroups(sets: WorkoutSet[]): WorkoutSet[] {
  let cluster = 0;
  let inCluster = false;
  let changed = false;
  const out = sets.map((s) => {
    let group: number | undefined;
    if (s.kind === 'activation') {
      cluster += 1;
      inCluster = true;
      group = cluster;
    } else if (s.kind === 'mini') {
      if (!inCluster) {
        cluster += 1;
        inCluster = true;
      }
      group = cluster;
    } else {
      inCluster = false;
      group = undefined;
    }
    if (s.group === group) return s; // already correct → reuse reference
    changed = true;
    return { ...s, group };
  });
  return changed ? out : sets;
}
