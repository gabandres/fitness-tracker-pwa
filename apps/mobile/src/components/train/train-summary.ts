import type {
  ActivationIssue,
  Recommendation,
  ProgressionSuggestion,
  StallContext,
  UnitSystem,
} from '@macrolog/core';
import {
  engineHistory,
  formatLoad,
  honourLifterLoad,
  isWorkingSet,
  lastPerformed,
  muscleSignals,
  recommend,
  recommendOptionsFor,
  sessionCardioSec,
  sessionCounts,
  templateCounts,
  volumeCalls,
  weeklyClusterAudit,
  workingSetCells,
} from '@macrolog/core';
import type { CardioModality } from '@macrolog/core/cardio';
import type { I18nKey, Locale, TFn } from '@/i18n';
import { plural } from '@/i18n/grammar';
import type {
  Exercise,
  LogStyle,
  MuscleGroup,
  SessionExercise,
  TrainingPhase,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '@/lib/workout';

/**
 * The Train tab's plain functions — wording and lookups the split components
 * share. They lived as file-scope helpers in `app/(app)/train.tsx`, and moved
 * here when that route was split (Train review item 32) so the screen, the
 * live session and the sheets read one copy.
 *
 * Nothing here holds state or renders. Anything that is a number about
 * training belongs in `@macrolog/core`; this is where it gets words.
 */

/**
 * Rest between sets when a session has no template to ask (an empty workout,
 * a run). The template's own `restMiniSec` / `restClusterSec` win whenever
 * there is one. A setting would be the better home for these, and Train has
 * no settings surface of its own yet (Train review item 7) — so they are
 * named constants rather than literals inside the rest logic, which is where
 * a setting would plug in.
 */
export const DEFAULT_REST_MINI_SEC = 60;
export const DEFAULT_REST_CLUSTER_SEC = 120;

/** The per-exercise rest choices the live ⋯ menu offers, seconds. */
export const REST_CHOICES_SEC = [30, 60, 90, 120, 180, 240] as const;

/** One i18n key per reason a progression read was rejected. A `Record` rather
 *  than a switch so adding an `ActivationIssue` without a string is a compile
 *  error — the union is small and its members are user-facing. */
const ACTIVATION_ISSUE_KEYS: Record<ActivationIssue, I18nKey> = {
  'rir-too-easy': 'train.invalidRirEasy',
  'rir-missing': 'train.invalidRirMissing',
  'not-clustered': 'train.invalidNotClustered',
};
export const activationIssueKey = (issue: ActivationIssue): I18nKey => ACTIVATION_ISSUE_KEYS[issue];

/** Modality → i18n key. The picker and the card keep their own copies for
 *  the reason the set-kind labels are duplicated between screen and sheet. */
export const CARDIO_MODALITY_KEY: Record<CardioModality, I18nKey> = {
  run: 'cardio.modality.run',
  walk: 'cardio.modality.walk',
  ride: 'cardio.modality.ride',
  swim: 'cardio.modality.swim',
  row: 'cardio.modality.row',
  elliptical: 'cardio.modality.elliptical',
  stair: 'cardio.modality.stair',
  hike: 'cardio.modality.hike',
  sport: 'cardio.modality.sport',
  other: 'cardio.modality.other',
};

/** `m:ss`, for the session clock and the rest picker. Hours roll into the
 *  minutes on purpose — "74:10" reads as a long session, "1:14:10" as a time
 *  of day. */
export function clock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A duration as a screen reader should say it: "12 minutes 34 seconds", not
 * the "12:34" {@link clock} draws, which VoiceOver reads as a time of day
 * (Train re-score 3). Past an hour the seconds are dropped — nobody needs
 * them read out on a 70-minute session.
 */
export function spokenDuration(totalSec: number, t: TFn, locale: Locale): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(plural(t, locale, 'train.durHours', h));
  if (m > 0) parts.push(plural(t, locale, 'train.durMinutes', m));
  if (h === 0 && (sec > 0 || m === 0)) parts.push(plural(t, locale, 'train.durSeconds', sec));
  return parts.join(' ');
}

/**
 * The sets a load chosen for the whole lift lands on — an accepted
 * recommendation, the card's "Template: X" line and the "↑ Try X" bump chip
 * alike: every working set that has not been ticked and still holds what the
 * session was SEEDED with — no weight, or one of `seededLoads` (the template's
 * `targetLoad`, the engine's call frozen at start). One rule for all three;
 * the bump used to fill only the FIRST working set, so the rest were ticked at
 * last week's load without anyone noticing (Train re-score 3, bug 4).
 *
 * A seeded load counts as untouched because a template start pre-fills every
 * set with it: checking for an EMPTY weight only made Accept a silent no-op on
 * every templated lift (10/6: "Repeat 25" over sets seeded at 30, typed by
 * hand). Both seeds count so the lifter can move between the card's load and
 * the template's and back. A ticked set is a record of what was lifted, and a
 * typed weight other than a seed is the lifter's own call — neither moves.
 */
