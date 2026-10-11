/**
 * Supersets: two or three exercises performed alternately with short rests
 * between them (2026-10-11).
 *
 * ## What a superset is, and is not, in this model
 *
 * A superset changes the ORDER sets are performed in and the REST between
 * them. Nothing else. Each exercise keeps its own identity, load, clusters,
 * effort standard and history; the progression engine still reads one
 * exercise at a time, and a cluster counts once in the weekly audit whether
 * or not it was supersetted.
 *
 * That is why it is a GROUPING of template rows (`supersetGroup` +
 * `pairPosition`) and not a {@link SetStructure}. `SetStructure` describes how
 * one lift's sets are built (straight, myo-reps …); a superset is a
 * relationship between lifts. ADR-0040's declared-but-unread `superset`
 * structure is left alone and stays unread.
 *
 * ## Where the fields live
 *
 * On the template ROW, not the template document. Rules validate a template's
 * top-level keys with `hasOnly` but cannot iterate the `exercises` list, so a
 * row field needs no rules change and no deploy-before-write ordering. The
 * group's two rests (`transitionRestSec`, `roundRestSec`) are stored once, on
 * the group's leader (`pairPosition` 1); {@link groupRest} is the one reader.
 * Starting a session snapshots all four onto every member's
 * `SessionExercise`, so a running workout never needs its template.
 *
 * ## The evidence the guardrails cite
 *
 * Zhang, Weakley et al. 2025 (Sports Med; 19 studies): supersets matched
 * traditional sets for hypertrophy, strength and total reps in less time;
 * agonist–antagonist pairs INCREASED reps (SMD +0.68); pairs with similar
 * biomechanics REDUCED volume load (SMD −1.08); perceived exertion was higher.
 *
 * Pure; no I/O.
 */
import type { MuscleGroup, SetKind } from './workout';
import { restAfterSet, type RestSeconds } from './rest-after-set';

/** Group letters, in the order new groups are named. */
export const SUPERSET_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A pair, or a tri-set. A fourth member is dropped by {@link normalizeSupersets}. */
export const MAX_SUPERSET_SIZE = 3;
export type PairPosition = 1 | 2 | 3;

/**
 * Default rests, seconds. The prescription is "30–45 s" for both; the timer
 * runs the LOW end, the convention `restAfterSec`/`restAfterMaxSec` already
 * follow, and the lifter can raise either per group.
 */
export const DEFAULT_TRANSITION_REST_SEC = 30;
export const DEFAULT_ROUND_REST_SEC = 30;
/** The prescribed range both defaults come from — display only. */
export const SUPERSET_REST_RANGE_SEC = { min: 30, max: 45 } as const;

/** The superset half of a template row or session exercise. */
export interface SupersetFields {
  /** "A", "B", "C"… — absent for a straight exercise. */
  supersetGroup?: string;
  /** 1, 2 or 3 within the group — the order the members alternate in. */
  pairPosition?: PairPosition;
  /** Rest from one member to the next within a round, seconds. Leader row. */
  transitionRestSec?: number;
  /** Rest after the round's last member, before the first again. Leader row. */
  roundRestSec?: number;
}

/** "A1" for a supersetted row, `undefined` for a straight one. */
export function supersetLabel(row: SupersetFields): string | undefined {
  return row.supersetGroup && row.pairPosition ? `${row.supersetGroup}${row.pairPosition}` : undefined;
}

export interface SupersetMember {
  /** Index of the row in the exercise list. */
  index: number;
  pairPosition: PairPosition;
}

/**
 * Every REAL superset in a list: group letter → members, in alternation order
 * (pairPosition, then list order). A group with one member is not a superset —
 * a partner was removed — and is left out, so it runs as straight sets.
 */
export function supersetGroups(rows: readonly SupersetFields[]): Map<string, SupersetMember[]> {
  const byGroup = new Map<string, SupersetMember[]>();
  rows.forEach((r, index) => {
    if (!r.supersetGroup) return;
    const list = byGroup.get(r.supersetGroup) ?? [];
    list.push({ index, pairPosition: r.pairPosition ?? ((list.length + 1) as PairPosition) });
    byGroup.set(r.supersetGroup, list);
  });
  for (const [g, list] of byGroup) {
    if (list.length < 2) byGroup.delete(g);
    else list.sort((a, b) => a.pairPosition - b.pairPosition || a.index - b.index);
  }
  return byGroup;
}

