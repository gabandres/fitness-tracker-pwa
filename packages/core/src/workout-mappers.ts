/**
 * Workout doc → domain mappers, single-sourced for BOTH frontends (arch
 * review E). The read-path twin of the write helpers already in
 * `./workout` (fillMissingClusterLoads) — a field added to a workout doc now
 * lands here once instead of in the Angular `FirestoreLedgerCore` and the Expo
 * `lib/ledger.ts` separately.
 *
 * Framework-free (ADR-0012): no `firebase/firestore` import — dates are coerced
 * structurally via {@link toDate} (`TimestampLike`), so each frontend keeps its
 * own `onSnapshot`/`getDocs` I/O and `Timestamp` import.
 *
 * These mappers do the field-copy + Timestamp→Date ONLY; they deliberately do
 * NOT run `normalizeClusterGroups`. The web adapter applies that normalization
 * as a post-step (mobile does not — the historical asymmetry), so it stays a
 * per-frontend decision at the call site rather than baked into the shared shape.
 */
import { toDate } from './firestore-mappers';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSession, WorkoutTemplate } from './workout';

export function toWorkoutExercise(id: string, data: Record<string, unknown>): Exercise {
  return {
    id,
    name: (data['name'] as string) ?? '',
    muscles: (data['muscles'] as Exercise['muscles']) ?? [],
    defaultCues: (data['defaultCues'] as string[]) ?? [],
    logStyle: data['logStyle'] as Exercise['logStyle'],
    seedKey: data['seedKey'] as string | undefined,
    createdAt: toDate(data['createdAt']),
  };
}

export function toWorkoutTemplate(id: string, data: Record<string, unknown>): WorkoutTemplate {
  return {
    id,
    name: (data['name'] as string) ?? '',
    notes: data['notes'] as string | undefined,
    restMiniSec: data['restMiniSec'] as number | undefined,
    restClusterSec: data['restClusterSec'] as number | undefined,
    exercises: ((data['exercises'] as TemplateExercise[] | undefined) ?? []).map((ex) => ({
      ...ex,
      plannedSets: ex.plannedSets ?? [],
    })),
    seedKey: data['seedKey'] as string | undefined,
    createdAt: toDate(data['createdAt']),
    updatedAt: toDate(data['updatedAt']),
  };
}

export function toWorkoutSession(id: string, data: Record<string, unknown>): WorkoutSession {
  return {
    id,
    status: data['status'] as WorkoutSession['status'],
    templateId: data['templateId'] as string | undefined,
    templateName: data['templateName'] as string | undefined,
    // The session's date is stored as the `timestamp` field at the seam.
    date: toDate(data['timestamp']),
    bodyweight: data['bodyweight'] as number | undefined,
    sleepHours: data['sleepHours'] as number | undefined,
    durationMin: data['durationMin'] as number | undefined,
    exercises: ((data['exercises'] as SessionExercise[] | undefined) ?? []).map((ex) => ({
      ...ex,
      sets: ex.sets ?? [],
    })),
    nextNotes: data['nextNotes'] as string | undefined,
    createdAt: toDate(data['createdAt']),
    updatedAt: toDate(data['updatedAt']),
  };
}
