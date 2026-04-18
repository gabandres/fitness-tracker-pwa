import { effect, Injectable, inject, signal } from '@angular/core';
import { DailyLog, LogEntry, MealPreset } from './firebase.service';
import { FitnessStore, PresetLimitError } from './fitness-store.service';
import { MacroEstimate } from '../models/macro-estimate';
import { TranslationService } from './translation.service';
import { AuthService } from './auth.service';
import { localDateKey } from '../utils/date';

// Hoisted to root so non-ledger surfaces (dashboard empty-state hero,
// future FAB / quick-add buttons) can call `startAdd()` + `requestLogFocus()`
// without going through an event-bus service. There's only ever one
// active entry-form flow in the app at a time; the previous
// ledger-local provider was effectively a singleton anyway.
@Injectable({ providedIn: 'root' })
export class EntryFormManager {
  private readonly store = inject(FitnessStore);
  private readonly translation = inject(TranslationService);
  private readonly auth = inject(AuthService);

  constructor() {
    // Now that EntryFormManager is a root singleton, sign-out must reset
    // the in-flight form state — otherwise a subsequent sign-in by a
    // different user could re-enter edit mode pointing at the previous
    // user's DailyLog.id and a save would target the wrong document.
    // Watch auth state and fully reset on any transition to signed-out.
    let prevSignedIn = this.auth.isSignedIn();
    effect(() => {
      const signedIn = this.auth.isSignedIn();
      if (prevSignedIn && !signedIn) this.reset();
      prevSignedIn = signedIn;
    });
  }

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
  /** Set true when a free-tier user hits PRESET_LIMIT_FREE; used by the
      entry-form template to surface the contextual upsell card. Cleared
      on the next successful preset save or form reset. */
  readonly presetLimitHit = signal(false);

  /** Bumped when a non-ledger surface (dashboard empty-state hero, mobile
      CTAs) wants the app shell to switch to the log tab and scroll to
      the ledger. Counter signal so repeat clicks re-fire. App.ts listens
      via effect and handles the tab switch + scroll. */
  readonly logTabRequestCount = signal(0);
  requestLogFocus(): void {
    this.logTabRequestCount.update((n) => n + 1);
  }

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
    try {
      await this.store.addPreset(preset);
      this.savingPreset.set(false);
    } catch (err) {
      this.savingPreset.set(false);
      if (err instanceof PresetLimitError) {
        this.status.set('error');
        this.errorMsg.set(this.translation.t('errors.presetLimitReached', { limit: err.limit }));
        this.presetLimitHit.set(true);
        return;
      }
      throw err;
    }
  }

  // ── Private ─────────────────────────────────────────────────

  private resetForm(): void {
    this.calories.set(null);
    this.protein.set(null);
    this.exerciseDone.set(false);
    this.activePresetName.set(null);
    this.mealLabel.set('');
    this.entryDate.set(localDateKey(new Date()));
    this.presetLimitHit.set(false);
  }

  /**
   * Full state reset including mode + editTarget + errors. Called on
   * sign-out so a subsequent sign-in by a different user can't
   * accidentally save against the previous user's `DailyLog.id` if
   * the form was mid-edit. Safe to call at any time — clears back to
   * the same state the component initialises with.
   */
  reset(): void {
    this.mode.set('view');
    this.editTarget.set(null);
    this.addingForDay.set(null);
    this.status.set('idle');
    this.errorMsg.set('');
    this.savingPreset.set(false);
    this.presetName.set('');
    this.resetForm();
  }
}
