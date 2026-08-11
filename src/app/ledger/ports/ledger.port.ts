import { InjectionToken, Signal } from '@angular/core';
import type { UnitSystem } from '@macrolog/core';
import type {
  Exercise,
  ExerciseDraft,
  SessionDraft,
  TemplateDraft,
  WorkoutSession,
  WorkoutTemplate,
} from '../../models/workout';
import type {
  CustomFood,
  DailyLog,
  LogEntry,
  MealPreset,
  Measurement,
  OnboardingV2Submission,
  Profile,
  ProfileFields,
  RefineTargetsSubmission,
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
 *
 * ## What is deliberately NOT behind this seam
 *
 * `public-profile`, `transformations` and `status` read `publicProfiles/*` and
 * `status/heartbeat` with `@angular/fire/firestore` directly, and that is
 * correct, not a leak. Those documents are **not user-owned** — they are other
 * people's public pages and a global heartbeat — so a seam whose entire
 * contract is "scoped to the signed-in user, callers never pass a uid" cannot
 * express them without growing a second, unscoped half.
 *
 * They also do not violate the single-SDK-copy rule: that rule forbids plain
 * `firebase/firestore` in app-bundle code, and these import from
 * `@angular/fire/firestore`, which IS the injected instance.
 *
 * A `PublicDataPort` was considered and rejected: three read-only calls with
 * exactly one implementation is a hypothetical seam, not a real one. Reviewed
 * 2026-08-10 — please don't re-flag them.
 */
export interface LedgerPort {
  readonly profile: Signal<Profile | null>;
  readonly profileCompleted: Signal<boolean>;

  ensureUserProfile(): Promise<void>;
  clearProfile(): void;
  saveProfile(fields: ProfileFields): Promise<void>;
  /**
   * Persist the 2-question onboarding submission — heuristic kcal/protein
   * targets, goal direction, and today's weight.
   *
   * On the port since 2026-08-10. It and `saveRefinedTargets` were the only
   * two profile writes that lived on `FirebaseService` alone, which forced
   * `onboarding` and `refine-targets-sheet` to inject the concrete adapter and
   * left them the two components that could not be exercised without Firebase.
   */
  saveOnboardingV2(submission: OnboardingV2Submission): Promise<void>;
  /**
   * Persist the Day-3 "Refine targets" sheet — the full Mifflin-St Jeor
   * inputs — and clear the heuristic manual targets so the TDEE chain takes
   * over from the next read.
   */
  saveRefinedTargets(submission: RefineTargetsSubmission): Promise<void>;

  generateWebhookApiKey(): Promise<string>;
  revokeWebhookApiKey(): Promise<void>;
  saveFcmToken(token: string): Promise<void>;
  clearFcmToken(): Promise<void>;
  saveReminderHour(hour: number): Promise<void>;
  startFast(startedAt?: Date): Promise<void>;
  breakFast(): Promise<void>;
  setWeeklyDigestOptIn(on: boolean): Promise<void>;
  setUnitSystem(system: UnitSystem): Promise<void>;
  setProteinPerKg(gPerKg: number): Promise<void>;
  setTargetPace(lbPerWeek: number): Promise<void>;
  /** Personal daily-calorie safety floor (kcal); pass null to clear (reverts
   *  the TDEE clamp to the 1500 default). */
  saveCalorieFloor(floor: number | null): Promise<void>;
  /** Personal daily-protein safety floor (grams); pass null to clear. Unlike
   *  the calorie floor there is NO default — cleared means no floor at all. */
  saveProteinFloor(floor: number | null): Promise<void>;
  hideRecentLabel(label: string): Promise<void>;
  unhideRecentLabel(label: string): Promise<void>;

  deleteMyAccount(): Promise<void>;
  exportMyData(): Promise<unknown>;

  /** Returns the new doc id — callers append to their caches locally
   *  (optimistic) instead of refetching the window. */
  addLog(entry: LogEntry): Promise<string>;
  /** Returns up to `count` most-recent log ROWS, oldest-first.
   *
   *  `count` is a row cap, NOT a date window — a heavy logger (7 meals/day)
   *  gets ~2 days from the default 14; a sparse logger may span weeks. The
   *  parameter was once named `days`, which taught exactly the wrong model;
   *  mixing this up with a day window is the footgun ADR-0004 exists to
   *  prevent. See CONTEXT.md "Time windows over logs". */
  getRecentLogs(count?: number): Promise<DailyLog[]>;
  updateLog(logId: string, entry: LogEntry): Promise<void>;
  deleteLog(logId: string): Promise<void>;
  /** Bulk-create rows (switcher import). Batched, NOT atomic across
   *  chunks; returns the number of rows written. */
  importLogs(entries: readonly LogEntry[]): Promise<number>;

  getDailyWeights(): Promise<Record<string, number>>;
  setDailyWeight(dateKey: string, weight: number): Promise<void>;

  getDailyWater(): Promise<Record<string, number>>;
  setDailyWater(dateKey: string, flOz: number): Promise<void>;

  getDailySleep(): Promise<Record<string, number>>;
  setDailySleep(dateKey: string, hours: number): Promise<void>;

  getPresets(): Promise<MealPreset[]>;
  addPreset(preset: Omit<MealPreset, 'id'>): Promise<string>;
  deletePreset(presetId: string): Promise<void>;

  // ─── Custom foods (My Foods library — ADR-0013) ───────────────
  getCustomFoods(): Promise<CustomFood[]>;
  /** Save a food to the library. When `id` is provided (the barcode for
   *  scanned foods) the write is a deterministic upsert at that id — free
   *  de-dup + instant re-scan match; omit it for an auto-id. Returns the id. */
  addCustomFood(food: Omit<CustomFood, 'id'>, id?: string | null): Promise<string>;
  deleteCustomFood(foodId: string): Promise<void>;

  getLatestReport(): Promise<WeeklyReport | null>;

  getRecentMeasurements(count?: number): Promise<Measurement[]>;
  addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<string>;
  /** Overwrite a measurement's fields, preserving its original date. Fields
   *  absent from `entry` are removed from the doc. */
  updateMeasurement(id: string, entry: Omit<Measurement, 'id' | 'date'>): Promise<void>;
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
