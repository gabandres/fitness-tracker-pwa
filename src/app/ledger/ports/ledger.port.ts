import { InjectionToken, Signal } from '@angular/core';
import type { UnitSystem } from '../../models/unit-system';
import type {
  DailyLog,
  LogEntry,
  MealPreset,
  Measurement,
  ProfileFields,
  UserProfile,
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
  readonly profile: Signal<UserProfile | null>;
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
}

export const LEDGER_PORT = new InjectionToken<LedgerPort>('LedgerPort');
