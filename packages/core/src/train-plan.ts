/**
 * What to train next, what you did last time, and what a declared structure
 * scaffolds — the three questions the Train UI asks that had no answer in
 * core, so each frontend was about to answer them in a renderer.
 *
 * A SIBLING of `./train-view`, not an edit to it. `train-view` derives numbers
 * from history the screen already shows (hero, sparkline, summary counts).
 * This module decides *what the screen should offer* — which template comes
 * up, which previous set a row compares itself to, which set list a structure
 * implies. Same rule as everywhere else here: no `TFn`, no formatting that
 * needs a locale, nothing that must know what a chip looks like.
 *
 * ## Why "next up" is least-recently-performed and not an order field
 *
 * An A/B/C split is a rotation, and a rotation needs a starting point. Three
 * shapes were considered:
 *
 * - **An explicit `order` on the template.** Correct, and it makes the user
 *   maintain a number they never think about. It also cannot answer the
 *   question for someone who trains two of their four templates.
 * - **Next after the last one performed, cyclically.** Reads well until the
 *   list reorders — `subscribeTemplates` returns most-recently-updated first,
 *   so editing a template silently changes what comes next.
 * - **Least recently performed.** What this module does. It needs no stored
 *   order, it is stable under any list ordering, a never-performed template
 *   sorts first (which is what you want the day after you write one), and for
 *   a plain A/B/C rotation it produces exactly the rotation.
 *
 * Ties break on the template list's own order, so the result is deterministic
 * for a brand-new account where nothing has been performed at all.
 */
