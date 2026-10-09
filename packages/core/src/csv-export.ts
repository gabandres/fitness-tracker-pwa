// Shared CSV export — the single long-format serializer for BOTH apps
// (Angular PWA + Expo). Pure string-building only; the DOM download / native
// file-share wrapper lives in each app. Every row carries a `type`
// discriminator and fills only the columns relevant to that type, so the file
// opens cleanly in Excel/Sheets and a user can filter by type to recover any
// single dataset.

import type { DailyLog, Measurement } from './types';
import { fastLengthHours, type Fast } from './fasting-history';
import { isLoggedCardioBlock } from './cardio';
import { type WorkoutSession, type WorkoutTemplate, DEFAULT_EFFORT_STANDARD, type EffortStandard, isLoggedSet } from './workout';
import { type DailyTargetRecord, describeTargetChange } from './target-history';
import { normalizeClusterGroups } from './cluster-groups';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { compareLogsOldestFirst } from './firestore-mappers';

const COLS = [
  'type', 'date', 'timestamp',
  'calories', 'protein', 'carbs', 'fat', 'weight',
  'exerciseCompleted', 'liftCompleted', 'cardioCompleted', 'mealLabel', 'mealType',
  'waterFlOz',
  'waist', 'chest', 'bicep', 'hip', 'neck',
  // Workout columns — filled on 'workout' (session) + 'workout_set' rows.
  'template', 'exercise', 'setKind', 'setGroup', 'setWeight', 'setReps',
  // A `time`-style set (plank, a mobility hold) has no reps: its count is a
  // duration. It went blank in the export for as long as `time` has existed
  // (found 2026-09-15 on a plank that read setReps=NaN from 09-08 on); the
  // hold was in Firestore the whole time. Its own column, never a default
  // into `setReps` — a 90 in a reps column is a lie about a hold.
  'setDurationSec',
  'setRir', 'durationMin', 'sleepHours',
  // Cardio columns — filled on 'cardio' rows only (ADR-0025). Distance is
  // exported in METERS, the stored unit, so the file does not depend on which
  // display preference the user happened to have on export day.
  'modality', 'cardioLabel', 'cardioDurationSec', 'cardioDistanceM',
  'cardioAvgHr', 'cardioMaxHr', 'cardioKcal', 'cardioRpe', 'cardioSource',
  'cardioProvider', 'cardioStartedAt', 'notes',
  // Fasting columns — filled on 'fast' rows only (ADR-0032). `date` is the day
  // the fast ENDED and `timestamp` is when it started, so the row carries the
  // whole interval and a reader can re-derive any attribution rule they like
  // rather than being stuck with ours.
  'fastEndedAt', 'fastHours',
  // Measured body fat — 'measurement' rows only (ADR-0043). Appended, not
  // placed beside the tapes, so no existing column moves.
  'bodyFatPct', 'bodyFatMethod',
  // ── 2026-10-08, appended so no existing column moves (older readers index
  // by position as well as by name) ──
  // 'template' rows: the programme as it stands, one row per exercise (and one
  // per cardio slot), so a coach can check it against what was logged.
  'position', 'load', 'clusters', 'clusterLabels', 'miniRestSec', 'restBetweenSec',
  'effortStandard', 'lastModifiedAt', 'lastModifiedBy',
  // 'target' rows: the targets in effect on each day, from stored records only.
  'kcalTarget', 'kcalTargetSource', 'proteinTarget', 'proteinTargetSource',
  'maintenanceEstimate', 'compositionAdjustedMaintenance', 'targetChangeReason',
] as const;
type Col = typeof COLS[number];

