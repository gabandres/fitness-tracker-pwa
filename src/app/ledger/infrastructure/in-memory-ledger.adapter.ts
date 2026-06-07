import { Injectable, computed, signal } from '@angular/core';
import type { LedgerPort } from '../ports/ledger.port';
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
 * In-memory LedgerPort for tests and Storybook. Mirrors FirebaseService
 * behavior closely enough to satisfy the port contract: insertion-ordered
 * logs, newest-first ordering on read with oldest-first return for
 * getRecentLogs (matching the prod service). Holds the domain `Profile`
 * shape directly — all dates are JS `Date`, exactly what the Firestore
 * adapter exposes after `toDomainProfile`. No `Timestamp` anywhere: that
 * is the whole point of the contract this fake must honor.
 *
 * Deliberately NOT providedIn 'root' — tests opt in via TestBed providers.
 */
@Injectable()
export class InMemoryLedgerAdapter implements LedgerPort {
  private readonly _profile = signal<Profile | null>(null);
  readonly profile = this._profile.asReadonly();
  readonly profileCompleted = computed(
    () => this._profile()?.profileCompleted === true,
  );

  private readonly logs = new Map<string, DailyLog>();
  private logSeq = 0;
  private readonly presets = new Map<string, MealPreset>();
  private presetSeq = 0;
  private readonly measurements = new Map<string, Measurement>();
  private measurementSeq = 0;
  private readonly weights: Record<string, number> = {};
  private readonly water: Record<string, number> = {};
  private report: WeeklyReport | null = null;

  /** Test hook: pre-seed a weekly report (prod writes are server-only). */
  seedLatestReport(report: WeeklyReport | null): void {
    this.report = report;
  }

  async ensureUserProfile(): Promise<void> {
    if (this._profile()) return;
    const now = new Date();
    this._profile.set({
      email: 'test@example.com',
      createdAt: now,
      lastSeenAt: now,
      profileCompleted: false,
    });
  }

  clearProfile(): void {
    this._profile.set(null);
  }

  async saveProfile(fields: ProfileFields): Promise<void> {
    const current = this._profile();
    if (!current) throw new Error('No profile loaded.');
    const patch: Partial<Profile> = {
      heightIn: fields.heightIn,
      age: fields.age,
      sex: fields.sex,
      activityLevel: fields.activityLevel,
      targetPaceLbsPerWeek: fields.targetPaceLbsPerWeek,
      profileCompleted: true,
      lastSeenAt: new Date(),
    };
    if (fields.goalWeightLbs != null) patch.goalWeightLbs = fields.goalWeightLbs;
    if (fields.ageConfirmed === true && current.ageConfirmedAt == null) {
      patch.ageConfirmedAt = new Date();
    }
    if (fields.preferredLocale) patch.preferredLocale = fields.preferredLocale;
    this._profile.set({ ...current, ...patch } as Profile);
  }

  async generateWebhookApiKey(): Promise<string> {
    const key = crypto.randomUUID();
    this.patchProfile({ webhookApiKey: key });
    return key;
  }

  async revokeWebhookApiKey(): Promise<void> {
    this.patchProfile({ webhookApiKey: undefined }, ['webhookApiKey']);
  }

  async saveFcmToken(token: string): Promise<void> {
    this.patchProfile({
      fcmToken: token,
      timezoneOffsetMin: new Date().getTimezoneOffset(),
    });
  }

  async clearFcmToken(): Promise<void> {
    this.patchProfile({}, ['fcmToken']);
  }

  async saveReminderHour(hour: number): Promise<void> {
    this.patchProfile({ reminderHour: hour });
  }

  async startFast(startedAt?: Date): Promise<void> {
    const start = startedAt ?? new Date();
    this.patchProfile({ fastStartedAt: start });
  }

  async breakFast(): Promise<void> {
    this.patchProfile({ fastStartedAt: null });
  }

  async setTravelMode(on: boolean): Promise<void> {
    this.patchProfile({ travelMode: on });
  }

  async setUnitSystem(system: import('../../models/unit-system').UnitSystem): Promise<void> {
    this.patchProfile({ unitSystem: system });
  }

  async hideRecentLabel(label: string): Promise<void> {
    const norm = label.trim().toLowerCase();
    if (!norm) return;
    const current = this._profile() as { hiddenRecentLabels?: string[] } | null;
    const existing = current?.hiddenRecentLabels ?? [];
    if (existing.includes(norm)) return;
    this.patchProfile({ hiddenRecentLabels: [...existing, norm].slice(-200) });
  }