/** True when the row belongs to a group with at least one partner. */
export function isSupersetted(rows: readonly SupersetFields[], index: number): boolean {
  const g = rows[index]?.supersetGroup;
  return g != null && (supersetGroups(rows).get(g)?.length ?? 0) >= 2;
}

/** The group's two rests, read off its leader (else any member that has
 *  them), else the defaults. */
export function groupRest(
  rows: readonly SupersetFields[],
  group: string,
): { transitionRestSec: number; roundRestSec: number } {
  const members = supersetGroups(rows).get(group) ?? [];
  const pick = (k: 'transitionRestSec' | 'roundRestSec') =>
    members.map((m) => rows[m.index][k]).find((v) => v != null);
  return {
    transitionRestSec: pick('transitionRestSec') ?? DEFAULT_TRANSITION_REST_SEC,
    roundRestSec: pick('roundRestSec') ?? DEFAULT_ROUND_REST_SEC,
  };
}

/**
 * Put a row list into canonical superset form — what every writer saves:
 *
 * - a group with one member loses its group (it is straight now);
 * - members are CONTIGUOUS, gathered at the first member's place in
 *   alternation order (a superset is performed as a block, so it is listed
 *   as one);
 * - members beyond {@link MAX_SUPERSET_SIZE} leave the group;
 * - groups are re-lettered A, B, C… in list order and members renumbered
 *   1, 2, 3;
 * - the two rests sit on the leader only.
 *
 * Rows that are already canonical come back by reference.
 */
/** How a SESSION is normalized: its group letters stay what the lifter has
 *  been reading all workout (re-lettering B to A mid-session renames a
 *  station), and every member keeps the group's rests, as the start snapshot
 *  wrote them. Templates use the defaults: re-lettered, rests on the leader. */
export interface NormalizeOptions {
  keepLetters?: boolean;
  restsOnEveryMember?: boolean;
}

export function normalizeSupersets<T extends SupersetFields>(rows: readonly T[], opts: NormalizeOptions = {}): T[] {
  const groups = supersetGroups(rows);
  const strip = (r: T): T => {
    if (r.supersetGroup == null && r.pairPosition == null && r.transitionRestSec == null && r.roundRestSec == null) return r;
    const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...rest } = r;
    return rest as T;
  };
  const out: T[] = [];
  const placed = new Set<number>();
  let letter = 0;
  rows.forEach((row, i) => {
    if (placed.has(i)) return;
    const members = row.supersetGroup ? groups.get(row.supersetGroup) : undefined;
    if (!members) {
      placed.add(i);
      out.push(strip(row));
      return;
    }
    const kept = members.slice(0, MAX_SUPERSET_SIZE);
    const rest = groupRest(rows, row.supersetGroup!);
    const name = opts.keepLetters ? row.supersetGroup! : SUPERSET_LETTERS[letter++ % SUPERSET_LETTERS.length];
    kept.forEach((m, k) => {
      placed.add(m.index);
      const src = rows[m.index];
      const pos = (k + 1) as PairPosition;
      const want: SupersetFields = k === 0 || opts.restsOnEveryMember
        ? { supersetGroup: name, pairPosition: pos, transitionRestSec: rest.transitionRestSec, roundRestSec: rest.roundRestSec }
        : { supersetGroup: name, pairPosition: pos };
      const same = src.supersetGroup === want.supersetGroup && src.pairPosition === want.pairPosition
        && src.transitionRestSec === want.transitionRestSec && src.roundRestSec === want.roundRestSec;
      out.push(same ? src : ({ ...strip(src), ...want } as T));
    });
    // Overflow members run straight, right after the block.
    for (const m of members.slice(MAX_SUPERSET_SIZE)) {
      placed.add(m.index);
      out.push(strip(rows[m.index]));
    }
  });
  return out;
}

/**
 * Pair the row at `index` with the row after it. When `index` is already in a
 * group, the next row joins that group (a tri-set) if there is room. A next row
 * already in ANOTHER group is left alone (the list comes back unchanged).
 * Returns the canonical list.
 */