export function loadTargetIndices(
  sets: readonly WorkoutSet[],
  seededLoads: readonly (number | undefined)[] = [],
): number[] {
  const out: number[] = [];
  const seeded = (w: number) => seededLoads.some((l) => l != null && Math.abs(w - l) < 0.01);
  sets.forEach((s, i) => {
    const w = s.weight ?? 0;
    if (isWorkingSet(s) && !s.done && (w === 0 || seeded(w))) out.push(i);
  });
  return out;
}

/**
 * The load the lift's untouched sets hold right now (0 when they are empty),
 * or `undefined` when every working set is ticked or typed over — nothing a
 * tap could still move. The card offers a load only when it differs from this.
 */
export function untouchedLoad(
  sets: readonly WorkoutSet[],
  seededLoads: readonly (number | undefined)[] = [],
): number | undefined {
  const first = loadTargetIndices(sets, seededLoads)[0];
  return first == null ? undefined : (sets[first].weight ?? 0);
}

/** Working-set summary line for one logged exercise, by logStyle. The cells
 *  come from core; the separator is this app's spacing. */
export function setLine(ex: SessionExercise, style: LogStyle, unitSystem: UnitSystem): string {
  return workingSetCells(ex, style, unitSystem).join('   ');
}

/** "3 exercises · 12 sets" from the counts core derived. Pluralization is
 *  per-locale, which is why the counting and the wording are separate. */