  async unhideRecentLabel(label: string): Promise<void> {
    const norm = label.trim().toLowerCase();
    const current = this._profile() as { hiddenRecentLabels?: string[] } | null;
    const existing = current?.hiddenRecentLabels ?? [];
    const next = existing.filter((l) => l !== norm);
    if (next.length === existing.length) return;
    this.patchProfile({ hiddenRecentLabels: next });
  }

  async setWeeklyDigestOptIn(on: boolean): Promise<void> {
    this.patchProfile({ weeklyDigestOptIn: on });
  }

  async deleteMyAccount(): Promise<void> {
    this.logs.clear();
    this.presets.clear();
    this.measurements.clear();
    for (const k of Object.keys(this.weights)) delete this.weights[k];
    for (const k of Object.keys(this.water)) delete this.water[k];
    this.report = null;
    this._profile.set(null);
  }

  async exportMyData(): Promise<unknown> {
    return {
      profile: this._profile(),
      logs: [...this.logs.values()],
      presets: [...this.presets.values()],
      measurements: [...this.measurements.values()],
      dailyWeights: { ...this.weights },
      dailyWater: { ...this.water },
      reports: this.report ? [this.report] : [],
    };
  }

  async addLog(entry: LogEntry): Promise<void> {
    const id = `log-${++this.logSeq}`;
    this.logs.set(id, {
      id,
      calories: entry.calories,
      date: entry.timestamp ?? new Date(),
      weight: entry.weight,
      protein: entry.protein,
      exerciseCompleted: entry.exerciseCompleted || undefined,
      mealLabel: entry.mealLabel,
    });
  }

  async getRecentLogs(days = 14): Promise<DailyLog[]> {
    // Mirror prod: sort desc by date, take `days` rows, return oldest-first.
    const sorted = [...this.logs.values()].sort(
      (a, b) => b.date.getTime() - a.date.getTime(),
    );
    return sorted.slice(0, days).reverse();
  }

  async updateLog(logId: string, entry: LogEntry): Promise<void> {
    const existing = this.logs.get(logId);
    if (!existing) throw new Error(`Log not found: ${logId}`);
    this.logs.set(logId, {
      ...existing,
      calories: entry.calories,
      protein: entry.protein ?? undefined,
      exerciseCompleted: entry.exerciseCompleted ? true : undefined,
      mealLabel: entry.mealLabel ?? undefined,
      weight: entry.weight ?? existing.weight,
      date: entry.timestamp ?? existing.date,
      liftCompleted: undefined,
      cardioCompleted: undefined,
    });
  }

  async deleteLog(logId: string): Promise<void> {
    if (!this.logs.delete(logId)) throw new Error(`Log not found: ${logId}`);
  }

  async getDailyWeights(): Promise<Record<string, number>> {
    return { ...this.weights };
  }

  async setDailyWeight(dateKey: string, weight: number): Promise<void> {
    this.weights[dateKey] = weight;
  }

  async getDailyWater(): Promise<Record<string, number>> {
    return { ...this.water };
  }

  async setDailyWater(dateKey: string, ml: number): Promise<void> {
    this.water[dateKey] = Math.max(0, Math.min(20000, Math.round(ml)));
  }

  async getPresets(): Promise<MealPreset[]> {
    return [...this.presets.values()];
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<void> {
    const id = `preset-${++this.presetSeq}`;
    this.presets.set(id, { id, ...preset });
  }

  async deletePreset(presetId: string): Promise<void> {
    if (!this.presets.delete(presetId)) throw new Error(`Preset not found: ${presetId}`);
  }

  async getLatestReport(): Promise<WeeklyReport | null> {
    return this.report;
  }

  async getRecentMeasurements(count = 10): Promise<Measurement[]> {
    return [...this.measurements.values()]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, count);
  }

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    const id = `m-${++this.measurementSeq}`;
    this.measurements.set(id, { id, date: new Date(), ...entry });
  }

  async deleteMeasurement(id: string): Promise<void> {
    if (!this.measurements.delete(id)) throw new Error(`Measurement not found: ${id}`);
  }

  private patchProfile(
    patch: Partial<Profile>,
    deleteKeys: ReadonlyArray<keyof Profile> = [],
  ): void {
    const current = this._profile();
    if (!current) return;
    const next = { ...current, ...patch } as Profile;
    for (const k of deleteKeys) delete (next as unknown as Record<string, unknown>)[k as string];
    this._profile.set(next);
  }
}
