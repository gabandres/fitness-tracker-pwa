import { InjectionToken, Signal } from '@angular/core';
import type { UnitSystem } from '../../models/unit-system';
import type {
  Exercise,
  ExerciseDraft,
  SessionDraft,
  TemplateDraft,
  WorkoutSession,
  WorkoutTemplate,
} from '../../models/workout';
import type {
  DailyLog,
  LogEntry,
  MealPreset,
  Measurement,
  Profile,
  ProfileFields,
  WeeklyReport,
} from '../../services/firebase.service';

/**
 * Persistence seam for user-owned data. Implementations are scoped
 * to the currently signed-in user — the adapter resolves UID from
 * its own auth context; callers never pass one. That implicit scoping
 * is DELIBERATE (not a phase-5 leftover): pushing an explicit uid
 * parameter to every call site would spread auth knowledge across all
 * consumers — see ADR-0009. Drafts and results are domain-typed (JS
 * `Date`, never Firestore `Timestamp`); errors throw (no blanket
 * `Result<T>` wrapper — same ADR).
 *
 * Add-verbs return the server-assigned doc id so stores can reconcile
 * caches locally instead of refetching after every mutation.
 */
export interface LedgerPort {
  readonly profile: Signal<Profile | null>;
  readonly profileCompleted: Signal<boolean>;

  ensureUserProfile(): Promise<void>;
  clearProfile(): void;
  saveProfile(fields: ProfileFields): Promise<void>;

  generateWebhookApiKey(): Promise<string>;
  revokeWebhookApiKey(): Promise<void>;
  saveFcmToken(token: string): Promise<void>;
  clearFcmToken(): Promise<void>;
  saveReminderHour(hour: number): Promise<void>;
  startFast(startedAt?: Date): Promise<void>;
  breakFast(): Promise<void>;
  setTravelMode(on: boolean): Promise<void>;
  setWeeklyDigestOptIn(on: boolean): Promise<void>;
  setUnitSystem(system: UnitSystem): Promise<void>;
  hideRecentLabel(label: string): Promise<void>;
  unhideRecentLabel(label: string): Promise<void>;

  deleteMyAccount(): Promise<void>;
  exportMyData(): Promise<unknown>;

  /** Returns the new doc id — callers append to their caches locally
   *  (optimistic) instead of refetching the window. */
  addLog(entry: LogEntry): Promise<string>;
  /** Returns up to `days` most-recent log rows, oldest-first. The `days`
   *  parameter is a row cap, not a date window — a heavy logger may get
   *  a few days' worth; a sparse logger may span weeks. */
  getRecentLogs(days?: number): Promise<DailyLog[]>;
  updateLog(logId: string, entry: LogEntry): Promise<void>;
  deleteLog(logId: string): Promise<void>;

  getDailyWeights(): Promise<Record<string, number>>;
  setDailyWeight(dateKey: string, weight: number): Promise<void>;

  getDailyWater(): Promise<Record<string, number>>;
  setDailyWater(dateKey: string, ml: number): Promise<void>;

  getPresets(): Promise<MealPreset[]>;
  addPreset(preset: Omit<MealPreset, 'id'>): Promise<string>;
  deletePreset(presetId: string): Promise<void>;

  getLatestReport(): Promise<WeeklyReport | null>;

  getRecentMeasurements(count?: number): Promise<Measurement[]>;
  addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<string>;
  deleteMeasurement(id: string): Promise<void>;

  // ─── Workout: exercise catalog ────────────────────────────────
  getExercises(): Promise<Exercise[]>;
  /** Returns the new doc id so seed/clone flows can wire template
   *  references to freshly-created catalog entries. */
  addExercise(exercise: ExerciseDraft): Promise<string>;
  updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<void>;
  deleteExercise(id: string): Promise<void>;
  /** Merge `fromId` into `toId`: repoint every session/template reference
   *  to the survivor, then delete the victim catalog entry. */
  mergeExercises(fromId: string, toId: string): Promise<void>;

  // ─── Workout: templates ───────────────────────────────────────
  getTemplates(): Promise<WorkoutTemplate[]>;
  addTemplate(template: TemplateDraft): Promise<string>;
  updateTemplate(id: string, template: TemplateDraft): Promise<void>;
  deleteTemplate(id: string): Promise<void>;

  // ─── Workout: sessions ────────────────────────────────────────
  /** The single in-progress session, if any (`status == 'active'`). */
  getActiveSession(): Promise<WorkoutSession | null>;
  /** Most-recent sessions, newest-first. */
  getRecentSessions(count?: number): Promise<WorkoutSession[]>;
  /** Completed sessions for one template, newest-first — backs the
   *  "last session" autofill + rule-based progression. */
  getSessionsForTemplate(templateId: string, count?: number): Promise<WorkoutSession[]>;
  /** All sessions, newest-first — backs per-exercise progression charts
   *  (filtered client-side, like getRecentLogs(9999) for CSV). */
  getAllSessions(): Promise<WorkoutSession[]>;
  startSession(session: SessionDraft): Promise<string>;
  /** Partial merge — the debounced live-write path while logging. */
  updateSession(id: string, patch: Partial<SessionDraft>): Promise<void>;
  deleteSession(id: string): Promise<void>;
}

export const LEDGER_PORT = new InjectionToken<LedgerPort>('LedgerPort');
