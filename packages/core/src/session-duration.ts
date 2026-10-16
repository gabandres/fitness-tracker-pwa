/**
 * How long a template takes, estimated (Program v2, 2026-10-11).
 *
 * The constants are the coaching sheet's: a myo-rep cluster (activation,
 * minis and their 5–10 s rests) takes {@link DURATION.clusterSec}; every rest
 * between clusters is the one the live timer would run
 * (`restAfterSetInFlow` — superset transitions and rounds included); a 3-min
 * warm-up comes once, before the first compound lift only; Zone 2 is its
 * prescribed duration (20 min). An L or an R cluster is a cluster of its own
 * here — each leg takes the time — even though for VOLUME the pair is one.
 *
 * An estimate to compare versions with, not a promise. Pure.
 */
import type { MuscleGroup, WorkoutTemplate } from './workout';
import type { RestSeconds } from './rest-after-set';
import { CLUSTER_ESTIMATE_SEC, DEFAULT_REST_SECONDS, plannedRestSec, supersetFlow } from './superset';
import { creditsFor } from './volume-credits';

export const DURATION = {
  /** One number for a cluster's length — the superset guardrail's gap
   *  estimate (`pairSpacing`) uses the same. */
  clusterSec: CLUSTER_ESTIMATE_SEC,
  transitionSec: 30,
  warmupSec: 180,
  zone2Sec: 20 * 60,
  /** The app's defaults when a template states no rest. */
  miniSec: DEFAULT_REST_SECONDS.mini,
  clusterRestSec: DEFAULT_REST_SECONDS.cluster,
} as const;

export interface DurationEstimate {
  minutes: number;
  /** The parts, seconds — so a report can say where the time goes. */
  clustersSec: number;
  restSec: number;
  warmupSec: number;
  cardioSec: number;
}

/** A compound lift: one whose cluster credits more than one muscle. */
function isCompound(name: string, muscles?: readonly MuscleGroup[]): boolean {
  return creditsFor(name, muscles).length > 1;
}

type RestRow = Pick<WorkoutTemplate['exercises'][number], 'restMiniSec' | 'restClusterSec' | 'restAfterSec'>;

/** A template row's rests as the estimator counts them — row override, else
 *  the template's, else the app default. Also what the template editor's
 *  superset guardrail estimates a gap with, so the two agree. */
export function templateRestFor(
  template: { restMiniSec?: number; restClusterSec?: number; exercises: readonly RestRow[] },
): (exerciseIndex: number) => RestSeconds {
  return (i) => {
    const r = template.exercises[i] ?? {};
    return {
      mini: r.restMiniSec ?? template.restMiniSec ?? DURATION.miniSec,
      cluster: r.restClusterSec ?? template.restClusterSec ?? DURATION.clusterRestSec,
      afterExercise: r.restAfterSec ?? template.restClusterSec ?? DURATION.clusterRestSec,
    };
  };
}

export function estimateTemplateDuration(
  template: Pick<WorkoutTemplate, 'exercises' | 'restMiniSec' | 'restClusterSec' | 'cardioBlocks'>,
  musclesOf: (exerciseId: string) => readonly MuscleGroup[] | undefined = () => undefined,
): DurationEstimate {
  const rows = template.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(template);
  const units = supersetFlow(rows).length;
  const clustersSec = units * DURATION.clusterSec;
  const restSec = plannedRestSec(rows, restFor);
  const warmupSec = template.exercises.some((e) => isCompound(e.name, musclesOf(e.exerciseId))) ? DURATION.warmupSec : 0;
  const cardioSec = (template.cardioBlocks ?? []).reduce((t, b) => t + (b.targetDurationSec ?? DURATION.zone2Sec), 0);
  const total = clustersSec + restSec + warmupSec + cardioSec;
  return { minutes: Math.round(total / 60), clustersSec, restSec, warmupSec, cardioSec };
}
