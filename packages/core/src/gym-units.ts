/**
 * kg next to lb, the unit a set was typed in, and the load hint at another gym
 * (owner, 2026-11-05).
 *
 * ## kg is DERIVED, never stored
 *
 * The store is pounds (`load-units.ts`), and stays that way: every volume,
 * e1RM and engine read is one scale. The kg figure next to every load — on the
 * session card, in history, in the export (`setWeightKg`, `loadKg`) — is
 * {@link kgOf}, the owner's rule `round(lb ÷ 2.2046, 1)`. A stored copy would
 * drift the first time a set is edited.
 *
 * ## What IS stored: the unit a set was typed in
 *
 * `WorkoutSet.unit` says whether the lifter entered the number in kg or lb,
 * and the set is shown in that unit ("12 kg (26.5 lb)"). A kg entry is stored
 * as full-precision pounds (`kgToLb`, no rounding), so 12 kg → lb → kg is 12
 * again at the 0.1 the display shows. A set with no `unit` (everything before
 * 2026-11-05) reads in its row's unit, else the account's.
 *
 * ## The unit a lift is shown in
 *
 * Per exercise per gym, the last unit used wins (`Exercise.unitByGym`, keyed
 * by the gym name or {@link HOME_GYM_KEY}); else the template row's own unit
 * (a kg gym's rack); else kg while a trip is on; else the account's unit.
 *
 * Pure; no I/O, no clock.
 */
import { kgToLb } from './health-mapping';
import { inferEquipment } from './progression-engine';
import type { UnitSystem } from './unit-system';
import type { LoadUnit, SessionExercise, WorkoutSession, WorkoutSet } from './workout';

/** The owner's divisor for the derived kg figure. */
export const LB_PER_KG_DERIVED = 2.2046;

/** Stored pounds → kg, the owner's rule: `round(lb ÷ 2.2046, 1)`. */
export function kgOf(lb: number): number {
  return Math.round((lb / LB_PER_KG_DERIVED) * 10) / 10;
}

/** Stored pounds → the number shown in `unit`, one decimal at most. */
export function loadIn(lb: number, unit: LoadUnit): number {
  return unit === 'kg' ? kgOf(lb) : Math.round(lb * 10) / 10;
}

/** A number for a load label: "12", "11.3" — never "12.0". */
export function loadNumber(value: number, locale?: string): string {
  const v = Math.round(value * 10) / 10;
  return v.toLocaleString(locale, { maximumFractionDigits: 1 });
}

/** "12 kg (26.5 lb)" / "25 lb (11.3 kg)": `unit` first, the other in brackets. */
export function dualLoadText(lb: number, unit: LoadUnit, locale?: string): string {
  const other: LoadUnit = unit === 'kg' ? 'lb' : 'kg';
  return `${loadNumber(loadIn(lb, unit), locale)} ${unit} (${loadNumber(loadIn(lb, other), locale)} ${other})`;
}

/** The unit the account trains in when nothing more specific says. */
export function accountUnit(unitSystem: UnitSystem | undefined): LoadUnit {
  return unitSystem === 'metric' ? 'kg' : 'lb';
}

/** The unit ONE SET reads in: the unit it was typed in, else its row's, else
 *  the account's. */
export function setUnit(
  set: Pick<WorkoutSet, 'unit'>,
  rowUnit: LoadUnit | undefined,
  unitSystem: UnitSystem | undefined,
): LoadUnit {
  return set.unit ?? rowUnit ?? accountUnit(unitSystem);
}

// ─── Unit memory, per exercise per gym ────────────────────────────

/** The `unitByGym` key for a row at no away gym. */
export const HOME_GYM_KEY = 'home';
/** Gyms one exercise remembers (rules cap the map). */
export const UNIT_BY_GYM_MAX = 20;

export type UnitByGym = Partial<Record<string, LoadUnit>>;

export function gymKeyOf(awayGym: string | undefined): string {
  const g = awayGym?.trim();
  return g ? g.slice(0, 60) : HOME_GYM_KEY;
}

/** `Exercise.unitByGym`, cleaned: only `kg` / `lb` values survive. */
export function unitByGymOf(raw: unknown): UnitByGym {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: UnitByGym = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === 'kg' || v === 'lb') out[k] = v;
  }
  return out;
}