export function canPairWithNext(rows: readonly SupersetFields[], index: number): boolean {
  const a = rows[index];
  const b = rows[index + 1];
  if (!a || !b) return false;
  const groups = supersetGroups(rows);
  const own = a.supersetGroup && groups.has(a.supersetGroup) ? a.supersetGroup : undefined;
  if (b.supersetGroup && groups.has(b.supersetGroup)) return false;
  return !own || (groups.get(own)?.length ?? 0) < MAX_SUPERSET_SIZE;
}

export function pairWithNext<T extends SupersetFields>(rows: readonly T[], index: number): T[] {
  const a = rows[index];
  const b = rows[index + 1];
  if (!a || !b) return [...rows];
  const groups = supersetGroups(rows);
  const used = new Set(rows.map((r) => r.supersetGroup).filter(Boolean));
  const group = a.supersetGroup && groups.has(a.supersetGroup)
    ? a.supersetGroup
    : [...SUPERSET_LETTERS].find((l) => !used.has(l)) ?? 'Z';
  const size = groups.get(group)?.length ?? 1;
  if (size >= MAX_SUPERSET_SIZE) return [...rows];
  // Never take the next row out of a pair of its own: that would dissolve a
  // choice the lifter made, silently. They unpair it first.
  if (b.supersetGroup && groups.has(b.supersetGroup) && b.supersetGroup !== group) return [...rows];
  const next = rows.map((r, i) => {
    if (i === index && !groups.has(group)) return { ...r, supersetGroup: group, pairPosition: 1 as PairPosition };
    if (i === index + 1) {
      const { transitionRestSec: _t, roundRestSec: _r, ...rest } = r;
      return { ...rest, supersetGroup: group, pairPosition: (size + 1) as PairPosition } as T;
    }
    return r;
  });
  return normalizeSupersets(next);
}

/** Take the row at `index` out of its group; a partner left alone goes
 *  straight too. Returns the canonical list. */
export function unpair<T extends SupersetFields>(rows: readonly T[], index: number, opts: NormalizeOptions = {}): T[] {
  const next = rows.map((r, i) => {
    if (i !== index) return r;
    const { supersetGroup: _g, pairPosition: _p, transitionRestSec, roundRestSec, ...rest } = r;
    return rest as T;
  });
  // The leader's rests stay with the group when the leader leaves it.
  const g = rows[index]?.supersetGroup;
  const t = rows[index]?.transitionRestSec;
  const rr = rows[index]?.roundRestSec;
  if (g && (t != null || rr != null)) {
    const heir = next.findIndex((r) => r.supersetGroup === g);
    if (heir >= 0) {
      next[heir] = {
        ...next[heir],
        ...(t != null && next[heir].transitionRestSec == null ? { transitionRestSec: t } : {}),
        ...(rr != null && next[heir].roundRestSec == null ? { roundRestSec: rr } : {}),
      };
    }
  }
  return normalizeSupersets(next, opts);
}

// ─── The alternating flow ───────────────────────────────────────

/**
 * An exercise's sets split into UNITS — the thing a superset alternates.
 *
 * A cluster (activation + its minis / continuations, and a drop set that
 * follows it) is one unit; a straight working set is one unit. Warm-ups and
 * mobility holds ride with the unit after them, so they are done at the
 * station before its first effort. Returns set indices per unit, in order.
 */
export function exerciseUnits(sets: readonly { kind: SetKind }[]): number[][] {
  const units: number[][] = [];
  let lead: number[] = [];
  let open: number[] | null = null;
  let openIsCluster = false;
  sets.forEach((s, i) => {
    switch (s.kind) {
      case 'warmup':
      case 'mobility':
        lead.push(i);
        open = null;
        return;
      case 'activation':
        open = [...lead, i];
        openIsCluster = true;
        units.push(open);
        lead = [];
        return;
      case 'mini':
      case 'continuation':
        if (open && openIsCluster) open.push(i);
        else {
          // An orphan mini opens its own cluster, as `normalizeClusterGroups` does.
          open = [...lead, i];
          openIsCluster = true;
          units.push(open);
          lead = [];
        }
        return;
      case 'drop':
        if (open) open.push(i);
        else {
          open = [...lead, i];
          openIsCluster = false;
          units.push(open);
          lead = [];
        }
        return;
      default:
        open = [...lead, i];
        openIsCluster = false;
        units.push(open);
        lead = [];
    }
  });
  if (lead.length) {
    if (units.length) units[units.length - 1].push(...lead);
    else units.push(lead);
  }
  return units;
}

