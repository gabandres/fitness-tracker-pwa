/**
 * Read a workout history exported from another lifting app (UX_AUDIT S24-17,
 * 2026-11-19): Hevy's "Export Workouts" CSV and Strong's CSV export. Switchers
 * bring years of sessions with them, and a logger that starts them at zero
 * loses them.
 *
 * Pure: text in, workouts out. Nothing here writes, maps a name to a catalog
 * exercise or knows the account's unit — the caller does (`lib/workout-import`
 * in the app).
 *
 * **Neither format is documented by its app** (checked 2026-11-19: Hevy's help
 * centre describes where the export is, not what is in it). So nothing below
 * depends on column ORDER or on an exact header list: columns are found by
 * NAME after normalising (case, spaces, punctuation), with the aliases seen in
 * both apps' exports, the delimiter is detected (Strong has shipped both `,`
 * and `;`), and a file that does not carry the columns a workout needs is
 * REFUSED (`null`) rather than half-read. One row is one set in both.
 */

export type WorkoutImportFormat = 'hevy' | 'strong';

/** `drop` and `warmup` keep their meaning; everything else is a working set. */
export type ImportedSetKind = 'working' | 'warmup' | 'drop';

export interface ImportedSet {
  kind: ImportedSetKind;
  /** In the FILE's unit — see {@link WorkoutImport.unit}. */
  weight?: number;
  reps?: number;
  durationSec?: number;
  /** Reps in reserve, from an RPE when one was logged (10 − RPE, 0…5). */
  rir?: number;
}

export interface ImportedExercise {
  name: string;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  name: string;
  date: Date;
  durationMin?: number;
  exercises: ImportedExercise[];
}

export interface WorkoutImport {
  format: WorkoutImportFormat;
  /**
   * The unit the weights are in, when the file says (`weight_lbs`,
   * `Weight (kg)`). `null` when it does not — Strong's older export has a bare
   * `Weight` column in whatever the app was set to — and the caller must ask.
   */
  unit: 'kg' | 'lb' | null;
  workouts: ImportedWorkout[];
  /** Rows that could not be read as a set (no exercise, no date, no numbers). */
  skippedRows: number;
  sets: number;
  firstDate: Date | null;
  lastDate: Date | null;
}

const LB_PER_KG = 2.2046226218;

/** A weight from the file's unit to pounds, the unit sessions are stored in. */
export function importedWeightToLb(weight: number, unit: 'kg' | 'lb'): number {
  const lb = unit === 'kg' ? weight * LB_PER_KG : weight;
  return Math.round(lb * 100) / 100;
}

// ─── CSV ────────────────────────────────────────────────────────

function detectDelimiter(headerLine: string): ',' | ';' {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

/** RFC-4180 records: quoted fields, doubled quotes, newlines inside quotes. */
function splitRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** `Weight (kg)` → `weightkg`; `exercise_title` → `exercisetitle`. */
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9#]/g, '');

function column(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * The two date shapes the exports use, as LOCAL time (neither carries a zone):
 * `2023-01-15 18:30:00` (Strong) and `15 Jan 2023, 18:30` (Hevy). Anything else
 * is null — a guess at day/month order would file sessions on the wrong day.
 */
export function parseWorkoutDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 12), +(m[5] ?? 0), +(m[6] ?? 0));
    return validDate(d, +m[1], +m[2] - 1, +m[3]);
  }
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})(?:,? +(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month == null) return null;
    const d = new Date(+m[3], month, +m[1], +(m[4] ?? 12), +(m[5] ?? 0));
    return validDate(d, +m[3], month, +m[1]);
  }
  return null;
}

function validDate(d: Date, y: number, mo: number, day: number): Date | null {
  if (Number.isNaN(d.getTime())) return null;
  // `new Date(2023, 1, 31)` rolls into March: refuse rather than move the day.
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  if (y < 2000 || y > 2100) return null;
  return d;
}

/** `45m`, `1h 5m`, `1h`, `3600` (seconds) → minutes. */
function parseDurationMin(raw: string | undefined, seconds: boolean): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (s === '') return undefined;
  if (seconds) {
    const n = num(s);
    return n != null && n > 0 ? Math.round(n / 60) : undefined;
  }
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*m/.exec(s);
  if (!h && !m) {
    const n = num(s);
    return n != null && n > 0 ? Math.round(n / 60) : undefined;
  }
  const total = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
  return total > 0 ? total : undefined;
}

function setKind(raw: string | undefined): ImportedSetKind {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'warmup' || s === 'warm up' || s === 'warm-up' || s === 'w') return 'warmup';
  if (s === 'dropset' || s === 'drop set' || s === 'drop' || s === 'd') return 'drop';
  return 'working';
}

/** Hevy's `failure` set type (15 % of the sets in a real 7,211-row export,
 *  2026-11-20): taken to failure is zero reps in reserve. Strong marks it "F"
 *  in Set Order. */
function isFailureSet(raw: string | undefined): boolean {
  const s = (raw ?? '').trim().toLowerCase();
  return s === 'failure' || s === 'f';
}

function rirFromRpe(raw: string | undefined): number | undefined {
  const rpe = num(raw);
  if (rpe == null || rpe < 5 || rpe > 10) return undefined;
  return Math.round(10 - rpe);
}