/** The map with `gym` set to `unit`, or the same object when nothing changes.
 *  Over the cap, the oldest-inserted other gym goes first. */
export function rememberUnit(map: UnitByGym, gym: string, unit: LoadUnit): UnitByGym {
  if (map[gym] === unit) return map;
  const next: UnitByGym = { ...map, [gym]: unit };
  const keys = Object.keys(next);
  for (let i = 0; keys.length - i > UNIT_BY_GYM_MAX; i++) if (keys[i] !== gym) delete next[keys[i]];
  return next;
}

/**
 * The unit a lift starts in: what the lifter last used for it at this gym,
 * else the template row's unit, else kg on a trip, else the account's.
 */
export function startUnit(input: {
  remembered?: LoadUnit;
  rowUnit?: LoadUnit;
  travel: boolean;
  unitSystem: UnitSystem | undefined;
}): LoadUnit {
  return input.remembered ?? input.rowUnit ?? (input.travel ? 'kg' : accountUnit(input.unitSystem));
}

/**
 * The row switched to `unit`: the row reads in it, and every set not yet
 * ticked follows (it was never "typed" in the old unit — a pre-fill is not an
 * entry). Ticked sets keep the unit they were typed in.
 */
export function switchRowUnit<E extends Pick<SessionExercise, 'loadUnit' | 'sets'>>(ex: E, unit: LoadUnit): E {
  return {
    ...ex,
    loadUnit: unit,
    sets: ex.sets.map((s) => (s.done ? s : s.unit === undefined || s.unit === unit ? s : { ...s, unit })),
  };
}

// ─── The load hint at another gym ─────────────────────────────────

/** Home loads are cut this much for another gym's equipment. */
export const AWAY_HINT_CUT = 0.1;

export interface GymLoadHint {
  /** The hinted load, stored pounds (exactly the kg value converted). */
  lb: number;
  /** The hinted load in kg — a real step at the gym. */
  kg: number;
  /** `gym`: the last load at this gym. `home`: last home load −10 %. */
  source: 'gym' | 'home';
  /** The load it came from, pounds. */
  fromLb: number;
  /** When that load was lifted. */
  at: Date;
}

/** The kg step a lift's equipment moves in at another gym: a stack 1, the rest 2. */
export function awayStepKg(name: string): 1 | 2 {
  return inferEquipment(name) === 'stack' ? 1 : 2;
}

type HintSession = Pick<WorkoutSession, 'id' | 'status' | 'date' | 'exercises' | 'notComparable' | 'deload'>;

/** The heaviest load of a row's logged working sets (activation / working /
 *  mini), pounds, or null. */
function topLoggedLoad(ex: Pick<SessionExercise, 'sets' | 'logStyle'>): number | null {
  let top: number | null = null;
  for (const s of ex.sets) {
    if (s.reps == null || s.weight == null || s.weight <= 0) continue;
    if (s.kind !== 'working' && s.kind !== 'activation' && s.kind !== 'mini') continue;
    if (top == null || s.weight > top) top = s.weight;
  }
  return top;
}

/**
 * The hint for a lift at an away gym (owner, 2026-11-05), in priority order:
 *  (a) the last load lifted for it at the SAME gym;
 *  (b) else the last HOME load −10 %, rounded DOWN to the gym's step — 2 kg
 *      for dumbbells and plates, 1 kg for a machine stack.
 * Null at home, and when there is nothing to go on. Only completed sessions
 * count; a deload never does (its loads are not the lifter's).
 */
export function gymLoadHint(
  sessions: readonly HintSession[],
  row: { exerciseId: string; name: string; awayGym?: string },
  excludeSessionId?: string,
): GymLoadHint | null {
  if (!row.awayGym) return null;
  const done = sessions
    .filter((s) => s.status === 'completed' && !s.deload && s.id !== excludeSessionId)
    .slice()
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const s of done) {
    for (const e of s.exercises) {
      if (e.exerciseId !== row.exerciseId || e.awayGym !== row.awayGym) continue;
      const top = topLoggedLoad(e);
      if (top != null) return { lb: top, kg: kgOf(top), source: 'gym', fromLb: top, at: s.date };
    }
  }
  for (const s of done) {
    if (s.notComparable) continue;
    for (const e of s.exercises) {
      if (e.exerciseId !== row.exerciseId || e.awayGym) continue;
      const top = topLoggedLoad(e);
      if (top == null) continue;
      const step = awayStepKg(row.name);
      const kg = Math.floor((kgOf(top) * (1 - AWAY_HINT_CUT)) / step + 1e-9) * step;
      if (kg <= 0) return null;
      return { lb: kgToLb(kg), kg, source: 'home', fromLb: top, at: s.date };
    }
  }
  return null;
}