/** One stop in the workout: one unit of one exercise. */
export interface FlowStep {
  exerciseIndex: number;
  /** Which unit of the exercise (0-based) — the round, inside a superset. */
  unit: number;
  setIndices: number[];
  /** "A1" inside a superset. */
  label?: string;
  group?: string;
}

type FlowRow = SupersetFields & { sets: readonly { kind: SetKind }[] };

/**
 * The order the session is performed in. Straight exercises run unit after
 * unit; a superset runs A1 unit 1 → A2 unit 1 → A1 unit 2 → A2 unit 2 …, and
 * when the members have different unit counts the leftover units run alone,
 * in alternation order. A group is emitted where its first member sits.
 */
export function supersetFlow(rows: readonly FlowRow[]): FlowStep[] {
  const groups = supersetGroups(rows);
  const steps: FlowStep[] = [];
  const emitted = new Set<string>();
  rows.forEach((row, exerciseIndex) => {
    const members = row.supersetGroup ? groups.get(row.supersetGroup) : undefined;
    if (!members) {
      exerciseUnits(row.sets).forEach((setIndices, unit) => steps.push({ exerciseIndex, unit, setIndices }));
      return;
    }
    if (emitted.has(row.supersetGroup!)) return;
    emitted.add(row.supersetGroup!);
    const unitsOf = members.map((m) => exerciseUnits(rows[m.index].sets));
    const rounds = Math.max(...unitsOf.map((u) => u.length));
    for (let r = 0; r < rounds; r++) {
      members.forEach((m, k) => {
        const u = unitsOf[k][r];
        if (!u) return;
        const label = supersetLabel({ supersetGroup: row.supersetGroup, pairPosition: (k + 1) as PairPosition });
        steps.push({ exerciseIndex: m.index, unit: r, setIndices: u, group: row.supersetGroup, ...(label ? { label } : {}) });
      });
    }
  });
  return steps;
}

export type RestKind =
  /** Inside a unit: between mini-sets, or into a drop / continuation. */
  | 'intra'
  /** Between two units of the same straight exercise. */
  | 'cluster'
  /** After an exercise (or a whole superset), before the next one. */
  | 'after-exercise'
  /** From one superset member to the next, within a round. */
  | 'transition'
  /** After the round's last member, before its first again. */
  | 'round';

export interface FlowRest {
  seconds: number;
  kind: RestKind;
  /** The set that comes next in the flow, if any. */
  next?: { exerciseIndex: number; setIndex: number; label?: string };
  /** On a `round` rest: which round comes next, of how many ("Round 2 of 3"). */
  round?: { n: number; total: number };
}

/**
 * Which rest follows the set at (`exerciseIndex`, `setIndex`), and what comes
 * after it — the superset-aware sibling of {@link restAfterSet}.
 *
 * Inside a unit nothing changes: mini-set rest, the drop and continuation
 * constants. Between units of a superset:
 *
 * - to the next member in the same round → the group's transition rest;
 * - to the next round, when that round has two or more members → the round rest;
 * - to a LEFTOVER unit (the next round has one member) → that exercise's
 *   ordinary between-cluster rest, because it runs as a straight set;
 * - after the group's last unit → the rest after the exercise.
 *
 * "Next" skips what is already logged when `isDone` is given: a lifter whose
 * A1 station was taken and who did all of A2 first is not sent back to A2
 * after A1's cluster, and gets A1's own between-cluster rest instead of a
 * 30-second switch to a finished exercise.
 *
 * `restFor` gives an exercise's ordinary rests (template, row and ⋯ override
 * already resolved by the caller). The group's rests come from the rows.
 */
