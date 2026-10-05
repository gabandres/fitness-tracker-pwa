import type { ActivationIssue, Recommendation, ProgressionSuggestion, UnitSystem } from '@macrolog/core';
import {
  exerciseHistory,
  formatLoad,
  isWorkingSet,
  lastPerformed,
  recommend,
  recommendOptionsFor,
  sessionCardioSec,
  sessionCounts,
  templateCounts,
  workingSetCells,
} from '@macrolog/core';
import type { CardioModality } from '@macrolog/core/cardio';
import type { I18nKey, Locale, TFn } from '@/i18n';
import { plural } from '@/i18n/grammar';
import type {
  Exercise,
  LogStyle,
  SessionExercise,
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
 * recommendation and the "↑ Try X" bump chip both: every working set with no
 * weight yet that has not been ticked. One rule for both; the bump used to
 * fill only the FIRST working set, so the rest were ticked at last week's
 * load without anyone noticing (Train re-score 3, bug 4). A ticked set is a
 * record of what was lifted, and a typed weight is the lifter's own call.
 */
export function loadTargetIndices(sets: readonly WorkoutSet[]): number[] {
  const out: number[] = [];
  sets.forEach((s, i) => {
    if (isWorkingSet(s) && (s.weight ?? 0) === 0 && !s.done) out.push(i);
  });
  return out;
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
 * The engine's call for one exercise, from the completed history the tab
 * already holds. The prescription (cluster or not, rep target, increment)
 * comes from the template row; the equipment (`availableLoads`, `assisted`)
 * from the catalog exercise. An ad-hoc session exercise has no template row,
 * so its own sets say whether it is clustered and its snapshotted
 * `progression` supplies the band.
 *
 * Takes the two data fields rather than the whole hook result, so a memo
 * keyed on them actually hits.
 */
export function recommendationFor(
  data: { recentSessions: readonly WorkoutSession[]; catalog: readonly Exercise[] },
  exerciseId: string,
  templateRow: WorkoutTemplate['exercises'][number] | null | undefined,
  sessionEx?: SessionExercise,
): Recommendation {
  const completed = data.recentSessions.filter((s) => s.status === 'completed');
  const history = exerciseHistory(completed, exerciseId);
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
  return recommend(history, opts);
}
