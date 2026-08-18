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

/**
 * Human-readable row labels for a set sequence: plain sets count `1, 2, 3`,
 * and a cluster takes ONE of those numbers with lettered sub-sets —
 * `1a, 1b, 1c`. A three-set cluster followed by a straight set reads
 * `1a 1b 1c 2`.
 *
 * This replaces the `C1`/`C2` notation, which was unreadable without the
 * glossary: it told you a cluster's *index* but not where the cluster sat in
 * the workout, so a session's rows read `1, C1, C1, C1, 2` — two independent
 * numbering schemes interleaved, neither of them the row's position. The
 * letters carry the same grouping with no vocabulary attached, and stay
 * legible in a 36pt-wide cell.
 *
 * Presentation only: `group` remains the stored truth and is untouched.
 * Reads the CONSECUTIVE run of equal groups rather than the group number, so
 * it agrees with {@link normalizeClusterGroups} by construction and does not
 * depend on stored numbers being healed first.
 */
export function setRowLabels(sets: readonly { kind: SetKind; group?: number }[]): string[] {
  const out: string[] = [];
  let main = 0;
  let sub = 0;
  let openGroup: number | undefined;

  for (const s of sets) {
    if (s.group == null) {
      main += 1;
      openGroup = undefined;
      out.push(String(main));
      continue;
    }
    if (s.group !== openGroup) {
      // A new cluster consumes the next whole set number.
      main += 1;
      sub = 0;
      openGroup = s.group;
    } else {
      sub += 1;
    }
    out.push(`${main}${subLetter(sub)}`);
  }
  return out;
}

/** a, b, c … z, then aa, ab … — clusters run to three in practice, so the
 *  wrap-around is a guard against a pathological template, not a feature. */
function subLetter(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