export function restAfterSetInFlow(
  rows: readonly FlowRow[],
  exerciseIndex: number,
  setIndex: number,
  restFor: (exerciseIndex: number) => RestSeconds,
  isDone?: (exerciseIndex: number, setIndex: number) => boolean,
): FlowRest {
  const row = rows[exerciseIndex];
  const own = restFor(exerciseIndex);
  const flow = supersetFlow(rows);
  const at = flow.findIndex((s) => s.exerciseIndex === exerciseIndex && s.setIndices.includes(setIndex));
  const step = flow[at];
  const open = (s: FlowStep) => !isDone || s.setIndices.some((i) => !isDone(s.exerciseIndex, i));
  const nextStep = at >= 0 ? flow.slice(at + 1).find(open) : undefined;
  const nextOf = (s: FlowStep | undefined) =>
    s ? { exerciseIndex: s.exerciseIndex, setIndex: firstOpen(s), ...(s.label ? { label: s.label } : {}) } : undefined;
  const firstOpen = (s: FlowStep) => s.setIndices.find((i) => !isDone?.(s.exerciseIndex, i)) ?? s.setIndices[0];

  // Mid-unit, or a set the flow does not know: the per-exercise rule decides.
  const lastOfUnit = step != null && step.setIndices[step.setIndices.length - 1] === setIndex;
  if (!step || !lastOfUnit) {
    const seconds = restAfterSet(row?.sets ?? [], setIndex, own);
    const nextIdx = step ? step.setIndices[step.setIndices.indexOf(setIndex) + 1] : undefined;
    return {
      seconds,
      kind: 'intra',
      ...(nextIdx != null ? { next: { exerciseIndex, setIndex: nextIdx, ...(step?.label ? { label: step.label } : {}) } } : {}),
    };
  }

  const next = nextOf(nextStep);
  if (!step.group) {
    // A straight exercise: the per-exercise rule already knows "next cluster"
    // from "next exercise".
    const sameExercise = nextStep?.exerciseIndex === exerciseIndex;
    return {
      seconds: restAfterSet(row.sets, setIndex, own),
      kind: sameExercise ? 'cluster' : 'after-exercise',
      ...(next ? { next } : {}),
    };
  }

  const { transitionRestSec, roundRestSec } = groupRest(rows, step.group);
  if (nextStep?.group === step.group) {
    // The next open unit is this exercise's own (its partner is finished): an
    // ordinary between-cluster rest, as for a straight lift.
    if (nextStep.exerciseIndex === exerciseIndex) {
      return { seconds: own.cluster, kind: 'cluster', ...(next ? { next } : {}) };
    }
    if (nextStep.unit === step.unit) return { seconds: transitionRestSec, kind: 'transition', ...(next ? { next } : {}) };
    const groupSteps = flow.filter((s) => s.group === step.group);
    const inNextRound = groupSteps.filter((s) => s.unit === nextStep.unit && open(s)).length;
    if (inNextRound >= 2) {
      const total = Math.max(...groupSteps.map((s) => s.unit)) + 1;
      return { seconds: roundRestSec, kind: 'round', round: { n: nextStep.unit + 1, total }, ...(next ? { next } : {}) };
    }
    // A leftover unit: the exercise's own rest, but still a round of the
    // superset — "A1 alone · round 3 of 3".
    const total = Math.max(...groupSteps.map((s) => s.unit)) + 1;
    return { seconds: restFor(nextStep.exerciseIndex).cluster, kind: 'cluster', round: { n: nextStep.unit + 1, total }, ...(next ? { next } : {}) };
  }
  return { seconds: own.afterExercise ?? own.cluster, kind: 'after-exercise', ...(next ? { next } : {}) };
}

/**
 * The tag each row shows ("A1"), derived from the REAL groups — so a card never
 * claims a pairing the flow does not run (a partner removed or replaced
 * mid-session leaves a lone member, which runs straight and is untagged), and a
 * tri-set that lost its middle member renumbers A1, A2 rather than A1, A3.
 */
export function supersetTags(rows: readonly SupersetFields[]): (string | undefined)[] {
  const out: (string | undefined)[] = rows.map(() => undefined);
  for (const [group, members] of supersetGroups(rows)) {
    members.forEach((m, k) => {
      out[m.index] = `${group}${k + 1}`;
    });
  }
  return out;
}

/** Resolve a template's superset fields onto each of its session exercises at
 *  start: group, position and the group's two rests on EVERY member, so the
 *  running workout reads them without the template. Straight rows get none. */
export function snapshotSupersets<R extends SupersetFields>(rows: readonly R[]): SupersetFields[] {
  const groups = supersetGroups(rows);
  return rows.map((r, i) => {
    const members = r.supersetGroup ? groups.get(r.supersetGroup) : undefined;
    if (!members) return {};
    const rest = groupRest(rows, r.supersetGroup!);
    return {
      supersetGroup: r.supersetGroup,
      pairPosition: (members.findIndex((m) => m.index === i) + 1) as PairPosition,
      transitionRestSec: rest.transitionRestSec,
      roundRestSec: rest.roundRestSec,
    };
  });
}