export function countsLine({ exercises, sets }: { exercises: number; sets: number }, t: TFn): string {
  const ex = `${exercises} ${exercises === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
  const st = `${sets} ${sets === 1 ? t('train.setOne') : t('train.setMany')}`;
  return `${ex} · ${st}`;
}

/**
 * "3 exercises · 12 sets · 32 min cardio".
 *
 * The cardio clause is APPENDED rather than folded into the counts, which is
 * the summary-line form of ADR-0025's rule: `sessionCounts` walks
 * `exercises[]` and must keep walking only that, so a session with cardio must
 * not report more sets than it has.
 *
 * A cardio-only session drops the "0 exercises · 0 sets" prefix entirely —
 * a run is not a lifting day with nothing in it.
 */
export function sessionSummary(s: WorkoutSession, t: TFn): string {
  const minutes = Math.round(sessionCardioSec(s) / 60);
  const cardio = minutes > 0
    ? `${minutes} ${t('cardio.durationUnit')} ${t('cardio.title').toLowerCase()}`
    : '';
  const counts = sessionCounts(s);
  if (counts.exercises === 0 && cardio) return cardio;
  const line = countsLine(counts, t);
  return cardio ? `${line} · ${cardio}` : line;
}

export function templateSummary(tpl: WorkoutTemplate, t: TFn): string {
  return countsLine(templateCounts(tpl), t);
}

/** "Bench Press · Row · Squat +2" — the first three exercise names, so a
 *  template row says what is IN it (Train review item 10). */
export function templateExerciseNames(tpl: WorkoutTemplate, t: TFn, shown = 3): string {
  const names = tpl.exercises.slice(0, shown).map((e) => e.name);
  const rest = tpl.exercises.length - names.length;
  return rest > 0 ? `${names.join(' · ')} ${t('train.tplMore', { n: rest })}` : names.join(' · ');
}

/**
 * "Last: 135 lb × 8" — the ghost hint, shown on a COLLAPSED card only.
 *
 * It used to be the exercise's whole memory: one aggregate line at the card
 * head, where Hevy, Strong and Boostcamp all put last session's numbers on
 * EVERY set row. The per-row answer is the PREVIOUS column (`previousCell`);
 * this survives as the one-line summary a collapsed row can fit.
 *
 * In the TRAINING unit. It printed the stored pounds raw — "Last: 220 × 5"
 * on a kg account, beside a column headed KG (Train review bug 5).
 */
export function lastHint(sug: ProgressionSuggestion, style: LogStyle, t: TFn, unitSystem: UnitSystem): string | null {
  const last = lastPerformed(sug, style);
  if (!last) return null;
  const prefix = `${t('train.last')}: `;
  if (last.style === 'time') return `${prefix}${last.durationSec}s`;
  if (last.style === 'bodyweight') return `${prefix}${last.reps} ${t('train.reps')}`;
  return `${prefix}${formatLoad(last.weight, unitSystem)} × ${last.reps}`;
}

/**
 * What the engine needs beyond the log for one lift: whether the weekly
 * volume rules allow one more cluster for its muscle (offered at the rep cap
 * only), and the facts the stall checklist reads. Every field is optional —
 * an absent fact is "no data" to the engine, never "fine".
 */
export interface RecommendationExtras {
  volumeAllowsCluster?: boolean;
  stallContext?: StallContext;
}

/** A cache key for {@link RecommendationExtras}: the extras arrive as a fresh
 *  object each render, so the memo compares their VALUES. */
const extrasKey = (x: RecommendationExtras | undefined): string =>
  x
    ? `${x.volumeAllowsCluster ? 1 : 0}|${x.stallContext?.sleepHours ?? ''}|${x.stallContext?.intakeBelowTarget ?? ''}|${x.stallContext?.restMiniSec ?? ''}`
    : '';

/**
 * The engine's call for one exercise, from the completed history the tab
 * already holds. The prescription (cluster or not, rep target, increment)
 * comes from the template row; the equipment (`availableLoads`, `assisted`)
 * and the rep range from the catalog exercise. An ad-hoc session exercise has
 * no template row, so its own sets say whether it is clustered and its
 * snapshotted `progression` supplies the increment.
 *
 * Takes the two data fields rather than the whole hook result, so a memo
 * keyed on them actually hits. `extras` is compared by value for the same
 * reason.
 */
export function recommendationFor(
  data: { recentSessions: readonly WorkoutSession[]; catalog: readonly Exercise[] },
  exerciseId: string,
  templateRow: WorkoutTemplate['exercises'][number] | null | undefined,
  sessionEx?: SessionExercise,
  extras?: RecommendationExtras,
): Recommendation {
  // The live workout asks this twice per exercise per render — the card (for
  // its note) and the session (for whether ⋯ offers "Lift settings") — with
  // the SAME objects, and it walks the whole recent history each time
  // (UX_AUDIT S20). Session state is immutable, so identical inputs are the
  // identical answer: the second caller gets the first one's result. Keyed by
  // the live exercise object, so a keystroke (a new `ex`) misses by
  // construction and an abandoned one is collected with it.
  if (sessionEx) {
    const key = extrasKey(extras);
    const hit = recCache.get(sessionEx);
    if (
      hit &&
      hit.recentSessions === data.recentSessions &&
      hit.catalog === data.catalog &&
      hit.exerciseId === exerciseId &&
      hit.templateRow === templateRow &&
      hit.extras === key
    ) {
      return hit.rec;
    }
    const rec = computeRecommendation(data, exerciseId, templateRow, sessionEx, extras);
    recCache.set(sessionEx, {
      recentSessions: data.recentSessions, catalog: data.catalog, exerciseId, templateRow, extras: key, rec,
    });
    return rec;
  }
  return computeRecommendation(data, exerciseId, templateRow, sessionEx, extras);
}

const recCache = new WeakMap<
  SessionExercise,
  {
    recentSessions: readonly WorkoutSession[];
    catalog: readonly Exercise[];
    exerciseId: string;
    templateRow: WorkoutTemplate['exercises'][number] | null | undefined;
    extras: string;
    rec: Recommendation;
  }
>();

function computeRecommendation(
  data: { recentSessions: readonly WorkoutSession[]; catalog: readonly Exercise[] },
  exerciseId: string,
  templateRow: WorkoutTemplate['exercises'][number] | null | undefined,
  sessionEx?: SessionExercise,
  extras?: RecommendationExtras,
): Recommendation {
  const completed = data.recentSessions.filter((s) => s.status === 'completed');
  // Engine history honours the row's baseline marker; charts keep the full log.
  const history = engineHistory(completed, exerciseId, templateRow);
  const catalogEx = data.catalog.find((e) => e.id === exerciseId) ?? null;
  const opts = templateRow
    ? recommendOptionsFor(templateRow, catalogEx)
    : {
        // No template row: this is an ad-hoc exercise, so its own sets are the
        // only statement of intent there is — both for `expectsCluster` and,
        // via the fallback list, for the ADR-0040 structure.
        ...recommendOptionsFor(null, catalogEx, sessionEx?.sets),
        expectsCluster: sessionEx?.sets.some((x) => x.kind === 'activation') ?? false,
        ...(sessionEx?.progression ? { progression: sessionEx.progression } : {}),
      };
  const rec = recommend(history, {
    ...opts,
    ...(extras?.volumeAllowsCluster != null ? { volumeAllowsCluster: extras.volumeAllowsCluster } : {}),
    ...(extras?.stallContext ? { stallContext: extras.stallContext } : {}),
  });
  // The same rule `startFromTemplate` seeds the sets with, so the card and
  // the boxes cannot name two loads.
  const basedOn = completed.find((s) => s.exercises.includes(history[0]))?.date;
  return honourLifterLoad(rec, templateRow, basedOn);
}

/** Sessions the sleep average reads: the last few completed ones that logged it. */
const SLEEP_SESSIONS = 3;

/**
 * Average sleep over the last {@link SLEEP_SESSIONS} completed sessions that
 * logged one (newest first, as `recentSessions` is), for the stall
 * checklist's sleep line. Undefined when none did — the check then reads
 * "no data" rather than passing.
 */
export function recentSleepHours(recentSessions: readonly WorkoutSession[]): number | undefined {
  const hours = recentSessions
    .filter((s) => s.status === 'completed' && s.sleepHours != null)
    .slice(0, SLEEP_SESSIONS)
    .map((s) => s.sleepHours as number);
  if (hours.length === 0) return undefined;
  return hours.reduce((a, b) => a + b, 0) / hours.length;
}

/**
 * The muscles the weekly volume rules (core `volumeCalls`) give one more
 * cluster this week. Never any in a cut. Computed once per session render,
 * not per lift — the audit walks every completed session in the week.
 */
export function musclesAllowingCluster(
  recentSessions: readonly WorkoutSession[],
  catalog: readonly Exercise[],
  phase: TrainingPhase,
  now: number,
): ReadonlySet<MuscleGroup> {
  // A cut never adds volume — skip the audit entirely.
  if (phase === 'cut') return new Set();
  const completed = recentSessions.filter((s) => s.status === 'completed');
  const calls = volumeCalls(
    weeklyClusterAudit(completed, catalog, now),
    phase,
    muscleSignals(completed, catalog, now),
  );
  return new Set(calls.filter((c) => c.add === 1).map((c) => c.muscle));
}

/** Whether one lift's PRIMARY muscle (catalog `muscles[0]`, the one the
 *  weekly audit counts it toward) may take another cluster. */
export function liftAllowsCluster(
  allowed: ReadonlySet<MuscleGroup>,
  catalog: readonly Exercise[],
  exerciseId: string,
): boolean {
  const primary = catalog.find((e) => e.id === exerciseId)?.muscles[0];
  return primary != null && allowed.has(primary);
}

/** One lift's call at the finish boundary. */
export interface FinishCall {
  exerciseId: string;
  name: string;
  rec: Recommendation;
}

/**
 * The engine's call for every lift of a session being finished, read from
 * the history INCLUDING that session — it is treated as the newest completed
 * one, because it is what the next session's call will be made from. Lifts
 * the engine has nothing to say about (`action: 'none'`) are left out; a lift
 * logged twice is called once.
 */
export function finishCalls(input: {
  session: WorkoutSession;
  recentSessions: readonly WorkoutSession[];
  catalog: readonly Exercise[];
  template: WorkoutTemplate | null;
  phase: TrainingPhase;
  now: number;
}): FinishCall[] {
  const { session, catalog, template } = input;
  const finished: WorkoutSession = { ...session, status: 'completed' };
  const history = [
    finished,
    ...input.recentSessions.filter((s) => s.id == null || s.id !== session.id),
  ];
  const allowed = musclesAllowingCluster(history, catalog, input.phase, input.now);
  // The session being finished has no sleep logged yet; the average reads the
  // ones before it.
  const sleepHours = recentSleepHours(input.recentSessions);
  const out: FinishCall[] = [];
  const seen = new Set<string>();
  for (const ex of session.exercises) {
    if (seen.has(ex.exerciseId)) continue;
    seen.add(ex.exerciseId);
    const row = template?.exercises.find((te) => te.exerciseId === ex.exerciseId);
    const restMiniSec = row?.restMiniSec ?? template?.restMiniSec;
    const rec = computeRecommendation({ recentSessions: history, catalog }, ex.exerciseId, row, ex, {
      volumeAllowsCluster: liftAllowsCluster(allowed, catalog, ex.exerciseId),
      stallContext: {
        ...(sleepHours != null ? { sleepHours } : {}),
        ...(restMiniSec != null ? { restMiniSec } : {}),
      },
    });
    if (rec.action === 'none') continue;
    out.push({ exerciseId: ex.exerciseId, name: ex.name, rec });
  }
  return out;
}
