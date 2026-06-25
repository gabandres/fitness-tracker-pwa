import { Injectable, computed, signal } from '@angular/core';
import type { LedgerPort } from '../ports/ledger.port';
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
  private readonly exercises = new Map<string, Exercise>();
  private exerciseSeq = 0;
  private readonly templates = new Map<string, WorkoutTemplate>();
  private templateSeq = 0;
  private readonly sessions = new Map<string, WorkoutSession>();
  private sessionSeq = 0;

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

  async setProteinPerKg(gPerKg: number): Promise<void> {
    const clamped = Math.min(2.2, Math.max(1.6, gPerKg));
    this.patchProfile({ proteinPerKg: clamped });
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
    this.exercises.clear();
    this.templates.clear();
    this.sessions.clear();
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
      exercises: [...this.exercises.values()],
      workoutTemplates: [...this.templates.values()],
      workoutSessions: [...this.sessions.values()],
    };
  }

  async addLog(entry: LogEntry): Promise<string> {
    const id = `log-${++this.logSeq}`;
    this.logs.set(id, {
      id,
      calories: entry.calories,
      date: entry.timestamp ?? new Date(),
      weight: entry.weight,
      protein: entry.protein,
      carbs: entry.carbs,
      fat: entry.fat,
      exerciseCompleted: entry.exerciseCompleted || undefined,
      mealLabel: entry.mealLabel,
      mealType: entry.mealType,
    });
    return id;
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
      carbs: entry.carbs ?? undefined,
      fat: entry.fat ?? undefined,
      exerciseCompleted: entry.exerciseCompleted ? true : undefined,
      mealLabel: entry.mealLabel ?? undefined,
      mealType: entry.mealType ?? undefined,
      weight: entry.weight ?? existing.weight,
      date: entry.timestamp ?? existing.date,
      liftCompleted: undefined,
      cardioCompleted: undefined,
    });
  }

  async deleteLog(logId: string): Promise<void> {
    if (!this.logs.delete(logId)) throw new Error(`Log not found: ${logId}`);
  }

  async importLogs(entries: readonly LogEntry[]): Promise<number> {
    for (const e of entries) await this.addLog(e);
    return entries.length;
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

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<string> {
    const id = `preset-${++this.presetSeq}`;
    this.presets.set(id, { id, ...preset });
    return id;
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

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<string> {
    const id = `m-${++this.measurementSeq}`;
    this.measurements.set(id, { id, date: new Date(), ...entry });
    return id;
  }

  async deleteMeasurement(id: string): Promise<void> {
    if (!this.measurements.delete(id)) throw new Error(`Measurement not found: ${id}`);
  }

  // ─── Workout: exercise catalog ────────────────────────────────
  async getExercises(): Promise<Exercise[]> {
    return [...this.exercises.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async addExercise(exercise: ExerciseDraft): Promise<string> {
    const id = `ex-${++this.exerciseSeq}`;
    this.exercises.set(id, { ...exercise, id, createdAt: new Date() });
    return id;
  }

  async updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<void> {
    const existing = this.exercises.get(id);
    if (!existing) throw new Error(`Exercise not found: ${id}`);
    this.exercises.set(id, { ...existing, ...patch });
  }

  async deleteExercise(id: string): Promise<void> {
    if (!this.exercises.delete(id)) throw new Error(`Exercise not found: ${id}`);
  }

  async mergeExercises(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) return;
    const toName = this.exercises.get(toId)?.name;
    const repoint = (ex: { exerciseId: string; name: string }) =>
      ex.exerciseId === fromId ? { ...ex, exerciseId: toId, name: toName ?? ex.name } : ex;
    for (const [id, ses] of this.sessions) {
      this.sessions.set(id, { ...ses, exercises: ses.exercises.map(repoint) as typeof ses.exercises });
    }
    for (const [id, tpl] of this.templates) {
      this.templates.set(id, { ...tpl, exercises: tpl.exercises.map(repoint) as typeof tpl.exercises });
    }
    this.exercises.delete(fromId);
  }

  // ─── Workout: templates ───────────────────────────────────────
  async getTemplates(): Promise<WorkoutTemplate[]> {
    return [...this.templates.values()].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }

  async addTemplate(template: TemplateDraft): Promise<string> {
    const id = `tpl-${++this.templateSeq}`;
    const now = new Date();
    this.templates.set(id, { ...template, id, createdAt: now, updatedAt: now });
    return id;
  }

  async updateTemplate(id: string, template: TemplateDraft): Promise<void> {
    const existing = this.templates.get(id);
    if (!existing) throw new Error(`Template not found: ${id}`);
    this.templates.set(id, { ...existing, ...template, updatedAt: new Date() });
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!this.templates.delete(id)) throw new Error(`Template not found: ${id}`);
  }

  // ─── Workout: sessions ────────────────────────────────────────
  async getActiveSession(): Promise<WorkoutSession | null> {
    return [...this.sessions.values()].find((s) => s.status === 'active') ?? null;
  }

  async getRecentSessions(count = 30): Promise<WorkoutSession[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, count);
  }

  async getSessionsForTemplate(templateId: string, count = 10): Promise<WorkoutSession[]> {
    return [...this.sessions.values()]
      .filter((s) => s.templateId === templateId && s.status === 'completed')
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, count);
  }

  async getAllSessions(): Promise<WorkoutSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  async startSession(session: SessionDraft): Promise<string> {
    const id = `ses-${++this.sessionSeq}`;
    const now = new Date();
    this.sessions.set(id, { ...session, id, createdAt: now, updatedAt: now });
    return id;
  }

  async updateSession(id: string, patch: Partial<SessionDraft>): Promise<void> {
    const existing = this.sessions.get(id);
    if (!existing) throw new Error(`Session not found: ${id}`);
    this.sessions.set(id, { ...existing, ...patch, updatedAt: new Date() });
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.sessions.delete(id)) throw new Error(`Session not found: ${id}`);
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