// ─── Guardrails ─────────────────────────────────────────────────

/**
 * Muscle groups that oppose each other across a joint — the pairs whose
 * supersets Zhang 2025 found INCREASE reps. Deliberately short: `shoulders`
 * is one group covering front and rear delts, so it opposes nothing reliably,
 * and `core` has no antagonist in this taxonomy.
 */
export const ANTAGONIST_PAIRS: readonly (readonly [MuscleGroup, MuscleGroup])[] = [
  ['chest', 'back'],
  ['biceps', 'triceps'],
  ['quads', 'hamstrings'],
];

export type PairKind =
  /** Both exercises' PRIMARY muscle is the same — expected to cost volume. */
  | 'same-muscle'
  /** The primaries oppose each other — the best-supported pairing. */
  | 'agonist-antagonist'
  /** Different primaries, but one primary also works in the other lift
   *  (a press's triceps beside an extension). Not in the three-way spec: said
   *  plainly rather than mislabelled "non-competing". */
  | 'overlapping'
  /** Unrelated muscles. Likely fine, less studied. */
  | 'non-competing'
  /** A member has no muscles tagged: nothing to judge. */
  | 'unknown';

export interface PairJudgement {
  kind: PairKind;
  /** The shared muscle for `same-muscle` / `overlapping`. */
  muscle?: MuscleGroup;
}

/**
 * Judge one pairing from each exercise's ordered muscle list. The PRIMARY
 * muscle is `muscles[0]` — the same reading the weekly cluster audit uses, so
 * "which muscle does this lift train" has one answer across the app.
 */
export function classifyPair(a: readonly MuscleGroup[], b: readonly MuscleGroup[]): PairJudgement {
  const pa = a[0];
  const pb = b[0];
  if (!pa || !pb) return { kind: 'unknown' };
  if (pa === pb) return { kind: 'same-muscle', muscle: pa };
  if (ANTAGONIST_PAIRS.some(([x, y]) => (x === pa && y === pb) || (x === pb && y === pa))) {
    return { kind: 'agonist-antagonist' };
  }
  if (b.includes(pa)) return { kind: 'overlapping', muscle: pa };
  if (a.includes(pb)) return { kind: 'overlapping', muscle: pb };
  return { kind: 'non-competing' };
}

/**
 * A load test is pending when the load this session will use differs from the
 * load the exercise was last lifted at in the direction of progress — heavier,
 * or less assistance. The first session at a new load is the test of it, and a
 * superset's shorter rest would confound that test. `plannedLoad` is what the
 * session will seed (the engine's call, the lifter's own load winning — see
 * `honourLifterLoad`), not merely the template's number.
 */
export function pendingLoadTest(
  plannedLoad: number | undefined,
  history: readonly { sets: readonly { kind: SetKind; weight?: number; reps?: number }[] }[],
  assisted = false,
): { from: number; to: number } | null {
  if (plannedLoad == null) return null;
  for (const ex of history) {
    const loads = ex.sets
      .filter((s) => (s.kind === 'activation' || s.kind === 'working') && s.reps != null && s.weight != null)
      .map((s) => s.weight as number);
    if (loads.length === 0) continue;
    const last = assisted ? Math.min(...loads) : Math.max(...loads);
    const progressed = assisted ? plannedLoad < last - 0.01 : plannedLoad > last + 0.01;
    return progressed ? { from: last, to: plannedLoad } : null;
  }
  return null;
}

export interface GroupWarning {
  group: string;
  /** Every pair in the group, in alternation order. */
  pairs: { a: number; b: number; judgement: PairJudgement }[];
  /** Members (row indices) with a pending load test. */
  pendingLoadTests: number[];
}

/**
 * What the template editor shows under each superset: the pair type of every
 * pairing, and which members have a load test pending. Advisory only — saving
 * is never blocked.
 */
export function supersetWarnings(
  rows: readonly (SupersetFields & { exerciseId: string })[],
  musclesOf: (exerciseId: string) => readonly MuscleGroup[],
  hasPendingLoadTest: (exerciseId: string) => boolean = () => false,
): GroupWarning[] {
  const out: GroupWarning[] = [];
  for (const [group, members] of supersetGroups(rows)) {
    const pairs: GroupWarning['pairs'] = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i].index;
        const b = members[j].index;
        pairs.push({ a, b, judgement: classifyPair(musclesOf(rows[a].exerciseId), musclesOf(rows[b].exerciseId)) });
      }
    }
    out.push({
      group,
      pairs,
      pendingLoadTests: members.map((m) => m.index).filter((i) => hasPendingLoadTest(rows[i].exerciseId)),
    });
  }
  return out.sort((x, y) => x.group.localeCompare(y.group));
}