import type {
  LogStyle,
  SetKind,
  SetStructure,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from './workout';
import { toDisplayLoad } from './load-units';
import type { UnitSystem } from './unit-system';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── What did I last do, and when ───────────────────────────────

/**
 * Most recent completed date per `templateId`.
 *
 * Only `completed` sessions count: an abandoned or in-progress session is not
 * evidence that the day was trained, and counting it would push a template to
 * the back of the rotation for a workout that never happened.
 */
export function templateLastPerformed(
  sessions: readonly WorkoutSession[],
): Record<string, Date> {
  const out: Record<string, Date> = {};
  for (const s of sessions) {
    if (s.status !== 'completed' || !s.templateId) continue;
    const seen = out[s.templateId];
    if (!seen || s.date.getTime() > seen.getTime()) out[s.templateId] = s.date;
  }
  return out;
}

export interface NextUp {
  template: WorkoutTemplate;
  /** When it was last completed, or `null` if never. */
  lastPerformed: Date | null;
  /** Whole days since `lastPerformed`, or `null` if never performed. */
  daysAgo: number | null;
}

/**
 * The template to offer as "next up": the one gone longest without being
 * performed, never-performed first.
 *
 * `now` is passed rather than read for the same reason `trainHeroStats` takes
 * it — a screen that already knows the render time must not disagree with
 * itself mid-frame, and the day arithmetic has to be testable.
 *
 * Returns `null` when there are no templates, which is the cold-start case the
 * caller renders as "create one" rather than as an empty card.
 */
export function nextTemplateUp(
  templates: readonly WorkoutTemplate[],
  sessions: readonly WorkoutSession[],
  now: number,
): NextUp | null {
  if (templates.length === 0) return null;
  const last = templateLastPerformed(sessions);
  let best: NextUp | null = null;
  for (const template of templates) {
    const at = template.id ? last[template.id] ?? null : null;
    const candidate: NextUp = {
      template,
      lastPerformed: at,
      daysAgo: at ? Math.floor((now - at.getTime()) / DAY_MS) : null,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    // Never-performed wins outright; otherwise the older date wins. A tie
    // keeps the incumbent, so the template list's own order breaks it.
    if (best.lastPerformed == null) continue;
    if (candidate.lastPerformed == null) {
      best = candidate;
      continue;
    }
    if (candidate.lastPerformed.getTime() < best.lastPerformed.getTime()) best = candidate;
  }
  return best;
}

// ─── The PREVIOUS column ────────────────────────────────────────

/**
 * The sets this exercise was last logged with.
 *
 * `history` is what `exerciseHistory` returns — newest first, because
 * `recentSessions` is. The first entry that actually has sets is the answer;
 * an exercise that was opened and abandoned with nothing in it is not a
 * previous performance, and skipping it is the difference between "compare
 * yourself to last Tuesday" and "compare yourself to a blank row".
 */
export function previousSets(
  history: readonly { sets: readonly WorkoutSet[] }[],
): readonly WorkoutSet[] {
  for (const ex of history) {
    if (ex.sets.some((s) => s.reps != null || s.durationSec != null)) return ex.sets;
  }
  return [];
}

/**
 * One PREVIOUS cell — "135 × 8", "8", "45s" — or `null` when that row has no
 * comparable record.
 *
 * Deliberately positional: row 3 compares against row 3. The alternative
 * (compare against the nth *working* set) drifts the moment a warm-up is added
 * or dropped, and a comparison that silently re-points at a different set is
 * worse than no comparison. A row past the end of last session's list gets
 * `null`, which renders as the em dash the header column already implies.
 */
export function previousCell(
  set: WorkoutSet | undefined,
  style: LogStyle,
  unitSystem?: UnitSystem,
): string | null {
  if (!set) return null;
  if (style === 'time') return set.durationSec != null ? `${set.durationSec}s` : null;
  if (style === 'bodyweight') return set.reps != null ? `${set.reps}` : null;
  if (set.weight != null && set.reps != null) {
    return `${toDisplayLoad(set.weight, unitSystem)}×${set.reps}`;
  }
  // A rep count with no load is still a real comparison — a machine logged
  // without its weight, or a set typed reps-first. Saying "8" beats saying
  // nothing, and it can never be mistaken for a load.
  return set.reps != null ? `${set.reps}` : null;
}

// ─── What a declared structure scaffolds (ADR-0040) ─────────────

/**
 * The set list a structure implies, as kinds.
 *
 * This is the same scaffolding the template editor's three add-buttons did by
 * hand — `addSet` appends `working`, `addCluster` appends
 * `activation, mini, mini`, `addBlock` appends `activation, continuation`.
 * Naming it here is what lets the editor ask for the structure FIRST and
 * derive the rows, instead of asking the user to build rows that imply a
 * structure and then declare it underneath them.
 *
 * `undefined` (the "Auto" choice) has no scaffold on purpose: it means the
 * template states nothing, so there is nothing for it to state in sets either.
 * `drop` and `superset` are declared-but-unread (ADR-0040) and scaffold plain
 * working sets — the app must not pretend to express a structure its engine
 * refuses to read.
 */
export function scaffoldKindsFor(structure: SetStructure | undefined): SetKind[] {
  switch (structure) {
    case 'straight':
      return ['working', 'working', 'working'];
    case 'myoreps':
      return ['activation', 'mini', 'mini'];
    case 'rest-pause':
      return ['activation', 'continuation'];
    case 'cluster':
      return ['activation', 'continuation', 'continuation'];
    case 'hit':
      return ['working'];
    case 'drop':
      return ['working', 'drop'];
    case 'superset':
      return ['working', 'working', 'working'];
    default:
      return [];
  }
}

/** Which add-buttons a structure's card should offer. A myo-reps lift has no
 *  use for "add block" and a straight-set lift has no use for either — the
 *  three-button row every card carried was the union of every structure's
 *  needs, shown to everyone. */
export function addActionsFor(
  structure: SetStructure | undefined,
): { set: boolean; cluster: boolean; block: boolean } {
  switch (structure) {
    case 'straight':
    case 'hit':
    case 'drop':
    case 'superset':
      return { set: true, cluster: false, block: false };
    case 'myoreps':
      return { set: true, cluster: true, block: false };
    case 'rest-pause':
    case 'cluster':
      return { set: true, cluster: false, block: true };
    default:
      // Undeclared: offer everything, exactly as the editor did before
      // ADR-0040 had a field to read. Legacy templates keep every affordance
      // they were written with.
      return { set: true, cluster: true, block: true };
  }
}

/**
 * True when a set list is still an untouched scaffold — no prescribed reps,
 * load or duration anywhere in it.
 *
 * The gate on re-scaffolding. Changing the declared structure of an exercise
 * whose numbers are blank should rewrite its rows, because those rows are
 * placeholders the previous choice put there. Changing it on an exercise the
 * user has typed into must NOT: this repo does not silently overrule a person
 * who typed a number, and a template is the one artifact whose numbers took
 * real effort to enter.
 */
export function isPristineScaffold(
  sets: readonly { reps?: number; weight?: number; durationSec?: number }[],
): boolean {
  return sets.every(
    (s) => s.reps == null && s.weight == null && s.durationSec == null,
  );
}
