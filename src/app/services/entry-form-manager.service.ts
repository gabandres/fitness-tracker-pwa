import { Injectable, inject, signal } from '@angular/core';
import { DailyLog, LogEntry, MealPreset } from './firebase.service';
import { FitnessStore } from './fitness-store.service';
import { MacroEstimate } from '../models/macro-estimate';
import { TranslationService } from './translation.service';
import { localDateKey } from '../utils/date';

@Injectable()
export class EntryFormManager {
  private readonly store = inject(FitnessStore);
  private readonly translation = inject(TranslationService);

  // ── Mode state machine ──────────────────────────────────────
  readonly mode = signal<'view' | 'add' | 'edit'>('view');
  readonly editTarget = signal<DailyLog | null>(null);
  readonly addingForDay = signal<string | null>(null);
  readonly status = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly errorMsg = signal('');

  // ── Preset save sub-flow ────────────────────────────────────
  readonly savingPreset = signal(false);
  readonly presetName = signal('');
  readonly activePresetName = signal<string | null>(null);

  // ── Form field signals ──────────────────────────────────────
  readonly mealLabel = signal<string>('');
  readonly entryDate = signal<string>(localDateKey(new Date()));
  readonly calories = signal<number | null>(null);
  readonly protein = signal<number | null>(null);
  readonly exerciseDone = signal(false);

  // ── Mode transitions ────────────────────────────────────────

  startAdd(dateKey: string | null = null): void {
    this.resetForm();
    this.mode.set('add');
    this.editTarget.set(null);
    this.addingForDay.set(dateKey);
    if (dateKey) this.entryDate.set(dateKey);
    this.status.set('idle');
  }

  onTapMeal(meal: DailyLog): void {
    if (this.editTarget()?.id === meal.id && this.mode() === 'edit') {
      this.cancel();
      return;
    }
    this.editTarget.set(meal);
    this.addingForDay.set(null);
    this.mode.set('edit');
    this.calories.set(meal.calories);
    this.protein.set(meal.protein ?? null);
    // Derive exercise toggle from the new field OR either legacy flag.
    this.exerciseDone.set(
      meal.exerciseCompleted ?? meal.liftCompleted ?? meal.cardioCompleted ?? false,
    );
    this.mealLabel.set(meal.mealLabel ?? '');
    this.entryDate.set(localDateKey(meal.date));
    this.status.set('idle');
  }

  cancel(): void {
    this.mode.set('view');
    this.editTarget.set(null);
    this.addingForDay.set(null);
    this.resetForm();
    this.status.set('idle');
  }

  // ── Apply estimate (from photo / barcode / preset) ──────────

  applyEstimate(est: MacroEstimate): void {
    this.calories.set(est.calories);
    if (est.protein != null) this.protein.set(est.protein);
    this.activePresetName.set(est.label);
    this.mealLabel.set(est.label);
  }

  // ── Submit / Delete ─────────────────────────────────────────

  async submit(): Promise<void> {
    const c = this.calories();
    if (c == null || Number.isNaN(c)) {
      this.status.set('error');
      this.errorMsg.set(this.translation.t('entry.errorCaloriesRequired'));
      return;
    }

    const entry: LogEntry = { calories: Number(c) };
    const p = this.protein();
    if (p != null && !Number.isNaN(Number(p))) entry.protein = Number(p);
    entry.exerciseCompleted = this.exerciseDone();

    const dateStr = this.entryDate();
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      entry.timestamp = new Date(y, m - 1, d, 12, 0, 0);
    }

    const label = this.mealLabel().trim() || this.activePresetName();
    if (label) entry.mealLabel = label;

    this.status.set('saving');
    try {
      const editing = this.editTarget();
      if (this.mode() === 'edit' && editing?.id) {
        await this.store.updateLog(editing.id, entry);
      } else {
        await this.store.addLog(entry);
      }
      this.status.set('saved');
      this.savingPreset.set(false);
      if (this.mode() === 'edit') {
        setTimeout(() => this.cancel(), 800);
      }
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : this.translation.t('entry.errorFailedToSave'));
    }
  }

  async deleteEntry(): Promise<void> {
    const target = this.editTarget();
    if (!target?.id) return;
    try {
      await this.store.deleteLog(target.id);
      this.cancel();
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : this.translation.t('entry.errorFailedToDelete'));
    }
  }

  // ── Preset save flow ───────────────────────────────────────

  promptSavePreset(): void {
    this.savingPreset.set(true);
    this.presetName.set('');
  }

  async confirmSavePreset(): Promise<void> {
    const name = this.presetName().trim();
    const cal = this.calories();
    if (!name || cal == null) return;
    const preset: Omit<MealPreset, 'id'> = { name, calories: Number(cal) };
    const pro = this.protein();
    if (pro != null) preset.protein = Number(pro);
    await this.store.addPreset(preset);
    this.savingPreset.set(false);
  }

  // ── Private ─────────────────────────────────────────────────

  private resetForm(): void {
    this.calories.set(null);
    this.protein.set(null);
    this.exerciseDone.set(false);
    this.activePresetName.set(null);
    this.mealLabel.set('');
    this.entryDate.set(localDateKey(new Date()));
  }
}