/**
 * Total rest a row list prescribes BETWEEN units, seconds — every gap in the
 * flow except after the last unit (that one leads into cardio or the end, and
 * is the same either way). Intra-cluster rests are left out: a superset does
 * not change them. Used to estimate what a superset version saves, from the
 * same {@link restAfterSetInFlow} the workout runs on.
 */
export function plannedRestSec(rows: readonly FlowRow[], restFor: (exerciseIndex: number) => RestSeconds): number {
  const flow = supersetFlow(rows);
  let total = 0;
  for (let i = 0; i < flow.length - 1; i++) {
    const s = flow[i];
    total += restAfterSetInFlow(rows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor).seconds;
  }
  return total;
}

/**
 * Move a row from `from` to `to` (a drag) and keep the supersets honest.
 *
 * A member dragged away from every group-mate LEAVES its group (returned as
 * `left`, so the screen can say so); a straight row dropped inside a block is
 * moved out to just after it; the result is canonical. Without this the tag
 * kept saying "A2" on a row nowhere near A1 and save snapped it back — what
 * was shown was not what got saved.
 */
export function reorderWithSupersets<T extends SupersetFields>(
  rows: readonly T[],
  from: number,
  to: number,
  opts: NormalizeOptions = {},
): { rows: T[]; left?: { row: T; group: string } } {
  if (from === to || !rows[from] || to < 0 || to >= rows.length) return { rows: [...rows] };
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const g = moved.supersetGroup;
  if (g && supersetGroups(rows).has(g)) {
    const nearMate = [next[to - 1], next[to + 1]].some((r) => r != null && r !== moved && r.supersetGroup === g);
    if (!nearMate) {
      const solo = unpair(next, to, opts);
      return { rows: solo, left: { row: moved, group: g } };
    }
  }
  // Inside a block the LIST order is the alternation order now: dragging A1
  // below A2 makes it A2.
  const seen = new Map<string, number>();
  const renumbered = next.map((r) => {
    if (!r.supersetGroup) return r;
    const k = (seen.get(r.supersetGroup) ?? 0) + 1;
    seen.set(r.supersetGroup, k);
    return r.pairPosition === k ? r : { ...r, pairPosition: k as PairPosition };
  });
  return { rows: normalizeSupersets(renumbered, opts) };
}

/**
 * The list's order in UNITS: each superset is one block of its row indices,
 * each straight row a block of one. What a one-step move moves, and how a
 * position is counted out loud ("Superset A moved to 2 of 4").
 */
export function orderBlocks(rows: readonly SupersetFields[]): number[][] {
  const real = supersetGroups(rows);
  const blocks: number[][] = [];
  rows.forEach((r, i) => {
    const last = blocks[blocks.length - 1];
    const g = r.supersetGroup && real.has(r.supersetGroup) ? r.supersetGroup : undefined;
    if (g && last && rows[last[0]].supersetGroup === g) last.push(i);
    else blocks.push([i]);
  });
  return blocks;
}

/**
 * A ONE-STEP move (▲ / ▼, VoiceOver's move up / down) that treats a superset
 * as one unit: a straight row next to a block hops over the whole block, and
 * moving any member moves the whole block. Leaving a superset is never a
 * side effect of a one-step move — that is "Unpair", said out loud. (A
 * one-step move used to swap a row INTO a block, which normalizing then
 * undid — the move did nothing — or left a member with no adjacent partner,
 * which dissolved the pair without a word.)
 *
 * Returns the new list and where the moved row now sits; the list comes back
 * unchanged at either end. Letters and rests are untouched.
 */
export function moveBlockAware<T extends SupersetFields>(
  rows: readonly T[],
  from: number,
  dir: -1 | 1,
): { rows: T[]; newIndex: number } {
  const blocks = orderBlocks(rows);
  const at = blocks.findIndex((b) => b.includes(from));
  const to = at + dir;
  if (at < 0 || to < 0 || to >= blocks.length) return { rows: [...rows], newIndex: from };
  const order = [...blocks];
  [order[at], order[to]] = [order[to], order[at]];
  const flat = order.flat();
  return { rows: flat.map((i) => rows[i]), newIndex: flat.indexOf(from) };
}