// ─── "Use the range" ──────────────────────────────────────────────

/** The rep count the lifter keeps stopping at. */
export const RANGE_NUDGE_REPS = 10;
/** Sets running that must show it. */
export const RANGE_NUDGE_SETS = 3;
/** The RIR at or above which stopping there leaves reps on the table. */
export const RANGE_NUDGE_MIN_RIR = 2;

/**
 * "Use the range — go past 10": the last {@link RANGE_NUDGE_SETS} logged
 * working sets of a lift, oldest to newest across its last session and this
 * one, are each exactly {@link RANGE_NUDGE_REPS} reps at RIR ≥ 2 (owner,
 * 2026-11-05, Stephanie's 10 × every set). A set with no RIR breaks the run:
 * there is nothing to say it was easy.
 */
export function rangeNudge(
  current: Pick<SessionExercise, 'sets'>,
  previous?: Pick<SessionExercise, 'sets'> | null,
): boolean {
  const working = (sets: readonly WorkoutSet[], tickedOnly: boolean) =>
    sets.filter((s) => (s.kind ?? 'working') === 'working' && s.reps != null && (!tickedOnly || s.done));
  const run = [...working(previous?.sets ?? [], false), ...working(current.sets, true)].slice(-RANGE_NUDGE_SETS);
  return run.length === RANGE_NUDGE_SETS
    && run.every((s) => s.reps === RANGE_NUDGE_REPS && s.rir != null && s.rir >= RANGE_NUDGE_MIN_RIR);
}

// ─── "Haven dumbbells — kg or lb?" ────────────────────────────────

/**
 * A one-time question on the lifter's next session (profile `unitAsk`,
 * written by an owner-data script): which unit a gym's dumbbells are in. The
 * answer is remembered per exercise ({@link rememberUnit}) and re-labels the
 * session that raised the doubt ({@link relabelRows}).
 */
export interface UnitAsk {
  /** "Haven Gym" — the `unitByGym` key the answer is stored under. */
  gym: string;
  /** What the card asks ("Haven dumbbells — kg or lb?"). */
  question: string;
  /** The lifts the answer applies to. */
  exerciseIds: string[];
  /** The session whose loads were typed in the unknown unit. */
  relabelSessionId?: string;
}

export function unitAskOf(raw: unknown): UnitAsk | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['gym'] !== 'string' || !r['gym'] || typeof r['question'] !== 'string' || !r['question']) return null;
  const ids = Array.isArray(r['exerciseIds']) ? r['exerciseIds'].filter((x): x is string => typeof x === 'string' && !!x) : [];
  if (!ids.length) return null;
  return {
    gym: r['gym'],
    question: r['question'],
    exerciseIds: ids,
    ...(typeof r['relabelSessionId'] === 'string' && r['relabelSessionId'] ? { relabelSessionId: r['relabelSessionId'] } : {}),
  };
}

/**
 * The rows of a past session whose numbers were typed without a known unit,
 * re-labelled once the lifter says which it was. The NUMBER the lifter typed
 * is what stays: "10" read as 10 lb becomes 10 kg (22.05 lb stored) when the
 * answer is kg. Rows already carrying a set `unit` are left alone, so a
 * second run changes nothing.
 */
export function relabelRows<E extends Pick<SessionExercise, 'exerciseId' | 'loadUnit' | 'sets'>>(
  rows: readonly E[],
  exerciseIds: readonly string[],
  unit: LoadUnit,
): E[] {
  const ids = new Set(exerciseIds);
  return rows.map((e) => {
    if (!ids.has(e.exerciseId) || e.sets.some((s) => s.unit !== undefined)) return e;
    return {
      ...e,
      loadUnit: unit,
      sets: e.sets.map((s) => (s.weight == null ? s : { ...s, unit, ...(unit === 'kg' ? { weight: kgToLb(s.weight) } : {}) })),
    };
  });
}