function escape(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(values: Partial<Record<Col, unknown>>): string {
  return COLS.map((c) => escape(values[c])).join(',');
}

export interface ExportData {
  logs: DailyLog[];
  measurements: Measurement[];
  dailyWeights: Record<string, number>;
  dailyWater: Record<string, number>;
  dailySleep: Record<string, number>;
  /** Completed (and in-progress) workout sessions. Optional so existing
   *  callers without workout data keep working. */
  workoutSessions?: WorkoutSession[];
  /** Completed fasts (ADR-0032, #97). Optional for the same reason, and it is
   *  worth saying why this field exists at all: until #97 the export was
   *  silently incomplete — a user who asked for "their data" got none of their
   *  fasting, because ending a fast deleted it. */
  fasts?: Fast[];
  /** Workout templates, for `template` rows. Optional like the others. */
  templates?: WorkoutTemplate[];
  /** The catalog's effort standard per exercise id (absent → failure). */
  effortStandards?: Record<string, EffortStandard | undefined>;
  /** Stored per-day target records (`target-history.ts`), for `target` rows. */
  targetRecords?: DailyTargetRecord[];
}

/**
 * Long-format CSV: every row carries a `type` discriminator
 * (meal | weight | water | sleep | measurement | workout | workout_set | cardio)
 * and only fills the columns relevant to that type. Workout sessions emit one
 * `workout` summary row, one `workout_set` row per logged set, and one `cardio`
 * row per logged cardio block (ADR-0025).
 *
 * A cardio-only session — a run with no lifting — still emits its `workout`
 * summary row, so the export mirrors what Train shows rather than making a run
 * look like a session that never happened.
 */
export function buildCsv(data: ExportData, boundary: DayBoundary = MIDNIGHT): string {
  const rows: string[] = [COLS.join(',')];

  const sortedLogs = [...data.logs].sort(compareLogsOldestFirst);
  for (const l of sortedLogs) {
    rows.push(row({
      type: 'meal',
      date: dayKeyAt(l.date, boundary),
      timestamp: l.date.toISOString(),
      calories: l.calories,
      protein: l.protein,
      carbs: l.carbs,
      fat: l.fat,
      weight: l.weight,
      exerciseCompleted: l.exerciseCompleted ? 'true' : '',
      liftCompleted: l.liftCompleted ? 'true' : '',
      cardioCompleted: l.cardioCompleted ? 'true' : '',
      mealLabel: l.mealLabel,
      mealType: l.mealType,
      // The cardio rows' column; a meal's note is the same kind of free text.
      notes: l.note,
    }));
  }

  const weightKeys = Object.keys(data.dailyWeights).sort();
  for (const date of weightKeys) {
    rows.push(row({ type: 'weight', date, weight: data.dailyWeights[date] }));
  }

  // dailyWater is already in US fluid ounces (the stored unit).
  const waterKeys = Object.keys(data.dailyWater).sort();
  for (const date of waterKeys) {
    rows.push(row({ type: 'water', date, waterFlOz: Math.round(data.dailyWater[date]) }));
  }

  const sleepKeys = Object.keys(data.dailySleep).sort();
  for (const date of sleepKeys) {
    rows.push(row({ type: 'sleep', date, sleepHours: data.dailySleep[date] }));
  }

  const sortedMeasurements = [...data.measurements].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const m of sortedMeasurements) {
    rows.push(row({
      type: 'measurement',
      date: dayKeyAt(m.date, boundary),
      timestamp: m.date.toISOString(),
      waist: m.waist,
      chest: m.chest,
      bicep: m.bicep,
      hip: m.hip,
      neck: m.neck,
      bodyFatPct: m.bodyFatPct,
      bodyFatMethod: m.bodyFatMethod,
    }));
  }

  const sortedSessions = [...(data.workoutSessions ?? [])].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  for (const s of sortedSessions) {
    const date = dayKeyAt(s.date, boundary);
    const timestamp = s.date.toISOString();
    rows.push(row({
      type: 'workout',
      date,
      timestamp,
      template: s.templateName,
      weight: s.bodyweight,
      durationMin: s.durationMin,
      sleepHours: s.sleepHours,
    }));
    for (const ex of s.exercises) {
      // Drop unfilled scaffold rows (no rep/duration count — phantom clusters
      // and blank-reps sets) and re-derive cluster groups on what survives, so
      // already-saved sessions export cleanly: no blank rows, and every
      // exported cluster set carries its group.
      const logged = ex.sets.filter((set) => isLoggedSet(set, ex.logStyle));
      for (const set of normalizeClusterGroups(logged)) {
        rows.push(row({
          type: 'workout_set',
          date,
          timestamp,
          template: s.templateName,
          exercise: ex.name,
          setKind: set.kind,
          setGroup: set.group,
          setWeight: set.weight,
          setReps: set.reps,
          setDurationSec: set.durationSec,
          setRir: set.rir,
        }));
      }
    }
    // Unperformed prescriptions are dropped, exactly as scaffold sets are:
    // `isLoggedCardioBlock` is the same gate the roll-ups use, so the CSV can
    // never claim work the user did not do.
    for (const b of (s.cardio ?? []).filter(isLoggedCardioBlock)) {
      rows.push(row({
        type: 'cardio',
        date,
        // A block carries its OWN start time when the source knew it — a run
        // imported at 9pm may have happened at 6am — so prefer it over the
        // session's timestamp.
        timestamp: (b.startedAt ?? s.date).toISOString(),
        template: s.templateName,
        modality: b.modality,
        cardioLabel: b.label,
        cardioDurationSec: b.durationSec,
        cardioDistanceM: b.distanceM,
        cardioAvgHr: b.avgHr,
        cardioMaxHr: b.maxHr,
        // Provenance, and worth being explicit because a spreadsheet invites
        // arithmetic: this is what the device reported, and it is NOT part of
        // any calorie budget (ADR-0024 decision 4 / ADR-0026 decision 5).
        cardioKcal: b.kcal,
        cardioRpe: b.rpe,
        cardioSource: b.source,
        cardioProvider: b.provider,
        cardioStartedAt: b.startedAt?.toISOString(),
        notes: b.notes,
      }));
    }
  }

  // Fasting (ADR-0032, #97). Sorted by END instant because that is the day the
  // row is attributed to, so the file reads in the same order as History.
  //
  // The interval is exported WHOLE - `timestamp` is the start, `fastEndedAt`
  // the end - rather than only the derived hours. That is deliberate: `date`
  // uses the end-day rule the app shows, and a reader who disagrees with it
  // (Zero and BodyFast attribute a fast to the day it STARTED) can re-derive
  // their own rule from the same row. Exporting only a per-day number would
  // bake our attribution decision into the user's own copy of their data,
  // which is the one place it must not be baked in.
  const sortedFasts = [...(data.fasts ?? [])].sort(
    (a, b) => a.endedAt.getTime() - b.endedAt.getTime(),
  );
  for (const f of sortedFasts) {
    rows.push(row({
      type: 'fast',
      date: dayKeyAt(f.endedAt, boundary),
      timestamp: f.startedAt.toISOString(),
      fastEndedAt: f.endedAt.toISOString(),
      // Two decimals: a fast is a duration a person quotes in hours, and the
      // raw float would render as 15.983333333333333 in a spreadsheet cell.
      fastHours: Math.round(fastLengthHours(f) * 100) / 100,
      // Reuses the shared free-text column rather than minting a fasting-only
      // provenance one. `source` here means what it means on every other row
      // in this file: measured, or asserted by hand.
      notes: f.source,
    }));
  }

  rows.push(...templateRows(data));
  rows.push(...targetRows(data, boundary));

  return rows.join('\r\n');
}