// ─── The parser ─────────────────────────────────────────────────

const MAX_REPS = 500;
const MAX_WEIGHT = 5000;
const MAX_DURATION_SEC = 6 * 60 * 60;

/**
 * A Hevy or Strong workout export, or `null` when the text is neither — the
 * caller can then try the food importer, or say the file was not recognised.
 */
export function parseWorkoutCsv(text: string): WorkoutImport | null {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  if (firstLine.trim() === '') return null;
  const rows = splitRecords(clean, detectDelimiter(firstLine));
  if (rows.length < 2) return null;
  const headers = rows[0].map(norm);

  const col = {
    exercise: column(headers, ['exercisetitle', 'exercisename']),
    date: column(headers, ['starttime', 'date']),
    workout: column(headers, ['title', 'workoutname']),
    reps: column(headers, ['reps']),
    weightLb: column(headers, ['weightlbs', 'weightlb']),
    weightKg: column(headers, ['weightkg', 'weightkgs']),
    weightBare: column(headers, ['weight']),
    setType: column(headers, ['settype']),
    setOrder: column(headers, ['setorder', 'setindex']),
    seconds: column(headers, ['durationseconds', 'seconds']),
    duration: column(headers, ['duration', 'durationsec']),
    end: column(headers, ['endtime']),
    rpe: column(headers, ['rpe']),
  };
  // What a workout cannot be read without. A food diary export has a date but
  // no exercise column, and falls out here.
  if (col.exercise < 0 || col.date < 0 || col.reps < 0) return null;
  const format: WorkoutImportFormat = headers[col.exercise] === 'exercisetitle' ? 'hevy' : 'strong';
  const weightCol = col.weightLb >= 0 ? col.weightLb : col.weightKg >= 0 ? col.weightKg : col.weightBare;
  const unit: 'kg' | 'lb' | null = col.weightLb >= 0 ? 'lb' : col.weightKg >= 0 ? 'kg' : null;
  const durationInSeconds = col.duration >= 0 && headers[col.duration] === 'durationsec';

  const byKey = new Map<string, ImportedWorkout>();
  let skippedRows = 0;
  let sets = 0;
  for (const row of rows.slice(1)) {
    const name = (row[col.exercise] ?? '').trim();
    const date = parseWorkoutDate(row[col.date]);
    if (!name || !date) {
      skippedRows++;
      continue;
    }
    // Strong marks a rest timer as its own row ("Rest Timer" in Set Order).
    if (col.setOrder >= 0 && /rest/i.test(row[col.setOrder] ?? '')) continue;

    const reps = num(row[col.reps]);
    const weight = weightCol >= 0 ? num(row[weightCol]) : null;
    const seconds = col.seconds >= 0 ? num(row[col.seconds]) : null;
    const set: ImportedSet = {
      kind: col.setType >= 0 ? setKind(row[col.setType]) : setKind(col.setOrder >= 0 ? row[col.setOrder] : undefined),
    };
    if (reps != null && reps > 0 && reps <= MAX_REPS) set.reps = Math.round(reps);
    if (weight != null && weight > 0 && weight <= MAX_WEIGHT) set.weight = weight;
    if (seconds != null && seconds > 0 && seconds <= MAX_DURATION_SEC) set.durationSec = Math.round(seconds);
    // An RPE the lifter typed wins; a set marked "failure" with none is RIR 0.
    const rir = col.rpe >= 0 ? rirFromRpe(row[col.rpe]) : undefined;
    const typeRaw = col.setType >= 0 ? row[col.setType] : col.setOrder >= 0 ? row[col.setOrder] : undefined;
    if (rir != null) set.rir = rir;
    else if (isFailureSet(typeRaw)) set.rir = 0;
    // A set with neither reps nor a duration logged nothing.
    if (set.reps == null && set.durationSec == null) {
      skippedRows++;
      continue;
    }

    const workoutName = (col.workout >= 0 ? (row[col.workout] ?? '').trim() : '') || 'Workout';
    const key = `${date.getTime()}|${workoutName}`;
    let workout = byKey.get(key);
    if (!workout) {
      workout = { name: workoutName, date, exercises: [] };
      const end = col.end >= 0 ? parseWorkoutDate(row[col.end]) : null;
      const durationMin = end
        ? Math.round((end.getTime() - date.getTime()) / 60000)
        : col.duration >= 0
          ? parseDurationMin(row[col.duration], durationInSeconds)
          : undefined;
      if (durationMin != null && durationMin > 0 && durationMin <= 24 * 60) workout.durationMin = durationMin;
      byKey.set(key, workout);
    }
    // Consecutive rows of one exercise are one card; the same lift later in
    // the workout is a second card, as it was done.
    const last = workout.exercises[workout.exercises.length - 1];
    if (last && last.name === name) last.sets.push(set);
    else workout.exercises.push({ name, sets: [set] });
    sets++;
  }

  const workouts = [...byKey.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (workouts.length === 0) return null;
  return {
    format,
    unit,
    workouts,
    skippedRows,
    sets,
    firstDate: workouts[0].date,
    lastDate: workouts[workouts.length - 1].date,
  };
}
