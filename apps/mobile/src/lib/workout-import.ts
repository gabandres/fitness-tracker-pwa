import { type ImportedWorkout, type WorkoutImport, importedWeightToLb } from '@macrolog/core';
import { addExercise, getAllExercises, getAllSessions, startSession } from '@/lib/ledger';
import type { Exercise, LogStyle, SessionDraft, SessionExercise, WorkoutSession, WorkoutSet } from '@/lib/workout';

/**
 * Turn a parsed Hevy / Strong export (core `parseWorkoutCsv`) into this
 * account's own sessions (UX_AUDIT S24-17, 2026-11-19).
 *
 * `planWorkoutImport` is pure — which lifts are new, which workouts are
 * already here, what each session will hold — so the preview and the write
 * cannot disagree and the rules are testable without Firestore.
 * `runWorkoutImport` reads the catalog and the sessions once, adds the missing
 * lifts, and writes the sessions as `completed`, a few at a time.
 *
 * Decisions, each a limit of the source file rather than a preference:
 *  - **A lift is matched by NAME**, case-insensitively, then by the same
 *    WORDS in any order: "Bench Press (Barbell)" is a seeded "Barbell Bench
 *    Press" (Hevy and Strong put the equipment last, in brackets). Only when
 *    exactly one catalog lift has those words — two candidates is a guess, and
 *    a guess would file someone's history under the wrong lift. Anything else
 *    becomes its own lift with no muscles, and Train's merge can join it later.
 *  - **A workout already here is skipped**: same start minute as a completed
 *    session. Importing the same file twice adds nothing.
 *  - **Weights are stored in pounds**, as every session is; the file's unit is
 *    the caller's to supply when the header does not name it.
 *  - Sessions carry no template, no progression rule and no structure: the
 *    engine reads them as plain history.
 */

/** `firestore.rules` → `isValidWorkoutSession`: `exercises.size() <= 40`. */
export const IMPORT_MAX_EXERCISES = 40;
/** `isValidExercise` / `templateName`: 100 characters. */
const NAME_MAX = 100;
const WRITE_CONCURRENCY = 4;

const nameKey = (name: string) => name.trim().toLowerCase();
const minuteKey = (d: Date) => Math.floor(d.getTime() / 60000);
/** The name's words, lower-cased and sorted, brackets and punctuation dropped:
 *  the same for "Bench Press (Barbell)" and "Barbell Bench Press". Exported
 *  for test. */
export const wordKey = (name: string) =>
  name
    .toLowerCase()
    .split(/[\s()[\]{}\-–—_,./]+/)
    .filter(Boolean)
    .sort()
    .join(' ');

export interface PlannedExercise {
  /** {@link nameKey} of the lift. */
  key: string;
  name: string;
  logStyle: LogStyle;
}

export interface PlannedSession {
  name: string;
  date: Date;
  durationMin?: number;
  exercises: { key: string; name: string; logStyle: LogStyle; sets: WorkoutSet[] }[];
}

export interface WorkoutImportPlan {
  /** Lifts the catalog does not have, to create first. */
  newExercises: PlannedExercise[];
  sessions: PlannedSession[];
  /** Workouts skipped because a completed session starts the same minute. */
  duplicates: number;
  /** Lifts dropped from workouts over {@link IMPORT_MAX_EXERCISES}. */
  droppedExercises: number;
}

/** How a lift is logged, from every set the file has for it: any weight makes
 *  it a loaded lift, else any reps a bodyweight one, else a timed hold. */
function logStyleOf(workouts: readonly ImportedWorkout[]): Map<string, LogStyle> {
  const seen = new Map<string, { weight: boolean; reps: boolean }>();
  for (const w of workouts) {
    for (const ex of w.exercises) {
      const k = nameKey(ex.name);
      const s = seen.get(k) ?? { weight: false, reps: false };
      for (const set of ex.sets) {
        if (set.weight != null) s.weight = true;
        if (set.reps != null) s.reps = true;
      }
      seen.set(k, s);
    }
  }
  const out = new Map<string, LogStyle>();
  for (const [k, s] of seen) out.set(k, s.weight ? 'weight-reps' : s.reps ? 'bodyweight' : 'time');
  return out;
}

