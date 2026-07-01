// Shared CSV export — the single long-format serializer for BOTH apps
// (Angular PWA + Expo). Pure string-building only; the DOM download / native
// file-share wrapper lives in each app. Every row carries a `type`
// discriminator and fills only the columns relevant to that type, so the file
// opens cleanly in Excel/Sheets and a user can filter by type to recover any
// single dataset.

import type { DailyLog, Measurement } from './types';
import { type WorkoutSession, isLoggedSet } from './workout';
import { normalizeClusterGroups } from './cluster-groups';
import { localDateKey } from './date';

const COLS = [
  'type', 'date', 'timestamp',
  'calories', 'protein', 'carbs', 'fat', 'weight',
  'exerciseCompleted', 'liftCompleted', 'cardioCompleted', 'mealLabel', 'mealType',
  'waterFlOz',
  'waist', 'chest', 'bicep', 'hip', 'neck',
  // Workout columns — filled on 'workout' (session) + 'workout_set' rows.
  'template', 'exercise', 'setKind', 'setGroup', 'setWeight', 'setReps',
  'setRir', 'durationMin', 'sleepHours',
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
}

/**
 * Long-format CSV: every row carries a `type` discriminator
 * (meal | weight | water | sleep | measurement | workout | workout_set) and only
 * fills the columns relevant to that type. Workout sessions emit one `workout`
 * summary row plus one `workout_set` row per logged set.
 */
export function buildCsv(data: ExportData): string {
  const rows: string[] = [COLS.join(',')];

  const sortedLogs = [...data.logs].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const l of sortedLogs) {
    rows.push(row({
      type: 'meal',
      date: localDateKey(l.date),
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
      date: localDateKey(m.date),
      timestamp: m.date.toISOString(),
      waist: m.waist,
      chest: m.chest,
      bicep: m.bicep,
      hip: m.hip,
      neck: m.neck,
    }));
  }

  const sortedSessions = [...(data.workoutSessions ?? [])].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  for (const s of sortedSessions) {
    const date = localDateKey(s.date);
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
          setRir: set.rir,
        }));
      }
    }
  }

  return rows.join('\r\n');
}