/** `90-120` for a range, `60` for a single value. */
function secRange(sec: number | undefined, maxSec?: number): string | undefined {
  if (sec == null) return undefined;
  return maxSec != null && maxSec !== sec ? `${sec}-${maxSec}` : String(sec);
}

/**
 * One `template` row per exercise per template, in programme order, then one
 * per cardio slot. `clusters` counts activation sets; `clusterLabels` lists the
 * clusters' labels in order ("L,R"). A drop set is not a cluster and is named
 * in `notes`. `lastModified*` is the row's own stamp, else its newest load
 * move, else blank — never a guess.
 */
function templateRows(data: ExportData): string[] {
  const out: string[] = [];
  const templates = [...(data.templates ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of templates) {
    t.exercises.forEach((ex, i) => {
      const acts = ex.plannedSets.filter((p) => p.kind === 'activation');
      const labels: string[] = [];
      for (const p of acts) if (p.label && !labels.includes(p.label)) labels.push(p.label);
      const drops = ex.plannedSets.filter((p) => p.kind === 'drop');
      const lastLoad = ex.loadLog?.[ex.loadLog.length - 1];
      const notes = [
        ...drops.map((d) => `+ drop set${d.weight != null ? ` at ${d.weight}` : ''}`),
        ...(ex.baseline ? [`baseline since ${ex.baseline.since}: ${ex.baseline.reason}`] : []),
      ].join('; ');
      out.push(row({
        type: 'template',
        template: t.name,
        position: i + 1,
        exercise: ex.name,
        load: ex.targetLoad,
        clusters: acts.length > 0 ? acts.length : undefined,
        clusterLabels: labels.join(','),
        miniRestSec: ex.restMiniSec ?? t.restMiniSec,
        restBetweenSec: secRange(ex.restAfterSec ?? t.restClusterSec, ex.restAfterSec != null ? ex.restAfterMaxSec : undefined),
        effortStandard: data.effortStandards?.[ex.exerciseId] ?? DEFAULT_EFFORT_STANDARD,
        notes,
        lastModifiedAt: ex.lastModifiedAt ?? lastLoad?.at,
        lastModifiedBy: ex.lastModifiedBy ?? lastLoad?.by,
      }));
    });
    (t.cardioBlocks ?? []).forEach((b, j) => {
      out.push(row({
        type: 'template',
        template: t.name,
        position: t.exercises.length + j + 1,
        exercise: b.label ?? b.modality,
        durationMin: b.targetDurationSec != null ? Math.round(b.targetDurationSec / 60) : undefined,
      }));
    });
  }
  return out;
}

/**
 * One `target` row per date: every date that has a stored target record or
 * any other row in this file. Values come ONLY from stored records — a date
 * with none has blank target columns, because a target recomputed today from
 * today's inputs is not the target that was in effect then.
 */
function targetRows(data: ExportData, boundary: DayBoundary): string[] {
  const records = new Map((data.targetRecords ?? []).map((r) => [r.date, r]));
  const dates = new Set<string>(records.keys());
  for (const l of data.logs) dates.add(dayKeyAt(l.date, boundary));
  for (const k of Object.keys(data.dailyWeights)) dates.add(k);
  if (dates.size === 0) return [];
  return [...dates].sort().map((date) => {
    const r = records.get(date);
    return row(r ? {
      type: 'target',
      date,
      kcalTarget: r.kcalTarget,
      kcalTargetSource: r.kcalSource,
      proteinTarget: r.proteinTarget,
      proteinTargetSource: r.proteinSource,
      maintenanceEstimate: r.maintenanceEstimate,
      compositionAdjustedMaintenance: r.compositionAdjustedMaintenance,
      targetChangeReason: r.change ? describeTargetChange(r.change) : undefined,
    } : { type: 'target', date });
  });
}
