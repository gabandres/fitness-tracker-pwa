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
 * its own auth context; callers never pass one.
 *
 * Phase 1: signatures mirror FirebaseService 1:1 so the existing
 * service implements this port with no behavior change. Follow-up
 * phases narrow the surface (explicit UID, Result<T>, domain-typed
 * drafts without Firestore Timestamp) — see issue #6.
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

  addLog(entry: LogEntry): Promise<void>;
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
  addPreset(preset: Omit<MealPreset, 'id'>): Promise<void>;
  deletePreset(presetId: string): Promise<void>;

  getLatestReport(): Promise<WeeklyReport | null>;

  getRecentMeasurements(count?: number): Promise<Measurement[]>;
  addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<void>;
  deleteMeasurement(id: string): Promise<void>;

  // ─── Workout: exercise catalog ────────────────────────────────
  getExercises(): Promise<Exercise[]>;
  /** Returns the new doc id so seed/clone flows can wire template
   *  references to freshly-created catalog entries. */
  addExercise(exercise: ExerciseDraft): Promise<string>;
  updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<void>;
  deleteExercise(id: string): Promise<void>;

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
