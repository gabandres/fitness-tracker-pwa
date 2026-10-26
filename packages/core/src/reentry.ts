/**
 * Re-entry sessions (travel mode, 2026-10-26).
 *
 * Two moments after time away from the gym where the last loads are not the
 * right ask:
 *
 * - **`travel`** — a gym session DURING a trip after ≥ {@link
 *   REENTRY_LAYOFF_DAYS} days without one ("if a gym is available").
 * - **`post-travel`** — the first session of each template after a trip, for
 *   {@link POST_TRAVEL_WINDOW_DAYS} days after it.
 *
 * A re-entry session seeds the usual loads −10 % (rounded DOWN to a load the
 * equipment has; an assisted lift gets 10 % MORE assistance), asks for RIR 2,
 * and is flagged on the session (`WorkoutSession.reentry`). Like a deload, the
 * engine never reads it (`engineSessions`), so:
 *
 * - the second session back reads the pre-trip history again — normal targets
 *   return by the second session;
 * - a re-entry session's lower reps or loads are never a regression, a stall
 *   or a deload trigger — all of those read the engine's history.
 *
 * "Gym" excludes the travel templates themselves: a calisthenics session in a
 * hotel room is not the gym, and it must not reset the ≥ 7-day count.
 *
 * Pure; no clock — `today` is passed in.
 */
import { addDays, calendarDateKey, parseYmd } from './date';
import { dayKeyAt, type DayBoundary } from './day-boundary';
import { activeTravel, lastEndedTravel, type TravelPeriod } from './travel';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';

export type ReentryKind = 'travel' | 'post-travel';

/** Loads are scaled by this. */
export const REENTRY_LOAD_FACTOR = 0.9;
/** The effort a re-entry session asks for. */
export const REENTRY_RIR = 2;
/** Days without a gym session, during a trip, that make the next one re-entry. */
export const REENTRY_LAYOFF_DAYS = 7;
/** After a trip, a template's first session is re-entry if it falls within this. */
export const POST_TRAVEL_WINDOW_DAYS = 42;

type SessionLike = Pick<WorkoutSession, 'date' | 'templateId' | 'status' | 'exercises'>;

/** The travel templates are tagged by version ("travel-v1"): they are never
 *  re-entry, never "the gym", and never another gym's equipment. */
export const TRAVEL_TEMPLATE_VERSION = 'travel-v1';
export function isTravelTemplate(t: { templateVersion?: string }): boolean {
  return typeof t.templateVersion === 'string' && t.templateVersion.startsWith('travel');
}

const isGymSession = (s: SessionLike, travelTemplateIds: ReadonlySet<string>) =>
  s.status === 'completed' && s.exercises.length > 0 && !(s.templateId && travelTemplateIds.has(s.templateId));

const daysBetween = (from: string, to: string) =>
  Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);

/**
 * Whether starting `templateId` today is a re-entry session, and which kind.
 * Null for a travel template, for any session outside the two moments above,
 * and when the user has no gym history at all (nothing to re-enter from).
 */
export function reentryFor(args: {
  templateId?: string;
  today: string;
  sessions: readonly SessionLike[];
  periods: readonly TravelPeriod[];
  /** The calisthenics templates made for travel (`templateVersion` starting
   *  "travel"). Never re-entry themselves, and not "the gym". */
  travelTemplateIds?: ReadonlySet<string>;
  /** When the template was created. The app holds a bounded window of recent
   *  sessions (walks included), so a long trip can push the template's last
   *  pre-trip session out of it; a template that existed before the trip
   *  counts as having history then. */
  templateCreatedAt?: Date;
  boundary: DayBoundary;
}): ReentryKind | null {
  const { templateId, today, sessions, periods, boundary } = args;
  const travelIds = args.travelTemplateIds ?? new Set<string>();
  if (!templateId || travelIds.has(templateId) || periods.length === 0) return null;
  const gym = sessions.filter((s) => isGymSession(s, travelIds));
  if (gym.length === 0) return null;
  const keyOf = (s: SessionLike) => dayKeyAt(s.date, boundary);

  const trip = activeTravel(today, periods);
  if (trip) {
    const last = gym.reduce<string | null>((m, s) => {
      const k = keyOf(s);
      return k < today && (m == null || k > m) ? k : m;
    }, null);
    return last != null && daysBetween(last, today) >= REENTRY_LAYOFF_DAYS ? 'travel' : null;
  }

  const ended = lastEndedTravel(today, periods);
  if (!ended || daysBetween(ended.end, today) > POST_TRAVEL_WINDOW_DAYS) return null;
  const doneSince = gym.some((s) => s.templateId === templateId && keyOf(s) > ended.end && keyOf(s) < today);
  // A template with no history before the trip either has nothing to re-enter.
  const hadBefore =
    gym.some((s) => s.templateId === templateId && keyOf(s) < ended.start)
    || (args.templateCreatedAt != null && dayKeyAt(args.templateCreatedAt, boundary) < ended.start);
  return !doneSince && hadBefore ? 'post-travel' : null;
}

/** How one lift's loads move: what the equipment offers, as the engine sees
 *  it (`EngineConfig`). */
export interface ReentryStep {
  loadSteps?: readonly number[];
  stepLb: number;
  loadGrid?: number;
  assisted?: boolean;
}

/**
 * A load −10 %, on a load the equipment has: the heaviest entered step at or
 * under the target, else the grid/step below it. Never 0 from a positive load
 * (a 5-lb lift stays 5), never above the original. Assisted: +10 % assistance,
 * rounded UP to a step — more help is the easier direction.
 */
export function reentryLoad(load: number, step: ReentryStep): number {
  if (!(load > 0)) return load;
  const steps = [...new Set((step.loadSteps ?? []).filter((x) => Number.isFinite(x) && x >= 0))].sort((a, b) => a - b);
  if (step.assisted) {
    const target = load / REENTRY_LOAD_FACTOR;
    if (steps.length) return steps.find((x) => x >= target) ?? steps[steps.length - 1];
    const g = step.loadGrid ?? step.stepLb;
    return +(Math.ceil(target / g - 1e-9) * g).toFixed(2);
  }
  const target = load * REENTRY_LOAD_FACTOR;
  if (steps.length) {
    const under = steps.filter((x) => x <= target && x > 0);
    return under.length ? under[under.length - 1] : Math.min(load, steps.find((x) => x > 0) ?? load);
  }
  const g = step.loadGrid ?? step.stepLb;
  if (!(g > 0)) return +target.toFixed(2);
  const down = +(Math.floor(target / g + 1e-9) * g).toFixed(2);
  return down > 0 ? down : Math.min(load, g);
}

/**
 * A re-entry session's lifts: every set's load through {@link reentryLoad},
 * and the frozen engine calls dropped — the session is not the engine's call
 * and the engine never reads it, so a snapshot would only misreport it.
 */
export function reentrySessionExercises(
  exercises: readonly SessionExercise[],
  stepFor: (exerciseId: string) => ReentryStep,
): SessionExercise[] {
  return exercises.map((ex) => {
    const step = stepFor(ex.exerciseId);
    const sets: WorkoutSet[] = ex.sets.map((s) => (s.weight != null && s.weight > 0 ? { ...s, weight: reentryLoad(s.weight, step) } : s));
    const { recommendation: _r, sideRecommendations: _s, ...rest } = ex;
    return { ...rest, sets };
  });
}

/** The last day a template's first post-travel session is still re-entry. */
export function postTravelWindowEnd(period: TravelPeriod): string {
  return calendarDateKey(addDays(parseYmd(period.end), POST_TRAVEL_WINDOW_DAYS));
}