export function planWorkoutImport(
  parsed: Pick<WorkoutImport, 'workouts'>,
  unit: 'kg' | 'lb',
  catalog: readonly Pick<Exercise, 'name' | 'logStyle'>[],
  existing: readonly Pick<WorkoutSession, 'status' | 'date'>[],
): WorkoutImportPlan {
  const known = new Map<string, LogStyle | undefined>();
  // Catalog lifts by their words; `null` marks words two lifts share.
  const byWords = new Map<string, { key: string; name: string } | null>();
  for (const e of catalog) {
    const key = nameKey(e.name);
    known.set(key, e.logStyle);
    const words = wordKey(e.name);
    if (!words) continue;
    const seen = byWords.get(words);
    if (seen === undefined) byWords.set(words, { key, name: e.name });
    else if (seen && seen.key !== key) byWords.set(words, null);
  }
  const taken = new Set(existing.filter((s) => s.status === 'completed').map((s) => minuteKey(s.date)));
  const styles = logStyleOf(parsed.workouts);

  const newExercises = new Map<string, PlannedExercise>();
  const sessions: PlannedSession[] = [];
  let duplicates = 0;
  let droppedExercises = 0;

  for (const w of parsed.workouts) {
    const minute = minuteKey(w.date);
    if (taken.has(minute)) {
      duplicates++;
      continue;
    }
    // Two workouts in one file that start the same minute: the first wins,
    // like a re-import would.
    taken.add(minute);
    droppedExercises += Math.max(0, w.exercises.length - IMPORT_MAX_EXERCISES);
    const exercises = w.exercises.slice(0, IMPORT_MAX_EXERCISES).map((ex) => {
      const fileKey = nameKey(ex.name);
      // Exact name first; else the one catalog lift with the same words.
      const same = known.has(fileKey) ? null : byWords.get(wordKey(ex.name));
      const key = same ? same.key : fileKey;
      const name = (same ? same.name : ex.name).trim().slice(0, NAME_MAX);
      const logStyle = known.get(key) ?? styles.get(fileKey) ?? 'weight-reps';
      if (!known.has(key) && !newExercises.has(key)) newExercises.set(key, { key, name, logStyle });
      const sets: WorkoutSet[] = ex.sets.map((s) => ({
        kind: s.kind,
        ...(s.weight != null ? { weight: importedWeightToLb(s.weight, unit) } : {}),
        ...(s.reps != null ? { reps: s.reps } : {}),
        ...(s.durationSec != null ? { durationSec: s.durationSec } : {}),
        ...(s.rir != null ? { rir: s.rir } : {}),
        done: true,
      }));
      return { key, name, logStyle, sets };
    });
    sessions.push({
      name: w.name.trim().slice(0, NAME_MAX) || 'Workout',
      date: w.date,
      ...(w.durationMin != null ? { durationMin: w.durationMin } : {}),
      exercises,
    });
  }
  return { newExercises: [...newExercises.values()], sessions, duplicates, droppedExercises };
}

export interface WorkoutImportOutcome {
  imported: number;
  duplicates: number;
  exercisesAdded: number;
  /** Sessions that could not be written (offline mid-way, a refused write). */
  failed: number;
}

/**
 * Read, plan and write. `onProgress` is called after each session lands.
 * A failed session does not stop the rest: importing again skips what landed
 * (the duplicate rule) and retries what did not.
 */
export async function runWorkoutImport(
  uid: string,
  parsed: Pick<WorkoutImport, 'workouts'>,
  unit: 'kg' | 'lb',
  onProgress?: (done: number, total: number) => void,
): Promise<WorkoutImportOutcome> {
  const [catalog, existing] = await Promise.all([getAllExercises(uid), getAllSessions(uid)]);
  const plan = planWorkoutImport(parsed, unit, catalog, existing);

  const idByKey = new Map<string, string>();
  for (const e of catalog) if (e.id) idByKey.set(nameKey(e.name), e.id);
  for (const ex of plan.newExercises) {
    const id = await addExercise(uid, { name: ex.name, muscles: [], defaultCues: [], logStyle: ex.logStyle });
    idByKey.set(ex.key, id);
  }

  let imported = 0;
  let failed = 0;
  let done = 0;
  const total = plan.sessions.length;
  const queue = [...plan.sessions];
  async function worker() {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      const exercises: SessionExercise[] = [];
      for (const ex of s.exercises) {
        const exerciseId = idByKey.get(ex.key);
        if (!exerciseId) continue;
        exercises.push({ exerciseId, name: ex.name, cues: [], logStyle: ex.logStyle, sets: ex.sets });
      }
      const draft: SessionDraft = {
        status: 'completed',
        date: s.date,
        templateName: s.name,
        ...(s.durationMin != null ? { durationMin: s.durationMin } : {}),
        exercises,
      };
      try {
        await startSession(uid, draft);
        imported++;
      } catch {
        failed++;
      }
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, total) }, () => worker()));
  return { imported, duplicates: plan.duplicates, exercisesAdded: plan.newExercises.length, failed };
}