/**
 * The live session's move, one rule for ▲ / ▼ and for a drag
 * (`useTrain.moveExerciseInActive` is a thin wrapper around it).
 *
 * - No superset in the list: a plain move.
 * - One step: block-aware ({@link moveBlockAware}) — a superset moves as one
 *   unit and is never dissolved.
 * - A drag: {@link reorderWithSupersets} with the letters and the snapshot's
 *   rests kept as the lifter has read them; a member dragged away from its
 *   partner leaves the pair and is reported in `left`.
 *
 * `newIndex` is where the MOVED row now sits (the open card follows it).
 * `changed` is false when nothing moved — at an end, or a drop on itself —
 * so the caller can skip the write.
 */
export function moveInSession<T extends SupersetFields & { exerciseId: string }>(
  rows: readonly T[],
  from: number,
  to: number,
): { rows: T[]; newIndex: number; changed: boolean; left?: { row: T; group: string } } {
  const same = { rows: [...rows], newIndex: from, changed: false };
  if (from === to || !rows[from] || to < 0 || to >= rows.length) return same;
  let next: T[];
  let newIndex = to;
  let left: { row: T; group: string } | undefined;
  if (!rows.some((r) => r.supersetGroup)) {
    next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
  } else if (Math.abs(to - from) === 1) {
    const r = moveBlockAware(rows, from, to > from ? 1 : -1);
    next = r.rows;
    newIndex = r.newIndex;
  } else {
    const moved = rows[from];
    const r = reorderWithSupersets(rows, from, to, { keepLetters: true, restsOnEveryMember: true });
    next = r.rows;
    // Unpairing rebuilds the row, so find it by what it IS, not by identity.
    const at = next.indexOf(moved);
    newIndex = at >= 0 ? at : Math.max(0, next.findIndex((e) => e.exerciseId === moved.exerciseId && !e.supersetGroup));
    left = r.left;
  }
  if (next.every((e, i) => e === rows[i])) return same;
  return { rows: next, newIndex, changed: true, ...(left ? { left } : {}) };
}

/**
 * Undo a move WITHOUT undoing anything logged since: the CURRENT rows, put
 * back in `before`'s order (matched by exercise and occurrence), with
 * `before`'s superset fields. Sets logged between the move and the Undo tap
 * stay logged — restoring the whole old copy used to erase them. Returns
 * `now` unchanged when the lifts differ ({@link canUndoMove}).
 */
export function undoMoveRows<T extends SupersetFields & { exerciseId: string }>(
  before: readonly T[],
  now: readonly T[],
): T[] {
  if (!canUndoMove(before, now)) return [...now];
  // Each row is found by its own sets array first (Undo keeps it when nothing
  // was logged), so two copies of one lift never swap; then by occurrence.
  const left = [...now];
  const take = (b: T): T => {
    const bySets = 'sets' in b ? left.findIndex((r) => 'sets' in r && (r as { sets: unknown }).sets === (b as { sets: unknown }).sets) : -1;
    const at = bySets >= 0 ? bySets : left.findIndex((r) => r.exerciseId === b.exerciseId);
    return left.splice(at, 1)[0];
  };
  return before.map((b) => {
    const cur = take(b);
    const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...rest } = cur;
    return {
      ...rest,
      ...(b.supersetGroup != null ? { supersetGroup: b.supersetGroup } : {}),
      ...(b.pairPosition != null ? { pairPosition: b.pairPosition } : {}),
      ...(b.transitionRestSec != null ? { transitionRestSec: b.transitionRestSec } : {}),
      ...(b.roundRestSec != null ? { roundRestSec: b.roundRestSec } : {}),
    } as T;
  });
}

/**
 * Whether an Undo of a move can still apply: the session holds exactly the
 * same exercises as before it (only their order differs). A lift added or
 * removed since makes the old order wrong, so the Undo does nothing.
 */
export function canUndoMove(before: readonly { exerciseId: string }[], now: readonly { exerciseId: string }[]): boolean {
  const key = (xs: readonly { exerciseId: string }[]) => xs.map((e) => e.exerciseId).sort().join('|');
  return key(before) === key(now);
}
