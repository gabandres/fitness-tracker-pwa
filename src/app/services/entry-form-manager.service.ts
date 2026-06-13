import { effect, Injectable, inject, signal } from '@angular/core';
import { DailyLog, MealPreset, MealType } from './firebase.service';
import { FitnessStore, PresetLimitError } from './fitness-store.service';
import { MacroEstimate } from '../models/macro-estimate';
import { TranslationService } from './translation.service';
import { AuthService } from './auth.service';
import { localDateKey } from '../utils/date';
import {
  MEAL_DRAFT_ERROR_MESSAGE_KEYS,
  MealDraftResult,
  defaultMealTypeForHour,
  parseMealDraft,
} from '../utils/meal-draft';

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

  /** Snapshot of the last ADD-mode save (calories, macros, label) so
      the "save as preset" affordance survives the post-save reset that
      clears the form fields. Without this, `confirmSavePreset()` read
      null calories from the cleared form and silently no-op'd. */
  private lastSavedEntry: {
    calories: number; protein?: number; carbs?: number; fat?: number; label?: string;
  } | null = null;

  /** Handle for the ADD-mode auto-close timer so the "save as preset"
      sub-flow can cancel it. Otherwise the timer fires mid-flow and
      cancels the whole form while the user is naming their preset. */
  private addAutoCloseTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** Diary slot. Defaults by time-of-day on ADD; null = no slot
   *  ("other" bucket) — edit mode never invents one for legacy rows. */
  readonly mealType = signal<MealType | null>(defaultMealTypeForHour(new Date().getHours()));
  readonly entryDate = signal<string>(localDateKey(new Date()));
  readonly calories = signal<number | null>(null);
  readonly protein = signal<number | null>(null);
  readonly carbs = signal<number | null>(null);
  readonly fat = signal<number | null>(null);
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
    this.carbs.set(meal.carbs ?? null);
    this.fat.set(meal.fat ?? null);
    // Derive exercise toggle from the new field OR either legacy flag.
    this.exerciseDone.set(
      meal.exerciseCompleted ?? meal.liftCompleted ?? meal.cardioCompleted ?? false,
    );
    this.mealLabel.set(meal.mealLabel ?? '');
    this.mealType.set(meal.mealType ?? null);
    this.entryDate.set(localDateKey(meal.date));
    this.status.set('idle');
  }

  cancel(): void {
    if (this.addAutoCloseTimer) {
      clearTimeout(this.addAutoCloseTimer);
      this.addAutoCloseTimer = null;
    }
    this.lastSavedEntry = null;
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
    if (est.carbs != null) this.carbs.set(est.carbs);
    if (est.fat != null) this.fat.set(est.fat);
    this.activePresetName.set(est.label);
    this.mealLabel.set(est.label);
  }

  // ── Submit / Delete ─────────────────────────────────────────

  /** The current form fields parsed into a persistable draft (or an
   *  error), via the one pure parser that owns all coercion + validation.
   *  `submit()` persists this; `entry-sheet` reads it to gate its inline
   *  kcal-error visual against the exact same rule. */
  currentDraft(): MealDraftResult {
    return parseMealDraft({
      calories: this.calories(),
      protein: this.protein(),
      carbs: this.carbs(),
      fat: this.fat(),
      exerciseCompleted: this.exerciseDone(),
      mealLabel: this.mealLabel(),
      mealType: this.mealType(),
      activePresetName: this.activePresetName(),
      dateKey: this.entryDate(),
    });
  }

  async submit(): Promise<void> {
    const result = this.currentDraft();
    if (!result.ok) {
      this.status.set('error');
      this.errorMsg.set(this.translation.t(MEAL_DRAFT_ERROR_MESSAGE_KEYS[result.error]));
      return;
    }
    const { entry, calories, protein, carbs, fat, label } = result.draft;

    this.status.set('saving');
    try {
      const editing = this.editTarget();
      if (this.mode() === 'edit' && editing?.id) {
        await this.store.updateLog(editing.id, entry);
      } else {
        await this.store.addLog(entry);
      }
      this.status.set('saved');
      // Short tactile confirmation on supported devices (mobile primarily).
      // No-op on desktop browsers that don't implement the Vibration API.
      try { navigator.vibrate?.(20); } catch { /* ignore */ }
      this.savingPreset.set(false);
      if (this.mode() === 'edit') {
        setTimeout(() => this.cancel(), 800);
      } else {
        // ADD mode: stash the just-saved values before we clear the form
        // so the "save as preset" sub-flow still has calories + label to
        // work with (confirmSavePreset reads from here now). Without the
        // snapshot the reset zeroed out calories and the preset save
        // silently no-op'd on its `cal == null` guard.
        this.lastSavedEntry = { calories };
        if (protein != null) this.lastSavedEntry.protein = protein;
        if (carbs != null) this.lastSavedEntry.carbs = carbs;
        if (fat != null) this.lastSavedEntry.fat = fat;
        if (label) this.lastSavedEntry.label = label;

        // Clear fields so a second SAVE click can't duplicate the entry.
        this.resetForm();

        // Arm auto-close. Held in an instance field so promptSavePreset()
        // can cancel it — otherwise the timer fires while the user is
        // typing a preset name and yanks the form out from under them.
        if (this.addAutoCloseTimer) clearTimeout(this.addAutoCloseTimer);
        this.addAutoCloseTimer = setTimeout(() => {
          this.addAutoCloseTimer = null;
          if (this.status() === 'saved' && !this.savingPreset()) this.cancel();
        }, 3000);
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
    // Cancel the ADD-mode auto-close timer — the user is still using
    // the form, so tearing it down in ~3s would cancel the preset save
    // mid-type.
    if (this.addAutoCloseTimer) {
      clearTimeout(this.addAutoCloseTimer);
      this.addAutoCloseTimer = null;
    }
    this.savingPreset.set(true);
    this.presetName.set(this.lastSavedEntry?.label ?? '');
  }

  async confirmSavePreset(): Promise<void> {
    const name = this.presetName().trim();
    // Prefer the post-save snapshot — the form fields themselves get
    // cleared after ADD-mode save so preset can't reach back through
    // the live signals.
    const snap = this.lastSavedEntry;
    const cal = snap?.calories ?? this.calories();
    if (!name || cal == null) return;
    const preset: Omit<MealPreset, 'id'> = { name, calories: Number(cal) };
    const pro = snap?.protein ?? this.protein();
    if (pro != null) preset.protein = Number(pro);
    const carb = snap?.carbs ?? this.carbs();
    if (carb != null) preset.carbs = Number(carb);
    const f = snap?.fat ?? this.fat();
    if (f != null) preset.fat = Number(f);
    try {
      await this.store.addPreset(preset);
      this.savingPreset.set(false);
      // Preset saved successfully — close the form now since both the
      // entry and preset are done. Keeping it open would show a stale
      // empty form with a dangling "SAVED" stamp.
      this.cancel();
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
    this.carbs.set(null);
    this.fat.set(null);
    this.exerciseDone.set(false);
    this.activePresetName.set(null);
    this.mealLabel.set('');
    this.mealType.set(defaultMealTypeForHour(new Date().getHours()));
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
    if (this.addAutoCloseTimer) {
      clearTimeout(this.addAutoCloseTimer);
      this.addAutoCloseTimer = null;
    }
    this.lastSavedEntry = null;
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
